"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blogPost } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { uniqueBlogSlug, excerptFromBody } from "@/lib/blog";

export type ActionResult = { ok: true } | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const schema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Add a title").max(200),
  slug: z.string().trim().min(1).max(80),
  excerpt: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  body: z.string().max(50_000),
  coverUrl: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
  authorName: z.string().trim().min(1).max(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  seoTitle: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()),
  seoDescription: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  status: z.enum(["draft", "published"]),
});

export type BlogPostInput = z.input<typeof schema>;

/** Create a blank draft and return its id (opened in the editor). */
export async function createPost(): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
  const user = await requireSuperAdmin();
  const slug = await uniqueBlogSlug("untitled-post");
  // Default the byline to the signed-in admin's name (fallback: Daniel Ishaku).
  const authorName = user.name?.trim() || "Daniel Ishaku";
  const [row] = await db
    .insert(blogPost)
    .values({
      title: "Untitled post",
      slug,
      body: "",
      authorName,
      createdBy: user.id,
    })
    .returning({ id: blogPost.id });
  revalidatePath("/superadmin/blog");
  return { ok: true, id: row.id };
}

export async function savePost(input: BlogPostInput): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const [current] = await db
    .select({ publishedAt: blogPost.publishedAt })
    .from(blogPost)
    .where(eq(blogPost.id, d.id))
    .limit(1);
  if (!current) return { ok: false, error: "Post not found." };

  const slug = await uniqueBlogSlug(d.slug || d.title, d.id);
  // Stamp publishedAt the first time a post goes live.
  const publishedAt =
    d.status === "published"
      ? (current.publishedAt ?? new Date())
      : current.publishedAt;

  await db
    .update(blogPost)
    .set({
      title: d.title,
      slug,
      excerpt: d.excerpt ?? excerptFromBody(d.body),
      body: d.body,
      coverUrl: d.coverUrl,
      authorName: d.authorName,
      tags: d.tags,
      seoTitle: d.seoTitle,
      seoDescription: d.seoDescription,
      status: d.status,
      publishedAt,
    })
    .where(eq(blogPost.id, d.id));

  revalidatePath("/superadmin/blog");
  revalidatePath(`/superadmin/blog/${d.id}`);
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  return { ok: true };
}

export async function setPostStatus(
  id: string,
  status: "draft" | "published",
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };

  const [current] = await db
    .select({ publishedAt: blogPost.publishedAt })
    .from(blogPost)
    .where(eq(blogPost.id, id))
    .limit(1);
  if (!current) return { ok: false, error: "Post not found." };

  await db
    .update(blogPost)
    .set({
      status,
      publishedAt:
        status === "published" ? (current.publishedAt ?? new Date()) : current.publishedAt,
    })
    .where(eq(blogPost.id, id));

  revalidatePath("/superadmin/blog");
  revalidatePath("/blog");
  return { ok: true };
}

export async function deletePost(id: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  await db.delete(blogPost).where(eq(blogPost.id, id));
  revalidatePath("/superadmin/blog");
  revalidatePath("/blog");
  return { ok: true };
}
