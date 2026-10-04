import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { qrCode, shortLink, user } from "@/db/schema";
import { normaliseDesign, type QrDesign } from "@/lib/qr/design";
import {
  normalisePayload,
  payloadSummary,
  type QrKind,
  type QrPayload,
} from "@/lib/qr/payload";

/**
 * Saved QR codes, against the database.
 *
 * Every row goes out through `normalisePayload` and `normaliseDesign` on the
 * way out, not just on the way in. Those two functions are the only definition
 * of a valid payload and a valid design, and a design saved by an older build
 * is missing whatever has been added since — so a row that has sat in the
 * table for a year still opens in the designer rather than rendering a code
 * with `undefined` in its markup.
 */

export type QrRow = {
  id: string;
  title: string;
  kind: QrKind;
  payload: QrPayload;
  design: QrDesign;
  shortLinkId: string | null;
  /** The code of the short link it points at, when it points at one. */
  shortLinkCode: string | null;
  shortLinkStatus: string | null;
  /** The short link's destination, so a list can show where a code leads. */
  shortLinkDestination: string | null;
  downloadCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
  /** One line describing where it points, with no secrets in it. */
  summary: string;
};

function toRow(raw: {
  id: string;
  title: string;
  kind: string;
  payload: unknown;
  design: unknown;
  shortLinkId: string | null;
  shortLinkCode: string | null;
  shortLinkStatus: string | null;
  shortLinkDestination: string | null;
  downloadCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
}): QrRow {
  const payload = normalisePayload(raw.payload);
  return {
    id: raw.id,
    title: raw.title,
    kind: payload.kind,
    payload,
    design: normaliseDesign(raw.design),
    shortLinkId: raw.shortLinkId,
    shortLinkCode: raw.shortLinkCode,
    shortLinkStatus: raw.shortLinkStatus,
    shortLinkDestination: raw.shortLinkDestination,
    downloadCount: raw.downloadCount,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdByName: raw.createdByName,
    /*
     * For a dynamic code the summary is the LINK's destination, not the
     * payload's URL. The payload holds the short link, which is the same
     * string on every dynamic code a church owns — a list of twelve codes all
     * reading "flockinsight.com/l/…" tells nobody anything.
     */
    summary:
      payload.kind === "link" && raw.shortLinkDestination
        ? raw.shortLinkDestination
        : payloadSummary(payload),
  };
}

const SELECTION = {
  id: qrCode.id,
  title: qrCode.title,
  kind: qrCode.kind,
  payload: qrCode.payload,
  design: qrCode.design,
  shortLinkId: qrCode.shortLinkId,
  shortLinkCode: shortLink.code,
  shortLinkStatus: shortLink.status,
  shortLinkDestination: shortLink.destination,
  downloadCount: qrCode.downloadCount,
  createdAt: qrCode.createdAt,
  updatedAt: qrCode.updatedAt,
  createdByName: user.name,
};

export async function listQrCodes(churchId: string): Promise<QrRow[]> {
  const rows = await db
    .select(SELECTION)
    .from(qrCode)
    .leftJoin(shortLink, eq(shortLink.id, qrCode.shortLinkId))
    .leftJoin(user, eq(user.id, qrCode.createdBy))
    .where(eq(qrCode.churchId, churchId))
    .orderBy(desc(qrCode.updatedAt));
  return rows.map(toRow);
}

export async function getQrCode(churchId: string, id: string): Promise<QrRow | null> {
  const [row] = await db
    .select(SELECTION)
    .from(qrCode)
    .leftJoin(shortLink, eq(shortLink.id, qrCode.shortLinkId))
    .leftJoin(user, eq(user.id, qrCode.createdBy))
    .where(and(eq(qrCode.id, id), eq(qrCode.churchId, churchId)))
    .limit(1);
  return row ? toRow(row) : null;
}

/** How many codes a church has saved — for the module's overview. */
export async function countQrCodes(churchId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(qrCode)
    .where(eq(qrCode.churchId, churchId));
  return Number(row?.count ?? 0);
}

export async function saveQrCode(input: {
  churchId: string;
  id?: string | null;
  title: string;
  payload: QrPayload;
  design: QrDesign;
  shortLinkId: string | null;
  userId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const payload = normalisePayload(input.payload);
  const design = normaliseDesign(input.design);

  try {
    if (input.id) {
      const rows = await db
        .update(qrCode)
        .set({
          title: input.title,
          kind: payload.kind,
          payload,
          design,
          shortLinkId: input.shortLinkId,
        })
        .where(and(eq(qrCode.id, input.id), eq(qrCode.churchId, input.churchId)))
        .returning({ id: qrCode.id });
      if (rows.length === 0) return { ok: false, error: "That code no longer exists." };
      return { ok: true, id: rows[0].id };
    }

    const [row] = await db
      .insert(qrCode)
      .values({
        churchId: input.churchId,
        title: input.title,
        kind: payload.kind,
        payload,
        design,
        shortLinkId: input.shortLinkId,
        createdBy: input.userId,
      })
      .returning({ id: qrCode.id });
    return { ok: true, id: row.id };
  } catch (error) {
    console.error("[qr] saveQrCode failed", error);
    return { ok: false, error: "The code could not be saved. Please try again." };
  }
}

export async function deleteQrCode(churchId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(qrCode)
    .where(and(eq(qrCode.id, id), eq(qrCode.churchId, churchId)))
    .returning({ id: qrCode.id });
  return rows.length > 0;
}

/**
 * Note that a code was downloaded.
 *
 * Only so that a church can see which of its codes are actually in use before
 * it changes one. Never throws, and never blocks the download: the file is
 * built in the browser and this is a note about it afterwards.
 */
export async function noteDownload(churchId: string, id: string): Promise<void> {
  try {
    await db
      .update(qrCode)
      .set({ downloadCount: sql`${qrCode.downloadCount} + 1` })
      .where(and(eq(qrCode.id, id), eq(qrCode.churchId, churchId)));
  } catch (error) {
    console.error("[qr] noteDownload failed", { id }, error);
  }
}

/** The codes pointing at one link — what makes retiring it consequential. */
export async function qrCodesForLink(
  churchId: string,
  linkId: string,
): Promise<{ id: string; title: string; downloadCount: number }[]> {
  return db
    .select({
      id: qrCode.id,
      title: qrCode.title,
      downloadCount: qrCode.downloadCount,
    })
    .from(qrCode)
    .where(and(eq(qrCode.churchId, churchId), eq(qrCode.shortLinkId, linkId)))
    .orderBy(desc(qrCode.updatedAt));
}
