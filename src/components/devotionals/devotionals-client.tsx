"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Mail,
  BookOpen,
  Clock,
  CheckCircle2,
  Users,
  Download,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  createDevotional,
  deleteDevotional,
  addSubscriber,
  removeSubscriber,
} from "@/app/(app)/devotionals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Devo = {
  id: string;
  type: "devotional" | "newsletter";
  title: string;
  status: "draft" | "scheduled" | "sent";
  audience: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipients: number;
  sentCount: number;
  updatedAt: string;
};
type Sub = {
  id: string;
  name: string | null;
  email: string;
  status: string;
  source: string;
  createdAt: string;
};

type Tab = "devotional" | "newsletter" | "subscribers";

const AUDIENCE_LABEL: Record<string, string> = {
  both: "Members & subscribers",
  members: "Members",
  subscribers: "Subscribers",
};

export function DevotionalsClient({
  canManage,
  activeSubscribers,
  devotionals,
  subscribers,
}: {
  canManage: boolean;
  activeSubscribers: number;
  devotionals: Devo[];
  subscribers: Sub[];
}) {
  const [tab, setTab] = useState<Tab>("devotional");

  const tabs: { id: Tab; label: string; icon: typeof BookOpen }[] = [
    { id: "devotional", label: "Devotionals", icon: BookOpen },
    { id: "newsletter", label: "Newsletters", icon: Mail },
    { id: "subscribers", label: "Subscribers", icon: Users },
  ];

  return (
    <div className="space-y-5">
      <div className="bg-muted inline-flex flex-wrap gap-1 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              tab === t.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
            {t.id === "subscribers" && (
              <span className="bg-primary/10 text-primary rounded-full px-1.5 text-xs font-bold">
                {activeSubscribers}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "subscribers" ? (
        <Subscribers
          canManage={canManage}
          activeSubscribers={activeSubscribers}
          subscribers={subscribers}
        />
      ) : (
        <Posts
          type={tab}
          canManage={canManage}
          items={devotionals.filter((d) => d.type === tab)}
        />
      )}
    </div>
  );
}

function Posts({
  type,
  canManage,
  items,
}: {
  type: "devotional" | "newsletter";
  canManage: boolean;
  items: Devo[];
}) {
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const noun = type === "newsletter" ? "newsletter" : "devotional";

  function create() {
    startCreate(async () => {
      const res = await createDevotional(type);
      if (res.ok && res.id) router.push(`/devotionals/${res.id}`);
      else if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={create} disabled={creating}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            New {noun}
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center">
          {type === "newsletter" ? (
            <Mail className="mx-auto mb-3 size-8 opacity-60" />
          ) : (
            <BookOpen className="mx-auto mb-3 size-8 opacity-60" />
          )}
          No {noun}s yet.
          {canManage && ` Create your first ${noun}.`}
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((d) => (
            <PostCard key={d.id} d={d} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ d, canManage }: { d: Devo; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function remove() {
    if (!confirm(`Delete "${d.title}"? This can't be undone.`)) return;
    start(async () => {
      const res = await deleteDevotional(d.id);
      if (res.ok) {
        toast.success("Deleted");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="bg-card rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{d.title}</p>
            <StatusBadge d={d} />
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {d.status === "sent" && d.sentAt
              ? `Sent ${format(parseISO(d.sentAt), "MMM d, yyyy")} · ${d.sentCount}/${d.recipients} delivered`
              : d.status === "scheduled" && d.scheduledAt
                ? `Scheduled for ${format(parseISO(d.scheduledAt), "MMM d, yyyy · h:mm a")}`
                : `Draft · updated ${format(parseISO(d.updatedAt), "MMM d, yyyy")}`}
            {" · "}
            {AUDIENCE_LABEL[d.audience] ?? d.audience}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button asChild variant="outline" size="sm">
            <Link href={`/devotionals/${d.id}`}>
              <Pencil className="size-4" /> {d.status === "sent" ? "View" : "Edit"}
            </Link>
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              onClick={remove}
              className="text-muted-foreground hover:text-destructive"
              title="Delete"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ d }: { d: Devo }) {
  if (d.status === "sent")
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="size-3" /> Sent
      </Badge>
    );
  if (d.status === "scheduled")
    return (
      <Badge variant="default" className="gap-1">
        <Clock className="size-3" /> Scheduled
      </Badge>
    );
  return <Badge variant="secondary">Draft</Badge>;
}

function Subscribers({
  canManage,
  activeSubscribers,
  subscribers,
}: {
  canManage: boolean;
  activeSubscribers: number;
  subscribers: Sub[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  function add() {
    if (!email.trim()) return toast.error("Enter an email.");
    start(async () => {
      const res = await addSubscriber(name, email);
      if (res.ok) {
        toast.success("Subscriber added");
        setName("");
        setEmail("");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await removeSubscriber(id);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary grid size-11 place-items-center rounded-xl">
            <Users className="size-5" />
          </div>
          <div>
            <p className="text-2xl font-extrabold tabular-nums">{activeSubscribers}</p>
            <p className="text-muted-foreground text-sm">active subscribers</p>
          </div>
        </div>
        {subscribers.length > 0 && (
          <Button asChild variant="outline" size="sm">
            <a href="/devotionals/subscribers/export">
              <Download className="size-4" /> Export CSV
            </a>
          </Button>
        )}
      </div>

      {canManage && (
        <div className="bg-card flex flex-wrap items-end gap-2 rounded-2xl border p-4">
          <div className="flex-1">
            <Input
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <Input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          </div>
          <Button onClick={add} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Add
          </Button>
        </div>
      )}

      {subscribers.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center">
          <Users className="mx-auto mb-3 size-8 opacity-60" />
          No subscribers yet. People who sign up on your public page appear here.
        </div>
      ) : (
        <div className="bg-card divide-y rounded-2xl border">
          {subscribers.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {s.name || s.email}
                  {s.status !== "active" && (
                    <Badge variant="outline" className="ml-2">
                      Unsubscribed
                    </Badge>
                  )}
                </p>
                {s.name && (
                  <p className="text-muted-foreground truncate text-xs">{s.email}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground hidden text-xs sm:block">
                  {format(parseISO(s.createdAt), "MMM d, yyyy")}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-8"
                    onClick={() => remove(s.id)}
                    disabled={pending}
                    title="Remove"
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
