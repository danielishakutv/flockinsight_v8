"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { audit } from "@/lib/audit";
import { siteUrl } from "@/lib/site";
import {
  CODE_MAX,
  DESTINATION_MAX,
  LINK_STATUSES,
  checkDestination,
  codeProblem,
  normaliseCode,
  prettyDestination,
} from "@/lib/links-shared";
import {
  codeTaken,
  createLink,
  freeCode,
  getLink,
  setLinkStatus,
  updateLink,
} from "@/lib/links";
import { deleteQrCode, noteDownload, saveQrCode } from "@/lib/qr-codes";
import { normaliseDesign } from "@/lib/qr/design";
import { normalisePayload } from "@/lib/qr/payload";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

/**
 * The two halves of this module are gated separately, and that is the point.
 *
 * Drawing a QR code runs entirely on the church's device and costs us nothing,
 * so it is on Starter. A short link is a redirect we serve on every scan for as
 * long as the poster exists, so it is on Growth. One module, two gates — see
 * the notes beside `qrCodes` and `shortLinks` in lib/entitlements.ts.
 *
 * Both guards return a refusal to return rather than throwing, which is the
 * shape every action in this app speaks.
 */
async function guardLinks() {
  const gate = await refuseWithoutFeature("shortLinks");
  if (gate) return { ctx: null, refusal: gate };
  const ctx = await requireChurch();
  if (!(await can("links.manage"))) {
    return {
      ctx: null,
      refusal: {
        ok: false as const,
        error: "You don't have permission to manage short links.",
      },
    };
  }
  return { ctx, refusal: null };
}

async function guardCodes() {
  const gate = await refuseWithoutFeature("qrCodes");
  if (gate) return { ctx: null, refusal: gate };
  const ctx = await requireChurch();
  if (!(await can("links.manage"))) {
    return {
      ctx: null,
      refusal: {
        ok: false as const,
        error: "You don't have permission to manage QR codes.",
      },
    };
  }
  return { ctx, refusal: null };
}

/* ============================================================
 * Short links
 * ========================================================== */

const linkSchema = z.object({
  id: z.string().uuid().nullish(),
  code: z.string().trim().max(CODE_MAX),
  destination: z.string().trim().min(1).max(DESTINATION_MAX),
  title: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(160).nullable(),
  ),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(600).nullable(),
  ),
  /** A date from an <input type="date">, or empty for never. */
  expiresOn: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(32).nullable(),
  ),
  status: z.enum(LINK_STATUSES),
});

export type LinkInput = z.input<typeof linkSchema>;

/**
 * The expiry, as the end of the day the church chose.
 *
 * A date with no time means midnight, which would stop a link working at the
 * start of the day somebody picked rather than the end of it — so "expires 24
 * December" would break the link all through Christmas Eve. One line, and the
 * kind of thing that is obvious only after somebody rings about it.
 */
function endOfDay(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function saveLink(input: LinkInput): Promise<ActionResult> {
  const { ctx, refusal } = await guardLinks();
  if (refusal) return refusal;

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const data = parsed.data;

  const code = normaliseCode(data.code);
  const problem = codeProblem(code);
  if (problem) return { ok: false, error: problem };

  // `siteUrl()` so a destination pointing at one of our own short links can be
  // refused — that is a redirect loop, and the browser's own cap on redirects
  // is not a diagnosis anybody can read.
  const host = new URL(siteUrl()).hostname;
  const destination = checkDestination(data.destination, host);
  if (!destination.ok) return { ok: false, error: destination.error };

  if (await codeTaken(code, data.id ?? undefined)) {
    return {
      ok: false,
      error: `“${code}” is already in use. Try another word.`,
    };
  }

  if (data.id) {
    const res = await updateLink({
      churchId: ctx.church.id,
      id: data.id,
      code,
      destination: destination.url,
      title: data.title,
      note: data.note,
      expiresAt: endOfDay(data.expiresOn),
      status: data.status,
      userId: ctx.user.id,
    });
    if (!res.ok) return res;

    await audit({
      churchId: ctx.church.id,
      /*
       * A destination change gets its own action key, because it is the one
       * edit with consequences outside this app: every printed copy of the
       * code now goes somewhere else. Somebody reading the log a year later
       * needs to find it without reading every "update".
       */
      action: res.destinationChanged ? "links.link.repoint" : "links.link.update",
      summary: res.destinationChanged
        ? `Pointed /l/${code} at ${prettyDestination(destination.url, 90)}`
        : `Edited the short link /l/${code}`,
      targetType: "short_link",
      targetId: data.id,
      targetLabel: `/l/${code}`,
      severity: res.destinationChanged ? "notice" : "info",
    });

    revalidatePath("/links");
    revalidatePath(`/links/${data.id}`);
    return { ok: true, id: data.id };
  }

  const res = await createLink({
    churchId: ctx.church.id,
    code,
    destination: destination.url,
    title: data.title,
    note: data.note,
    expiresAt: endOfDay(data.expiresOn),
    userId: ctx.user.id,
  });
  if (!res.ok) return res;

  await audit({
    churchId: ctx.church.id,
    action: "links.link.create",
    summary: `Made the short link /l/${code}, pointing at ${prettyDestination(destination.url, 90)}`,
    targetType: "short_link",
    targetId: res.id,
    targetLabel: `/l/${code}`,
  });

  revalidatePath("/links");
  return { ok: true, id: res.id };
}

export async function setStatus(
  id: string,
  status: (typeof LINK_STATUSES)[number],
): Promise<ActionResult> {
  const { ctx, refusal } = await guardLinks();
  if (refusal) return refusal;
  if (!LINK_STATUSES.includes(status)) return { ok: false, error: "Unknown status." };

  const changed = await setLinkStatus(ctx.church.id, id, status);
  if (!changed) return { ok: false, error: "That link no longer exists." };

  await audit({
    churchId: ctx.church.id,
    action: status === "archived" ? "links.link.archive" : "links.link.update",
    summary:
      status === "active"
        ? "Turned a short link back on"
        : status === "paused"
          ? "Paused a short link"
          : "Retired a short link",
    targetType: "short_link",
    targetId: id,
    severity: status === "active" ? "info" : "notice",
  });

  revalidatePath("/links");
  revalidatePath(`/links/${id}`);
  return { ok: true, id };
}

/**
 * A code that is free, suggested from a title.
 *
 * On the server because it has to check the table — a code is unique across
 * the whole platform, so the browser cannot know. Needs the feature and the
 * permission like any other write, even though it writes nothing: it reveals
 * whether a code is taken, and that is a fact about other churches.
 */
export async function suggestCode(title: string): Promise<{ code: string } | null> {
  const { refusal } = await guardLinks();
  if (refusal) return null;
  return { code: await freeCode(typeof title === "string" ? title : "") };
}

/* ============================================================
 * QR codes
 * ========================================================== */

const codeSchema = z.object({
  id: z.string().uuid().nullish(),
  title: z.string().trim().min(1, "Give the code a name.").max(120),
  shortLinkId: z.string().uuid().nullish(),
  /*
   * `unknown`, then through `normalisePayload` and `normaliseDesign` — the same
   * two functions that mend a stored row on the way out. One definition of
   * "valid", used on both sides, instead of a Zod mirror of forty fields that
   * would drift the first time a knob was added. Same reasoning as the photo
   * studio's preset.
   */
  payload: z.unknown(),
  design: z.unknown(),
});

export type CodeInput = z.input<typeof codeSchema>;

export async function saveCode(input: CodeInput): Promise<ActionResult> {
  const { ctx, refusal } = await guardCodes();
  if (refusal) return refusal;

  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const data = parsed.data;
  const payload = normalisePayload(data.payload);

  /*
   * A dynamic code needs the shortener, which is a tier up from the designer.
   * Checked on the server because the kind arrives from the client: hiding the
   * option in the UI is not a locked door.
   */
  if (payload.kind === "link") {
    const gate = await refuseWithoutFeature("shortLinks");
    if (gate) return gate;
    if (!data.shortLinkId) {
      return { ok: false, error: "Choose which short link this code should point at." };
    }
    /*
     * The id arrives from the client, and `qr_code.short_link_id` references
     * `short_link.id` across the whole platform rather than within one church.
     * Without this check a church could save a code against ANOTHER church's
     * link id, and the designer and the list would then render that link's
     * code, status and destination back to them: a cross-tenant read, from a
     * foreign key the database was perfectly happy with.
     *
     * `getLink` is already scoped by church, so a link that is not theirs comes
     * back null. Found by the automated review of this commit, not by writing
     * the code — which is exactly the class of hole that looks fine in a
     * diff.
     */
    const link = await getLink(ctx.church.id, data.shortLinkId);
    if (!link) {
      return { ok: false, error: "Choose one of your own short links." };
    }
  }

  const res = await saveQrCode({
    churchId: ctx.church.id,
    id: data.id ?? null,
    title: data.title,
    payload,
    design: normaliseDesign(data.design),
    shortLinkId: payload.kind === "link" ? (data.shortLinkId ?? null) : null,
    userId: ctx.user.id,
  });
  if (!res.ok) return res;

  await audit({
    churchId: ctx.church.id,
    action: data.id ? "links.code.update" : "links.code.create",
    summary: data.id
      ? `Edited the QR code “${data.title}”`
      : `Made the QR code “${data.title}”`,
    targetType: "qr_code",
    targetId: res.id,
    targetLabel: data.title,
    // Never the payload: a WiFi code's password would end up in the log.
    meta: { kind: payload.kind },
  });

  revalidatePath("/links");
  revalidatePath(`/links/qr/${res.id}`);
  return { ok: true, id: res.id };
}

export async function deleteCode(id: string): Promise<ActionResult> {
  const { ctx, refusal } = await guardCodes();
  if (refusal) return refusal;

  const gone = await deleteQrCode(ctx.church.id, String(id || ""));
  if (!gone) return { ok: false, error: "That code no longer exists." };

  await audit({
    churchId: ctx.church.id,
    action: "links.code.delete",
    summary: "Deleted a QR code design",
    targetType: "qr_code",
    targetId: id,
  });

  revalidatePath("/links");
  return { ok: true };
}

/**
 * Note that a code was downloaded.
 *
 * Deliberately not audited and deliberately not gated beyond viewing: it is a
 * counter that tells a church which of its codes are actually in circulation
 * before it changes one, and an audit row per download would bury the log.
 */
export async function noteCodeDownload(id: string): Promise<void> {
  const ctx = await requireChurch();
  if (!(await can("links.view"))) return;
  await noteDownload(ctx.church.id, String(id || ""));
}
