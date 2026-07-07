"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Eye, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { savePost } from "@/app/superadmin/blog/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/blog/markdown";
import { slugify } from "@/lib/slug";

type PostState = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  coverUrl: string;
  authorName: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  status: "draft" | "published";
};

export function BlogEditor({
  post,
  baseUrl,
}: {
  post: PostState;
  baseUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<PostState>(post);
  const [tagsText, setTagsText] = useState(post.tags.join(", "));
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<PostState>) => setF((p) => ({ ...p, ...patch }));

  function persist(next?: Partial<PostState>) {
    const merged = {
      ...f,
      ...next,
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
    };
    start(async () => {
      const res = await savePost(merged);
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        merged.status === "published" ? "Saved & published" : "Draft saved",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/superadmin/blog">
            <ArrowLeft className="size-4" /> All posts
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {f.status === "published" && (
            <Button variant="outline" size="sm" asChild>
              <a href={`${baseUrl}/blog/${f.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> View live
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => persist({ status: "draft" })}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save draft
          </Button>
          <Button onClick={() => persist({ status: "published" })} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {f.status === "published" ? "Update" : "Publish"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={f.title}
              onChange={(e) => set({ title: e.target.value })}
              className="text-lg font-semibold"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="slug">URL slug</Label>
              <Input
                id="slug"
                value={f.slug}
                onChange={(e) => set({ slug: e.target.value })}
                onBlur={() => set({ slug: slugify(f.slug || f.title) })}
              />
              <p className="text-muted-foreground truncate text-xs">
                {baseUrl}/blog/{f.slug || "…"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="author">Author</Label>
              <Input
                id="author"
                value={f.authorName}
                onChange={(e) => set({ authorName: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cover">Cover image URL</Label>
            <Input
              id="cover"
              value={f.coverUrl}
              onChange={(e) => set({ coverUrl: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="church growth, tips"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="excerpt">Excerpt (optional — auto-generated if blank)</Label>
            <Textarea
              id="excerpt"
              rows={2}
              value={f.excerpt}
              onChange={(e) => set({ excerpt: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-lg">Content (Markdown)</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)}>
            {preview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
            {preview ? "Edit" : "Preview"}
          </Button>
        </CardHeader>
        <CardContent>
          {preview ? (
            <div className="min-h-[300px] rounded-xl border p-4">
              {f.body.trim() ? (
                <Markdown>{f.body}</Markdown>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
              )}
            </div>
          ) : (
            <Textarea
              value={f.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={20}
              className="font-mono text-sm"
              placeholder={"# Heading\n\nWrite your article in Markdown…"}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SEO</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="seoTitle">SEO title (optional)</Label>
            <Input
              id="seoTitle"
              value={f.seoTitle}
              onChange={(e) => set({ seoTitle: e.target.value })}
              placeholder={f.title}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seoDesc">Meta description (optional)</Label>
            <Textarea
              id="seoDesc"
              rows={2}
              value={f.seoDescription}
              onChange={(e) => set({ seoDescription: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
