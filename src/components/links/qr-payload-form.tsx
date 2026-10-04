"use client";

import Link from "next/link";
import { ExternalLink, Info, Lock, PencilLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  KIND_BLURB,
  KIND_LABEL,
  QR_KINDS,
  blankPayload,
  payloadIsSensitive,
  type QrPayload,
} from "@/lib/qr/payload";
import { prettyDestination, shortUrlForPrint } from "@/lib/links-shared";
import { useT } from "@/components/i18n-provider";

/**
 * What the code points at.
 *
 * `link` is first in the list and is the one the designer opens on, because it
 * is the only kind whose destination can be changed after the code is printed —
 * and a printed code whose destination cannot change is the reason this module
 * exists. The other kinds are honest about being fixed, in their own words, in
 * the line under each one.
 */

export type LinkChoice = {
  id: string;
  code: string;
  title: string | null;
  destination: string;
  status: string;
};

export function QrPayloadForm({
  payload,
  onChange,
  links,
  baseUrl,
  canUseShortLinks,
  selectedLinkId,
  onSelectLink,
}: {
  payload: QrPayload;
  onChange: (payload: QrPayload) => void;
  links: LinkChoice[];
  baseUrl: string;
  canUseShortLinks: boolean;
  selectedLinkId: string | null;
  onSelectLink: (id: string | null) => void;
}) {
  const t = useT();
  /*
   * Each field below spreads the NARROWED payload rather than going through a
   * generic setter. `keyof QrPayload` on a discriminated union is only `kind`
   * — the one key every variant shares — so a generic setter taking a field
   * name cannot typecheck at all, and making it typecheck means casting away
   * the very thing that stops a WiFi field being written onto an email
   * payload.
   */
  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <h3 className="font-semibold">{t("links.whatShouldScanningItDo")}</h3>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {QR_KINDS.map((kind) => {
            const active = payload.kind === kind;
            const locked = kind === "link" && !canUseShortLinks;
            return (
              <button
                key={kind}
                type="button"
                disabled={locked}
                onClick={() => {
                  onChange(blankPayload(kind));
                  if (kind !== "link") onSelectLink(null);
                }}
                aria-pressed={active}
                className={cn(
                  "min-h-11 rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition",
                  active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                  locked && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="flex items-center gap-1">
                  {locked && <Lock className="size-3 shrink-0" />}
                  {KIND_LABEL[kind]}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-muted-foreground mt-3 flex gap-1.5 text-xs leading-relaxed">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {KIND_BLURB[payload.kind]}
        </p>
      </div>

      <div className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5">
        {payload.kind === "link" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t("links.whichShortLink")}</Label>
              {links.length === 0 ? (
                <div className="border-border bg-muted/40 rounded-xl border p-3">
                  <p className="text-sm font-medium">{t("links.youHaveNoShortLinks")}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                    Make one first and this code can point at it — then you can change
                    where it goes without reprinting anything.
                  </p>
                  <Link
                    href="/links"
                    className="text-primary mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-medium hover:underline"
                  >
                    Make a short link
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
              ) : (
                <>
                  <select
                    value={selectedLinkId ?? ""}
                    onChange={(e) => onSelectLink(e.target.value || null)}
                    className="border-input bg-background focus-visible:ring-ring min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <option value="">{t("links.chooseALink")}</option>
                    {links.map((l) => (
                      <option key={l.id} value={l.id}>
                        /l/{l.code}
                        {l.title ? ` — ${l.title}` : ""}
                        {l.status !== "active" ? ` (${l.status})` : ""}
                      </option>
                    ))}
                  </select>

                  {selectedLinkId && (
                    <SelectedLink
                      link={links.find((l) => l.id === selectedLinkId)!}
                      baseUrl={baseUrl}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}

        {payload.kind === "url" && (
          <Text
            label={t("links.theWebAddress")}
            type="url"
            value={payload.url}
            onChange={(url) => onChange({ ...payload, url })}
            placeholder={t("links.graceChurchGive")}
            hint={t("links.youCanLeaveOffHttps")}
          />
        )}

        {payload.kind === "text" && (
          <Area
            label={t("links.theWordsToShow")}
            value={payload.text}
            onChange={(text) => onChange({ ...payload, text })}
            placeholder={t("links.forGodSoLovedThe")}
            hint={t("links.shorterIsBetterEveryCharacter")}
            max={1000}
          />
        )}

        {payload.kind === "wifi" && (
          <>
            <Text
              label={t("links.networkName")}
              value={payload.ssid}
              onChange={(ssid) => onChange({ ...payload, ssid })}
              placeholder={t("links.graceHouseGuest")}
              hint={t("links.exactlyAsItAppearsIn")}
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t("links.security")}</Label>
              <select
                value={payload.security}
                onChange={(e) => onChange({ ...payload, security: e.target.value as "WPA" })}
                className="border-input bg-background focus-visible:ring-ring min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="WPA">{t("links.wpaWpa2Wpa3AlmostAlways")}</option>
                <option value="WEP">{t("links.wepVeryOldRouters")}</option>
                <option value="nopass">{t("links.openNetworkNoPassword")}</option>
              </select>
            </div>
            {payload.security !== "nopass" && (
              <Text
                label={t("links.password")}
                value={payload.password}
                onChange={(password) => onChange({ ...payload, password })}
                placeholder={t("links.theGuestPassword")}
                hint={t("links.semicolonsColonsAndQuotationMarks")}
              />
            )}
            <Check
              label={t("links.thisNetworkIsHidden")}
              checked={payload.hidden}
              onChange={(hidden) => onChange({ ...payload, hidden })}
            />
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm font-medium">{t("links.anyoneWhoCanSeeThis")}</p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                A WiFi code carries the password in it. That is the point — a visitor
                joins without anybody reading it out — but it means the printed code
                deserves the same care as the password itself. Put it on your guest
                network, not the one the office computers are on.
              </p>
            </div>
          </>
        )}

        {payload.kind === "phone" && (
          <Text
            label={t("links.phoneNumber")}
            type="tel"
            value={payload.phone}
            onChange={(phone) => onChange({ ...payload, phone })}
            placeholder="0808 825 6055"
            hint={t("links.spacesAndDashesAreFine")}
          />
        )}

        {payload.kind === "sms" && (
          <>
            <Text
              label={t("links.phoneNumber")}
              type="tel"
              value={payload.phone}
              onChange={(phone) => onChange({ ...payload, phone })}
              placeholder="0808 825 6055"
            />
            <Area
              label={t("links.theMessageAlreadyWritten")}
              value={payload.message}
              onChange={(message) => onChange({ ...payload, message })}
              placeholder={t("links.iDLikeToJoin")}
              hint={t("links.theyCanEditItBefore")}
              max={300}
            />
          </>
        )}

        {payload.kind === "whatsapp" && (
          <>
            <Text
              label={t("links.whatsappNumber")}
              type="tel"
              value={payload.phone}
              onChange={(phone) => onChange({ ...payload, phone })}
              placeholder="0808 825 6055"
              hint={t("links.aNigerianNumberStarting0")}
            />
            <Area
              label={t("links.theMessageAlreadyWritten")}
              value={payload.message}
              onChange={(message) => onChange({ ...payload, message })}
              placeholder={t("links.helloIWasAtThe")}
              max={500}
            />
          </>
        )}

        {payload.kind === "email" && (
          <>
            <Text
              label={t("links.emailAddress")}
              type="email"
              value={payload.email}
              onChange={(email) => onChange({ ...payload, email })}
              placeholder={t("links.officeGraceChurch")}
            />
            <Text
              label={t("links.subject")}
              value={payload.subject}
              onChange={(subject) => onChange({ ...payload, subject })}
              placeholder={t("links.prayerRequest")}
            />
            <Area
              label={t("links.theMessageAlreadyWritten")}
              value={payload.body}
              onChange={(body) => onChange({ ...payload, body })}
              max={800}
            />
          </>
        )}

        {payload.kind === "contact" && (
          <>
            <Text
              label={t("links.name")}
              value={payload.name}
              onChange={(name) => onChange({ ...payload, name })}
              placeholder={t("links.pastorEmekaOkafor")}
              hint={t("links.theFirstWordIsTaken")}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Text
                label={t("links.churchOrOrganisation")}
                value={payload.org}
                onChange={(org) => onChange({ ...payload, org })}
                placeholder={t("links.graceHouse")}
              />
              <Text
                label={t("links.role")}
                value={payload.title}
                onChange={(title) => onChange({ ...payload, title })}
                placeholder={t("links.seniorPastor")}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Text
                label={t("links.phone")}
                type="tel"
                value={payload.phone}
                onChange={(phone) => onChange({ ...payload, phone })}
              />
              <Text
                label={t("links.email")}
                type="email"
                value={payload.email}
                onChange={(email) => onChange({ ...payload, email })}
              />
            </div>
            <Text
              label={t("links.website")}
              type="url"
              value={payload.url}
              onChange={(url) => onChange({ ...payload, url })}
              placeholder={t("links.graceChurch")}
            />
            <Text
              label={t("links.address")}
              value={payload.address}
              onChange={(address) => onChange({ ...payload, address })}
              placeholder={t("links.churchRoadJos")}
            />
          </>
        )}

        {payload.kind === "location" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Text
                label={t("links.latitude")}
                value={payload.latitude}
                onChange={(latitude) => onChange({ ...payload, latitude })}
                placeholder="9.8965"
              />
              <Text
                label={t("links.longitude")}
                value={payload.longitude}
                onChange={(longitude) => onChange({ ...payload, longitude })}
                placeholder="8.8583"
              />
            </div>
            <Text
              label={t("links.whatToCallIt")}
              value={payload.label}
              onChange={(label) => onChange({ ...payload, label })}
              placeholder={t("links.graceHouseJos")}
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              To find the numbers: open Google Maps, press and hold the spot, and the
              coordinates appear at the top. Latitude first.
            </p>
          </>
        )}

        {payload.kind === "event" && (
          <>
            <Text
              label={t("links.whatItIsCalled")}
              value={payload.title}
              onChange={(title) => onChange({ ...payload, title })}
              placeholder={t("links.carolService")}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DateTime
                label={t("links.starts")}
                value={payload.starts}
                onChange={(starts) => onChange({ ...payload, starts })}
              />
              <DateTime
                label={t("links.ends")}
                value={payload.ends}
                onChange={(ends) => onChange({ ...payload, ends })}
              />
            </div>
            <Text
              label={t("links.where")}
              value={payload.location}
              onChange={(location) => onChange({ ...payload, location })}
              placeholder={t("links.graceHouseJos")}
            />
            <Area
              label={t("links.details")}
              value={payload.description}
              onChange={(description) => onChange({ ...payload, description })}
              max={500}
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              The time is saved without a timezone, so a phone reads it in its own — which
              is right for a poster on a wall, where everybody reading it is standing in
              the same place.
            </p>
          </>
        )}

        {payloadIsSensitive(payload) && (
          <p className="text-muted-foreground flex gap-1.5 text-xs leading-relaxed">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            The password is never shown in the list of codes, only here.
          </p>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * The chosen link
 * ========================================================== */

function SelectedLink({ link, baseUrl }: { link: LinkChoice; baseUrl: string }) {
  return (
    <div className="border-border bg-muted/40 mt-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-semibold">{shortUrlForPrint(baseUrl, link.code)}</code>
        {link.status !== "active" && <Badge variant="outline">{link.status}</Badge>}
      </div>
      <p className="text-muted-foreground mt-1 text-xs break-all">
        goes to {prettyDestination(link.destination, 70)}
      </p>
      <Link
        href={`/links/${link.id}`}
        className="text-primary mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-medium hover:underline"
      >
        <PencilLine className="size-3.5" />
        Change where it goes
      </Link>
    </div>
  );
}

/* ============================================================
 * Fields
 * ========================================================== */

function Text({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: "text" | "tel" | "email" | "url";
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-11"
      />
      {hint && <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>}
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  placeholder,
  hint,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  max: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        placeholder={placeholder}
        rows={3}
        maxLength={max}
      />
      {hint && <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>}
    </div>
  );
}

function DateTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11"
      />
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary size-4"
      />
      {label}
    </label>
  );
}
