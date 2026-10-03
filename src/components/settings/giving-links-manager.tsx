"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import {
  createGivingLinkAction,
  setGivingLinkActiveAction,
  updateGivingLinkAction,
} from "@/app/(app)/settings/payments/actions";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/components/i18n-provider";

export type LinkView = {
  id: string;
  slug: string;
  url: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  amountMode: "open" | "fixed" | "preset";
  fixedAmount: number | null;
  presetAmounts: number[];
  minAmount: number | null;
  targetAmount: number | null;
  askPhone: boolean;
  allowAnonymous: boolean;
  showProgress: boolean;
  thankYouMessage: string | null;
  isActive: boolean;
  raised: number;
  givers: number;
};

type Draft = {
  title: string;
  description: string;
  categoryId: string;
  amountMode: "open" | "fixed" | "preset";
  fixedAmount: string;
  presetAmounts: string;
  minAmount: string;
  targetAmount: string;
  askPhone: boolean;
  allowAnonymous: boolean;
  showProgress: boolean;
  thankYouMessage: string;
};

const EMPTY: Draft = {
  title: "",
  description: "",
  categoryId: "",
  amountMode: "open",
  fixedAmount: "",
  presetAmounts: "",
  minAmount: "",
  targetAmount: "",
  askPhone: true,
  allowAnonymous: true,
  showProgress: false,
  thankYouMessage: "",
};

function toDraft(l: LinkView): Draft {
  return {
    title: l.title,
    description: l.description ?? "",
    categoryId: l.categoryId ?? "",
    amountMode: l.amountMode,
    fixedAmount: l.fixedAmount != null ? String(l.fixedAmount) : "",
    presetAmounts: l.presetAmounts.join(", "),
    minAmount: l.minAmount != null ? String(l.minAmount) : "",
    targetAmount: l.targetAmount != null ? String(l.targetAmount) : "",
    askPhone: l.askPhone,
    allowAnonymous: l.allowAnonymous,
    showProgress: l.showProgress,
    thankYouMessage: l.thankYouMessage ?? "",
  };
}

/** "1000, 2000, 5000" → [1000, 2000, 5000]. Anything unparseable is dropped. */
function parseAmounts(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s.replace(/[^\d.]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function num(raw: string): number | null {
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The church's collection links.
 *
 * A link, not a page per category: the thing a church actually does with this
 * is paste one address into a WhatsApp group on a Saturday night, so copying
 * it is the primary action and everything else is configuration.
 */
export function GivingLinksManager({
  links,
  categories,
  currency,
  canManage,
  hasActiveGateway,
}: {
  links: LinkView[];
  categories: { id: string; name: string }[];
  currency: string;
  canManage: boolean;
  hasActiveGateway: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [copied, setCopied] = useState<string | null>(null);

  function set<K extends keyof Draft>(key: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: v }));
  }

  function payload() {
    return {
      title: draft.title,
      description: draft.description || undefined,
      categoryId: draft.categoryId || null,
      amountMode: draft.amountMode,
      fixedAmount: draft.amountMode === "fixed" ? num(draft.fixedAmount) : null,
      presetAmounts:
        draft.amountMode === "preset" ? parseAmounts(draft.presetAmounts) : [],
      minAmount: num(draft.minAmount),
      targetAmount: num(draft.targetAmount),
      askPhone: draft.askPhone,
      allowAnonymous: draft.allowAnonymous,
      showProgress: draft.showProgress,
      thankYouMessage: draft.thankYouMessage || undefined,
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res =
        editing === "new"
          ? await createGivingLinkAction(payload())
          : await updateGivingLinkAction(editing as string, payload());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing === "new" ? "Your giving link is live." : "Saved.");
      setEditing(null);
      setDraft(EMPTY);
      router.refresh();
    });
  }

  function toggle(id: string, next: boolean) {
    start(async () => {
      const res = await setGivingLinkActiveAction(id, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next ? "Open for giving." : "Closed.");
      router.refresh();
    });
  }

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an
      // insecure origin, a locked-down browser. Showing the link beats
      // pretending the copy worked.
      toast.error(t("give.copyFailed"));
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="text-primary size-5" /> Giving links
          </CardTitle>
          <CardDescription>
            One link per collection. Share it in a WhatsApp group, put it on
            your website, or print it in the bulletin.
          </CardDescription>
        </div>
        {canManage && editing === null && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(EMPTY);
              setEditing("new");
            }}
          >
            <Plus /> New link
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasActiveGateway && links.length > 0 && (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            These links are live, but no payment account is connected above — so
            anyone who opens one is told the church hasn&apos;t finished setting
            up. Connect an account to start taking gifts.
          </p>
        )}

        {links.length === 0 && editing === null && (
          <p className="text-muted-foreground py-2 text-sm">
            No giving links yet. One link is enough to start — &ldquo;Tithes
            &amp; offerings&rdquo; with an open amount is what most churches
            use.
          </p>
        )}

        {links.map((l) => (
          <div key={l.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {l.title}
                  {!l.isActive && (
                    <Badge variant="secondary">{t("give.closed")}</Badge>
                  )}
                  {l.categoryName && (
                    <Badge variant="outline">{l.categoryName}</Badge>
                  )}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs break-all">
                  {l.url}
                </p>
                <p className="mt-1 text-sm">
                  {/*
                    What it has raised, beside the link rather than on another
                    page — this is the number somebody opens this page to see.
                  */}
                  <span className="font-semibold">
                    {formatMoney(l.raised, currency)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    from {l.givers} {l.givers === 1 ? "gift" : "gifts"}
                    {l.amountMode === "fixed" && l.fixedAmount
                      ? ` · ${formatMoney(l.fixedAmount, currency)} each`
                      : l.amountMode === "open"
                        ? " · any amount"
                        : ""}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(l.url, l.id)}>
                  {copied === l.id ? <Check /> : <Copy />}
                  {copied === l.id ? "Copied" : "Copy"}
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/give/${l.slug}`} target="_blank">
                    <ExternalLink /> Open
                  </Link>
                </Button>
                {canManage && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDraft(toDraft(l));
                        setEditing(l.id);
                      }}
                      disabled={pending}
                    >
                      <Pencil /> Edit
                    </Button>
                    <Switch
                      checked={l.isActive}
                      onCheckedChange={(v) => toggle(l.id, v)}
                      disabled={pending}
                      aria-label={t("give.openForGiving")}
                    />
                  </>
                )}
              </div>
            </div>

            {editing === l.id && (
              <LinkForm
                draft={draft}
                set={set}
                categories={categories}
                currency={currency}
                pending={pending}
                onSubmit={submit}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        ))}

        {editing === "new" && (
          <div className="rounded-xl border p-3">
            <LinkForm
              draft={draft}
              set={set}
              categories={categories}
              currency={currency}
              pending={pending}
              onSubmit={submit}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinkForm({
  draft,
  set,
  categories,
  currency,
  pending,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, v: Draft[K]) => void;
  categories: { id: string; name: string }[];
  currency: string;
  pending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-4 border-t pt-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="gl-title">{t("give.whatIsItCalled")}</Label>
          <Input
            id="gl-title"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={t("give.titlePlaceholder")}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gl-cat">{t("give.recordUnder")}</Label>
          <Select
            value={draft.categoryId || "none"}
            onValueChange={(v) => set("categoryId", v === "none" ? "" : v)}
          >
            <SelectTrigger id="gl-cat" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("give.noCategory")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Online gifts land in your giving records under this category, like
            any other offering.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gl-desc">{t("give.whatIsItFor")}</Label>
        <Textarea
          id="gl-desc"
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={t("give.descriptionPlaceholder")}
          rows={2}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gl-mode">{t("give.howMuchCanPeopleGive")}</Label>
        <Select
          value={draft.amountMode}
          onValueChange={(v) => set("amountMode", v as Draft["amountMode"])}
        >
          <SelectTrigger id="gl-mode" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t("give.modeOpen")}</SelectItem>
            <SelectItem value="preset">{t("give.modePreset")}</SelectItem>
            <SelectItem value="fixed">{t("give.modeFixed")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {draft.amountMode === "fixed" && (
        <div className="space-y-1.5">
          <Label htmlFor="gl-fixed">The amount ({currency})</Label>
          <Input
            id="gl-fixed"
            inputMode="decimal"
            value={draft.fixedAmount}
            onChange={(e) => set("fixedAmount", e.target.value)}
            placeholder="5000"
            className="sm:w-48"
            required
          />
        </div>
      )}

      {draft.amountMode === "preset" && (
        <div className="space-y-1.5">
          <Label htmlFor="gl-preset">{t("give.suggestedAmounts")}</Label>
          <Input
            id="gl-preset"
            value={draft.presetAmounts}
            onChange={(e) => set("presetAmounts", e.target.value)}
            placeholder="1000, 2000, 5000, 10000"
          />
          <p className="text-muted-foreground text-xs">
            Separate them with commas. Up to eight; givers can still type their
            own.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="gl-min">Smallest gift ({currency}, optional)</Label>
          <Input
            id="gl-min"
            inputMode="decimal"
            value={draft.minAmount}
            onChange={(e) => set("minAmount", e.target.value)}
            placeholder="100"
          />
          <p className="text-muted-foreground text-xs">
            Card fees make very small gifts cost more than they give.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gl-target">Goal ({currency}, optional)</Label>
          <Input
            id="gl-target"
            inputMode="decimal"
            value={draft.targetAmount}
            onChange={(e) => set("targetAmount", e.target.value)}
            placeholder="2000000"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border p-3">
        <Row
          label={t("give.askPhone")}
          hint={t("give.askPhoneHint")}
          checked={draft.askPhone}
          onChange={(v) => set("askPhone", v)}
        />
        <Row
          label={t("give.allowAnonymous")}
          hint={t("give.allowAnonymousHint")}
          checked={draft.allowAnonymous}
          onChange={(v) => set("allowAnonymous", v)}
        />
        <Row
          label={t("give.showProgress")}
          hint={t("give.showProgressHint")}
          checked={draft.showProgress}
          onChange={(v) => set("showProgress", v)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gl-thanks">{t("give.thankYouMessage")}</Label>
        <Textarea
          id="gl-thanks"
          value={draft.thankYouMessage}
          onChange={(e) => set("thankYouMessage", e.target.value)}
          placeholder={t("give.thankYouPlaceholder")}
          rows={2}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save link
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
