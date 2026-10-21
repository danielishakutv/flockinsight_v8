/** Convert a name into a URL-friendly slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * `slugify` for a field somebody is typing into: the same rules, except that
 * a hyphen (or a space, which becomes one) at the end survives.
 *
 * `slugify` strips a trailing hyphen, and run on every keystroke that deleted
 * the separator the moment it was typed, so "youth-camp" could only ever come
 * out as "youthcamp". Run the full `slugify` on blur and on save.
 */
export function slugifyTyping(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48);
}

/** Short random suffix to de-duplicate slugs. */
export function randomSuffix(len = 5): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
