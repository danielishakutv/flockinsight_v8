"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { sendCampaign } from "@/app/superadmin/growth/actions";
import {
  LEAD_STATUSES,
  TEMPLATE_TAGS,
  renderTemplate,
  type LeadStatus,
} from "@/lib/growth-shared";
import { smsPages } from "@/lib/sms-pages";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ChurchOption = { id: string; name: string; plan: string };

type ChurchFilter =
  "all" | "plan" | "country" | "status" | "denomination" | "picked";
type LeadFilter = "all" | "open" | "status" | "source" | "picked";

export function OutreachComposer({
  churches,
  countries,
  denominations,
  sources,
  leadCounts,
  openLeads,
  totalLeads,
  emailReady,
  smsReady,
}: {
  churches: ChurchOption[];
  countries: string[];
  denominations: { id: string; name: string; churches: number }[];
  sources: string[];
  leadCounts: Record<LeadStatus, number>;
  openLeads: number;
  totalLeads: number;
  emailReady: boolean;
  smsReady: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [side, setSide] = useState<"leads" | "churches">("leads");

  const [churchFilter, setChurchFilter] = useState<ChurchFilter>("all");
  const [plan, setPlan] = useState("starter");
  const [country, setCountry] = useState(countries[0] ?? "Nigeria");
  const [churchStatus, setChurchStatus] = useState<"active" | "suspended">(
    "active",
  );
  const [denominationId, setDenominationId] = useState(
    denominations[0]?.id ?? "",
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [churchQuery, setChurchQuery] = useState("");

  const [leadFilter, setLeadFilter] = useState<LeadFilter>("open");
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("new");
  const [source, setSource] = useState(sources[0] ?? "manual");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");

  const filteredChurches = useMemo(() => {
    const q = churchQuery.trim().toLowerCase();
    return q
      ? churches.filter((c) => c.name.toLowerCase().includes(q))
      : churches;
  }, [churches, churchQuery]);

  /** Rough reach, from what the page already knows — the server is the truth. */
  const reach = useMemo(() => {
    if (side === "churches") {
      if (churchFilter === "all") return churches.length;
      if (churchFilter === "plan")
        return churches.filter((c) => c.plan === plan).length;
      if (churchFilter === "picked") return picked.size;
      if (churchFilter === "denomination")
        return (
          denominations.find((d) => d.id === denominationId)?.churches ?? 0
        );
      return null; // country / status need a query
    }
    if (leadFilter === "all") return totalLeads;
    if (leadFilter === "open") return openLeads;
    if (leadFilter === "status") return leadCounts[leadStatus];
    return null;
  }, [
    side,
    churchFilter,
    churches,
    plan,
    picked,
    denominations,
    denominationId,
    leadFilter,
    leadStatus,
    leadCounts,
    openLeads,
    totalLeads,
  ]);

  const pages = smsPages(body || "");
  const ready = channel === "email" ? emailReady : smsReady;

  const preview = renderTemplate(body || "", {
    name: "Daniel",
    church: side === "churches" ? churches[0]?.name : "Grace Chapel",
    city: "Yola",
  });

  function insert(tag: string) {
    setBody((b) => (b ? `${b}${b.endsWith(" ") ? "" : " "}${tag}` : tag));
  }

  function submit() {
    if (!body.trim()) return toast.error("Write a message.");
    if (channel === "email" && !subject.trim())
      return toast.error("An email needs a subject.");

    const audience =
      side === "churches"
        ? {
            kind: "churches" as const,
            filter: churchFilter,
            plan,
            country,
            status: churchStatus,
            denominationId: denominationId || undefined,
            denominationLabel: denominations.find(
              (d) => d.id === denominationId,
            )?.name,
            ids: [...picked],
          }
        : {
            kind: "leads" as const,
            filter: leadFilter,
            status: leadStatus,
            source,
            ids: [],
          };

    startTransition(async () => {
      const res = await sendCampaign({
        channel,
        audience,
        subject,
        body,
        ctaUrl,
        ctaLabel,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        `${res.sent} sent · ${res.failed} failed · ${res.skipped} had no ${
          channel === "email" ? "email" : "phone"
        }`,
      );
      setBody("");
      setSubject("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Compose</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Channel + side */}
        <div className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <Label>Channel</Label>
            <div className="flex gap-2">
              {(["email", "sms"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
                    channel === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {c === "email" ? (
                    <Mail className="size-4" />
                  ) : (
                    <MessageSquare className="size-4" />
                  )}
                  {c === "email" ? "Email" : "SMS"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Send to</Label>
            <div className="flex gap-2">
              {(
                [
                  { id: "leads", label: "Leads", icon: Users },
                  {
                    id: "churches",
                    label: "Churches on FlockInsight",
                    icon: Building2,
                  },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSide(s.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
                    side === s.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <s.icon className="size-4" />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!ready && (
          <p className="text-warning-foreground bg-warning/20 flex items-center gap-2 rounded-lg p-3 text-sm">
            <AlertTriangle className="size-4 shrink-0" />
            {channel === "email"
              ? "No email provider is configured on this server (RESEND_API_KEY or SMTP_HOST)."
              : "SMS isn't configured on this server (TERMII_API_KEY and TERMII_SENDER_ID)."}
          </p>
        )}

        {/* Audience */}
        <div className="grid gap-3 sm:grid-cols-2">
          {side === "churches" ? (
            <>
              <div className="space-y-2">
                <Label>Which churches</Label>
                <Select
                  value={churchFilter}
                  onValueChange={(v) => setChurchFilter(v as ChurchFilter)}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label="Church audience"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every church</SelectItem>
                    <SelectItem value="plan">On a plan</SelectItem>
                    <SelectItem value="country">In a country</SelectItem>
                    <SelectItem value="status">By account status</SelectItem>
                    <SelectItem
                      value="denomination"
                      disabled={denominations.length === 0}
                    >
                      In a denomination
                    </SelectItem>
                    <SelectItem value="picked">Pick them myself</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {churchFilter === "plan" && (
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={plan} onValueChange={setPlan}>
                    <SelectTrigger className="w-full" aria-label="Plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLANS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {churchFilter === "country" && (
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger className="w-full" aria-label="Country">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent searchPlaceholder="Search countries…">
                      {countries.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {churchFilter === "denomination" && (
                <div className="space-y-2">
                  <Label>Denomination</Label>
                  <Select
                    value={denominationId}
                    onValueChange={setDenominationId}
                  >
                    <SelectTrigger className="w-full" aria-label="Denomination">
                      <SelectValue placeholder="Choose a denomination" />
                    </SelectTrigger>
                    <SelectContent searchPlaceholder="Search denominations…">
                      {denominations.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} ({d.churches})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {churchFilter === "status" && (
                <div className="space-y-2">
                  <Label>Account status</Label>
                  <Select
                    value={churchStatus}
                    onValueChange={(v) =>
                      setChurchStatus(v as "active" | "suspended")
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label="Account status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Which leads</Label>
                <Select
                  value={leadFilter}
                  onValueChange={(v) => setLeadFilter(v as LeadFilter)}
                >
                  <SelectTrigger className="w-full" aria-label="Lead audience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">
                      Still open ({openLeads})
                    </SelectItem>
                    <SelectItem value="status">At one stage</SelectItem>
                    <SelectItem value="source">From one source</SelectItem>
                    <SelectItem value="all">Everyone ({totalLeads})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {leadFilter === "status" && (
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select
                    value={leadStatus}
                    onValueChange={(v) => setLeadStatus(v as LeadStatus)}
                  >
                    <SelectTrigger className="w-full" aria-label="Stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label} ({leadCounts[s.id]})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {leadFilter === "source" && (
                <div className="space-y-2">
                  <Label>Source</Label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger className="w-full" aria-label="Source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent searchPlaceholder="Search sources…">
                      {sources.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>

        {side === "churches" && churchFilter === "picked" && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={churchQuery}
                onChange={(e) => setChurchQuery(e.target.value)}
                placeholder="Search churches…"
                className="pl-9"
              />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border p-1">
              {filteredChurches.map((c) => {
                const on = picked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      on
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-accent",
                    )}
                  >
                    {c.name}
                    {on && <Check className="size-4" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Message */}
        {channel === "email" && (
          <div className="space-y-2">
            <Label htmlFor="c-subject">Subject</Label>
            <Input
              id="c-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="{church}: take attendance in 30 seconds this Sunday"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="c-body">Message</Label>
          <Textarea
            id="c-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={channel === "email" ? 8 : 4}
            placeholder={
              channel === "email"
                ? "Hello {name},\n\nRunning {church} on paper registers takes hours every week…"
                : "Hi {name}, FlockInsight helps {church} track attendance, giving and follow-up. Free for 7 Sundays: flockinsight.com"
            }
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {TEMPLATE_TAGS.map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => insert(t.tag)}
                title={t.hint}
                className="bg-muted hover:bg-accent rounded-full px-2.5 py-1 font-mono text-xs font-semibold transition-colors"
              >
                {t.tag}
              </button>
            ))}
            {channel === "sms" && body && (
              <span className="text-muted-foreground ml-auto text-xs">
                {body.length} characters · {pages} page{pages === 1 ? "" : "s"}{" "}
                per recipient
              </span>
            )}
          </div>
        </div>

        {channel === "email" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-cta">Button link (optional)</Label>
              <Input
                id="c-cta"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="/pricing"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-cta-label">Button text</Label>
              <Input
                id="c-cta-label"
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="See how it works"
              />
            </div>
          </div>
        )}

        {body.trim() && (
          <div className="bg-muted/50 space-y-1 rounded-xl border p-3">
            <p className="text-muted-foreground text-xs font-semibold uppercase">
              Preview
            </p>
            <p className="text-sm whitespace-pre-wrap">{preview}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground text-sm">
            {reach === null
              ? "Reach is worked out when you send."
              : `About ${reach} recipient${reach === 1 ? "" : "s"}`}
            {channel === "sms" && reach !== null && body
              ? ` · roughly ${reach * pages} SMS pages`
              : ""}
          </p>
          <Button onClick={submit} disabled={pending || !ready}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
