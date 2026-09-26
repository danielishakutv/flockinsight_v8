"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Loader2,
  Mic,
  MicOff,
  Signal,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { initialsOf } from "@/lib/meetings-shared";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

export type JoinValues = {
  name: string;
  micOn: boolean;
  cameraOn: boolean;
  lowData: boolean;
  passcode: string;
};

/**
 * The room before the room.
 *
 * Every good meeting app has this screen and every bad one doesn't, for one
 * reason: it is where people find out their microphone is the wrong one, in
 * private, instead of in front of forty people. It also lets someone on a
 * hard-up connection choose audio-only BEFORE a camera has ever been opened —
 * which is the difference between joining and giving up.
 */
export function JoinScreen({
  title,
  churchName,
  churchLogo,
  defaultName,
  needsPasscode,
  needsSignIn,
  lowDataDefault,
  error,
  joining,
  onJoin,
  signInHref,
}: {
  title: string;
  churchName: string;
  churchLogo: string | null;
  defaultName: string;
  needsPasscode: boolean;
  needsSignIn: boolean;
  lowDataDefault: boolean;
  error: string | null;
  joining: boolean;
  onJoin: (values: JoinValues) => void;
  signInHref: string;
}) {
  const t = useT();
  const [name, setName] = useState(defaultName);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(!lowDataDefault);
  const [lowData, setLowData] = useState(lowDataDefault);
  const [passcode, setPasscode] = useState("");
  const [devicesBlocked, setDevicesBlocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<MediaStream | null>(null);

  /*
   * The preview holds a real camera open, so it is released the moment it is
   * not wanted — when low-data is switched on, when the camera is switched
   * off, and when this screen goes away. A preview left running is a camera
   * light that stays on after someone thought they had turned it off.
   */
  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      previewRef.current?.getTracks().forEach((t) => t.stop());
      previewRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    if (!cameraOn || lowData) {
      stop();
      return;
    }

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setDevicesBlocked(true);
          setCameraOn(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [cameraOn, lowData]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    previewRef.current?.getTracks().forEach((t) => t.stop());
    previewRef.current = null;
    onJoin({ name: name.trim() || "Guest", micOn, cameraOn: cameraOn && !lowData, lowData, passcode });
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-8 text-white">
      <div className="w-full max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          {churchLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={churchLogo}
              alt=""
              className="size-11 rounded-xl object-cover ring-1 ring-white/15"
            />
          ) : (
            <div className="flex size-11 items-center justify-center rounded-xl bg-indigo-500/20 ring-1 ring-white/15">
              <Video className="size-5 text-indigo-300" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold sm:text-2xl">{title}</h1>
            <p className="truncate text-sm text-slate-400">{churchName}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Preview */}
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10">
            {cameraOn && !lowData ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="size-full -scale-x-100 object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3">
                <div className="flex size-20 items-center justify-center rounded-full bg-slate-700 text-2xl font-bold">
                  {initialsOf(name || "Guest")}
                </div>
                <p className="text-sm text-slate-400">
                  {lowData
                    ? t("meetings.audioOnlyCameraStays")
                    : t("meetings.cameraOff")}
                </p>
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 p-4">
              <RoundToggle
                on={micOn}
                onClick={() => setMicOn((v) => !v)}
                onIcon={<Mic className="size-5" />}
                offIcon={<MicOff className="size-5" />}
                label={micOn ? t("meetings.mute") : t("meetings.unmute")}
              />
              <RoundToggle
                on={cameraOn && !lowData}
                disabled={lowData}
                onClick={() => setCameraOn((v) => !v)}
                onIcon={<Camera className="size-5" />}
                offIcon={<CameraOff className="size-5" />}
                label={
                  cameraOn ? t("meetings.cameraOff2") : t("meetings.cameraOn2")
                }
              />
            </div>
          </div>

          {/* Form */}
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="join-name" className="mb-1.5 block text-slate-300">
                {t("meetings.yourName")}
              </Label>
              <Input
                id="join-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Grace Okoro"
                maxLength={60}
                autoComplete="name"
                required
                className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                {t("meetings.yourNameHint")}
              </p>
            </div>

            {needsPasscode && (
              <div>
                <Label htmlFor="join-passcode" className="mb-1.5 block text-slate-300">
                  {t("meetings.meetingPasscode")}
                </Label>
                <Input
                  id="join-passcode"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={12}
                  placeholder="6 digits"
                  className="border-white/15 bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <Switch
                checked={lowData}
                onCheckedChange={(v) => {
                  setLowData(v);
                  if (v) setCameraOn(false);
                }}
                aria-label={t("meetings.lowDataMode")}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Signal className="size-4 text-emerald-400" />
                  {t("meetings.lowDataMode")}
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">
                  {t("meetings.lowDataModeHint")}
                </span>
              </span>
            </label>

            {devicesBlocked && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {t("meetings.cameraBlocked")}
              </p>
            )}

            {error && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            )}

            {needsSignIn ? (
              <Button asChild size="lg" className="w-full">
                <a href={signInHref}>{t("meetings.signInToJoin")}</a>
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={joining} className="w-full">
                {joining ? (
                  <>
                    <Loader2 className="animate-spin" /> {t("meetings.joining")}
                  </>
                ) : (
                  t("meetings.joinMeeting")
                )}
              </Button>
            )}

            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              {t("meetings.privacyNote")}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function RoundToggle({
  on,
  onClick,
  onIcon,
  offIcon,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "flex size-12 items-center justify-center rounded-full transition disabled:opacity-40",
        on ? "bg-white/15 text-white hover:bg-white/25" : "bg-rose-500 text-white hover:bg-rose-600",
      )}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}
