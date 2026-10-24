/**
 * The twice-weekly Partner progress email: when it goes, who it is for, and
 * what it says. No database in here, so every rule is tested directly.
 *
 * Three decisions shape it.
 *
 * **It is about what their churches PAY, not what they sign.** The segment is
 * decided by churches that have actually paid, the same way the tier is: a
 * Partner congratulated for ten sign-ups that never paid is being encouraged
 * to do the wrong thing.
 *
 * **It always says one thing to DO.** Every email ends on a single next step
 * that fits where they are — share the link, help a church record its first
 * Sunday, ask for an introduction, add a bank account to collect what they
 * have earned. An email that only reports numbers gets archived.
 *
 * **Twice a week must not read like the same email twice a week.** The tip
 * and the subject rotate with the send day, so Monday and Thursday differ.
 *
 * And it never names a member, a phone number or an address — only church
 * names, which the Partner already sees on their own dashboard.
 */

import { formatMoney } from "@/lib/money";

/** Lagos is UTC+1 all year — no daylight saving to account for. */
const LAGOS_OFFSET_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

/** Monday and Thursday: the start of the week, and in time for the weekend. */
export const DIGEST_DAYS = [1, 4] as const;
/** Sent from 09:00 Lagos; a tick that failed is retried until 19:00. */
export const DIGEST_FROM_HOUR = 9;
export const DIGEST_UNTIL_HOUR = 19;

/**
 * Which send day this moment belongs to, or null when it is not one.
 *
 * The slot is the Lagos DATE, so it is the same string for every tick of that
 * day and the claim row stops a second send. Outside 09:00–19:00 Lagos it is
 * null: a run that missed the morning catches up in the afternoon, never at
 * midnight, and never on Tuesday.
 */
export function digestSlotFor(now: Date): string | null {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const day = lagos.getUTCDay();
  const hour = lagos.getUTCHours();
  if (!(DIGEST_DAYS as readonly number[]).includes(day)) return null;
  if (hour < DIGEST_FROM_HOUR || hour >= DIGEST_UNTIL_HOUR) return null;
  return lagos.toISOString().slice(0, 10);
}

/**
 * A number that goes up by one every send day, for rotating the tip.
 *
 * Counted from the Lagos date, so Monday and the Thursday after it are
 * consecutive and every Partner gets the same rotation on the same day.
 */
export function digestSlotIndex(slotDate: string): number {
  const days = Math.floor(Date.parse(`${slotDate}T00:00:00Z`) / DAY_MS);
  if (!Number.isFinite(days)) return 0;
  // 1970-01-01 was a Thursday. Two send days a week: Monday and Thursday.
  const weeks = Math.floor((days + 3) / 7); // weeks since the Monday before
  const isThursday = new Date(days * DAY_MS).getUTCDay() === 4;
  return weeks * 2 + (isThursday ? 1 : 0);
}

/** The next send day after this moment, for "next email" on the admin page. */
export function nextDigestAt(now: Date): Date {
  for (let i = 0; i < 8 * 24; i++) {
    const t = new Date(
      Math.floor((now.getTime() + i * 3_600_000) / 3_600_000) * 3_600_000,
    );
    if (t.getTime() <= now.getTime()) continue;
    const lagos = new Date(t.getTime() + LAGOS_OFFSET_MS);
    if (
      (DIGEST_DAYS as readonly number[]).includes(lagos.getUTCDay()) &&
      lagos.getUTCHours() === DIGEST_FROM_HOUR
    ) {
      return t;
    }
  }
  return new Date(now.getTime() + 7 * DAY_MS);
}

export type DigestSegment = "first_steps" | "activate" | "growing" | "top";

export const DIGEST_SEGMENT_LABEL: Record<DigestSegment, string> = {
  first_steps: "No churches yet",
  activate: "Signed up, none paying",
  growing: "Paying churches, climbing",
  top: "Top tier",
};

export type DigestFacts = {
  displayName: string;
  status: "pending" | "active";
  code: string;
  shareLink: string;
  /** Every church they brought, whether or not it paid. */
  churchesSigned: number;
  /** Churches that have paid at least once. */
  churchesEverPaid: number;
  /** Signed up and never paid — named in the "activate" email. */
  notYetPaying: string[];
  /** Live and paying inside the tier window: what the tier counts. */
  liveChurches: number;
  /** Signed since the previous progress email. */
  newSinceLast: number;
  /** Earned since the previous progress email (reversals netted in). */
  earnedSinceLast: number;
  available: number;
  lifetime: number;
  daysSinceLastSignup: number | null;
  tier: { name: string; firstBps: number; secondBps: number };
  next: { name: string; needed: number; firstBps: number } | null;
  minPayout: number;
  hasBank: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  openRequest: boolean;
  /** A typical plan's monthly price, for "one church earns you…". Null if unknown. */
  examplePlan: { name: string; monthly: number } | null;
};

export function digestSegment(f: DigestFacts): DigestSegment {
  if (f.churchesSigned === 0) return "first_steps";
  if (f.churchesEverPaid === 0) return "activate";
  if (f.next === null) return "top";
  return "growing";
}

export type DigestEmail = {
  segment: DigestSegment;
  subject: string;
  heading: string;
  /** Plain sentences. The renderer escapes them. */
  paragraphs: string[];
  /** The one thing to do, set apart. */
  tip: string;
  cta: { label: string; path: string };
};

const money = (n: number) => formatMoney(n, "NGN");
const pct = (bps: number) => `${bps / 100}%`;
const churches = (n: number) => `${n} church${n === 1 ? "" : "es"}`;
const pick = <T,>(list: readonly T[], i: number): T => list[((i % list.length) + list.length) % list.length];

const TIPS: Record<DigestSegment, readonly string[]> = {
  first_steps: [
    "Start with the church you know best — your own. Ask your pastor or church administrator if they'd like to see how FlockInsight keeps attendance, members and giving in one place.",
    "Send your link to one pastor on WhatsApp today, with a line about why you thought of them. One personal message beats a hundred posts in a group.",
    "Pastors meet at fellowships, denominational meetings and ministers' conferences. Mention that the first 7 Sundays are free — it is the easiest yes in the room.",
    "Offer to set it up with them. Sitting with a church secretary for twenty minutes to record last Sunday is how most churches decide to stay.",
  ],
  activate: [
    "A church that records its first Sunday usually stays. Offer to sit with the secretary and enter last Sunday's attendance together.",
    "The first 7 Sundays are free. A friendly call around week five, before the trial ends, is when a church chooses a plan.",
    "If one of your churches is stuck, use \"Raise a ticket\" beside it on your Partner page. Support will know it came from you and answer the church directly.",
    "Show them giving records and the birthday messages — the parts people see for themselves are what make a church keep paying.",
  ],
  growing: [
    "The pastors you have signed know other pastors. Ask each of them for one introduction this week.",
    "Every paying church keeps earning you a monthly share for a year. A quick check-in with the churches you have keeps that coming.",
    "Churches that use attendance AND giving are the ones that stay. Show your churches the giving reports if they have not found them yet.",
    "Fellowships and denominations decide together. One short demo at a ministers' meeting can bring several churches at once.",
  ],
  top: [
    "Thank you. You are among the Partners bringing the most churches to FlockInsight — tell us what is working by replying to this email; we read every one.",
    "Consider running a short demo for a denomination or a fellowship of churches. You know better than anyone what convinces a pastor.",
    "Your churches' monthly share keeps paying for a year each. A thank-you call to the pastors who signed with you keeps them with you.",
  ],
};

/**
 * The words for one Partner on one send day.
 *
 * `slotIndex` rotates the tip and the subject; pass `digestSlotIndex(slot)`.
 */
export function composeDigest(f: DigestFacts, slotIndex: number): DigestEmail {
  const segment = digestSegment(f);
  const first = f.displayName.split(/\s+/)[0] || "there";
  const paragraphs: string[] = [];
  let subject: string;
  let heading: string;
  let cta = { label: "Open your Partner page", path: "/partner" };

  switch (segment) {
    case "first_steps": {
      subject = pick(
        [
          `${first}, your first church is one conversation away`,
          "An easy way to bring your first church to FlockInsight",
          `${first}, here's your link — and who to send it to`,
        ],
        slotIndex,
      );
      heading = "Your first church is one conversation away";
      paragraphs.push(
        "You haven't brought a church to FlockInsight yet — and that's fine. Most Partners' first church is one they already know.",
      );
      if (f.examplePlan) {
        const firstPay = Math.round((f.examplePlan.monthly * f.tier.firstBps) / 10_000);
        const secondPay = Math.round((f.examplePlan.monthly * f.tier.secondBps) / 10_000);
        paragraphs.push(
          `One church on ${f.examplePlan.name} (${money(f.examplePlan.monthly)} a month) earns you ${money(firstPay)} from its first payment and ${money(secondPay)} from its second, then a monthly share for a year.`,
        );
      }
      paragraphs.push(`Your link: ${f.shareLink} — or they can type your code ${f.code} when they sign up.`);
      paragraphs.push(`A message you can forward as it is: "${whatsappInvite(f.shareLink)}"`);
      cta = { label: "Copy your link", path: "/partner" };
      break;
    }
    case "activate": {
      subject = pick(
        [
          `${churches(f.churchesSigned)} signed up — let's get them going`,
          `${first}, your churches are one Sunday away from staying`,
        ],
        slotIndex,
      );
      heading = "Your churches have signed up — now help them start";
      const names = f.notYetPaying.slice(0, 3);
      const more = f.notYetPaying.length - names.length;
      paragraphs.push(
        `${churches(f.churchesSigned)} you brought ${f.churchesSigned === 1 ? "has" : "have"} signed up, but none has paid yet, so nothing has been earned so far. You earn from the moment a church pays.`,
      );
      if (names.length) {
        paragraphs.push(
          `Waiting to start: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`,
        );
      }
      break;
    }
    case "growing": {
      heading = `${churches(f.liveChurches)} live and paying`;
      subject =
        f.earnedSinceLast > 0
          ? `You earned ${money(f.earnedSinceLast)} since your last update`
          : pick(
              [
                `${first}, you're ${churches(f.next!.needed)} from ${f.next!.name}`,
                `Your Partner progress: ${churches(f.liveChurches)} paying`,
              ],
              slotIndex,
            );
      if (f.liveChurches === 0) {
        heading = "Time to check in with your churches";
        paragraphs.push(
          `None of your churches has paid in the last 90 days, so they are not counting towards your tier. A call to each pastor is often all it takes.`,
        );
      } else {
        paragraphs.push(
          `${churches(f.liveChurches)} you brought ${f.liveChurches === 1 ? "is" : "are"} live and paying. Your tier is ${f.tier.name}: you earn ${pct(f.tier.firstBps)} of each new church's first payments.`,
        );
      }
      const n = f.next!.needed;
      paragraphs.push(
        `${n} more ${n === 1 ? "church" : "churches"} and you reach ${f.next!.name} at ${pct(f.next!.firstBps)}.`,
      );
      break;
    }
    case "top": {
      subject = pick(
        [`Thank you, ${first} — you're a ${f.tier.name}`, `Your ${f.tier.name} update`],
        slotIndex,
      );
      heading = `You're a ${f.tier.name}`;
      paragraphs.push(
        `${churches(f.liveChurches)} you brought ${f.liveChurches === 1 ? "is" : "are"} live and paying — the top of the Partner ladder, at ${pct(f.tier.firstBps)} of every new church's first payments.`,
      );
      break;
    }
  }

  // What changed since last time, when something did.
  if (segment !== "first_steps" && (f.newSinceLast > 0 || f.earnedSinceLast > 0)) {
    const bits: string[] = [];
    if (f.newSinceLast > 0) bits.push(`${churches(f.newSinceLast)} signed up`);
    if (f.earnedSinceLast > 0) bits.push(`you earned ${money(f.earnedSinceLast)}`);
    paragraphs.push(`Since your last update: ${bits.join(" and ")}.`);
  }

  // Quiet for a while.
  if (f.churchesSigned > 0 && f.daysSinceLastSignup !== null && f.daysSinceLastSignup >= 30) {
    paragraphs.push(
      `It's been ${f.daysSinceLastSignup} days since your last church signed up. One introduction this week gets things moving again.`,
    );
  }

  // Money waiting.
  if (f.available >= f.minPayout && f.available > 0) {
    if (f.status === "pending") {
      paragraphs.push(
        `${money(f.available)} is waiting for you. You can withdraw it once your Partner account is approved.`,
      );
    } else if (f.openRequest) {
      paragraphs.push("Your withdrawal request is being processed.");
    } else if (!f.hasBank) {
      paragraphs.push(
        `${money(f.available)} is ready to withdraw. Add your bank account on your Partner page to collect it.`,
      );
      cta = { label: "Add your bank account", path: "/partner" };
    } else if (!f.emailVerified || !f.phoneVerified) {
      paragraphs.push(
        `${money(f.available)} is ready to withdraw. Confirm your ${
          !f.emailVerified && !f.phoneVerified ? "email and phone" : !f.emailVerified ? "email" : "phone"
        } on your Partner page to collect it.`,
      );
      cta = { label: "Confirm your details", path: "/partner" };
    } else {
      paragraphs.push(`${money(f.available)} is ready — you can withdraw it from your Partner page now.`);
      cta = { label: "Withdraw", path: "/partner" };
    }
  } else if (f.status === "pending") {
    paragraphs.push(
      "Your Partner account is still waiting for approval. Keep sharing your link — what you earn is recorded either way.",
    );
  }

  return {
    segment,
    subject: subject!,
    heading: heading!,
    paragraphs,
    tip: pick(TIPS[segment], slotIndex),
    cta,
  };
}

/** A ready-to-forward message for a Partner with no churches yet. */
export function whatsappInvite(shareLink: string): string {
  return `Pastor, have you seen FlockInsight? It keeps attendance, members, first-timers and giving in one place, and works on any phone. The first 7 Sundays are free: ${shareLink}`;
}
