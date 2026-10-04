import Link from "next/link";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Make a QR code for this" — from anywhere in the app.
 *
 * A link into the designer with the address already filled in, rather than a
 * dialog. Three reasons it is a link and not a copy of the designer:
 *
 *   - The designer is a large client component with a live preview and a
 *     scannability check. Dropping it into the forms list, the public-page
 *     settings and the giving page would put all of that in three more
 *     bundles for a button most people never press.
 *   - A code made this way is SAVED, so it can be found and downloaded again
 *     next year when the flyer is reprinted. A dialog that renders one and
 *     throws it away is the thing churches currently do with free websites.
 *   - The destination is validated on arrival, by the same function that
 *     validates a short link's destination.
 *
 * The price list has promised "a shareable link and QR code" on forms since
 * Growth launched. This is the part that was missing.
 */
export function QrButton({
  url,
  title,
  label = "QR code",
  variant = "outline",
  size = "sm",
  className,
}: {
  /** The address the code should open. Absolute. */
  url: string;
  /** What the saved code should be called. */
  title: string;
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const href = `/links/qr/new?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
  return (
    <Button asChild variant={variant} size={size} className={cn("min-h-11", className)}>
      <Link href={href}>
        <QrCode className="size-4" />
        {label}
      </Link>
    </Button>
  );
}
