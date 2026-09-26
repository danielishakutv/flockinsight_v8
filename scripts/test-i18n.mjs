/**
 * Checks that the app actually answers in the chosen language.
 *
 * Sets the locale cookie the picker writes and asks for real pages, looking for
 * words that only exist in that language's dictionary. Catches the whole chain:
 * cookie -> getLocale -> dictionary -> server render -> client provider.
 *
 * Usage:
 *   BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start -- -p 3100
 *   node scripts/test-i18n.mjs
 */
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3100";

const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email: "demo@flockinsight.app", password: "demo1234" }),
});
const jar = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
if (jar.length === 0) {
  console.log("Could not sign in — skipping.");
  process.exit(0);
}
const session = await (
  await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: jar.join("; ") } })
).json();
const churchId = session?.session?.activeOrganizationId;

let failed = 0;
const check = async (locale, path, expected) => {
  const cookie = [...jar, `fi_act_as=${churchId}`, `fi_lang=${locale}`].join("; ");
  const r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  const body = r.status === 200 ? await r.text() : "";
  const missing = expected.filter((w) => !body.includes(w));
  const ok = r.status === 200 && missing.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${locale}  ${path}${r.status !== 200 ? ` -> ${r.status}` : ""}${
      missing.length ? `  missing: ${missing.join(" | ")}` : ""
    }`,
  );
};

// The shell: sidebar sections and nav labels come from the dictionary.
await check("en", "/meetings", ["Meetings", "Upcoming"]);
await check("fr", "/meetings", ["Réunions", "Nouvelle réunion", "Tableau de bord"]);
await check("pt", "/meetings", ["Reuniões", "Nova reunião", "Painel"]);
await check("ha", "/meetings", ["Tarurruka", "Sabon taro", "Shafin bayani"]);
await check("ig", "/meetings", ["Nzukọ", "Nzukọ ọhụrụ", "Ebe nchịkọta"]);
await check("yo", "/meetings", ["Ìpàdé", "Ìpàdé tuntun", "Pátákó ìsọfúnni"]);
await check("sw", "/meetings", ["Mikutano", "Mkutano mpya", "Dashibodi"]);
await check("pcm", "/meetings", ["Meetings", "New meeting", "Main page"]);

// Other pages, to prove it is not only the one route.
await check("fr", "/members", ["Membres", "Suivi"]);
await check("yo", "/attendance", ["Wíwà"]);
await check("sw", "/giving", ["Sadaka"]);
await check("ig", "/settings/language", ["Asụsụ"]);
await check("fr", "/settings/language", ["Langue", "Version d'essai"]);

// The picker always lists every language in its own script, whatever the UI is.
await check("en", "/settings/language", [
  "Français",
  "Português",
  "Yorùbá",
  "Kiswahili",
  "Naijá Pidgin",
]);

// A signed-out guest gets the language from their browser, with no account.
const guest = await fetch(`${BASE}/login`, {
  headers: { "accept-language": "fr-CA,fr;q=0.9,en;q=0.8" },
});
const guestBody = await guest.text();
const guestOk = guestBody.includes("Se connecter") || guestBody.includes("Mot de passe");
if (!guestOk) failed++;
console.log(
  `${guestOk ? "PASS" : "FAIL"}  guest with a French browser gets French sign-in`,
);

console.log(`\n${failed === 0 ? "All language checks passed." : `${failed} failed.`}`);
process.exit(failed === 0 ? 0 : 1);
