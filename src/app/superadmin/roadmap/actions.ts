"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { releases } from "@/lib/changelog";
import {
  createRoadmapItem,
  deleteRoadmapItem,
  getRoadmapItem,
  reorderRoadmap,
  seedFromChangelog,
  setRoadmapStatus,
  unshipRoadmapItem,
  updateRoadmapItem,
} from "@/lib/roadmap";

export type ActionResult = { ok: true } | { ok: false; error: string };

const STATUSES = ["idea", "planned", "in_progress", "shipped", "parked"] as const;
const PRIORITIES = ["critical", "high", "medium", "low"] as const;

const itemSchema = z.object({
  title: z.string().trim().min(2, "Give it a title").max(200),
  detail: z.string().trim().max(20_000).optional().nullable(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  area: z.string().trim().max(60).optional().nullable(),
  // An empty date input posts "", which is not a date — treat it as unset
  // rather than failing the whole save on a field the user left alone.
  targetDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  isPublic: z.boolean().optional(),
  version: z.string().trim().max(20).optional().nullable(),
});

export type RoadmapItemInput = z.input<typeof itemSchema>;

function clean(v: string | null | undefined) {
  const t = v?.trim();
  return t ? t : null;
}

/** Add something to the queue. */
export async function addRoadmapItem(
  input: RoadmapItemInput,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const row = await createRoadmapItem({
    title: d.title,
    detail: clean(d.detail),
    status: d.status ?? "idea",
    priority: d.priority ?? "medium",
    area: clean(d.area),
    targetDate: clean(d.targetDate),
    isPublic: d.isPublic ?? false,
    version: clean(d.version),
    createdBy: admin.id,
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "roadmap_add",
    summary: `Added roadmap item "${row.title}" (${row.status})`,
  });

  revalidatePath("/superadmin/roadmap");
  revalidatePath("/roadmap");
  return { ok: true };
}

export async function editRoadmapItem(
  id: string,
  input: RoadmapItemInput,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  await updateRoadmapItem(id, {
    title: d.title,
    detail: clean(d.detail),
    priority: d.priority ?? "medium",
    area: clean(d.area),
    targetDate: clean(d.targetDate),
    isPublic: d.isPublic ?? false,
    version: clean(d.version),
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "roadmap_edit",
    summary: `Edited roadmap item "${d.title}"`,
  });

  revalidatePath("/superadmin/roadmap");
  revalidatePath("/roadmap");
  return { ok: true };
}

const moveSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUSES),
  version: z.string().trim().max(20).optional().nullable(),
});

/**
 * Move an item between columns. Landing on "shipped" is what freezes the
 * platform-size snapshot — see setRoadmapStatus.
 */
export async function moveRoadmapItem(
  input: z.input<typeof moveSchema>,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { id, status, version } = parsed.data;

  const before = await getRoadmapItem(id);
  if (!before) return { ok: false, error: "That item no longer exists." };

  // Only pass a version when one was actually supplied. `clean(undefined)` is
  // null, and setRoadmapStatus treats a null as "clear it" — so passing it
  // unconditionally wiped the version off every item shipped from the board,
  // where the buttons send no version at all.
  await setRoadmapStatus(
    id,
    status,
    version === undefined ? {} : { version: clean(version) },
  );

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "roadmap_move",
    summary: `Moved "${before.title}" from ${before.status} to ${status}`,
  });

  revalidatePath("/superadmin/roadmap");
  revalidatePath("/roadmap");
  return { ok: true };
}

/** Take something back out of shipped, clearing its date and frozen counts. */
export async function unshipItem(id: string): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const before = await getRoadmapItem(id);
  if (!before) return { ok: false, error: "That item no longer exists." };

  await unshipRoadmapItem(id, "in_progress");

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "roadmap_unship",
    summary: `Un-shipped "${before.title}" — cleared its date and platform snapshot`,
  });

  revalidatePath("/superadmin/roadmap");
  revalidatePath("/roadmap");
  return { ok: true };
}

export async function removeRoadmapItem(id: string): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const before = await getRoadmapItem(id);
  if (!before) return { ok: true };

  await deleteRoadmapItem(id);

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "roadmap_delete",
    summary: `Deleted roadmap item "${before.title}"`,
  });

  revalidatePath("/superadmin/roadmap");
  revalidatePath("/roadmap");
  return { ok: true };
}

export async function reorderItems(ids: string[]): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = z.array(z.string().uuid()).max(500).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid order" };
  await reorderRoadmap(parsed.data);
  revalidatePath("/superadmin/roadmap");
  return { ok: true };
}

/**
 * Backfill shipped history from the changelog. Safe to run more than once —
 * releases already on the board are skipped by version.
 */
export async function importChangelog(): Promise<
  { ok: true; added: number } | { ok: false; error: string }
> {
  const admin = await requireSuperAdmin();
  const added = await seedFromChangelog(releases, admin.id);

  if (added > 0) {
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "roadmap_import",
      summary: `Imported ${added} shipped release${added === 1 ? "" : "s"} from the changelog`,
    });
  }

  revalidatePath("/superadmin/roadmap");
  return { ok: true, added };
}
