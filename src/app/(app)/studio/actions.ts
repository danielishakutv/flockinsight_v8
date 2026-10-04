"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { normalisePreset } from "@/lib/image-studio";
import { deletePreset, listPresets, savePreset } from "@/lib/image-presets";

export type ActionResult = { ok: true } | { ok: false; error: string };

/*
 * The studio does its work on the device, so this file is small on purpose.
 * The only things the server is asked for are the two a browser cannot do:
 * remember the church's brand between volunteers, and forget a file later.
 */

async function guard() {
  const ctx = await requireChurch();
  if (!(await can("media.manage")))
    return {
      ctx,
      refusal: {
        ok: false as const,
        error: "You don't have permission to change the church's presets.",
      },
    };
  return { ctx, refusal: null };
}

const saveSchema = z.object({
  name: z.string().trim().min(1, "Give the preset a name.").max(60),
  logoUrl: z.string().trim().max(1000).nullish(),
  logoMediaId: z.string().uuid().nullish(),
  /** Validated by normalisePreset rather than by a schema — see below. */
  config: z.unknown(),
  makeDefault: z.boolean().default(true),
});

/**
 * Save the church's preset.
 *
 * `config` is deliberately `unknown` here and then run through
 * `normalisePreset`, which is the same function that mends a stored row on the
 * way out. One definition of "a valid preset", used on both sides, instead of
 * a Zod mirror of it that would drift the first time a knob was added.
 */
export async function savePresetAction(
  input: z.input<typeof saveSchema>,
): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const res = await savePreset({
    churchId: ctx.church.id,
    name: parsed.data.name,
    logoUrl: parsed.data.logoUrl ?? null,
    logoMediaId: parsed.data.logoMediaId ?? null,
    config: normalisePreset(parsed.data.config),
    makeDefault: parsed.data.makeDefault,
    userId: ctx.user.id,
  });
  if (!res.ok) return res;

  await audit({
    churchId: ctx.church.id,
    action: "media.preset.save",
    summary: `Saved the photo preset "${parsed.data.name}"`,
    targetType: "media",
    targetId: res.id,
    targetLabel: parsed.data.name,
  });

  revalidatePath("/studio");
  return { ok: true };
}

export async function deletePresetAction(id: string): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const gone = await deletePreset(ctx.church.id, String(id || ""));
  if (!gone) return { ok: false, error: "That preset no longer exists." };

  await audit({
    churchId: ctx.church.id,
    action: "media.preset.delete",
    summary: "Deleted a photo preset",
    targetType: "media",
    targetId: id,
  });

  revalidatePath("/studio");
  return { ok: true };
}

/** Re-read the presets after a save, without a full page reload. */
export async function refreshPresets() {
  const { church } = await requireChurch();
  if (!(await can("media.view"))) return [];
  return listPresets(church.id);
}
