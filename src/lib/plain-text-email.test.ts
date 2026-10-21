import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plainTextEmailLayout } from "@/lib/mailer";

/*
 * The automatic emails filled a church's plain-text template with a member's
 * first name and dropped it into emailLayout as raw HTML. The public welcome
 * form takes a first name from anybody, so a stranger could put a link in it,
 * give a victim's address, and have the first-timer cron send that link the
 * next day from the church's name.
 */
describe("plainTextEmailLayout", () => {
  const evil = `<a href="https://evil.example">Confirm your visit</a>`;

  it("prints a first name typed as a link as text, in the heading and the body", () => {
    const html = plainTextEmailLayout(
      `Thank you for visiting, ${evil}!`,
      `Dear ${evil},\n\nThank you.`,
    );
    expect(html).not.toContain("<a href");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });

  it("cannot be used to plant an image either", () => {
    const html = plainTextEmailLayout("Hi", `Dear <img src="https://evil.example/t.gif">,`);
    expect(html).not.toContain("<img");
  });

  it("keeps the template's line breaks", () => {
    expect(plainTextEmailLayout("Hi", "Dear Ada,\n\nWelcome.")).toContain(
      "Dear Ada,<br><br>Welcome.",
    );
  });
});

describe("the automatic senders", () => {
  const ROOT = join(import.meta.dirname, "..");
  const FILES = [
    "lib/first-timers.ts",
    "lib/celebrations.ts",
    "lib/service-reminders.ts",
    "lib/pledge-reminders.ts",
    "app/(app)/settings/celebrations/actions.ts",
    "app/(app)/settings/reminders/actions.ts",
  ];

  it.each(FILES)("%s never hands a filled template to emailLayout raw", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    expect(src).not.toMatch(/\bemailLayout\(/);
  });
});
