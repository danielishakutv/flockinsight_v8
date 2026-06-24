"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineIndicator() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      className="animate-in fade-in fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-amber-950 shadow-lg"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
    >
      <WifiOff className="size-3.5" />
      You&apos;re offline — showing saved data
    </div>
  );
}
