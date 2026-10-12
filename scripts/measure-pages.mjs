/**
 * Every page, in a real browser, at phone widths — measured, not inferred.
 *
 * `audit-mobile.mjs` reads markup and reports structures that CAN overflow.
 * This one loads each page in headless Chrome, signed in, and reports what a
 * phone actually does with it:
 *
 *   - the page scrolls sideways (documentElement.scrollWidth > viewport), and
 *     the outermost elements responsible, with their class and text, because
 *     "overflows by 37px" with no culprit sends you reading forty components;
 *   - the document came back as an error (500, 404 where a page should be);
 *   - an uncaught exception, a console error, or a hydration mismatch — a
 *     page that renders on the server and then throws in the browser looks
 *     perfect in a screenshot and has dead buttons.
 *
 * Routes are DISCOVERED from src/app, not listed by hand, so a new module is
 * measured the day it exists. Dynamic routes (/members/[id]) are filled from
 * links harvested while crawling the static ones; a pattern nobody links to
 * is reported as not reached rather than silently skipped.
 *
 * Run against `next build` + `next start` — `next dev` does not hydrate
 * headless in this project, so every handler would look broken.
 *
 *   BETTER_AUTH_URL=http://127.0.0.1:3212 pnpm start -p 3212
 *   BASE=http://127.0.0.1:3212 node scripts/measure-pages.mjs
 *   WIDTHS=320,390 ONLY=/members,/finance node scripts/measure-pages.mjs
 *   node scripts/measure-pages.mjs --json > report.json
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

const BASE = process.env.BASE || "http://127.0.0.1:3212";
const PORT = Number(process.env.CDP_PORT || 9347);
const WIDTHS = (process.env.WIDTHS || "320,390").split(",").map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
/**
 * Concrete URLs for dynamic routes nothing links to from a signed-in page —
 * the public ones a church shares by WhatsApp: /give/<slug>, /welcome/<slug>.
 */
const EXTRA = process.env.EXTRA ? process.env.EXTRA.split(",").filter(Boolean) : [];
const AS_JSON = process.argv.includes("--json");
const EMAIL = process.env.AUDIT_EMAIL || "demo@flockinsight.app";
const PASSWORD = process.env.AUDIT_PASSWORD || "demo1234";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));
if (!CHROME) {
  console.error("No Chrome or Edge found.");
  process.exit(1);
}

/* ------------------------------------------------------------ discovery */

/**
 * Routes that are not pages a person lands on, or that change state merely by
 * being loaded. /try signs you into the demo church; /suspended and
 * /select-church are reached by redirect only.
 */
const SKIP = new Set([
  "/try",
  "/suspended",
  "/select-church",
  "/reset-password",
  "/set-password",
  "/onboarding",
  "/n/unsubscribe",
]);

function discover() {
  const root = join(process.cwd(), "src", "app");
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        // Route handlers and private folders are not pages.
        if (name === "api" || name.startsWith("_")) continue;
        walk(full);
      } else if (name === "page.tsx") {
        const route =
          "/" +
          relative(root, dir)
            .split(sep)
            .filter((seg) => !/^\(.*\)$/.test(seg))
            .join("/");
        out.push(route === "/" ? "/" : route.replace(/\/$/, ""));
      }
    }
  };
  walk(root);
  return out.sort();
}

const ALL = discover();
const STATIC = ALL.filter((r) => !r.includes("[") && !SKIP.has(r));
const DYNAMIC = ALL.filter((r) => r.includes("["));

/** /members/[id] -> /^\/members\/[^/]+$/ */
const patternFor = (route) =>
  new RegExp(
    "^" +
      route
        .split("/")
        .map((seg) =>
          seg.startsWith("[") ? "[^/?#]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/") +
      "$",
  );

/* ------------------------------------------------------------------ CDP */

let msgId = 0;
const pending = new Map();
const listeners = new Set();
let ws;

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`CDP timeout: ${method}`));
      }
    }, 45_000);
  });
}

async function waitForHttp(url, attempts = 80) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing at ${url}: ${last?.message ?? "no answer"}`);
}

/* --------------------------------------------------------------- signin */

async function signIn() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  if (jar.length === 0) {
    throw new Error(
      `sign-in as ${EMAIL} returned ${res.status} and no cookie — is the server started with BETTER_AUTH_URL=${BASE}?`,
    );
  }
  const session = await (
    await fetch(`${BASE}/api/auth/get-session`, {
      headers: { cookie: jar.join("; ") },
    })
  ).json();
  const org = session?.session?.activeOrganizationId;
  return [...jar, ...(org ? [`fi_act_as=${org}`] : [])].map((pair) => {
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i), value: pair.slice(i + 1) };
  });
}

/* ------------------------------------------------------------- measure */

/**
 * Runs in the page. The outermost elements that stick out past the viewport
 * and are not inside something that scrolls or clips them — those are the
 * ones that make the PAGE scroll sideways. Descendants of an offender are
 * dropped, so one wide table is one finding rather than ninety cells.
 */
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const overflow = document.documentElement.scrollWidth - vw;
  const offenders = [];
  if (overflow > 0) {
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') return true;
      }
      return false;
    };
    const all = [...document.body.querySelectorAll('*')];
    const hits = all.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.visibility === 'hidden') return false;
      return r.right > vw + 1 && !clipped(el);
    });
    for (const el of hits) {
      if (hits.some((o) => o !== el && o.contains(el))) continue;
      const r = el.getBoundingClientRect();
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 140),
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      });
      if (offenders.length >= 4) break;
    }
  }
  const links = [...document.querySelectorAll('a[href^="/"]')]
    .map((a) => a.getAttribute('href').split('#')[0].split('?')[0])
    .filter(Boolean);
  return {
    overflow,
    offenders,
    links: [...new Set(links)].slice(0, 400),
    title: document.title,
    path: location.pathname,
  };
})()`;

/* ------------------------------------------------------------------ main */

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), `fi-measure-${process.pid}`)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const results = [];
const notReached = [];
let fatal = null;

try {
  const cookies = await signIn();

  const v = await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method) {
      for (const l of listeners) l(m);
    }
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const S = (method, params) => send(method, params, sessionId);
  await S("Page.enable");
  await S("Runtime.enable");
  await S("Network.enable");
  await S("Log.enable");

  const host = new URL(BASE).hostname;
  for (const c of cookies) {
    await S("Network.setCookie", {
      name: c.name,
      value: c.value,
      domain: host,
      path: "/",
      httpOnly: true,
    });
  }

  // Per-navigation event capture.
  let current = null;
  listeners.add((m) => {
    if (!current || m.sessionId !== sessionId) return;
    if (m.method === "Network.responseReceived" && m.params.type === "Document") {
      current.status ??= m.params.response.status;
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      current.errors.push(
        `exception: ${(d.exception?.description || d.text || "").split("\n")[0].slice(0, 220)}`,
      );
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      const text = m.params.args
        .map((a) => a.value ?? a.description ?? "")
        .join(" ")
        .split("\n")[0]
        .slice(0, 220);
      current.errors.push(`console: ${text}`);
    } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      const e = m.params.entry;
      // A 404 on a favicon or a blocked analytics beacon is not the page.
      if (/favicon|posthog|analytics|\/_vercel/.test(e.url || "")) return;
      current.errors.push(`log: ${(e.text || "").slice(0, 160)} ${e.url ? `(${e.url.replace(BASE, "")})` : ""}`);
    }
  });

  async function evaluate(expression) {
    const r = await S("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? "threw");
    }
    return r.result.value;
  }

  async function measure(path, width) {
    await S("Emulation.setDeviceMetricsOverride", {
      width,
      height: 780,
      deviceScaleFactor: 2,
      mobile: true,
    });
    current = { path, width, status: null, errors: [] };
    await S("Page.navigate", { url: `${BASE}${path}` });
    for (let i = 0; i < 120; i++) {
      const ready = await evaluate("document.readyState").catch(() => "loading");
      if (ready === "complete") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // Hydration, and the first effects that fetch.
    await new Promise((r) => setTimeout(r, 1500));
    let m;
    try {
      m = await evaluate(MEASURE);
    } catch (e) {
      m = { overflow: 0, offenders: [], links: [], path, title: "" };
      current.errors.push(`measure failed: ${e.message}`);
    }
    const row = {
      path,
      width,
      landed: m.path,
      status: current.status,
      overflow: m.overflow,
      offenders: m.offenders,
      errors: [...new Set(current.errors)],
    };
    current = null;
    return { row, links: m.links };
  }

  const harvested = new Set();
  const targets = ONLY ?? STATIC;
  for (const path of targets) {
    for (const width of WIDTHS) {
      const { row, links } = await measure(path, width);
      results.push(row);
      links.forEach((l) => harvested.add(l));
      if (!AS_JSON) process.stderr.write(".");
    }
  }

  for (const path of EXTRA) {
    for (const width of WIDTHS) {
      const { row } = await measure(path, width);
      results.push(row);
      if (!AS_JSON) process.stderr.write(".");
    }
  }

  if (!ONLY) {
    for (const route of DYNAMIC) {
      const re = patternFor(route);
      if (EXTRA.some((x) => re.test(x))) continue;
      const hit = [...harvested].find((h) => re.test(h));
      if (!hit) {
        notReached.push(route);
        continue;
      }
      for (const width of WIDTHS) {
        const { row } = await measure(hit, width);
        row.route = route;
        results.push(row);
        if (!AS_JSON) process.stderr.write(".");
      }
    }
  }
} catch (e) {
  fatal = e;
} finally {
  try {
    ws?.close();
  } catch (e) {
    // The socket is already gone; the browser is killed next either way.
    console.error(`closing CDP: ${e.message}`);
  }
  chrome.kill();
}

if (fatal) {
  console.error(`\nmeasure-pages failed: ${fatal.message}`);
  process.exit(2);
}

/* ---------------------------------------------------------------- report */

/**
 * A redirect to /login for a signed-in page means the session was not
 * accepted, which would make every other number on the page meaningless.
 */
const bounced = results.filter(
  (r) => r.landed === "/login" && r.path !== "/login" && !r.path.startsWith("/partner"),
);
const broken = results.filter((r) => r.status && r.status >= 400);
const wide = results.filter((r) => r.overflow > 0);
const noisy = results.filter((r) => r.errors.length > 0);

if (AS_JSON) {
  console.log(JSON.stringify({ results, notReached, bounced, broken, wide, noisy }, null, 2));
} else {
  console.log(`\n\nMeasured ${results.length} page loads (${WIDTHS.join("/")}px) against ${BASE}\n`);
  if (bounced.length) {
    console.log(`SESSION REFUSED on ${bounced.length} page(s) — results below are of the sign-in page:`);
    bounced.slice(0, 5).forEach((r) => console.log(`  ${r.path}`));
  }
  console.log(`HTTP errors: ${broken.length}`);
  broken.forEach((r) => console.log(`  ${r.status}  ${r.path}${r.route ? `  (${r.route})` : ""}`));
  console.log(`\nSideways scroll: ${wide.length}`);
  for (const r of wide) {
    console.log(`  ${r.path} @${r.width}px  +${r.overflow}px`);
    r.offenders.forEach((o) =>
      console.log(`      <${o.tag}> right=${o.right} w=${o.width} "${o.text}"  .${o.cls}`),
    );
  }
  console.log(`\nBrowser errors: ${noisy.length}`);
  for (const r of noisy) {
    if (r.width !== WIDTHS[0]) continue;
    console.log(`  ${r.path}`);
    r.errors.slice(0, 4).forEach((e) => console.log(`      ${e}`));
  }
  if (notReached.length) {
    console.log(`\nDynamic routes with no link to follow (not measured): ${notReached.length}`);
    console.log(`  ${notReached.join("  ")}`);
  }
}

process.exit(broken.length + wide.length + noisy.length + bounced.length > 0 ? 1 : 0);
