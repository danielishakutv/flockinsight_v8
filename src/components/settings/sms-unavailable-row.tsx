"use client";

import { MessageSquareOff } from "lucide-react";
import { useT } from "@/components/i18n-provider";

/**
 * Where the SMS toggle would be, for a church in a country SMS cannot reach.
 *
 * The toggle used to be offered everywhere. A Mozambican church could turn
 * SMS greetings on, see only "your sender ID isn't approved yet", and every
 * morning the cron was refused and nobody with only a phone number was
 * greeted. Saying it plainly, in the place the choice would have been, is the
 * difference between "SMS is broken" and "SMS isn't sold here; email is".
 */
export function SmsUnavailableRow() {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed p-3">
      <MessageSquareOff className="text-muted-foreground size-5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">SMS</p>
        <p className="text-muted-foreground text-xs">
          {t("communication.smsIsnTAvailableIn")} Email is free and unlimited.
        </p>
      </div>
    </div>
  );
}
