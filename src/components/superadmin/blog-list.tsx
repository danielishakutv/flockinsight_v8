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
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActions } from "@/components/superadmin/list-kit";
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
  /** "ai" for a post the weekly drafter wrote; it cannot be published from here unread. */
  source?: "human" | "ai";
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

  const waiting = posts.filter((p) => p.source === "ai" && p.status === "draft").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {waiting > 0 && (
          <p className="text-muted-foreground mr-auto text-sm">
            {waiting} AI draft{waiting === 1 ? "" : "s"} waiting for review
          </p>
        )}
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
        <div className="grid gap-3 xl:grid-cols-2">
          {posts.map((p) => (
            <article
              key={p.id}
              className="bg-card flex min-w-0 flex-col overflow-hidden rounded-2xl border shadow-sm"
            >
              <Link
                href={`/superadmin/blog/${p.id}`}
                className="group hover:bg-accent/40 block flex-1 p-4 transition-colors"
              >
                <h3 className="group-hover:text-primary line-clamp-3 leading-snug font-semibold break-words transition-colors">
                  {p.title}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant={p.status === "published" ? "success" : "outline"}>
                    {p.status === "published" ? "Published" : "Draft"}
                  </Badge>
                  {p.source === "ai" && p.status === "draft" && (
                    <Badge variant="warning">AI draft · needs review</Badge>
                  )}
                  {p.announcedAt && (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      Announced
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1.5 truncate text-xs">
                  {p.authorName} · {p.views} view{p.views === 1 ? "" : "s"} ·{" "}
                  {new Date(p.updatedAt).toLocaleDateString()}
                </p>
              </Link>
              {confirmId === p.id ? (
                <div className="bg-destructive/5 flex flex-wrap items-center gap-2 border-t px-3 py-2.5 sm:justify-end sm:px-4">
                  <p className="text-destructive mr-auto text-sm font-medium">
                    Delete this post for good?
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(p.id)}
                    disabled={pending}
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    Delete
                  </Button>
                </div>
              ) : (
                <RowActions
                  moreLabel={`More actions for ${p.title}`}
                  more={
                    <>
                      <DropdownMenuItem onSelect={() => void copy(p)}>
                        {copiedId === p.id ? <Check /> : <Copy />}
                        Copy link
                      </DropdownMenuItem>
                      {p.status === "published" && (
                        <DropdownMenuItem asChild>
                          <a href={`${baseUrl}/blog/${p.slug}`} target="_blank" rel="noreferrer">
                            <ExternalLink />
                            View on the website
                          </a>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setConfirmId(p.id)}
                      >
                        <Trash2 />
                        Delete post…
                      </DropdownMenuItem>
                    </>
                  }
                >
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/superadmin/blog/${p.id}`}>
                      <Pencil className="size-4" />
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant={p.status === "published" ? "outline" : "default"}
                    size="sm"
                    onClick={() => toggle(p)}
                    disabled={pending}
                  >
                    <Eye className="size-4" />
                    {p.status === "published" ? "Unpublish" : "Publish"}
                  </Button>
                </RowActions>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
