"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
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
import { mediaFault, type MediaFault } from "@/lib/meeting-client";
import { pointerKind } from "@/lib/meetings-shared";
import type { TKey } from "@/lib/i18n/translate";

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
/**
 * One sentence per way a device can fail to open.
 *
 * "blocked" is the only one that depends on the device, because it is the only
 * one that asks the person to go and change something — and where they go is
 * an icon in a different place on a phone and on a desktop.
 */
export function mediaFaultKey(fault: MediaFault): TKey {
  if (fault === "blocked") {
    return pointerKind() === "touch"
      ? "meetings.mediaBlocked"
      : "meetings.mediaBlockedDesktop";
  }
  const rest = {
    missing: "meetings.mediaMissing",
    inUse: "meetings.mediaInUse",
    unknown: "meetings.mediaUnreachable",
    unsupported: "meetings.mediaUnsupported",
  } as const satisfies Record<Exclude<MediaFault, "blocked">, TKey>;
  return rest[fault];
}

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
  const [fault, setFault] = useState<MediaFault | null>(null);
  /** null while the browser's dialog is up — nothing else should render yet. */
  const [asked, setAsked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<MediaStream | null>(null);

  /*
   * Ask for both devices, once, as soon as this screen appears.
   *
   * This is the whole point of a screen before the call. The browser shows ONE
   * dialog per getUserMedia call, so camera and microphone are asked for
   * together — two calls would be two dialogs, and the second arrives after
   * the person has stopped reading. And it happens here rather than in the
   * room because the remedy for a refusal is "change the setting and reload",
   * which costs nothing on this screen and throws you out of a live meeting on
   * the next one.
   *
   * Data Saver does not suppress the request. It decides what gets SENT, not
   * whether the browser has been asked — a meeting that starts in Data Saver
   * and switches to video mid-way should not stop to ask for permission in
   * front of a waiting congregation.
   *
   * The granted stream is kept for the preview and stopped on the way out.
   * Permission survives at the origin, so the room re-acquires silently with
   * no second dialog.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setFault("unsupported");
          setAsked(true);
        }
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
        });
      } catch (first) {
        // A machine with no camera fails the whole request, microphone and
        // all. Falling back to audio keeps the meeting usable for someone on
        // a desktop with no webcam, which is a great many church offices.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!cancelled) setCameraOn(false);
        } catch {
          if (!cancelled) {
            setFault(mediaFault(first));
            setMicOn(false);
            setCameraOn(false);
            setAsked(true);
          }
          return;
        }
      }

      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      previewRef.current = stream;
      setFault(null);
      setAsked(true);
    })();

    return () => {
      cancelled = true;
      previewRef.current?.getTracks().forEach((t) => t.stop());
      previewRef.current = null;
    };
  }, []);

  /*
   * Show the preview only while the camera is actually wanted, and let the
   * track go when it is not. A preview left running is a camera light that
   * stays on after somebody thought they had turned it off.
   */
  useEffect(() => {
    const el = videoRef.current;
    const stream = previewRef.current;
    if (!el) return;

    const video = stream?.getVideoTracks() ?? [];
    const wanted = cameraOn && !lowData;
    for (const track of video) track.enabled = wanted;

    if (wanted && stream) {
      el.srcObject = stream;
      void el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [cameraOn, lowData, asked]);

  /** Try the dialog again, for somebody who has just changed the setting. */
  const retry = () => {
    setFault(null);
    setAsked(false);
    window.location.reload();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Release the devices here. Permission lives on at the origin, so the room
    // re-acquires what it needs without a second dialog.
    previewRef.current?.getTracks().forEach((t) => t.stop());
    previewRef.current = null;
    onJoin({
      name: name.trim() || "Guest",
      micOn: micOn && fault === null,
      cameraOn: cameraOn && !lowData && fault === null,
      lowData,
      passcode,
    });
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
              // `pb-20` clears the control row below, which is absolutely
              // positioned over the bottom of this box.
              <div className="flex size-full flex-col items-center justify-center gap-3 px-4 pb-20">
                <div className="flex size-20 items-center justify-center rounded-full bg-slate-700 text-2xl font-bold">
                  {initialsOf(name || "Guest")}
                </div>
                <p className="text-center text-sm text-balance text-slate-400">
                  {!asked
                    ? // While the browser's own dialog is up. Without this the
                      // screen says "your camera is off", which reads as a
                      // setting rather than as a question waiting to be
                      // answered — and people dismiss the dialog to go and
                      // look for the setting.
                      t("meetings.allowToContinue")
                    : lowData
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

            {fault && (
              /*
                A panel, not a line of small print. Everything here needs the
                person to go and change something, and the Reload is the point:
                a permission changed in the browser's own panel does not reach
                a page that is already open, and on this screen reloading costs
                nothing.
              */
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs leading-relaxed text-amber-200">
                  {t(mediaFaultKey(fault), {
                    device: t("meetings.deviceCameraAndMic"),
                  })}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={retry}>
                    <RotateCcw className="size-4" /> {t("common.tryAgain")}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-amber-200/70">
                  {t("meetings.joinAnywayHint")}
                </p>
              </div>
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
