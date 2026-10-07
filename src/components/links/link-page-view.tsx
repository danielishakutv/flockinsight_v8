import { Church } from "lucide-react";
import { getTheme, themeVars } from "@/lib/church-themes";
import {
  getLinkPageLayout,
  getLinkPageStyle,
  type LinkPageStyle,
} from "@/lib/link-page-shared";

/**
 * The link page itself, drawn once.
 *
 * The public page at `/hub/<slug>` and the preview in the editor both render
 * THIS, with the same props. That is the whole reason it exists as a component
 * rather than as markup inside the route: a preview built from a second,
 * hand-written copy of the same five styles is a preview that will eventually
 * lie, and the church only finds out from somebody who opened the real thing.
 *
 * A server component with no interactivity — every item is an `<a>`. So the
 * page works with JavaScript switched off, on a feature phone's browser, and
 * through whatever in-app browser Instagram is using this month, which is
 * where this link actually gets opened.
 */

export type ViewItem = {
  label: string;
  url: string;
  description: string | null;
};

export type LinkPageViewProps = {
  title: string;
  tagline: string | null;
  styleId: string;
  layoutId: string;
  showLogo: boolean;
  showChurchName: boolean;
  churchName: string;
  churchLogo: string | null;
  churchTheme: string;
  items: readonly ViewItem[];
  /** The editor's preview, which must not navigate anywhere. */
  preview?: boolean;
};

/* ------------------------------------------------------------------ *
 * Turning a style into classes
 * ------------------------------------------------------------------ *
 *
 * Full literal Tailwind class strings, never built by interpolation — a class
 * assembled from a variable is a class Tailwind's scanner never sees and never
 * emits, which is how a style ships looking entirely unstyled. The same reason
 * `tile` in lib/nav.ts holds whole class names.
 */

function pageClasses(s: LinkPageStyle): string {
  switch (s.background) {
    case "dark":
      return "bg-neutral-950 text-neutral-100";
    case "tint":
      return "bg-[color-mix(in_srgb,var(--brand)_8%,white)] text-neutral-900";
    case "brand-gradient":
      return "bg-gradient-to-b from-[var(--brand-from)] to-[var(--brand-to)] text-white";
    case "white":
    default:
      return "bg-white text-neutral-900";
  }
}

function mutedClasses(s: LinkPageStyle): string {
  switch (s.background) {
    case "dark":
      return "text-neutral-400";
    case "brand-gradient":
      return "text-white/75";
    default:
      return "text-neutral-500";
  }
}

function radiusClass(s: LinkPageStyle): string {
  switch (s.radius) {
    case "full":
      return "rounded-full";
    case "xl":
      return "rounded-2xl";
    case "none":
    default:
      return "rounded-none";
  }
}

function buttonClasses(s: LinkPageStyle): string {
  const shadow = s.shadow ? "shadow-md hover:shadow-lg" : "";
  switch (s.button) {
    case "brand":
      return `bg-[var(--brand)] text-white hover:brightness-110 ${shadow}`;
    case "white":
      return `bg-white text-neutral-900 hover:bg-neutral-100 ${shadow}`;
    case "outline":
      return `border-2 border-[var(--brand)] text-[var(--brand)] bg-white/70 hover:bg-white ${shadow}`;
    case "plain":
    default:
      // The Minimal style: a rule above each row and nothing else.
      return "border-t border-current/15 text-current hover:opacity-70";
  }
}

export function LinkPageView({
  title,
  tagline,
  styleId,
  layoutId,
  showLogo,
  showChurchName,
  churchName,
  churchLogo,
  churchTheme,
  items,
  preview = false,
}: LinkPageViewProps) {
  const style = getLinkPageStyle(styleId);
  const layout = getLinkPageLayout(layoutId);
  const theme = getTheme(churchTheme);

  const plain = style.button === "plain";
  const radius = radiusClass(style);
  const muted = mutedClasses(style);

  return (
    <div
      // The church's own colours, as CSS variables, exactly as the public
      // church page does it. A style arranges them; it never picks them.
      style={themeVars(theme)}
      className={[
        "flex flex-col items-center px-5 py-10",
        /*
         * Full viewport height on the real page so the background reaches the
         * bottom of the screen — and NOT in the preview, where `min-h-dvh`
         * inside a 32rem frame would make the box permanently scrollable with
         * a screen's worth of empty colour under three buttons.
         */
        preview ? "min-h-full" : "min-h-dvh",
        pageClasses(style),
      ].join(" ")}
    >
      <div className="w-full max-w-md">
        {/* ------------------------------------------------ the head */}
        <header className="flex flex-col items-center text-center">
          {showLogo &&
            (churchLogo ? (
              /*
               * A plain <img>, like the public church page, deliberately.
               *
               * `next/image` would need the logo's host in `images.remotePatterns`
               * and there is no `images` block in next.config.ts at all — so
               * next/image here would build cleanly and then fail at runtime on
               * the one element above the fold. Logos are already small, served
               * from a CDN, and sized by CSS.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={churchLogo}
                alt={churchName}
                className="mb-4 size-24 rounded-full object-cover shadow-md"
              />
            ) : (
              <span
                className={`mb-4 grid size-20 place-items-center rounded-full ${
                  style.background === "brand-gradient"
                    ? "bg-white/20 text-white"
                    : "bg-[var(--brand)]/12 text-[var(--brand)]"
                }`}
              >
                <Church className="size-9" />
              </span>
            ))}

          <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
            {title}
          </h1>

          {showChurchName && (
            <p className={`mt-1 text-sm font-semibold ${muted}`}>{churchName}</p>
          )}

          {tagline && (
            <p className={`mt-3 text-sm leading-relaxed ${muted}`}>{tagline}</p>
          )}
        </header>

        {/* ----------------------------------------------- the links */}
        <nav
          className={
            plain ? "mt-8 flex flex-col" : "mt-8 flex flex-col gap-3"
          }
          aria-label="Links"
        >
          {items.map((item, i) => (
            <a
              key={`${item.url}-${i}`}
              href={preview ? undefined : item.url}
              /*
               * `noopener` on every outbound link.
               *
               * Without it, the page it opens gets a handle on this one
               * through `window.opener` and can replace it — a church's own
               * link page redirected to somebody else's, from a link the
               * church added itself. `noreferrer` keeps the church's address
               * out of the other site's logs as well.
               *
               * Not applied to the church's own pages, so an internal link
               * still opens in the same tab and Back works.
               */
              {...(isExternal(item.url)
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              aria-disabled={preview || undefined}
              tabIndex={preview ? -1 : undefined}
              className={[
                "group flex items-center gap-3 font-semibold transition",
                plain ? "" : radius,
                buttonClasses(style),
                layout.id === "cards"
                  ? "px-5 py-4"
                  : layout.id === "list"
                    ? "px-4 py-2.5 text-sm"
                    : "px-5 py-3.5",
                preview ? "pointer-events-none" : "",
              ].join(" ")}
            >
              <span className="min-w-0 flex-1 text-center">
                <span className="block truncate">{item.label}</span>
                {/*
                  The description belongs to the Cards layout only. In Buttons
                  and List it is deliberately not rendered — a church can
                  change the layout without losing what it typed, and get it
                  back by changing the layout again.
                */}
                {layout.id === "cards" && item.description && (
                  <span
                    className={`mt-0.5 block truncate text-xs font-normal ${
                      style.button === "brand" || style.button === "white"
                        ? "opacity-70"
                        : muted
                    }`}
                  >
                    {item.description}
                  </span>
                )}
              </span>
            </a>
          ))}
        </nav>

        {items.length === 0 && (
          <p className={`mt-10 text-center text-sm ${muted}`}>
            No links yet.
          </p>
        )}

        {/* ---------------------------------------------- the footer */}
        {/* The same line the welcome, form, sign-up and church pages carry. */}
        <footer className={`mt-12 text-center text-xs ${muted}`}>
          Powered by FlockInsight
        </footer>
      </div>
    </div>
  );
}

/** Does this address leave the site? Internal links are stored as paths. */
function isExternal(url: string): boolean {
  return !url.startsWith("/");
}
