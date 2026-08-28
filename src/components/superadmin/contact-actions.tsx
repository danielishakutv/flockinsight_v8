"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Check, Copy, Mail, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The quick actions beside a person's email and phone number in the admin.
 *
 * The same buttons mean different things on different machines: a `tel:` link
 * opens the dialer on a phone and does nothing useful on a desktop. So the row
 * asks the device which it is — `pointer: coarse` is true for touch screens —
 * and offers calling and texting there, copying everywhere else.
 *
 * It renders the desktop (copy) form first and switches after mount, because
 * the server has no idea what device this is and a mismatched first paint
 * would be a hydration error.
 */

const TOUCH_QUERY = "(pointer: coarse)";

function useIsTouch(): boolean {
  // A media query is external state, so React reads it rather than mirroring
  // it into an effect. The server snapshot is `false`, which is why the first
  // paint is the desktop form everywhere — matching what the server rendered.
  const subscribe = useCallback((onChange: () => void) => {
    const mq = window.matchMedia(TOUCH_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(TOUCH_QUERY).matches,
    () => false,
  );
}

/** Dial-safe form of a number: keeps a leading +, drops spaces and dashes. */
function dialable(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function CopyButton({
  value,
  label,
  icon: Icon,
}: {
  value: string;
  label: string;
  icon: typeof Copy;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access is blocked outside a secure context (plain http on a
      // LAN address, for instance) — say so rather than failing silently.
      toast.error("Couldn't copy — select the text and copy it manually.");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      title={`Copy ${label.toLowerCase()}: ${value}`}
    >
      {copied ? <Check className="size-4 text-emerald-600" /> : <Icon className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function ContactActions({
  email,
  phone,
  className,
}: {
  email?: string | null;
  phone?: string | null;
  className?: string;
}) {
  const touch = useIsTouch();
  if (!email && !phone) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {phone &&
        (touch ? (
          <>
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${dialable(phone)}`}>
                <Phone className="size-4" /> Call
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`sms:${dialable(phone)}`}>
                <MessageSquare className="size-4" /> Text
              </a>
            </Button>
          </>
        ) : (
          <CopyButton value={phone} label="Copy phone" icon={Phone} />
        ))}
      {email &&
        (touch ? (
          <Button asChild size="sm" variant="outline">
            <a href={`mailto:${email}`}>
              <Mail className="size-4" /> Email
            </a>
          </Button>
        ) : (
          <CopyButton value={email} label="Copy email" icon={Mail} />
        ))}
    </div>
  );
}
