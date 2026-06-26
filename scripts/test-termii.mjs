// Quick Termii SMS test. Reads TERMII_* from the project .env.
// Usage: node scripts/test-termii.mjs <phone> [message]
import fs from "node:fs";

const env = {};
try {
  const raw = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env — fall back to process.env */
}
const pick = (k, d) => env[k] || process.env[k] || d;

const API = pick("TERMII_API_KEY");
const FROM = pick("TERMII_SENDER_ID", "TEDxYola");
const BASE = pick("TERMII_BASE_URL", "https://v3.api.termii.com").replace(/\/$/, "");
const CHANNEL = pick("TERMII_CHANNEL", "generic");

const to = process.argv[2];
const msg = process.argv[3] || "FlockInsight Termii test — it works!";

if (!API) {
  console.error("Missing TERMII_API_KEY (add it to .env).");
  process.exit(1);
}
if (!to) {
  console.error("Usage: node scripts/test-termii.mjs <phone> [message]");
  process.exit(1);
}

let d = to.replace(/\D/g, "");
if (d.startsWith("0")) d = "234" + d.slice(1);

const res = await fetch(`${BASE}/api/sms/send`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    to: d,
    from: FROM,
    sms: msg,
    type: "plain",
    channel: CHANNEL,
    api_key: API,
  }),
});
const data = await res.json().catch(() => null);
console.log("HTTP", res.status);
console.log(JSON.stringify(data, null, 2));
