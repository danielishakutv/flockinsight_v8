"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  savePushSubscription,
  removePushSubscription,
} from "@/app/(app)/notifications/actions";
import { useMounted } from "@/lib/client-state";
import { Button } from "@/components/ui/button";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushToggle() {
  const mounted = useMounted();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Whether push works here is a fact about the browser, known as soon as we
  // are running in one — no state, no extra render.
  const supported =
    mounted &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !!VAPID;

  // Whether this device is already subscribed only the service worker knows.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setSubscribed(!!sub);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [supported]);

  if (!supported) return null;

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Notifications are blocked in your browser settings.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID as string),
      });
      const json = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      const res = await savePushSubscription({
        endpoint: json.endpoint,
        keys: json.keys,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSubscribed(true);
      toast.success("Push notifications enabled on this device.");
    } catch {
      toast.error("Could not enable push notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Push notifications turned off on this device.");
    } catch {
      toast.error("Could not turn off push notifications.");
    } finally {
      setBusy(false);
    }
  }

  return subscribed ? (
    <Button variant="outline" size="sm" onClick={disable} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <BellOff className="size-4" />}
      Push on
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={enable} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Bell className="size-4" />}
      Enable push
    </Button>
  );
}
