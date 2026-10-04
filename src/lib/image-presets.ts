import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { imagePreset } from "@/db/schema";
import { normalisePreset, type StudioPreset } from "@/lib/image-studio";

/**
 * Saved photo-branding presets, and the housekeeping that keeps derivatives
 * from eating a church's quota.
 *
 * Almost nothing happens on the server for this module — the pixels are all
 * handled on the device. What the server is for is the two things a browser
 * cannot do: remember a church's brand between volunteers and devices, and
 * forget a file nobody needs any more.
 */

export type PresetRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  logoMediaId: string | null;
  isDefault: boolean;
  config: StudioPreset;
  updatedAt: string;
};

/** Every preset this church has, the default first. */
export async function listPresets(churchId: string): Promise<PresetRow[]> {
  const rows = await db
    .select()
    .from(imagePreset)
    .where(eq(imagePreset.churchId, churchId))
    .orderBy(desc(imagePreset.isDefault), asc(imagePreset.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    logoUrl: r.logoUrl,
    logoMediaId: r.logoMediaId,
    isDefault: r.isDefault,
    // Mended on the way out, so a row written by an older release — or edited
    // by hand — can never crash the editor that opens it.
    config: normalisePreset(r.config),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Create or replace a preset by NAME.
 *
 * Upsert on (church, name) rather than requiring an id, because the way this
 * is used is "Save as: Sunday service" twice — the second time meaning
 * "update it", not "make a duplicate called the same thing". The unique index
 * is what makes that safe under two people pressing Save at once.
 */
export async function savePreset(opts: {
  churchId: string;
  name: string;
  logoUrl: string | null;
  logoMediaId: string | null;
  config: StudioPreset;
  makeDefault: boolean;
  userId?: string | null;
}): Promise<SaveResult> {
  const name = opts.name.trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give the preset a name." };

  const [existing] = await db
    .select({ id: imagePreset.id })
    .from(imagePreset)
    .where(and(eq(imagePreset.churchId, opts.churchId), eq(imagePreset.name, name)))
    .limit(1);

  const values = {
    churchId: opts.churchId,
    name,
    logoUrl: opts.logoUrl,
    logoMediaId: opts.logoMediaId,
    config: normalisePreset(opts.config) as unknown as Record<string, unknown>,
    isDefault: opts.makeDefault,
    createdBy: opts.userId ?? null,
  };

  const id = await db.transaction(async (tx) => {
    if (opts.makeDefault) {
      // One default per church, cleared in the same transaction so there is
      // never an instant with two and the studio cannot open the wrong one.
      await tx
        .update(imagePreset)
        .set({ isDefault: false })
        .where(eq(imagePreset.churchId, opts.churchId));
    }
    if (existing) {
      await tx
        .update(imagePreset)
        .set(values)
        .where(eq(imagePreset.id, existing.id));
      return existing.id;
    }
    const [row] = await tx
      .insert(imagePreset)
      .values(values)
      .returning({ id: imagePreset.id });
    return row.id;
  });

  return { ok: true, id };
}

/** Remove one. Scoped to the church, so an id from a form cannot reach another's. */
export async function deletePreset(
  churchId: string,
  id: string,
): Promise<boolean> {
  const gone = await db
    .delete(imagePreset)
    .where(and(eq(imagePreset.id, id), eq(imagePreset.churchId, churchId)))
    .returning({ id: imagePreset.id });
  return gone.length > 0;
}
