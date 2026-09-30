"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { livestream, livestreamOutput } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import {
  addOutput,
  createLiveInput,
  deleteLiveInput,
  isStreamConfigured,
  removeOutput,
  STREAM_TARGETS,
  StreamError,
} from "@/lib/stream";
import { parseEmbed } from "@/lib/stream-embed";

export type ActionResult =
  | { ok: true; id?: string; slug?: string }
  | { ok: false; error: string };

const DENIED: ActionResult = {
  ok: false,
  error: "You don't have permission to manage livestreams.",
};

async function guard() {
  const { church, user } = await requireChurch();
  if (!(await can("meetings.manage"))) return null;
  return { churchId: church.id, userId: user.id };
}

/**
 * A readable, stable address for the public page.
 *
 * Generated once from the title and never regenerated on edit: a church puts
 * this on a poster and in a WhatsApp broadcast, and a link that changes when
 * somebody fixes a typo in the title is a link that is wrong.
 */
async function uniqueSlug(title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "live";

  for (let i = 0; i < 40; i++) {
    // A short suffix from the start, rather than "-2" on a collision: two
    // churches both streaming "sunday-service" should not race for the bare
    // slug and leave one of them looking like an afterthought.
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    const [taken] = await db
      .select({ id: livestream.id })
      .from(livestream)
      .where(eq(livestream.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  throw new Error("Could not allocate a link for this stream.");
}

const createSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  scheduledFor: z.string().optional().nullable(),
  visibility: z.enum(["public", "members"]).default("public"),
  allowChat: z.coerce.boolean().default(false),
  source: z.enum(["external", "cloudflare"]).default("external"),
  /** Only for an external stream: the YouTube/Facebook/Vimeo link. */
  externalUrl: z.string().trim().max(500).optional().nullable(),
});

/**
 * Create a livestream, and the Cloudflare input behind it.
 *
 * The input is created here rather than on first broadcast, because the RTMP
 * credentials are the whole point of the page a church opens next — somebody
 * setting up OBS on Saturday needs them on Saturday, not at the moment they
 * press "go live" in front of a congregation.
 */
export async function createLivestream(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const v = parsed.data;

  const scheduledFor = v.scheduledFor ? new Date(v.scheduledFor) : null;
  if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
    return { ok: false, error: "Pick a real date and time." };
  }

  /*
   * An external stream needs nothing from us but a valid link, so it is
   * checked and saved without touching Cloudflare at all — which is the whole
   * reason it exists. Only the Cloudflare path needs the server configured.
   */
  let embedUrl: string | null = null;
  if (v.source === "external") {
    const parsed = parseEmbed(v.externalUrl ?? "");
    if (!parsed.embedUrl) {
      return { ok: false, error: parsed.error ?? "Paste the link to your stream." };
    }
    embedUrl = parsed.embedUrl;
  } else if (!isStreamConfigured()) {
    return {
      ok: false,
      error:
        "Streaming through FlockInsight isn't set up on this server. You can still add a stream from YouTube or Facebook.",
    };
  }

  const slug = await uniqueSlug(v.title);

  let live = null;
  if (v.source === "cloudflare") {
    try {
      live = await createLiveInput({ name: `${v.title} · ${g.churchId.slice(0, 8)}` });
    } catch (e) {
      const why = e instanceof StreamError ? e.message : "Could not reach the streaming service.";
      return { ok: false, error: why };
    }
  }

  const [row] = await db
    .insert(livestream)
    .values({
      churchId: g.churchId,
      title: v.title,
      description: v.description || null,
      slug,
      scheduledFor,
      visibility: v.visibility,
      allowChat: v.allowChat,
      source: v.source,
      externalUrl: v.source === "external" ? (v.externalUrl ?? null) : null,
      embedUrl,
      inputUid: live?.uid ?? null,
      whipUrl: live?.whipUrl ?? null,
      whepUrl: live?.whepUrl ?? null,
      rtmpUrl: live?.rtmpUrl ?? null,
      rtmpKey: live?.rtmpStreamKey ?? null,
      hlsUrl: live?.hlsUrl ?? null,
      createdBy: g.userId,
    })
    .returning({ id: livestream.id, slug: livestream.slug });

  await audit({
    churchId: g.churchId,
    action: "livestreams.stream.create",
    summary: `Created the livestream "${v.title}"`,
    targetType: "livestream",
    targetId: row.id,
    targetLabel: v.title,
  });

  revalidatePath("/livestreams");
  return { ok: true, id: row.id, slug: row.slug };
}

/** Mark it live or ended. What the church says, which the page shows alongside what is arriving. */
export async function setLivestreamStatus(
  id: string,
  status: "live" | "ended" | "idle",
): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const [row] = await db
    .select({ title: livestream.title, status: livestream.status })
    .from(livestream)
    .where(and(eq(livestream.id, id), eq(livestream.churchId, g.churchId)))
    .limit(1);
  if (!row) return { ok: false, error: "That livestream has gone." };

  await db
    .update(livestream)
    .set({
      status,
      ...(status === "live" ? { startedAt: new Date(), endedAt: null } : {}),
      ...(status === "ended" ? { endedAt: new Date() } : {}),
    })
    .where(and(eq(livestream.id, id), eq(livestream.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "livestreams.stream.update",
    summary:
      status === "live"
        ? `Went live with "${row.title}"`
        : status === "ended"
          ? `Ended the livestream "${row.title}"`
          : `Reset "${row.title}" to not started`,
    targetType: "livestream",
    targetId: id,
    targetLabel: row.title,
    severity: status === "live" ? "notice" : "info",
  });

  revalidatePath("/livestreams");
  revalidatePath(`/livestreams/${id}`);
  return { ok: true, id };
}

/**
 * Delete it, and the Cloudflare input with it.
 *
 * This removes the recordings too, which is why the UI asks first and says so.
 * Ending a broadcast does not come through here: ending is a state, and the
 * recording of a service outlives the Sunday it happened on.
 */
export async function deleteLivestream(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const [row] = await db
    .select({ title: livestream.title, inputUid: livestream.inputUid })
    .from(livestream)
    .where(and(eq(livestream.id, id), eq(livestream.churchId, g.churchId)))
    .limit(1);
  if (!row) return { ok: false, error: "That livestream has gone." };

  if (row.inputUid) {
    try {
      await deleteLiveInput(row.inputUid);
    } catch (e) {
      // Carry on. An input left behind at Cloudflare is tidy-up; a row that
      // cannot be deleted is a church stuck with a stream they have finished
      // with. The audit entry records which way it went.
      console.error("[livestream] could not delete the input", e);
    }
  }

  await db
    .delete(livestream)
    .where(and(eq(livestream.id, id), eq(livestream.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "livestreams.stream.delete",
    summary: `Deleted the livestream "${row.title}" and its recordings`,
    targetType: "livestream",
    targetId: id,
    targetLabel: row.title,
    severity: "notice",
  });

  revalidatePath("/livestreams");
  return { ok: true };
}

const outputSchema = z.object({
  livestreamId: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  platform: z.enum(["youtube", "facebook", "twitch", "custom"]),
  url: z.string().trim().max(300).optional().nullable(),
  streamKey: z.string().trim().min(4).max(300),
});

/**
 * Forward this stream somewhere else — YouTube, Facebook, anywhere RTMP.
 *
 * The key goes to Cloudflare and is never stored here. It is somebody else's
 * credential: a leaked YouTube key lets anybody broadcast to that church's
 * channel, and a key we do not hold is a key we cannot leak.
 */
export async function addLivestreamOutput(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const parsed = outputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const v = parsed.data;

  const [row] = await db
    .select({ inputUid: livestream.inputUid, title: livestream.title })
    .from(livestream)
    .where(and(eq(livestream.id, v.livestreamId), eq(livestream.churchId, g.churchId)))
    .limit(1);
  if (!row?.inputUid) return { ok: false, error: "That livestream has gone." };

  const preset = STREAM_TARGETS.find((t) => t.id === v.platform);
  const url = (v.platform === "custom" ? v.url : preset?.url) ?? "";
  if (!url.startsWith("rtmp")) {
    return { ok: false, error: "That doesn't look like an RTMP address." };
  }

  let created;
  try {
    created = await addOutput(row.inputUid, { url, streamKey: v.streamKey });
  } catch (e) {
    const why = e instanceof StreamError ? e.message : "Could not add that destination.";
    return { ok: false, error: why };
  }

  await db.insert(livestreamOutput).values({
    livestreamId: v.livestreamId,
    churchId: g.churchId,
    label: v.label,
    platform: v.platform,
    url,
    outputUid: created.uid,
  });

  await audit({
    churchId: g.churchId,
    action: "livestreams.output.create",
    summary: `Sends "${row.title}" on to ${v.label}`,
    targetType: "livestream",
    targetId: v.livestreamId,
    targetLabel: row.title,
    // The address, never the key.
    meta: { platform: v.platform, url },
  });

  revalidatePath(`/livestreams/${v.livestreamId}`);
  return { ok: true };
}

export async function removeLivestreamOutput(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const [row] = await db
    .select({
      livestreamId: livestreamOutput.livestreamId,
      label: livestreamOutput.label,
      outputUid: livestreamOutput.outputUid,
      inputUid: livestream.inputUid,
      title: livestream.title,
    })
    .from(livestreamOutput)
    .innerJoin(livestream, eq(livestream.id, livestreamOutput.livestreamId))
    .where(and(eq(livestreamOutput.id, id), eq(livestreamOutput.churchId, g.churchId)))
    .limit(1);
  if (!row) return { ok: false, error: "That destination has gone." };

  if (row.inputUid && row.outputUid) {
    try {
      await removeOutput(row.inputUid, row.outputUid);
    } catch (e) {
      console.error("[livestream] could not remove the output", e);
    }
  }

  await db
    .delete(livestreamOutput)
    .where(and(eq(livestreamOutput.id, id), eq(livestreamOutput.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "livestreams.output.delete",
    summary: `Stopped sending "${row.title}" to ${row.label}`,
    targetType: "livestream",
    targetId: row.livestreamId,
    targetLabel: row.title,
  });

  revalidatePath(`/livestreams/${row.livestreamId}`);
  return { ok: true };
}

/** Everything a church has streamed, newest first. */
export async function listLivestreams(churchId: string) {
  return db
    .select()
    .from(livestream)
    .where(eq(livestream.churchId, churchId))
    .orderBy(desc(livestream.createdAt));
}
