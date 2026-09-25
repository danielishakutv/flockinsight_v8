"use client";

import { usePathname } from "next/navigation";
import { APP_VERSION } from "@/lib/version";

/**
 * Who made this.
 *
 * It appears in exactly two places in the whole product: here, under the
 * sign-in form, and in the "About this software" card in Settings. Everything
 * past the sign-in page carries the church's own branding — a maker's name
 * turning up inside somebody's own platform reads as something gone wrong, so
 * the credit is taken once, before anyone has signed in, and then stays out of
 * the way.
 *
 * On the other auth pages (sign up, password reset) it stays a single
 * copyright line: the full block belongs on the sign-in page.
 */
export function MakerFooter() {
  const pathname = usePathname();
  const year = new Date().getFullYear();

  if (pathname !== "/login") {
    return (
      <p className="text-muted-foreground mt-8 text-center text-xs">
        © {year} Toko Technologies · FlockInsight
      </p>
    );
  }

  return (
    <footer className="text-muted-foreground mt-8 space-y-0.5 text-center text-xs leading-relaxed">
      <p>{year}</p>
      <p>Secure, Fast and Reliable Software</p>
      <p>
        Developed by{" "}
        <span className="text-foreground/80 font-semibold">
          Toko Technologies
        </span>{" "}
        (a division of Toko Academy Ltd)
      </p>
      <p>Made in Nigeria</p>
      <p className="pt-1 opacity-60">FlockInsight v{APP_VERSION}</p>
    </footer>
  );
}
