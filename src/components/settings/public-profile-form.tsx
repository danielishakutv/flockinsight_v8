"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import {
  savePublicProfile,
  type PublicProfileInput,
} from "@/app/(app)/settings/public/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUpload, GalleryUpload } from "@/components/settings/image-upload";
import { CHURCH_THEMES } from "@/lib/church-themes";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

type Initial = {
  handle: string;
  publicEnabled: boolean;
  theme: string;
  name: string;
  denomination: string;
  tagline: string;
  about: string;
  logo: string | null;
  coverUrl: string | null;
  photos: { url: string; caption?: string }[];
  addressText: string;
  landmarks: string;
  city: string;
  state: string;
  country: string;
  lat: number | null;
  lng: number | null;
  publicPhone: string;
  publicEmail: string;
  website: string;
  socials: Record<string, string>;
};

const SOCIALS: { key: string; label: string; placeholder: string }[] = [
  { key: "facebook", label: "Facebook", placeholder: "facebook.com/yourchurch" },
  { key: "instagram", label: "Instagram", placeholder: "@yourchurch" },
  { key: "youtube", label: "YouTube", placeholder: "youtube.com/@yourchurch" },
  { key: "tiktok", label: "TikTok", placeholder: "@yourchurch" },
  { key: "x", label: "X (Twitter)", placeholder: "@yourchurch" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "+234…" },
];

export function PublicProfileForm({
  baseUrl,
  initial,
}: {
  baseUrl: string;
  initial: Initial;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [f, setF] = useState<Initial>(initial);
  const set = (patch: Partial<Initial>) => setF((p) => ({ ...p, ...patch }));

  const url = `${baseUrl}/c/${f.handle}`;

  function copy() {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      (e: unknown) => {
        console.error("clipboard write failed", e);
        toast.message(t("settings.couldnTCopySelectThe"), { description: url });
      },
    );
  }

  async function share() {
    const text = `Join us at ${f.name}!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: f.name, text, url });
      } catch {
        /* user cancelled */
      }
    } else {
      copy();
      toast.success(t("settings.linkCopiedPasteItAnywhere"));
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return toast.error(t("settings.locationNotAvailable"));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        set({
          lat: +pos.coords.latitude.toFixed(6),
          lng: +pos.coords.longitude.toFixed(6),
        }),
      () => toast.error(t("settings.couldnTGetYourLocation")),
    );
  }

  function save() {
    const input: PublicProfileInput = {
      handle: f.handle,
      publicEnabled: f.publicEnabled,
      theme: f.theme,
      denomination: f.denomination,
      tagline: f.tagline,
      about: f.about,
      logo: f.logo,
      coverUrl: f.coverUrl,
      photos: f.photos,
      addressText: f.addressText,
      landmarks: f.landmarks,
      city: f.city,
      lat: f.lat,
      lng: f.lng,
      publicPhone: f.publicPhone,
      publicEmail: f.publicEmail,
      website: f.website,
      socials: f.socials,
    };
    start(async () => {
      const res = await savePublicProfile(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("settings.publicPageSaved"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Shareable link */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="text-primary size-5" /> Your FlockInsight page
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="handle">{t("settings.pageLink")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground hidden text-sm sm:inline">
                {baseUrl}/c/
              </span>
              <Input
                id="handle"
                value={f.handle}
                onChange={(e) =>
                  set({
                    handle: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-")
                      .replace(/-+/g, "-"),
                  })
                }
                className="max-w-xs font-mono"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Members can share this link to invite people. 3–40 letters,
              numbers or hyphens.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={share}>
              <Share2 className="size-4" /> Share
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> Open page
              </a>
            </Button>
          </div>

          {/* Listed toggle */}
          <button
            type="button"
            onClick={() => set({ publicEnabled: !f.publicEnabled })}
            className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left"
          >
            <div>
              <p className="text-sm font-semibold">{t("settings.listInPublicDirectory")}</p>
              <p className="text-muted-foreground text-xs">
                When on, your page is live and people can find you in search.
              </p>
            </div>
            <span
              className={
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
                (f.publicEnabled ? "bg-primary" : "bg-muted-foreground/30")
              }
            >
              <span
                className={
                  "inline-block size-5 transform rounded-full bg-white shadow transition-transform " +
                  (f.publicEnabled ? "translate-x-5" : "translate-x-0.5")
                }
              />
            </span>
          </button>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.branding")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUpload
            label={t("settings.logo")}
            kind="logo"
            maxDim={512}
            aspect="square"
            value={f.logo}
            onChange={(url) => set({ logo: url })}
          />
          <ImageUpload
            label={t("settings.coverPhoto")}
            kind="cover"
            maxDim={1600}
            aspect="wide"
            value={f.coverUrl}
            onChange={(url) => set({ coverUrl: url })}
          />

          {/* Colour theme */}
          <div className="space-y-2">
            <Label>{t("settings.colourTheme")}</Label>
            <div className="flex flex-wrap gap-2.5">
              {CHURCH_THEMES.map((churchTheme) => (
                <button
                  key={churchTheme.id}
                  type="button"
                  onClick={() => set({ theme: churchTheme.id })}
                  title={churchTheme.name}
                  className={cn(
                    "group relative size-11 rounded-xl ring-offset-2 transition-all ring-offset-background",
                    f.theme === churchTheme.id
                      ? "ring-foreground ring-2"
                      : "hover:ring-foreground/30 ring-1 ring-transparent",
                  )}
                  style={{ background: `linear-gradient(135deg, ${churchTheme.from}, ${churchTheme.to})` }}
                >
                  {f.theme === churchTheme.id && (
                    <Check className="absolute inset-0 m-auto size-5 text-white drop-shadow" />
                  )}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Sets the accent colours on your public church page.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.about")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tagline">{t("settings.tagline")}</Label>
              <Input
                id="tagline"
                value={f.tagline}
                placeholder={t("settings.aShortLineAboutYour")}
                onChange={(e) => set({ tagline: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="denomination">{t("settings.denominationType")}</Label>
              <Input
                id="denomination"
                value={f.denomination}
                placeholder={t("settings.eGPentecostalCatholicBaptist")}
                onChange={(e) => set({ denomination: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="about">{t("settings.description")}</Label>
            <Textarea
              id="about"
              value={f.about}
              rows={5}
              placeholder={t("settings.tellVisitorsAboutYourChurch")}
              onChange={(e) => set({ about: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Location */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.location")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="address">{t("settings.address")}</Label>
            <Input
              id="address"
              value={f.addressText}
              placeholder={t("settings.streetArea")}
              onChange={(e) => set({ addressText: e.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city">{t("settings.cityTown")}</Label>
              <Input
                id="city"
                value={f.city}
                onChange={(e) => set({ city: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="landmarks">{t("settings.landmarks")}</Label>
              <Input
                id="landmarks"
                value={f.landmarks}
                placeholder={t("settings.eGOppositeTheMarket")}
                onChange={(e) => set({ landmarks: e.target.value })}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {f.city || "—"}
            {f.state ? `, ${f.state}` : ""}
            {f.country ? `, ${f.country}` : ""} (state & country come from
            General settings)
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="lat">{t("settings.latitude")}</Label>
              <Input
                id="lat"
                value={f.lat ?? ""}
                inputMode="decimal"
                className="w-36"
                onChange={(e) =>
                  set({ lat: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lng">{t("settings.longitude")}</Label>
              <Input
                id="lng"
                value={f.lng ?? ""}
                inputMode="decimal"
                className="w-36"
                onChange={(e) =>
                  set({ lng: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={useMyLocation}>
              <MapPin className="size-4" /> Use my location
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Coordinates let people sort the directory by churches nearest them.
          </p>
        </CardContent>
      </Card>

      {/* Contact + socials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.contactSocial")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pphone">{t("settings.phone")}</Label>
              <Input
                id="pphone"
                type="tel"
                inputMode="tel"
                value={f.publicPhone}
                onChange={(e) => set({ publicPhone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pemail">{t("settings.email")}</Label>
              <Input
                id="pemail"
                type="email"
                value={f.publicEmail}
                onChange={(e) => set({ publicEmail: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">{t("settings.website")}</Label>
              <Input
                id="website"
                type="url"
                inputMode="url"
                value={f.website}
                placeholder="https://…"
                onChange={(e) => set({ website: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIALS.map((s) => (
              <div key={s.key} className="space-y-2">
                <Label htmlFor={`s-${s.key}`}>{s.label}</Label>
                <Input
                  id={`s-${s.key}`}
                  value={f.socials[s.key] ?? ""}
                  placeholder={s.placeholder}
                  onChange={(e) =>
                    set({ socials: { ...f.socials, [s.key]: e.target.value } })
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.photos")}</CardTitle>
        </CardHeader>
        <CardContent>
          <GalleryUpload
            photos={f.photos}
            onChange={(next) => set({ photos: next })}
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={pending} size="lg" className="shadow-lg">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save public page
        </Button>
      </div>
    </div>
  );
}
