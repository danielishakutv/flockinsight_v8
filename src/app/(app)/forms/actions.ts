"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { form } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { slugify, randomSuffix } from "@/lib/slug";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

// Slugs that would collide with app routes / reserved words.
const RESERVED = new Set([
  "new",
  "edit",
  "admin",
  "api",
  "settings",
  "forms",
  "f",
]);

const fieldSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum([
    "short_text",
    "long_text",
    "email",
    "phone",
    "number",
    "date",
    "select",
    "radio",
    "checkboxes",
    "yesno",
  ]),
  label: z.string().trim().max(200).default(""),
  description: z.string().trim().max(500).optional(),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().max(120)).max(50).optional(),
  map: z
    .enum(["none", "firstName", "lastName", "fullName", "phone", "email"])
    .optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Give the form a title.").max(160),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(2000).nullable(),
  ),
  slug: z.string().trim().min(3, "Link must be at least 3 characters.").max(48),
  status: z.enum(["draft", "open", "closed"]),
  fields: z.array(fieldSchema).max(80),
  confirmationMessage: z.string().trim().max(500).default("Thanks! Your response has been recorded."),
  notifyEmail: z.boolean(),
  notifyInApp: z.boolean(),
  createMembers: z.boolean(),
  addToFollowUp: z.boolean(),
});

export type FormUpdateInput = z.input<typeof updateSchema>;

/** Find a free slug derived from `base`, optionally ignoring one form id. */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = slugify(base) || "form";
  if (RESERVED.has(candidate)) candidate = `${candidate}-form`;
  for (let i = 0; i < 6; i++) {
    const clash = await db
      .select({ id: form.id })
      .from(form)
      .where(
        excludeId
          ? and(eq(form.slug, candidate), ne(form.id, excludeId))
          : eq(form.slug, candidate),
      )
      .limit(1);
    if (clash.length === 0) return candidate;
    candidate = `${slugify(base) || "form"}-${randomSuffix(4)}`;
  }
  return `${slugify(base) || "form"}-${randomSuffix(6)}`;
}

/** Create a blank form and return its id. */
export async function createForm(): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!(await can("forms.manage")))
    return { ok: false, error: "You don't have permission to create forms." };

  const slug = await uniqueSlug("untitled-form");
  const [row] = await db
    .insert(form)
    .values({
      churchId: church.id,
      title: "Untitled form",
      slug,
      createdBy: user.id,
      fields: [
        {
          id: `f0_${randomSuffix(6)}`,
          type: "short_text",
          label: "Full name",
          required: true,
          map: "fullName",
        },
      ],
    })
    .returning({ id: form.id });

  revalidatePath("/forms");
  return { ok: true, id: row.id };
}

/** Save all of a form's content + settings. */
export async function updateForm(input: FormUpdateInput): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("forms.manage")))
    return { ok: false, error: "You don't have permission to edit forms." };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid form." };
  const d = parsed.data;

  // Make sure the form belongs to this church.
  const [existing] = await db
    .select({ id: form.id, slug: form.slug })
    .from(form)
    .where(and(eq(form.id, d.id), eq(form.churchId, church.id)))
    .limit(1);
  if (!existing) return { ok: false, error: "Form not found." };

  // Normalise + guarantee a unique, non-reserved slug.
  let slug = slugify(d.slug) || existing.slug;
  if (slug !== existing.slug) {
    if (RESERVED.has(slug)) return { ok: false, error: "That link name is reserved — pick another." };
    slug = await uniqueSlug(slug, d.id);
  }

  // Drop empty options and options on non-option fields.
  const fields = d.fields.map((f) => ({
    ...f,
    label: f.label || "Untitled question",
    options:
      f.type === "select" || f.type === "radio" || f.type === "checkboxes"
        ? (f.options ?? []).map((o) => o.trim()).filter(Boolean)
        : undefined,
    map: f.map ?? "none",
  }));

  await db
    .update(form)
    .set({
      title: d.title,
      description: d.description,
      slug,
      status: d.status,
      fields,
      confirmationMessage: d.confirmationMessage,
      notifyEmail: d.notifyEmail,
      notifyInApp: d.notifyInApp,
      createMembers: d.createMembers,
      addToFollowUp: d.addToFollowUp,
    })
    .where(and(eq(form.id, d.id), eq(form.churchId, church.id)));

  revalidatePath("/forms");
  revalidatePath(`/forms/${d.id}`);
  return { ok: true, id: d.id };
}

/** Quick publish / close toggle from the list. */
export async function setFormStatus(
  id: string,
  status: "draft" | "open" | "closed",
): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("forms.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id." };

  const res = await db
    .update(form)
    .set({ status })
    .where(and(eq(form.id, id), eq(form.churchId, church.id)))
    .returning({ id: form.id });
  if (!res.length) return { ok: false, error: "Form not found." };
  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return { ok: true };
}

export async function deleteForm(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("forms.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id." };

  const res = await db
    .delete(form)
    .where(and(eq(form.id, id), eq(form.churchId, church.id)))
    .returning({ id: form.id });
  if (!res.length) return { ok: false, error: "Form not found." };
  revalidatePath("/forms");
  return { ok: true };
}
