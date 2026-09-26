/**
 * Mobile layout audit, run against the rendered HTML of a live server.
 *
 * Why rendered HTML and not the source: classes are composed at runtime (`cn()`,
 * variants, conditional branches), so grepping .tsx finds patterns that never
 * reach a browser and misses ones that do. This walks the actual markup a phone
 * would receive.
 *
 * What it CANNOT do, stated plainly: there is no headless browser here, so
 * nothing below is a measurement. It is a search for the specific structures
 * that cause horizontal overflow and clipped columns, in context — an element
 * wider than the viewport with no scrollable ancestor, an unbreakable string in
 * a container that cannot wrap, a grid that never collapses. Each finding is a
 * place to look, and the ones marked HIGH are ones where the CSS cannot behave
 * any other way.
 *
 * Usage:
 *   BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start -- -p 3100
 *   node scripts/audit-mobile.mjs            # human-readable
 *   node scripts/audit-mobile.mjs --json     # machine-readable
 */

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3100";
const AS_JSON = process.argv.includes("--json");

/** The narrowest phone we support, minus the page's own 16px gutters. */
const NARROW = 320;
const CONTENT_AT_320 = NARROW - 32;

/* ------------------------------------------------------------------ pages */

const APP_PAGES = [
  "/dashboard",
  "/attendance",
  "/attendance/record",
  "/analytics",
  "/members",
  "/members/households",
  "/groups",
  "/celebrations",
  "/training",
  "/meetings",
  "/giving",
  "/giving/projects",
  "/giving/projects/report",
  "/finance",
  "/finance/accounts",
  "/finance/categories",
  "/follow-up",
  "/media",
  "/forms",
  "/devotionals",
  "/my-events",
  "/notifications",
  "/reports",
  "/branches",
  "/help",
  "/help/meetings",
  "/help/support",
  "/settings",
  "/settings/language",
  "/settings/activity",
  "/settings/services",
  "/settings/giving",
  "/settings/finance",
  "/settings/team",
  "/settings/roles",
  "/settings/reminders",
  "/settings/celebrations",
  "/settings/first-timers",
  "/settings/sms",
  "/settings/wallet",
  "/settings/storage",
  "/settings/billing",
  "/settings/public",
  "/settings/signup",
  "/settings/verification",
  "/settings/referrals",
];

const PUBLIC_PAGES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/pricing",
  "/changelog",
  "/churches",
  "/events",
  "/blog",
  "/terms",
  "/privacy",
  "/demo",
];

const ADMIN_PAGES = [
  "/superadmin",
  "/superadmin/churches",
  "/superadmin/users",
  "/superadmin/finance",
  "/superadmin/health",
  "/superadmin/audit",
  "/superadmin/usage",
  "/superadmin/sms",
  "/superadmin/support",
  "/superadmin/roadmap",
  "/superadmin/growth",
  "/superadmin/pricing",
  "/superadmin/banners",
  "/superadmin/blog",
  "/superadmin/notifications",
  "/superadmin/denominations",
  "/superadmin/roles",
  "/superadmin/backups",
];

/* --------------------------------------------------------------- scanning */

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * Elements whose text a person never reads, so their contents cannot overflow
 * anything. Without this the whole report is Next's RSC payload — one page of
 * `self.__next_f.push(...)` drowns out every real finding.
 */
const OPAQUE = new Set(["script", "style", "noscript", "template", "svg", "head"]);

/** Class list of an element's attribute string. */
function classesOf(attrs) {
  const m = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

const scrollsX = (cls) =>
  cls.some((c) => /(^|:)overflow(-x)?-(auto|scroll)$/.test(c));
const clipsX = (cls) =>
  cls.some((c) => /(^|:)overflow(-x)?-(hidden|clip)$/.test(c));
const canWrap = (cls) =>
  cls.some((c) =>
    /(^|:)(truncate|break-words|break-all|wrap-anywhere|line-clamp-\d+)$/.test(c),
  );

/** "min-w-[46rem]" -> 736. Returns 0 when there is no fixed minimum. */
function minWidthPx(cls) {
  let worst = 0;
  for (const c of cls) {
    // Only unprefixed utilities apply at 320px; `sm:min-w-…` does not.
    if (c.includes(":")) continue;
    const rem = /^min-w-\[([\d.]+)rem\]$/.exec(c);
    if (rem) worst = Math.max(worst, parseFloat(rem[1]) * 16);
    const px = /^min-w-\[(\d+)px\]$/.exec(c);
    if (px) worst = Math.max(worst, parseInt(px[1], 10));
    const w = /^w-\[(\d+)px\]$/.exec(c);
    if (w) worst = Math.max(worst, parseInt(w[1], 10));
  }
  return worst;
}

/** grid-cols-N with no responsive variant anywhere on the element. */
function rigidGridColumns(cls) {
  const base = cls.find((c) => /^grid-cols-(\d+)$/.test(c));
  if (!base) return 0;
  const n = parseInt(/^grid-cols-(\d+)$/.exec(base)[1], 10);
  // A responsive override means the base value IS the mobile value, which is
  // fine — what matters is only how many columns land at 320px.
  return n;
}

/*
 * 22 characters, not 30.
 *
 * At 320px a page has 288px of content, and inside a two-column row or a card
 * with its own padding a value often gets half of that — roughly 18 characters
 * at the body size. An ordinary email address ("grace.okoro@example.com") is 23.
 * So 30 was set where nothing but an ID or a URL would trip it, and the things
 * that actually overflow for real churches were sailing under it.
 */
const LONG_TOKEN = /[^\s<>&]{22,}/;

/**
 * Whether a grid's column count cannot be the problem, from its first child.
 *
 * Two cases, both real and both on the same page:
 *
 *   - It is empty. The demo church has uploaded no photos, so the gallery
 *     renders as an open and closing tag with nothing between them. Nothing
 *     there can overflow.
 *   - Its cells are fixed-ratio media tiles. Three photos across is how a phone
 *     gallery is meant to look; three columns of figures is not.
 *
 * Deliberately shallow — one element, no parsing. It only has to tell a gallery
 * of photos from a row of numbers.
 */
function gridCannotOverflow(html, from) {
  const next = /<(\/?)([a-zA-Z][^\s/>]*)([^>]*)>/.exec(html.slice(from, from + 600));
  if (!next) return true;
  if (next[1] === "/") return true; // closed straight away: no children
  return classesOf(next[3]).some((c) => /^aspect-/.test(c));
}

function scan(path, html) {
  const findings = [];
  const stack = [];
  let m;
  TAG.lastIndex = 0;
  let lastIndex = 0;

  const add = (severity, kind, detail) =>
    findings.push({ path, severity, kind, detail });

  while ((m = TAG.exec(html))) {
    const [whole, closing, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();

    // Skip straight past anything whose contents are not read by a person.
    if (!closing && OPAQUE.has(tag) && !selfClose) {
      const close = html.indexOf(`</${tag}`, TAG.lastIndex);
      const end = close === -1 ? html.length : close;
      TAG.lastIndex = end;
      lastIndex = end;
      continue;
    }

    // Text between the previous tag and this one.
    const text = html.slice(lastIndex, m.index);
    lastIndex = m.index + whole.length;

    if (text.trim() && stack.length > 0) {
      const top = stack[stack.length - 1];
      const clean = text.replace(/&[a-z]+;/g, " ").trim();
      const token = LONG_TOKEN.exec(clean);
      const ignorable =
        token &&
        // A data URI or a hashed asset path is never laid out as text.
        (token[0].startsWith("data:") || token[0].startsWith("/_next/"));
      if (token && !ignorable && !stack.some((el) => canWrap(el.cls))) {
        // An unbreakable run of 30+ characters, in a chain of elements none of
        // which may wrap or truncate it. At 320px this is ~18 characters of
        // room, so it leaves the screen.
        add("HIGH", "unbreakable-text", {
          sample: token[0].slice(0, 48),
          inside: `<${top.tag}${top.cls.length ? ` class="${top.cls.slice(0, 4).join(" ")}…"` : ""}>`,
        });
      }
    }

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const cls = classesOf(attrs);
    const el = { tag, cls };

    // --- a table with nothing to scroll it ---
    if (tag === "table") {
      const scroller = stack.find((a) => scrollsX(a.cls));
      const clipper = stack.find((a) => clipsX(a.cls));
      if (!scroller) {
        add(clipper ? "HIGH" : "MEDIUM", "table-not-scrollable", {
          minWidth: minWidthPx(cls) || null,
          clippedBy: clipper
            ? `<${clipper.tag} class="${clipper.cls.filter((c) => c.startsWith("overflow")).join(" ")}">`
            : null,
        });
      }
    }

    // --- something wider than a narrow phone, with no way to reach the rest ---
    const min = minWidthPx(cls);
    if (min > CONTENT_AT_320) {
      const scroller = stack.find((a) => scrollsX(a.cls));
      if (!scroller) {
        add("HIGH", "wider-than-viewport", {
          tag,
          minWidthPx: min,
          overflowsBy: `${Math.round(min - CONTENT_AT_320)}px at 320px`,
        });
      }
    }

    // --- a grid that keeps too many columns on a phone ---
    //
    // Three columns is a defect when the cells hold words or figures, and
    // correct when they hold square thumbnails, and moot when the grid is empty.
    const cols = rigidGridColumns(cls);
    if (cols >= 3 && !gridCannotOverflow(html, lastIndex)) {
      add("MEDIUM", "grid-too-many-columns", {
        columns: cols,
        perColumnAt320: `${Math.round(CONTENT_AT_320 / cols)}px`,
      });
    }

    if (!selfClose && !VOID.has(tag)) stack.push(el);
  }

  return findings;
}

/* ------------------------------------------------------------------- main */

async function signIn() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({
      email: "demo@flockinsight.app",
      password: "demo1234",
    }),
  });
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  if (jar.length === 0) return null;
  const session = await (
    await fetch(`${BASE}/api/auth/get-session`, {
      headers: { cookie: jar.join("; ") },
    })
  ).json();
  return [...jar, `fi_act_as=${session?.session?.activeOrganizationId}`].join("; ");
}

const cookie = await signIn();
if (!cookie) {
  console.error("Could not sign in as the demo account — run pnpm db:seed first.");
  process.exit(1);
}

const all = [];
const unreachable = [];

const visit = async (path, withCookie) => {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: withCookie ? { cookie } : {},
      redirect: "manual",
    });
    if (res.status !== 200) {
      unreachable.push(`${path} -> ${res.status}`);
      return;
    }
    all.push(...scan(path, await res.text()));
  } catch (e) {
    unreachable.push(`${path} -> ${e instanceof Error ? e.message : "failed"}`);
  }
};

for (const p of PUBLIC_PAGES) await visit(p, false);
for (const p of APP_PAGES) await visit(p, true);
for (const p of ADMIN_PAGES) await visit(p, true);

if (AS_JSON) {
  console.log(JSON.stringify({ findings: all, unreachable }, null, 2));
  process.exit(0);
}

/* --------------------------------------------------------------- report */

const byPath = new Map();
for (const f of all) {
  if (!byPath.has(f.path)) byPath.set(f.path, []);
  byPath.get(f.path).push(f);
}

const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const pages = [...byPath.entries()].sort((a, b) => {
  const worst = (list) => Math.min(...list.map((f) => rank[f.severity]));
  return worst(a[1]) - worst(b[1]) || b[1].length - a[1].length;
});

const counts = all.reduce((acc, f) => {
  acc[f.kind] = (acc[f.kind] ?? 0) + 1;
  return acc;
}, {});

console.log("MOBILE LAYOUT AUDIT");
console.log(`Base: ${BASE}`);
console.log(
  `Pages checked: ${PUBLIC_PAGES.length + APP_PAGES.length + ADMIN_PAGES.length}` +
    `   With findings: ${pages.length}   Total findings: ${all.length}`,
);
console.log(`Narrowest width assumed: ${NARROW}px (${CONTENT_AT_320}px of content)\n`);

console.log("BY KIND");
for (const [kind, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${kind}`);
}

console.log("\nBY PAGE");
for (const [path, list] of pages) {
  console.log(`\n${path}`);
  const seen = new Set();
  for (const f of list) {
    const key = `${f.kind}|${JSON.stringify(f.detail)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const same = list.filter(
      (x) => `${x.kind}|${JSON.stringify(x.detail)}` === key,
    ).length;
    console.log(
      `  [ ] ${f.severity.padEnd(6)} ${f.kind}${same > 1 ? ` (x${same})` : ""}` +
        `  ${JSON.stringify(f.detail)}`,
    );
  }
}

if (unreachable.length > 0) {
  console.log(`\nNOT CHECKED (${unreachable.length})`);
  for (const u of unreachable) console.log(`  ${u}`);
}
