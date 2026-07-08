"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createPost,
  setPostStatus,
  deletePost,
} from "@/app/superadmin/blog/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Post = {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  authorName: string;
  views: number;
  publishedAt: string | null;
  announcedAt: string | null;
  updatedAt: string;
};

export function BlogList({
  posts,
  baseUrl,
}: {
  posts: Post[];
  baseUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function create() {
    start(async () => {
      const res = await createPost();
      if (!res.ok) return void toast.error(res.error);
      router.push(`/superadmin/blog/${res.id}`);
    });
  }

  function toggle(p: Post) {
    start(async () => {
      const res = await setPostStatus(
        p.id,
        p.status === "published" ? "draft" : "published",
      );
      if (!res.ok) return void toast.error(res.error);
      toast.success(p.status === "published" ? "Moved to draft" : "Published");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deletePost(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Post deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  async function copy(p: Post) {
    try {
      await navigator.clipboard.writeText(`${baseUrl}/blog/${p.slug}`);
      setCopiedId(p.id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={create} disabled={pending} size="lg">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
          New post
        </Button>
      </div>

      {posts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-12 text-center">
            No posts yet. Create your first article.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <div
              key={p.id}
              className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm"
            >
              <Link
                href={`/superadmin/blog/${p.id}`}
                className="min-w-0 flex-1"
              >
                <p className="truncate font-bold">{p.title}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {p.authorName} · {p.views} view{p.views === 1 ? "" : "s"} ·{" "}
                  {new Date(p.updatedAt).toLocaleDateString()}
                  {p.announcedAt && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {" "}
                      · Announced
                    </span>
                  )}
                </p>
              </Link>
              <Badge variant={p.status === "published" ? "success" : "outline"}>
                {p.status === "published" ? "Published" : "Draft"}
              </Badge>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" aria-label="Copy link" onClick={() => copy(p)}>
                  {copiedId === p.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
                {p.status === "published" && (
                  <Button variant="ghost" size="icon" aria-label="View" asChild>
                    <a href={`${baseUrl}/blog/${p.slug}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggle(p)}
                  disabled={pending}
                >
                  <Eye className="size-4" />
                  {p.status === "published" ? "Unpublish" : "Publish"}
                </Button>
                <Button variant="ghost" size="icon" aria-label="Edit" asChild>
                  <Link href={`/superadmin/blog/${p.id}`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                {confirmId === p.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(p.id)}
                    disabled={pending}
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : "Confirm"}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                    onClick={() => setConfirmId(p.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
