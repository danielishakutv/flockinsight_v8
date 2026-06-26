/** Canonical public base URL of the deployment (no trailing slash). */
export function siteUrl(): string {
  const raw =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://flockinsight.com";
  return raw.replace(/\/$/, "");
}

/** Public path for a church's shareable page. */
export function churchPath(handle: string): string {
  return `/c/${handle}`;
}

/** Absolute public URL for a church's shareable page. */
export function churchUrl(handle: string): string {
  return `${siteUrl()}${churchPath(handle)}`;
}
