"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  ImagePlus,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { savePost } from "@/app/superadmin/blog/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/blog/markdown";
import { MarkdownToolbar } from "@/components/superadmin/markdown-toolbar";
import { AnnounceDialog } from "@/components/superadmin/blog-announce-dialog";
import { uploadBlogImage } from "@/components/superadmin/blog-upload";
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";

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
  announcedAt: string | null;
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
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<PostState>) => setF((p) => ({ ...p, ...patch }));

  function persist(status: "draft" | "published") {
    const merged = { ...f, status, tags: f.tags.slice(0, 20) };
    start(async () => {
      const res = await savePost(merged);
      if (!res.ok) return void toast.error(res.error);
      setF(merged);
      toast.success(status === "published" ? "Saved & published" : "Draft saved");
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
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={`${baseUrl}/blog/${f.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> View live
                </a>
              </Button>
              <AnnounceDialog
                baseUrl={baseUrl}
                post={{
                  id: f.id,
                  slug: f.slug,
                  title: f.title,
                  excerpt: f.excerpt,
                  announcedAt: f.announcedAt,
                }}
              />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
            {preview ? "Back to editing" : "Preview"}
          </Button>
          <Button
            variant="outline"
            onClick={() => persist("draft")}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save draft
          </Button>
          <Button onClick={() => persist("published")} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {f.status === "published" ? "Update" : "Publish"}
          </Button>
        </div>
      </div>

      {preview ? (
        <ArticlePreview post={f} />
      ) : (
        <>
          <Card>
            <CardContent className="space-y-5 pt-6">
              <CoverField
                value={f.coverUrl}
                onChange={(url) => set({ coverUrl: url })}
              />
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
                <Label>Tags</Label>
                <TagInput
                  tags={f.tags}
                  onChange={(tags) => set({ tags })}
                />
                <p className="text-muted-foreground text-xs">
                  Type a tag and press comma or Enter. Click × to remove.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="excerpt">
                  Excerpt (optional — auto-generated if blank)
                </Label>
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
            <CardHeader>
              <CardTitle className="text-lg">Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <MarkdownToolbar
                textareaRef={bodyRef}
                value={f.body}
                onChange={(body) => set({ body })}
              />
              <Textarea
                ref={bodyRef}
                value={f.body}
                onChange={(e) => set({ body: e.target.value })}
                rows={20}
                className="font-mono text-sm"
                placeholder={"# Heading\n\nWrite your article here. Use the toolbar above to format — or type Markdown directly."}
              />
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
        </>
      )}
    </div>
  );
}

/** Full-article preview mirroring the public /blog/[slug] layout. */
function ArticlePreview({ post }: { post: PostState }) {
  return (
    <Card>
      <CardContent className="py-8">
        <article className="mx-auto max-w-3xl">
          {post.tags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {post.tags.map((t) => (
                <span
                  key={t}
                  className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
            {post.title || "Untitled post"}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            {post.authorName} · {format(new Date(), "MMMM d, yyyy")}
            {post.status === "draft" && " · Draft preview"}
          </p>
          {post.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.coverUrl}
              alt=""
              className="mt-6 aspect-[16/9] w-full rounded-2xl border object-cover"
            />
          )}
          <div className="mt-8">
            {post.body.trim() ? (
              <Markdown>{post.body}</Markdown>
            ) : (
              <p className="text-muted-foreground text-sm">
                Nothing to preview yet — write some content.
              </p>
            )}
          </div>
        </article>
      </CardContent>
    </Card>
  );
}

/** Wide cover-image field: upload, preview, replace, remove. */
function CoverField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadBlogImage(file, 1920);
      onChange(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <Label>Cover image</Label>
      <div
        className={cn(
          "bg-muted relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-xl border",
          !value && "border-dashed",
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <div className="text-muted-foreground flex flex-col items-center gap-1 text-sm">
            <ImagePlus className="size-7" />
            No cover image yet
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {value ? "Change cover" : "Upload cover"}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onChange("")}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="size-4" /> Remove
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}

/** Comma/Enter-separated tag entry — each tag becomes a removable chip. */
function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const t = raw.trim().slice(0, 40);
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    if (tags.length >= 20) return;
    onChange([...tags, t]);
  }

  function onChangeInput(v: string) {
    // A comma commits everything before it as tags.
    if (v.includes(",")) {
      const parts = v.split(",");
      parts.slice(0, -1).forEach(addTag);
      setDraft(parts[parts.length - 1] ?? "");
    } else {
      setDraft(v);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(draft);
      setDraft("");
    } else if (e.key === "Backspace" && draft === "" && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="border-input focus-within:border-ring focus-within:ring-ring/50 flex flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs focus-within:ring-[3px]">
      {tags.map((t) => (
        <span
          key={t}
          className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-semibold"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="hover:bg-primary/20 grid size-4 place-items-center rounded-full"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => onChangeInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          addTag(draft);
          setDraft("");
        }}
        placeholder={tags.length ? "" : "church growth, tips"}
        className="min-w-[8ch] flex-1 bg-transparent py-0.5 outline-none"
      />
    </div>
  );
}
