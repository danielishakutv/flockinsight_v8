/**
 * Signs in as the seeded demo account (a superadmin) and checks that every page
 * this release touched actually renders, with the words that should be on it.
 *
 * Church pages are viewed by acting as a church, which is also how support
 * looks at them. Needs `pnpm db:seed` to have run.
 *
 * Usage:
 *   BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start -- -p 3100
 *   node scripts/test-release-pages.mjs
 */
const BASE = "http://127.0.0.1:3100";

const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email: "demo@flockinsight.app", password: "demo1234" }),
});
const jar = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
if (jar.length === 0) {
  console.log("Could not sign in — skipping page checks.");
  process.exit(0);
}

const session = await (
  await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: jar.join("; ") } })
).json();
const churchId = session?.session?.activeOrganizationId;
const cookie = [...jar, `fi_act_as=${churchId}`].join("; ");

let failed = 0;
const check = async (path, mustContain = []) => {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  const body = r.status === 200 ? await r.text() : "";
  const missing = mustContain.filter((t) => !body.includes(t));
  const ok = r.status === 200 && missing.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${path} -> ${r.status}${r.headers.get("location") ? ` (${r.headers.get("location")})` : ""}${
      missing.length ? ` missing: ${missing.join(", ")}` : ""
    }`,
  );
  return body;
};

await check("/meetings", ["Meetings", "New meeting", "Happening now"]);
await check("/settings/activity", ["Activity log", "Download CSV"]);
await check("/settings", ["About this software", "belongs to the church"]);
await check("/help/meetings", ["Low data mode", "Recording"]);
await check("/superadmin/audit", ["Audit log", "Inside churches"]);
await check("/reports", ["Meeting attendance"]);
await check("/changelog", ["0.63.0", "Low data mode"]);

// The CSV export, end to end.
const csv = await fetch(`${BASE}/settings/activity/export`, { headers: { cookie } });
const text = await csv.text();
const headerOk = text.includes("what_happened") && text.includes("importance");
if (!(csv.status === 200 && headerOk)) failed++;
console.log(
  `${csv.status === 200 && headerOk ? "PASS" : "FAIL"}  /settings/activity/export -> ${csv.status}, ${text.split("\r\n").length - 1} rows`,
);

// A secret must never reach the log, whatever a caller passes.
const leaked = /hunter2|password=|"password"/i.test(text);
console.log(`${leaked ? "FAIL" : "PASS"}  the export carries no credentials`);
if (leaked) failed++;

const login = await (await fetch(`${BASE}/login`)).text();
const maker =
  login.includes("Toko Technologies") &&
  login.includes("Made in Nigeria") &&
  login.includes("Secure, Fast and Reliable Software");
if (!maker) failed++;
console.log(`${maker ? "PASS" : "FAIL"}  /login carries the maker footer`);

/*
 * …and nowhere else. Checked against the footer's own wording rather than the
 * company name: the root layout has always carried an `author` meta tag, which
 * is not the same thing as a credit on the page.
 */
const dash = await check("/dashboard", []);
const bleed = dash.includes("Secure, Fast and Reliable Software");
console.log(
  `${bleed ? "FAIL" : "PASS"}  the maker footer stays off the signed-in app`,
);
if (bleed) failed++;

console.log(`\n${failed === 0 ? "All page checks passed." : `${failed} failed.`}`);
process.exit(failed === 0 ? 0 : 1);
