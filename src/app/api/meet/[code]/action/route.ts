import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { media, meeting } from "@/db/schema";
import {
  addMessage,
  admitParticipant,
  endMeeting,
  getMeetingByCode,
  getStage,
  heartbeat,
  lowerAllHands,
  participantByPeerId,
  postSignals,
  removeParticipant,
  requestMute,
  setParticipantRole,
  setSpotlight,
  setStage,
  startRecordingRow,
} from "@/lib/meetings";
import { isHostRole, type Stage } from "@/lib/meetings-shared";
import { lookupVerse } from "@/lib/scripture";
import { DEFAULT_TRANSLATION } from "@/lib/scripture-shared";
import { fail, json, readJson, requirePeer } from "@/lib/meeting-api";
import { audit, auditGuest } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  peer?: unknown;
  secret?: unknown;
  action?: unknown;
  [k: string]: unknown;
};

const str = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * POST /api/meet/<code>/action — everything that changes the room.
 *
 * Kept apart from /sync on purpose. /sync carries peer-to-peer traffic that
 * any participant may send; everything here either changes what the whole room
 * sees or exercises authority over somebody else, so every branch that needs a
 * host says so and the check is in one readable place.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const body = await readJson<Body>(request);
  const action = str(body?.action, 40);
  if (!action) return fail("No action given.");

  const m = await getMeetingByCode(code);
  if (!m) return fail("That meeting has gone.", 404);

  const peer = await requirePeer(m.id, body);
  if (!peer)
    return fail("You've been signed out of this meeting.", 401, { code: "stale-peer" });

  await heartbeat(peer.id);
  const host = isHostRole(peer.role);
  const deny = () => fail("Only the host can do that.", 403);

  /** Announce something to the whole room. */
  const broadcast = (type: Parameters<typeof postSignals>[2][number]["type"], payload: Record<string, unknown>) =>
    postSignals(m.id, peer.peerId, [{ toPeer: null, type, payload }]);

  const log = async (opts: {
    action: string;
    summary: string;
    meta?: Record<string, unknown>;
    severity?: "info" | "notice" | "warning" | "critical";
  }) => {
    const entry = {
      action: opts.action,
      summary: opts.summary,
      targetType: "meeting" as const,
      targetId: m.id,
      targetLabel: m.title,
      meta: opts.meta,
      severity: opts.severity,
    };
    if (peer.userId) await audit({ churchId: m.churchId, ...entry });
    else
      await auditGuest({
        churchId: m.churchId,
        guestName: peer.displayName,
        ...entry,
      });
  };

  switch (action) {
    /* ---------------------------------------------------------- chat */
    case "chat": {
      if (!m.allowChat) return fail("Chat is turned off for this meeting.", 403);
      const text = str(body?.body, 2000);
      if (!text) return fail("Type something first.");
      const row = await addMessage({
        meetingId: m.id,
        churchId: m.churchId,
        participantId: peer.id,
        authorName: peer.displayName,
        body: text,
      });
      await broadcast("chat", {
        id: row.id,
        authorName: peer.displayName,
        peerId: peer.peerId,
        body: text,
        kind: "chat",
        createdAt: row.createdAt.toISOString(),
      });
      return json({ ok: true, id: row.id, createdAt: row.createdAt.toISOString() });
    }

    /* ----------------------------------------------------- spotlight */
    case "spotlight": {
      if (!host) return deny();
      const wanted = str(body?.peerId, 64) || null;

      // A spotlight on somebody who is not in the room is a blank screen for
      // everybody, so it is checked against the roster rather than trusted.
      let name: string | null = null;
      if (wanted) {
        const row = await participantByPeerId(m.id, wanted);
        if (!row) return fail("They have already left the meeting.", 404);
        name = row.displayName;
      }

      await setSpotlight(m.id, wanted);
      await broadcast("control", { action: "spotlight", peerId: wanted });
      await log({
        action: "meetings.stage.update",
        summary: wanted
          ? `Put ${name} on the main screen in "${m.title}"`
          : `Cleared the main screen in "${m.title}"`,
      });
      return json({ ok: true, spotlightPeerId: wanted });
    }

    /* --------------------------------------------------------- stage */
    case "stage.verse": {
      if (!host) return deny();
      const reference = str(body?.reference, 120);
      const translation = str(body?.translation, 12) || DEFAULT_TRANSLATION;
      const pasted = str(body?.text, 4000);

      // A pasted text always wins. It is the escape hatch for a translation we
      // cannot fetch, a local-language Bible, or simply no internet — and the
      // screen has to work in all three.
      let verseBody = pasted;
      let usedTranslation = translation;
      if (!verseBody) {
        const found = await lookupVerse(reference, translation);
        if (!found.ok) return fail(found.error, 422);
        verseBody = found.body;
        usedTranslation = found.translation;
      }

      const stage: Stage = {
        kind: "verse",
        reference: reference || "Scripture",
        translation: usedTranslation,
        body: verseBody,
        rev: (await getStage(m.id)).rev + 1,
      };
      await setStage(m.id, stage);
      await broadcast("stage", stage as unknown as Record<string, unknown>);
      await log({
        action: "meetings.stage.update",
        summary: `Put ${stage.reference} on the screen in "${m.title}"`,
        meta: { kind: "verse", reference: stage.reference, translation: usedTranslation },
      });
      return json({ ok: true, stage });
    }

    case "stage.text": {
      if (!host) return deny();
      const text = str(body?.body, 4000);
      if (!text) return fail("Type something to put on the screen.");
      const stage: Stage = {
        kind: "text",
        title: str(body?.title, 160) || null,
        body: text,
        rev: (await getStage(m.id)).rev + 1,
      };
      await setStage(m.id, stage);
      await broadcast("stage", stage as unknown as Record<string, unknown>);
      await log({
        action: "meetings.stage.update",
        summary: `Put a note on the screen in "${m.title}"`,
        meta: { kind: "text", title: stage.title },
      });
      return json({ ok: true, stage });
    }

    case "stage.slides": {
      if (!host) return deny();
      const ids = Array.isArray(body?.slides)
        ? (body.slides as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 100)
        : [];
      if (ids.length === 0) return fail("Pick at least one slide.");

      // Resolve to URLs here, scoped to this church — a media id posted from
      // the client is never trusted to belong to it.
      const rows = await db
        .select({ id: media.id, url: media.url })
        .from(media)
        .where(and(eq(media.churchId, m.churchId), inArray(media.id, ids)));
      const urlById = new Map(rows.map((r) => [r.id, r.url]));
      const ordered = ids
        .map((id) => ({ id, url: urlById.get(id) }))
        .filter((x): x is { id: string; url: string } => !!x.url);
      if (ordered.length === 0)
        return fail("Those slides aren't in your media library.", 404);

      const stage: Stage = {
        kind: "slide",
        slides: ordered.map((o) => o.id),
        urls: ordered.map((o) => o.url),
        index: 0,
        rev: (await getStage(m.id)).rev + 1,
      };
      await setStage(m.id, stage);
      await db
        .update(meeting)
        .set({ slides: stage.slides })
        .where(eq(meeting.id, m.id));
      await broadcast("stage", stage as unknown as Record<string, unknown>);
      await log({
        action: "meetings.stage.update",
        summary: `Started sharing ${ordered.length} slide${ordered.length === 1 ? "" : "s"} in "${m.title}"`,
        meta: { kind: "slide", count: ordered.length },
      });
      return json({ ok: true, stage });
    }

    case "stage.slide": {
      if (!host) return deny();
      const current = await getStage(m.id);
      if (current.kind !== "slide") return fail("No slides are showing.", 409);
      const wanted = Number(body?.index);
      const index = Number.isFinite(wanted)
        ? Math.max(0, Math.min(current.urls.length - 1, Math.floor(wanted)))
        : 0;
      const stage: Stage = { ...current, index, rev: current.rev + 1 };
      await setStage(m.id, stage);
      await broadcast("stage", stage as unknown as Record<string, unknown>);
      return json({ ok: true, stage });
    }

    case "stage.clear": {
      if (!host) return deny();
      const stage: Stage = { kind: "none", rev: (await getStage(m.id)).rev + 1 };
      await setStage(m.id, stage);
      await broadcast("stage", stage as unknown as Record<string, unknown>);
      return json({ ok: true, stage });
    }

    /* ------------------------------------------------- host controls */
    case "admit":
    case "deny": {
      if (!host) return deny();
      const id = str(body?.participantId, 60);
      if (!id) return fail("Which person?");
      if (action === "admit") {
        const row = await admitParticipant(m.id, id);
        if (!row) return fail("They're no longer waiting.", 404);
        await broadcast("control", { action: "admitted", peerId: row.peerId, name: row.name });
        await log({
          action: "meetings.participant.admit",
          summary: `Let ${row.name} into "${m.title}"`,
          meta: { name: row.name },
        });
        return json({ ok: true });
      }
      const row = await removeParticipant(m.id, id);
      if (!row) return fail("They're no longer waiting.", 404);
      await broadcast("control", { action: "denied", peerId: row.peerId });
      await log({
        action: "meetings.participant.deny",
        summary: `Refused ${row.name} entry to "${m.title}"`,
        meta: { name: row.name },
        severity: "notice",
      });
      return json({ ok: true });
    }

    case "remove": {
      if (!host) return deny();
      const id = str(body?.participantId, 60);
      const row = await removeParticipant(m.id, id);
      if (!row) return fail("They've already left.", 404);
      await broadcast("control", { action: "removed", peerId: row.peerId });
      await addMessage({
        meetingId: m.id,
        churchId: m.churchId,
        participantId: null,
        authorName: "System",
        body: `${row.name} was removed from the meeting`,
        kind: "system",
      });
      await log({
        action: "meetings.participant.remove",
        summary: `Removed ${row.name} from "${m.title}"`,
        meta: { name: row.name, removedUserId: row.userId },
        severity: "warning",
      });
      return json({ ok: true });
    }

    case "mute": {
      if (!host) return deny();
      const id = str(body?.participantId, 60);
      const peers = await requestMute(m.id, id ? [id] : undefined);
      await broadcast("control", { action: "mute", peers });
      await log({
        action: "meetings.participant.mute",
        summary: id
          ? `Muted someone in "${m.title}"`
          : `Muted everyone in "${m.title}"`,
        meta: { count: peers.length, everyone: !id },
      });
      return json({ ok: true, muted: peers.length });
    }

    case "promote": {
      if (!host) return deny();
      const id = str(body?.participantId, 60);
      const wanted = str(body?.role, 20);
      if (!["cohost", "speaker", "attendee"].includes(wanted))
        return fail("That isn't a role.");
      const row = await setParticipantRole(m.id, id, wanted as "cohost" | "speaker" | "attendee");
      if (!row) return fail("They've already left.", 404);
      await broadcast("control", { action: "role", peerId: row.peerId, role: wanted });
      await log({
        action: "meetings.participant.promote",
        summary: `Made ${row.name} a ${wanted} in "${m.title}"`,
        meta: { name: row.name, role: wanted },
        severity: "notice",
      });
      return json({ ok: true });
    }

    case "lower-hands": {
      if (!host) return deny();
      await lowerAllHands(m.id);
      await broadcast("control", { action: "lower-hands" });
      return json({ ok: true });
    }

    case "end": {
      if (!host) return deny();
      await endMeeting(m.id);
      await broadcast("control", { action: "ended" });
      await log({
        action: "meetings.meeting.end",
        summary: `Ended the meeting "${m.title}"`,
        severity: "notice",
      });
      return json({ ok: true });
    }

    /* ----------------------------------------------------- recording */
    case "recording.start": {
      if (!host) return deny();
      if (!m.allowRecording)
        return fail("Recording is turned off for this meeting.", 403);
      const mode = str(body?.mode, 10) === "audio" ? "audio" : "video";
      const id = await startRecordingRow({
        meetingId: m.id,
        churchId: m.churchId,
        title: `${m.title} — ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
        mode,
        createdBy: peer.userId,
      });
      await broadcast("recording", { state: "started", by: peer.displayName, mode });
      await addMessage({
        meetingId: m.id,
        churchId: m.churchId,
        participantId: null,
        authorName: "System",
        body: `${peer.displayName} started recording this meeting`,
        kind: "system",
      });
      await log({
        action: "meetings.recording.create",
        summary: `Started recording "${m.title}" (${mode})`,
        meta: { mode, recordingId: id },
        severity: "notice",
      });
      return json({ ok: true, recordingId: id });
    }

    case "recording.stop": {
      if (!host) return deny();
      await broadcast("recording", { state: "stopped", by: peer.displayName });
      await addMessage({
        meetingId: m.id,
        churchId: m.churchId,
        participantId: null,
        authorName: "System",
        body: "Recording stopped",
        kind: "system",
      });
      return json({ ok: true });
    }

    default:
      return fail("We don't know that action.", 400);
  }
}
