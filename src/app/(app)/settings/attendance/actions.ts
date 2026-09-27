"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { BAND_SEEDS, bandsFor, type BandConfig, type BandKey } from "@/lib/attendance-bands";

export type ActionResult = { ok: true } | { ok: false; error: string };

const KEYS = BAND_SEEDS.map((b) => b.key) as [BandKey, ...BandKey[]];

const schema = z.array(
  z.object({
    key: z.enum(KEYS),
    label: z.string().trim().max(40),
    enabled: z.boolean(),
  }),
);

/**
 * Save which groups this church counts, and its words for them.
 *
 * Only the label and the on/off state are stored; the bands themselves live in
 * code, so a church can never create a group that no report knows how to read.
 */
export async function saveAttendanceBands(input: unknown): Promise<ActionResult> {
  const { church: c } = await requireChurch();
  if (!(await can("settings.manage"))) {
    return { ok: false, error: "You don't have permission to change settings." };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the form and try again." };

  const before = bandsFor(c.attendanceBands);
  const config: BandConfig = {};

  for (const row of parsed.data) {
    const seed = BAND_SEEDS.find((b) => b.key === row.key);
    if (!seed) continue;
    const label = row.label.trim();
    config[row.key] = {
      // Store nothing when it matches the standard name, so a church that
      // never renamed anything keeps working if the defaults are ever reworded.
      label: label && label !== seed.label ? label : undefined,
      // Adults is not optional. Enforced here as well as in the UI, because a
      // switch that cannot be clicked is not the same as a value that cannot
      // be sent.
      enabled: row.key === "adults" ? true : row.enabled,
    };
  }

  await db.update(church).set({ attendanceBands: config }).where(eq(church.id, c.id));

  const after = bandsFor(config);
  const changes = after
    .filter((b) => {
      const was = before.find((x) => x.key === b.key);
      return was?.enabled !== b.enabled || was?.label !== b.label;
    })
    .map((b) => `${b.label}${b.enabled ? "" : " (off)"}`);

  await audit({
    churchId: c.id,
    action: "attendance.bands.update",
    summary: changes.length
      ? `Changed who attendance counts: ${changes.join(", ")}`
      : "Reviewed who attendance counts",
    targetType: "church",
    targetId: c.id,
    targetLabel: c.name,
    meta: { bands: after.map((b) => ({ key: b.key, label: b.label, enabled: b.enabled })) },
  });

  revalidatePath("/settings/attendance");
  revalidatePath("/attendance/record");
  return { ok: true };
}
