/**
 * Screenshots of the public pages, on a phone and on a desktop.
 *
 * Drives the Chrome already installed on the machine over the DevTools
 * Protocol. No Playwright, no Puppeteer, no 150MB browser download and nothing
 * added to package.json — Node 22 ships a global WebSocket, which is the only
 * thing CDP needs.
 *
 * Why not `chrome --screenshot`: it captures a window, not a page. It cannot
 * set a device pixel ratio, cannot tell the page it is a phone, and cannot
 * capture below the fold. All three matter here — the whole claim of the
 * product is that it works on a phone, so a screenshot taken at desktop DPR
 * with a narrow window is not evidence of anything.
 *
 * Usage:
 *   node scripts/screenshot.mjs                      # against :3212
 *   BASE=http://127.0.0.1:3000 node scripts/screenshot.mjs
 *   OUT=../shots node scripts/screenshot.mjs
 *   ONLY=landing,nigeria node scripts/screenshot.mjs
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const BASE = process.env.BASE || "http://127.0.0.1:3212";
const OUT = resolve(process.env.OUT || "screenshots");
const PORT = Number(process.env.CDP_PORT || 9333);

/** Where Chrome lives on Windows. First one that exists wins. */
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * The two shapes that matter.
 *
 * 390x844 at DPR 3 is an iPhone 14/15 — the most common phone screen a Nigerian
 * or British churchgoer will open this on, and `mobile: true` so the page is
 * told it is a touch device rather than just being narrow.
 *
 * 1440x900 at DPR 2 is a laptop, retina, which is what the screenshots are for
 * when somebody puts them in a deck.
 */
const DEVICES = [
  {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  },
  {
    name: "phone",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  },
];

/** The pages worth a picture, in the order somebody would review them. */
const PAGES = [
  ["01-landing", "/"],
  ["02-pricing", "/pricing"],
  ["03-solutions-index", "/solutions"],
  ["04-solution-attendance", "/solutions/church-attendance-app"],
  ["05-solution-sms", "/solutions/bulk-sms-for-churches"],
  ["06-solution-slow-internet", "/solutions/church-software-for-slow-internet"],
  ["07-countries-index", "/church-management-software"],
  ["08-country-nigeria", "/church-management-software/nigeria"],
  ["09-country-kenya", "/church-management-software/kenya"],
  ["10-country-uk", "/church-management-software/uk"],
  ["11-compare-index", "/compare"],
  ["12-compare-churchsuite", "/compare/churchsuite-alternative"],
  ["13-compare-free", "/compare/free-church-management-software"],
  ["14-churches-directory", "/churches"],
  ["15-landing-french", "/?lang=fr"],
  ["16-landing-portuguese", "/?lang=pt"],
];

/** The link-preview cards, captured as images rather than as pages. */
const CARDS = [
  ["card-01-default", "/opengraph-image"],
  ["card-02-country-nigeria", "/church-management-software/nigeria/opengraph-image"],
  ["card-03-solution-attendance", "/solutions/church-attendance-app/opengraph-image"],
  ["card-04-compare-churchsuite", "/compare/churchsuite-alternative/opengraph-image"],
];

/**
 * Chrome will not encode a capture taller than 16384 device pixels. At the
 * phone's DPR of 3 that is 5461 CSS px, which no real landing page fits in, so
 * the limit is expressed in CSS px and divided by the DPR at capture time.
 */
const MAX_CAPTURE_CSS_PX = Number(process.env.MAX_HEIGHT || 40000);

/**
 * Chrome's composite tile height, in device pixels. Captures are kept under it
 * because a capture that crosses a tile boundary repaints sticky elements at
 * the seam. See the long note in `shoot()`.
 */
const TILE_DEVICE_PX = 16000;

const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);

/* ------------------------------------------------------------------ CDP */

let msgId = 0;
const pending = new Map();

function send(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    // A CDP call that never answers would hang the script for ever, which in
    // CI reads as a stuck build rather than a failed screenshot.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 60_000);
  });
}

async function waitForHttp(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // Chrome is still starting. Expected, and the loop is the handling.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Nothing answering at ${url} after ${attempts} attempts`);
}

/* ----------------------------------------------------------------- main */

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error(
    "No Chrome or Edge found. Looked in:\n" +
      CHROME_CANDIDATES.map((p) => `  ${p}`).join("\n"),
  );
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const profile = join(tmpdir(), `fi-shots-${Date.now()}`);

console.log(`Browser : ${chromePath}`);
console.log(`Base    : ${BASE}`);
console.log(`Output  : ${OUT}\n`);

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    // Deterministic colour, so two runs of the same page are comparable.
    "--force-color-profile=srgb",
    "--disable-lcd-text",
    "about:blank",
  ],
  { stdio: "ignore", detached: false },
);

let ws;
let failures = 0;

try {
  const version = await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
  ws = new WebSocket(version.webSocketDebuggerUrl);

  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else ok(msg.result);
    }
  });

  const { targetId } = await send(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(ws, "Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  await send(ws, "Page.enable", {}, sessionId);
  await send(ws, "Runtime.enable", {}, sessionId);

  /*
   * Mark the launch promo as already seen, before any page script runs.
   *
   * `PromoPopup` opens after fifteen seconds or half a page of scrolling, and
   * it is `fixed inset-0` — so in a full-page capture it dims the entire
   * document and parks a modal across the middle of it. Every screenshot
   * taken for review or for a deck would have been a picture of the popup.
   *
   * It is suppressed rather than dismissed after the fact: dismissing it means
   * racing it, and a screenshot that is usually right is worse than one that
   * is always right. The real popup is unaffected — this writes sessionStorage
   * in a throwaway browser profile.
   */
  await send(
    ws,
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source:
        "try { sessionStorage.setItem('fi-promo-seen', '1'); } catch (e) { console.warn('could not suppress promo', e); }",
    },
    sessionId,
  );

  /** Navigate, wait for the network to settle, then shoot. */
  async function shoot({ path, file, device, fullPage, dark }) {
    await send(
      ws,
      "Emulation.setDeviceMetricsOverride",
      {
        width: device.width,
        height: device.height,
        deviceScaleFactor: device.deviceScaleFactor,
        mobile: device.mobile,
      },
      sessionId,
    );
    await send(
      ws,
      "Emulation.setEmulatedMedia",
      {
        features: [
          { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
          // Freeze animation so a transition cannot be caught half-way,
          // which is what makes two runs of the same page differ.
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      },
      sessionId,
    );

    await send(ws, "Page.navigate", { url: `${BASE}${path}` }, sessionId);

    /*
     * Wait for the document to be interactive and the fonts to be in, rather
     * than for a fixed timeout. A screenshot taken before `document.fonts.ready`
     * catches the fallback face and every heading is the wrong width.
     */
    const deadline = Date.now() + 20_000;
    for (;;) {
      const { result } = await send(
        ws,
        "Runtime.evaluate",
        {
          expression:
            "document.readyState === 'complete' && document.fonts.status === 'loaded'",
          returnByValue: true,
        },
        sessionId,
      );
      if (result.value === true) break;
      if (Date.now() > deadline) {
        console.warn(`  ! ${path} never settled; shooting anyway`);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    // One more frame, so any CSS that runs on load has painted.
    await new Promise((r) => setTimeout(r, 400));

    /*
     * Capture in parts, each one small enough to be a single composite tile.
     *
     * Chrome composites a screenshot in 16384-device-pixel tiles and repaints
     * every `position: sticky` and `position: fixed` element at the top of
     * each tile. On a 25,212px capture that put a byte-identical copy of the
     * header and the top of the hero two thirds of the way down the image.
     *
     * It took three wrong answers to find. It was read as a duplicated section
     * in the markup — the DOM has exactly one `<header>`. Then as a bug in the
     * script used to slice the image for review — it was not. Then an attempt
     * to override `position: sticky` with injected CSS, which also did not
     * stop it. What finally identified it was arithmetic: image row 16520 was
     * byte-identical to row 136, and 16520 - 16384 = 136.
     *
     * So the fix is not to fight the tiling, it is to stay inside one tile.
     * A page taller than a tile is captured as several numbered parts, each a
     * genuine single-pass render. That is also the more usable deliverable: a
     * 21,000-pixel-tall PNG of a phone page is not something anybody opens
     * twice.
     */
    const partCss = Math.floor(TILE_DEVICE_PX / device.deviceScaleFactor);
    let plan = [{ y: 0, height: device.height, suffix: "" }];

    if (fullPage) {
      const metrics = await send(ws, "Page.getLayoutMetrics", {}, sessionId);
      const size = metrics.cssContentSize ?? metrics.contentSize;
      const total = Math.min(Math.ceil(size.height), MAX_CAPTURE_CSS_PX);
      if (size.height > MAX_CAPTURE_CSS_PX) {
        console.warn(
          `  ! ${path} is ${Math.round(size.height)}px tall; capturing the top ${MAX_CAPTURE_CSS_PX}px`,
        );
      }

      const parts = Math.ceil(total / partCss);
      plan = Array.from({ length: parts }, (_, i) => {
        const y = i * partCss;
        return {
          y,
          height: Math.min(partCss, total - y),
          // A single-part page keeps its plain name; only a split one is
          // numbered, so the common case stays tidy.
          suffix: parts > 1 ? `-${i + 1}of${parts}` : "",
        };
      });
    }

    for (const part of plan) {
      await send(
        ws,
        "Emulation.setDeviceMetricsOverride",
        {
          width: device.width,
          height: part.height,
          deviceScaleFactor: device.deviceScaleFactor,
          mobile: device.mobile,
        },
        sessionId,
      );
      await send(
        ws,
        "Runtime.evaluate",
        { expression: `window.scrollTo(0, ${part.y})` },
        sessionId,
      );
      // Let the scroll settle and anything position-dependent repaint.
      await new Promise((r) => setTimeout(r, 300));

      const { data } = await send(
        ws,
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false, optimizeForSpeed: false },
        sessionId,
      );

      const buf = Buffer.from(data, "base64");
      const outFile = file.replace(/\.png$/, `${part.suffix}.png`);
      const target = join(OUT, outFile);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buf);
      console.log(`  ✓ ${outFile}  (${Math.round(buf.length / 1024)}KB)`);
    }
  }

  // ---- Pages, both devices, full length.
  for (const [name, path] of PAGES) {
    if (only && !only.some((o) => name.includes(o))) continue;
    console.log(`${path}`);
    for (const device of DEVICES) {
      try {
        await shoot({
          path,
          file: `${device.name}/${name}.png`,
          device,
          fullPage: true,
        });
      } catch (err) {
        failures++;
        console.error(`  ✗ ${device.name}/${name}: ${err.message}`);
      }
    }
  }

  // ---- The landing page in dark mode, because half of phones are set to it.
  if (!only || only.some((o) => "landing".includes(o) || o === "dark")) {
    console.log("/ (dark)");
    for (const device of DEVICES) {
      try {
        await shoot({
          path: "/",
          file: `${device.name}/01-landing-dark.png`,
          device,
          fullPage: true,
          dark: true,
        });
      } catch (err) {
        failures++;
        console.error(`  ✗ ${device.name}/01-landing-dark: ${err.message}`);
      }
    }
  }

  // ---- The link-preview cards, at exactly 1200x630.
  if (!only || only.some((o) => o === "cards")) {
    console.log("\nLink preview cards");
    for (const [name, path] of CARDS) {
      try {
        await shoot({
          path,
          file: `link-previews/${name}.png`,
          device: {
            name: "card",
            width: 1200,
            height: 630,
            deviceScaleFactor: 1,
            mobile: false,
          },
          fullPage: false,
        });
      } catch (err) {
        failures++;
        console.error(`  ✗ ${name}: ${err.message}`);
      }
    }
  }
} finally {
  try {
    ws?.close();
  } catch {
    // Already gone. Nothing to do, and nothing worth failing the run over.
  }
  chrome.kill();
  // The throwaway profile, not anybody's data.
  await rm(profile, { recursive: true, force: true }).catch((err) =>
    console.warn(`Could not remove temp profile ${profile}: ${err.message}`),
  );
}

console.log(
  failures === 0
    ? `\nDone. Screenshots in ${OUT}`
    : `\nDone with ${failures} failure(s). Screenshots in ${OUT}`,
);
process.exit(failures === 0 ? 0 : 1);
