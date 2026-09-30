"use client";

import { useSyncExternalStore } from "react";
import { Church } from "lucide-react";
import {
  FADE_MS,
  getServerSplashPhase,
  getSplashPhase,
  subscribeSplash,
} from "@/components/pwa/splash-store";

/**
 * The two seconds after the app icon is tapped.
 *
 * Android draws its own splash from the manifest (icon on background_color)
 * and then hands over to a blank page while React boots; iOS draws nothing at
 * all unless a startup image is supplied at every device size. Either way
 * there is a gap, and a gap is where an app feels cheap. This fills it with
 * the same violet the native splash uses, so the two read as one screen.
 *
 * Shown only in the installed app, once per launch — a client-side route
 * change must never bring it back. Both of those decisions live in
 * splash-store, which owns the timeline.
 */

export function SplashScreen() {
  const phase = useSyncExternalStore(
    subscribeSplash,
    getSplashPhase,
    getServerSplashPhase,
  );

  if (phase === "hidden") return null;

  return (
    <div
      // Inert to assistive tech and to the pointer: it is decoration over a
      // page that has already rendered beneath it.
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center ease-out"
      style={{
        // Matches manifest background_color, so the handover from the native
        // splash is invisible.
        background:
          "radial-gradient(120% 90% at 50% 0%, #241a3d 0%, #0f0b17 62%)",
        opacity: phase === "leaving" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      <div className="flex flex-col items-center gap-5 px-8 text-center">
        <div
          className="grid size-24 place-items-center rounded-[1.6rem] text-white shadow-2xl"
          style={{
            background: "linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)",
            boxShadow: "0 18px 50px -12px rgba(109,40,217,0.7)",
            animation: "fi-splash-rise 620ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          <Church className="size-12" strokeWidth={2.2} />
        </div>

        <div
          style={{
            animation:
              "fi-splash-rise 620ms cubic-bezier(0.22,1,0.36,1) 120ms both",
          }}
        >
          <p className="text-3xl font-extrabold tracking-tight text-white">
            Flock<span style={{ color: "#a78bfa" }}>Insight</span>
          </p>
          <p
            className="mt-2 text-sm font-medium"
            style={{ color: "#a9a2c4" }}
          >
            Everything your ministry needs
          </p>
        </div>
      </div>

      <div
        className="absolute bottom-10 h-1 w-24 overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.10)" }}
      >
        <span
          className="block h-full w-full rounded-full"
          style={{
            background: "linear-gradient(90deg, #6d28d9, #a78bfa)",
            transformOrigin: "left",
            animation: "fi-splash-bar 2000ms ease-out both",
          }}
        />
      </div>

      <style>{`
        @keyframes fi-splash-rise {
          from { opacity: 0; transform: translateY(14px) scale(0.94); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes fi-splash-bar {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes fi-splash-rise { from { opacity: 1; } to { opacity: 1; } }
          @keyframes fi-splash-bar  { from { transform: scaleX(1); } to { transform: scaleX(1); } }
        }
      `}</style>
    </div>
  );
}
