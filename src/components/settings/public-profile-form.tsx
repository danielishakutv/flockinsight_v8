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

type Initial = {
  handle: string;
  publicEnabled: boolean;
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [f, setF] = useState<Initial>(initial);
  const set = (patch: Partial<Initial>) => setF((p) => ({ ...p, ...patch }));

  const url = `${baseUrl}/c/${f.handle}`;

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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
      toast.success("Link copied — paste it anywhere to invite people.");
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return toast.error("Location not available.");
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        set({
          lat: +pos.coords.latitude.toFixed(6),
          lng: +pos.coords.longitude.toFixed(6),
        }),
      () => toast.error("Couldn't get your location."),
    );
  }

  function save() {
    const input: PublicProfileInput = {
      handle: f.handle,
      publicEnabled: f.publicEnabled,
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
      toast.success("Public page saved");
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
            <Label htmlFor="handle">Page link</Label>
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
              <p className="text-sm font-semibold">List in public directory</p>
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
          <CardTitle className="text-lg">Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUpload
            label="Logo"
            kind="logo"
            maxDim={512}
            aspect="square"
            value={f.logo}
            onChange={(url) => set({ logo: url })}
          />
          <ImageUpload
            label="Cover photo"
            kind="cover"
            maxDim={1600}
            aspect="wide"
            value={f.coverUrl}
            onChange={(url) => set({ coverUrl: url })}
          />
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tagline">Tagline</Label>
              <Input
                id="tagline"
                value={f.tagline}
                placeholder="A short line about your church"
                onChange={(e) => set({ tagline: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="denomination">Denomination / type</Label>
              <Input
                id="denomination"
                value={f.denomination}
                placeholder="e.g. Pentecostal, Catholic, Baptist"
                onChange={(e) => set({ denomination: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="about">Description</Label>
            <Textarea
              id="about"
              value={f.about}
              rows={5}
              placeholder="Tell visitors about your church, services and what to expect."
              onChange={(e) => set({ about: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Location */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={f.addressText}
              placeholder="Street, area"
              onChange={(e) => set({ addressText: e.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city">City / Town</Label>
              <Input
                id="city"
                value={f.city}
                onChange={(e) => set({ city: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="landmarks">Landmarks</Label>
              <Input
                id="landmarks"
                value={f.landmarks}
                placeholder="e.g. opposite the market"
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
              <Label htmlFor="lat">Latitude</Label>
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
              <Label htmlFor="lng">Longitude</Label>
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
          <CardTitle className="text-lg">Contact & social</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pphone">Phone</Label>
              <Input
                id="pphone"
                value={f.publicPhone}
                onChange={(e) => set({ publicPhone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pemail">Email</Label>
              <Input
                id="pemail"
                type="email"
                value={f.publicEmail}
                onChange={(e) => set({ publicEmail: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
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
          <CardTitle className="text-lg">Photos</CardTitle>
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
