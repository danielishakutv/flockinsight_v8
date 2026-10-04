/**
 * What a demonstration church is filled with.
 *
 * This was the body of scripts/seed-demo-church.ts, and it lived there alone
 * until the demo church started resetting itself every two hours. Both callers
 * now share it, because two copies of "what good demo data looks like" would
 * drift the first time somebody added a module to one of them.
 *
 * TWO PROPERTIES WORTH KEEPING.
 *
 * It is DETERMINISTIC — a fixed seed, so the same congregation appears every
 * time. A screenshot taken today and one taken next month show the same
 * people, and a reset does not silently change what a prospect was shown ten
 * minutes ago.
 *
 * Every row it writes is RECORDED IN A MANIFEST, so undoing it removes exactly
 * those rows and nothing else. The manifest lives in `platform_setting` rather
 * than as a "[demo]" marker in the data, because this data ends up in
 * marketing screenshots and a visible marker ruins every one of them.
 *
 * Relative imports, not the @/ alias: this module is loaded both by the app
 * and by `tsx scripts/seed-demo-church.ts`.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { PRESET_BY_ID, brandPreset } from "./qr/design";
import {
  attendanceSession,
  devotional,
  event,
  financeAccount,
  financeCategory,
  financeTransaction,
  followUpInteraction,
  form,
  formResponse,
  giving,
  givingCategory,
  group,
  groupMembership,
  household,
  member,
  platformSetting,
  pledge,
  project,
  qrCode,
  service,
  shortLink,
  shortLinkDestination,
  shortLinkStat,
  subscriber,
  trainingCohort,
  trainingCourse,
  trainingEnrollment,
  trainingInstructor,
} from "../db/schema";


/** Manifest key in `platform_setting`, one per seeded church. */
const manifestKey = (churchId: string) => `demo-seed:${churchId}`;

/** Tables the manifest can hold ids for, in the order --undo must delete. */
type Manifest = {
  churchId: string;
  seededAt: string;
  trainingEnrollment: string[];
  trainingInstructor: string[];
  trainingCohort: string[];
  trainingCourse: string[];
  financeTransaction: string[];
  financeAccount: string[];
  financeCategory: string[];
  giving: string[];
  pledge: string[];
  project: string[];
  givingCategory: string[];
  followUpInteraction: string[];
  attendanceSession: string[];
  formResponse: string[];
  form: string[];
  qrCode: string[];
  shortLink: string[];
  devotional: string[];
  subscriber: string[];
  event: string[];
  groupMembership: string[];
  group: string[];
  member: string[];
  household: string[];
  service: string[];
};

function emptyManifest(churchId: string): Manifest {
  return {
    churchId,
    seededAt: new Date().toISOString(),
    trainingEnrollment: [], trainingInstructor: [], trainingCohort: [],
    trainingCourse: [], financeTransaction: [], financeAccount: [],
    financeCategory: [], giving: [], pledge: [], project: [],
    givingCategory: [], followUpInteraction: [], attendanceSession: [],
    formResponse: [], form: [], qrCode: [], shortLink: [],
    devotional: [], subscriber: [], event: [],
    groupMembership: [], group: [], member: [], household: [], service: [],
  };
}

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 *
 * Seeded so two runs produce identical data — a screenshot taken today and
 * one taken next month show the same congregation.
 * ------------------------------------------------------------------ */

let seed = 20260909;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) =>
  Math.floor(rnd() * (max - min + 1)) + min;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

/* ------------------------------------------------------------------ *
 * Names — Nigerian, so screenshots look like the market
 * ------------------------------------------------------------------ */

const MALE = [
  "Emmanuel", "Chinedu", "Tunde", "Ibrahim", "Samuel", "David", "Obinna",
  "Segun", "Musa", "Daniel", "Kelechi", "Femi", "Peter", "Uche", "Bayo",
  "Joshua", "Ikenna", "Yusuf", "Michael", "Chidi", "Ayodeji", "Nnamdi",
  "Gbenga", "Solomon", "Efe", "Abiodun", "Chukwuemeka", "Olumide",
];
const FEMALE = [
  "Grace", "Chioma", "Folake", "Aisha", "Blessing", "Esther", "Ngozi",
  "Bukola", "Halima", "Deborah", "Amaka", "Yewande", "Ruth", "Adaeze",
  "Titilayo", "Joy", "Ifeoma", "Zainab", "Mercy", "Nkechi", "Omolara",
  "Chidinma", "Kemi", "Peace", "Oghenekaro", "Adenike", "Uchenna", "Temitope",
];
const SURNAMES = [
  "Adeyemi", "Okafor", "Nwosu", "Eze", "Bello", "Okoro", "Abubakar",
  "Ogunleye", "Olawale", "Chukwu", "Adeniyi", "Ibrahim", "Anyanwu", "Balogun",
  "Obi", "Danjuma", "Oyelaran", "Uzoma", "Afolabi", "Nwachukwu", "Salami",
  "Ogbonna", "Lawal", "Iheanacho", "Adebayo", "Onyeka", "Musa", "Ekwueme",
];
const STREETS = [
  "Allen Avenue", "Awolowo Road", "Ikorodu Road", "Herbert Macaulay Way",
  "Opebi Road", "Adeniran Ogunsanya", "Bode Thomas", "Ojuelegba Road",
];
const AREAS = ["Ikeja", "Surulere", "Yaba", "Gbagada", "Maryland", "Ojota"];

export async function readManifest(churchId: string): Promise<Manifest | null> {
  const [row] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, manifestKey(churchId)))
    .limit(1);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Manifest;
  } catch {
    return null;
  }
}

/**
 * Remove exactly the rows this script created, by id.
 *
 * Deletion order matters: children before parents, so a foreign key never
 * blocks us and nothing is left orphaned. Ids we no longer find were already
 * gone (deleted by hand, or cascaded) — that is not an error.
 */
export async function undoDemoSeed(churchId: string) {
  const m = await readManifest(churchId);
  /*
   * No manifest, nothing to undo. Returned rather than thrown: the caller is
   * either a CLI that wants to print a sentence, or the reset cron, for which
   * "there was nothing from last time" is the ordinary first run.
   */
  if (!m) return { ok: false as const, reason: "no-manifest" as const };

  const steps: [string, string[], (ids: string[]) => Promise<unknown>][] = [
    ["training enrolments", m.trainingEnrollment, (ids) => db.delete(trainingEnrollment).where(inArray(trainingEnrollment.id, ids))],
    ["training instructors", m.trainingInstructor, (ids) => db.delete(trainingInstructor).where(inArray(trainingInstructor.id, ids))],
    ["training classes", m.trainingCohort, (ids) => db.delete(trainingCohort).where(inArray(trainingCohort.id, ids))],
    ["training courses", m.trainingCourse, (ids) => db.delete(trainingCourse).where(inArray(trainingCourse.id, ids))],
    ["finance transactions", m.financeTransaction, (ids) => db.delete(financeTransaction).where(inArray(financeTransaction.id, ids))],
    ["finance accounts", m.financeAccount, (ids) => db.delete(financeAccount).where(inArray(financeAccount.id, ids))],
    ["finance categories", m.financeCategory, (ids) => db.delete(financeCategory).where(inArray(financeCategory.id, ids))],
    ["giving records", m.giving, (ids) => db.delete(giving).where(inArray(giving.id, ids))],
    ["pledges", m.pledge, (ids) => db.delete(pledge).where(inArray(pledge.id, ids))],
    ["projects", m.project, (ids) => db.delete(project).where(inArray(project.id, ids))],
    ["giving categories", m.givingCategory, (ids) => db.delete(givingCategory).where(inArray(givingCategory.id, ids))],
    ["follow-up interactions", m.followUpInteraction, (ids) => db.delete(followUpInteraction).where(inArray(followUpInteraction.id, ids))],
    ["attendance records", m.attendanceSession, (ids) => db.delete(attendanceSession).where(inArray(attendanceSession.id, ids))],
    /* QR codes before the links they point at: the code's own foreign key is
     * `set null`, so leaving them would not block the delete — it would leave
     * a demo code pointing at nothing, which is exactly the broken state the
     * showroom must never show. */
    ["QR codes", m.qrCode, (ids) => db.delete(qrCode).where(inArray(qrCode.id, ids))],
    /* The stats and the destination history cascade from the link itself. */
    ["short links", m.shortLink, (ids) => db.delete(shortLink).where(inArray(shortLink.id, ids))],
    ["form responses", m.formResponse, (ids) => db.delete(formResponse).where(inArray(formResponse.id, ids))],
    ["forms", m.form, (ids) => db.delete(form).where(inArray(form.id, ids))],
    ["devotionals", m.devotional, (ids) => db.delete(devotional).where(inArray(devotional.id, ids))],
    ["subscribers", m.subscriber, (ids) => db.delete(subscriber).where(inArray(subscriber.id, ids))],
    ["events", m.event, (ids) => db.delete(event).where(inArray(event.id, ids))],
    ["group memberships", m.groupMembership, (ids) => db.delete(groupMembership).where(inArray(groupMembership.id, ids))],
    ["groups", m.group, (ids) => db.delete(group).where(inArray(group.id, ids))],
    ["members", m.member, (ids) => db.delete(member).where(inArray(member.id, ids))],
    ["households", m.household, (ids) => db.delete(household).where(inArray(household.id, ids))],
    ["services", m.service, (ids) => db.delete(service).where(inArray(service.id, ids))],
  ];

  console.log("");
  for (const [label, ids, run] of steps) {
    if (ids.length === 0) continue;
    // Chunked: Postgres has a ceiling on parameters per statement.
    for (let i = 0; i < ids.length; i += 500) {
      await run(ids.slice(i, i + 500));
    }
    console.log(`    ✓ removed ${ids.length} ${label}`);
  }

  await db
    .delete(platformSetting)
    .where(eq(platformSetting.key, manifestKey(churchId)));
  return { ok: true as const };
}

const INCOME_CATEGORIES = [
  "Offering",
  "Tithe",
  "Donations",
  "Hall rental",
] as const;
const EXPENSE_CATEGORIES = [
  "Diesel & power",
  "Rent",
  "Staff welfare",
  "Transport",
  "Repairs & maintenance",
  "Guest ministers",
  "Children's church",
] as const;

/* ------------------------------------------------------------------ *
 * Seed
 * ------------------------------------------------------------------ */

export async function seedDemoData(churchId: string) {
  const man = emptyManifest(churchId);
  const out: string[] = [];
  const note = (s: string) => {
    out.push(s);
    console.log(`    ✓ ${s}`);
  };

  /* ---------- services ---------- */
  const services = await db
    .insert(service)
    .values([
      { churchId, name: "Sunday First Service", dayOfWeek: 0, startTime: "07:00", sortOrder: 1, description: null },
      { churchId, name: "Sunday Second Service", dayOfWeek: 0, startTime: "09:30", sortOrder: 2, description: null },
      { churchId, name: "Midweek Service", dayOfWeek: 3, startTime: "17:30", sortOrder: 3, description: null },
      { churchId, name: "Digging Deep", dayOfWeek: 2, startTime: "17:30", sortOrder: 4, description: null },
    ])
    .returning({ id: service.id, name: service.name });
  man.service.push(...services.map((r) => r.id));
  note(`${services.length} services`);

  /* ---------- households ---------- */
  const houseNames = [
    "The Adeyemi Family", "The Okafor Family", "The Bello Family",
    "The Nwosu Family", "The Ogunleye Family", "The Ibrahim Family",
    "The Chukwu Family", "The Balogun Family",
  ];
  const households = await db
    .insert(household)
    .values(
      houseNames.map((name) => ({
        churchId,
        name,
        note: null,
      })),
    )
    .returning({ id: household.id, name: household.name });
  man.household.push(...households.map((r) => r.id));
  note(`${households.length} households`);

  /* ---------- members ---------- */
  type NewMember = typeof member.$inferInsert;
  const rows: NewMember[] = [];

  // 168 adults across five years of joining, so the growth chart has a shape.
  for (let i = 0; i < 168; i++) {
    const female = rnd() > 0.45; // congregations skew female
    const first = female ? pick(FEMALE) : pick(MALE);
    const last = pick(SURNAMES);
    const joinedDaysAgo = int(20, 1800);
    // Most are active; a realistic tail of inactive and recent visitors.
    const roll = rnd();
    const status: NewMember["status"] =
      roll > 0.92 ? "inactive" : roll > 0.86 ? "visitor" : roll > 0.82 ? "new_convert" : "active";
    const age = int(19, 68);
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - age);
    dob.setMonth(int(0, 11), int(1, 28));

    rows.push({
      churchId,
      firstName: first,
      lastName: last,
      gender: female ? "female" : "male",
      phone: `080${int(10, 99)}${String(int(100000, 999999))}`,
      email: rnd() > 0.35 ? `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com` : null,
      dateOfBirth: iso(dob),
      status,
      joinedAt: iso(daysAgo(joinedDaysAgo)),
      house: String(int(1, 60)),
      street: pick(STREETS),
      city: pick(AREAS),
      lga: pick(AREAS),
      state: "Lagos",
      country: "Nigeria",
      baptized: rnd() > 0.45,
      weddingDate:
        age > 27 && rnd() > 0.55 ? iso(daysAgo(int(400, 6000))) : null,
      householdId: rnd() > 0.6 ? pick(households).id : null,
      inFollowUp: status === "visitor" || status === "new_convert",
      followUpStatus:
        status === "visitor" || status === "new_convert"
          ? pick(["new", "contacted", "in_progress"] as const)
          : null,
      notes: null,
    });
  }

  const adults = await db
    .insert(member)
    .values(rows)
    .returning({ id: member.id, firstName: member.firstName, lastName: member.lastName, status: member.status });
  man.member.push(...adults.map((r) => r.id));

  // 34 children, each attached to a guardian.
  const kidRows: NewMember[] = [];
  for (let i = 0; i < 34; i++) {
    const female = rnd() > 0.5;
    const guardian = pick(adults);
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - int(2, 15));
    dob.setMonth(int(0, 11), int(1, 28));
    kidRows.push({
      churchId,
      firstName: female ? pick(FEMALE) : pick(MALE),
      lastName: guardian.lastName,
      gender: female ? "female" : "male",
      dateOfBirth: iso(dob),
      status: "active",
      isMinor: true,
      guardianId: guardian.id,
      relationship: female ? "daughter" : "son",
      joinedAt: iso(daysAgo(int(30, 900))),
      notes: null,
    });
  }
  const kids = await db.insert(member).values(kidRows).returning({ id: member.id });
  man.member.push(...kids.map((r) => r.id));
  note(`${adults.length} adults + ${kids.length} children`);

  const activeAdults = adults.filter((a) => a.status === "active");

  /* ---------- groups ---------- */
  const groupDefs = [
    { name: "Choir", type: "ministry" as const, day: 5, time: "17:00" },
    { name: "Ushering", type: "ministry" as const, day: 0, time: "06:30" },
    { name: "Media & Technical", type: "ministry" as const, day: 6, time: "10:00" },
    { name: "Children's Church", type: "ministry" as const, day: 0, time: "09:00" },
    { name: "Prayer Band", type: "ministry" as const, day: 4, time: "18:00" },
    { name: "Ikeja Cell", type: "cell" as const, day: 4, time: "18:00" },
    { name: "Surulere Cell", type: "cell" as const, day: 4, time: "18:00" },
    { name: "Yaba Cell", type: "cell" as const, day: 4, time: "18:00" },
    { name: "Welfare Committee", type: "committee" as const, day: null, time: null },
    { name: "Youth Fellowship", type: "group" as const, day: 6, time: "16:00" },
  ];
  const groups = await db
    .insert(group)
    .values(
      groupDefs.map((g) => ({
        churchId,
        name: g.name,
        type: g.type,
        meetingDay: g.day,
        meetingTime: g.time,
        description: `${g.name} — meets weekly.`,
      })),
    )
    .returning({ id: group.id, name: group.name });
  man.group.push(...groups.map((r) => r.id));

  const memberships: (typeof groupMembership.$inferInsert)[] = [];
  for (const g of groups) {
    const size = int(9, 26);
    const chosen = new Set<string>();
    while (chosen.size < size && chosen.size < activeAdults.length) {
      chosen.add(pick(activeAdults).id);
    }
    let first = true;
    for (const memberId of chosen) {
      memberships.push({
        groupId: g.id,
        memberId,
        isLeader: first,
        role: first ? (g.name.includes("Cell") ? "Cell Leader" : "Head") : null,
        joinedAt: iso(daysAgo(int(30, 900))),
      });
      first = false;
    }
  }
  const gmRows = await db
    .insert(groupMembership)
    .values(memberships)
    .onConflictDoNothing()
    .returning({ id: groupMembership.id });
  man.groupMembership.push(...gmRows.map((r) => r.id));
  note(`${groups.length} groups with ${memberships.length} memberships`);

  /* ---------- attendance: 18 months, seasonal, growing ---------- */
  const sessions: (typeof attendanceSession.$inferInsert)[] = [];
  const first = services.find((s) => s.name === "Sunday First Service")!;
  const second = services.find((s) => s.name === "Sunday Second Service")!;
  const mid = services.find((s) => s.name === "Midweek Service")!;

  for (let w = 78; w >= 0; w--) {
    const d = daysAgo(w * 7);
    // Land it on the Sunday of that week.
    d.setDate(d.getDate() - d.getDay());
    const date = iso(d);
    const month = d.getMonth();
    // Steady growth, a December lift and a January dip, plus weekly noise.
    // The last ten weeks lift a little harder and the noise tightens, so the
    // "last 8 weeks" figure on the dashboard reads as growth rather than as
    // whichever way the random walk happened to fall — this is a demo church
    // whose whole job is to look like a healthy one in a screenshot.
    const growth = 1 + (78 - w) * 0.004 + (w < 10 ? (10 - w) * 0.006 : 0);
    const season = month === 11 ? 1.18 : month === 0 ? 0.9 : month === 7 ? 0.94 : 1;
    const spread = w < 10 ? 0.05 : 0.16;
    const noise = 1 - spread / 2 + rnd() * spread;
    const scale = growth * season * noise;

    for (const [svc, base] of [
      [first, 96],
      [second, 132],
    ] as const) {
      const adultsN = Math.round(base * scale);
      const male = Math.round(adultsN * (0.42 + rnd() * 0.06));
      const female = adultsN - male;
      const teens = Math.round(adultsN * (0.14 + rnd() * 0.05));
      const children = Math.round(adultsN * (0.2 + rnd() * 0.07));
      const firstTimers = int(0, 7);
      const converts = rnd() > 0.7 ? int(1, 4) : 0;
      sessions.push({
        churchId,
        serviceId: svc.id,
        date,
        totalCount: adultsN + teens + children,
        maleCount: male,
        femaleCount: female,
        teenMaleCount: Math.round(teens * 0.48),
        teenFemaleCount: teens - Math.round(teens * 0.48),
        childrenCount: children,
        childMaleCount: Math.round(children * 0.5),
        childFemaleCount: children - Math.round(children * 0.5),
        firstTimerCount: firstTimers,
        newConvertCount: converts,
        notes:
          month === 11 && rnd() > 0.6
            ? "Carol service — visitors from the community"
            : null,
      });
    }

    // Midweek, on the Wednesday, at roughly a third of Sunday.
    const wed = new Date(d);
    wed.setDate(wed.getDate() + 3);
    const midN = Math.round(74 * scale);
    sessions.push({
      churchId,
      serviceId: mid.id,
      date: iso(wed),
      totalCount: midN,
      maleCount: Math.round(midN * 0.44),
      femaleCount: midN - Math.round(midN * 0.44),
      childrenCount: int(4, 16),
      notes: null,
    });
  }
  const attRows = await db
    .insert(attendanceSession)
    .values(sessions)
    .onConflictDoNothing()
    .returning({ id: attendanceSession.id });
  man.attendanceSession.push(...attRows.map((r) => r.id));
  note(`${sessions.length} attendance records over 18 months`);

  /* ---------- giving ---------- */
  const cats = await db
    .insert(givingCategory)
    .values(
      [
        ["Tithe", 1],
        ["Offering", 2],
        ["Building Project", 3],
        ["Welfare", 4],
        ["Thanksgiving", 5],
        ["Missions", 6],
      ].map(([name, order]) => ({
        churchId,
        name: name as string,
        sortOrder: order as number,
        description: null,
      })),
    )
    .returning({ id: givingCategory.id, name: givingCategory.name });
  man.givingCategory.push(...cats.map((r) => r.id));

  const catBy = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  const gifts: (typeof giving.$inferInsert)[] = [];
  for (let w = 78; w >= 0; w--) {
    const d = daysAgo(w * 7);
    d.setDate(d.getDate() - d.getDay());
    const date = iso(d);
    const scale = 1 + (78 - w) * 0.005;

    // The Sunday lump sums, recorded the way a church actually records them.
    gifts.push({
      churchId, categoryId: catBy.Offering, amount: Math.round(int(210000, 340000) * scale),
      date, method: "cash", note: "Sunday offering",
    });
    gifts.push({
      churchId, categoryId: catBy.Tithe, amount: Math.round(int(420000, 690000) * scale),
      date, method: "transfer", note: "Sunday tithe",
    });
    if (rnd() > 0.35) {
      gifts.push({
        churchId, categoryId: catBy["Building Project"],
        amount: Math.round(int(80000, 260000) * scale), date,
        method: "transfer", note: "Building fund",
      });
    }
    if (rnd() > 0.6) {
      gifts.push({
        churchId, categoryId: catBy.Welfare, amount: int(20000, 70000),
        date, method: "cash", note: "Welfare",
      });
    }
    // Midweek online transfers. Churches genuinely receive these, and they
    // stop the "this month" card reading near-zero in the first days of a
    // month, when it is being compared against a complete previous one.
    for (let d2 = 1; d2 <= 4; d2++) {
      if (rnd() > 0.55) continue;
      const mid = new Date(d);
      mid.setDate(mid.getDate() + d2);
      if (mid > new Date()) break;
      gifts.push({
        churchId,
        categoryId: pick([catBy.Tithe, catBy.Offering, catBy["Building Project"]]),
        amount: int(15000, 120000),
        date: iso(mid),
        method: "online",
        note: "Online transfer",
      });
    }

    // A few named gifts each week, so member giving history is not empty.
    for (let i = 0; i < int(2, 5); i++) {
      const m = pick(activeAdults);
      gifts.push({
        churchId,
        categoryId: pick([catBy.Tithe, catBy.Thanksgiving, catBy.Missions]),
        memberId: m.id,
        amount: int(5000, 90000),
        date,
        method: pick(["cash", "transfer", "online"] as const),
        note: null,
      });
    }
  }
  /*
   * Make the current month read as growth.
   *
   * "Giving this month" compares month-to-date against the same span of last
   * month. Early in a month that span may hold one Sunday against last
   * month's two, so a perfectly healthy church shows a fall — which on a
   * marketing screenshot is the first thing the eye lands on. This is a
   * fictional church whose job is to look like a thriving one, so it tops the
   * current month up with the daily online transfers a real church receives
   * until it is comfortably ahead. Nothing here changes how the app computes
   * the figure; it changes what this one demo church gave.
   */
  {
    // Midday, not midnight. `iso()` formats through UTC, so a date built at
    // local midnight in a positive-offset timezone reports as the day before —
    // which silently shifted every boundary here by one day.
    const now = new Date();
    const at = (y: number, m: number, d: number) => new Date(y, m, d, 12);
    const monthStart = at(now.getFullYear(), now.getMonth(), 1);
    const prevStart = at(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = at(
      now.getFullYear(),
      now.getMonth() - 1,
      Math.min(
        now.getDate(),
        new Date(now.getFullYear(), now.getMonth(), 0).getDate(),
      ),
    );
    const today = at(now.getFullYear(), now.getMonth(), now.getDate());

    const within = (d: string, from: Date, to: Date) =>
      d >= iso(from) && d <= iso(to);

    const sumOf = (from: Date, to: Date) =>
      gifts
        .filter((g) => within(String(g.date), from, to))
        .reduce((n, g) => n + Number(g.amount), 0);

    const target = sumOf(prevStart, prevEnd) * 1.18; // ~18% ahead
    let current = sumOf(monthStart, today);
    const elapsedDays = now.getDate();

    // Spread the top-up over the days that have already happened, so it looks
    // like giving rather than one implausible lump on the 1st.
    let guard = 0;
    while (current < target && guard++ < 400) {
      const day = at(now.getFullYear(), now.getMonth(), int(1, elapsedDays));
      const amount = int(20000, 150000);
      gifts.push({
        churchId,
        categoryId: pick([catBy.Tithe, catBy.Offering, catBy["Building Project"]]),
        amount,
        date: iso(day),
        method: "online",
        note: "Online transfer",
      });
      current += amount;
    }
  }

  const giftRows = await db
    .insert(giving)
    .values(gifts)
    .returning({ id: giving.id });
  man.giving.push(...giftRows.map((r) => r.id));
  note(`${cats.length} giving categories, ${gifts.length} giving records`);

  /* ---------- project + pledges ---------- */
  const [proj] = await db
    .insert(project)
    .values({
      churchId,
      name: "New Auditorium Roof",
      description: "Replacing the main auditorium roof before the rains.",
      targetAmount: 25_000_000,
      status: "active",
      startDate: iso(daysAgo(300)),
      endDate: iso(daysAgo(-120)),
    })
    .returning({ id: project.id });
  man.project.push(proj.id);

  const pledgeRows: (typeof pledge.$inferInsert)[] = [];
  const pledgers = activeAdults.slice(0, 96);
  for (const p of pledgers) {
    const amount = pick([50_000, 100_000, 150_000, 250_000, 500_000, 1_000_000]);
    pledgeRows.push({
      churchId,
      projectId: proj.id,
      memberId: p.id,
      amount,
      cadence: pick(["one_time", "monthly", "quarterly"] as const),
      startDate: iso(daysAgo(int(60, 290))),
      status: "active",
      note: null,
    });
  }
  const pledgeIds = await db
    .insert(pledge)
    .values(pledgeRows)
    .returning({ id: pledge.id });
  man.pledge.push(...pledgeIds.map((r) => r.id));
  note(`1 project with ${pledgeRows.length} pledges`);

  /* ---------- finance ---------- */
  const accounts = await db
    .insert(financeAccount)
    .values([
      { churchId, name: "Main Current Account", type: "bank", institution: "GTBank", openingBalance: 1_850_000, note: null },
      { churchId, name: "Offering Box (Cash)", type: "cash", openingBalance: 120_000, note: null },
      { churchId, name: "Building Fund Account", type: "bank", institution: "Zenith Bank", openingBalance: 0, note: null },
    ])
    .returning({ id: financeAccount.id, name: financeAccount.name });
  man.financeAccount.push(...accounts.map((r) => r.id));

  const incomeCats = await db
    .insert(financeCategory)
    .values(INCOME_CATEGORIES.map((name) => ({ churchId, name, kind: "income" as const })))
    .returning({ id: financeCategory.id, name: financeCategory.name });
  man.financeCategory.push(...incomeCats.map((r) => r.id));
  const expenseCats = await db
    .insert(financeCategory)
    .values(EXPENSE_CATEGORIES.map((name) => ({ churchId, name, kind: "expense" as const })))
    .returning({ id: financeCategory.id, name: financeCategory.name });
  man.financeCategory.push(...expenseCats.map((r) => r.id));

  const main = accounts[0];
  const txns: (typeof financeTransaction.$inferInsert)[] = [];
  for (let m = 17; m >= 0; m--) {
    const d = daysAgo(m * 30);
    for (const c of expenseCats) {
      const amount =
        c.name === "Rent" ? 450_000
        : c.name === "Diesel & power" ? int(180_000, 320_000)
        : c.name === "Staff welfare" ? int(600_000, 850_000)
        : int(25_000, 180_000);
      if (c.name === "Rent" && d.getMonth() % 3 !== 0) continue;
      txns.push({
        churchId, kind: "expense", amount, date: iso(d),
        accountId: main.id, categoryId: c.id,
        party: c.name === "Rent" ? "Landlord" : null,
        method: "transfer",
        note: null,
      });
    }
    const hall = incomeCats.find((c) => c.name === "Hall rental");
    if (hall && rnd() > 0.5) {
      txns.push({
        churchId, kind: "income", amount: int(80_000, 250_000), date: iso(d),
        accountId: main.id, categoryId: hall.id, party: "Wedding hire",
        method: "transfer", note: "Hall rental",
      });
    }
  }
  const txnRows = await db
    .insert(financeTransaction)
    .values(txns)
    .returning({ id: financeTransaction.id });
  man.financeTransaction.push(...txnRows.map((r) => r.id));
  note(`${accounts.length} accounts, ${incomeCats.length + expenseCats.length} categories, ${txns.length} transactions`);

  /* ---------- training ---------- */
  const courses = await db
    .insert(trainingCourse)
    .values([
      { churchId, name: "Foundation Class", kind: "class", level: 1, badgeLabel: "FND", badgeColor: "emerald", badgeIcon: "check", description: "New members' foundation course." },
      { churchId, name: "Baptism Class", kind: "class", level: 1, badgeLabel: "BAP", badgeColor: "sky", badgeIcon: "droplet", description: "Preparation for water baptism." },
      { churchId, name: "Pre-Marital Counselling", kind: "class", level: 2, badgeLabel: "PMC", badgeColor: "rose", badgeIcon: "heart", description: "For intending couples." },
      { churchId, name: "Workers in Training", kind: "training", level: 2, badgeLabel: "WIT", badgeColor: "amber", badgeIcon: "star", passMark: 50, issuesCertificate: true, description: "For all intending workers." },
      { churchId, name: "Leadership School", kind: "training", level: 3, badgeLabel: "LEAD", badgeColor: "violet", badgeIcon: "crown", passMark: 60, issuesCertificate: true, description: "For heads of department and cell leaders." },
    ])
    .returning({ id: trainingCourse.id, name: trainingCourse.name, passMark: trainingCourse.passMark });
  man.trainingCourse.push(...courses.map((r) => r.id));

  let enrolCount = 0;
  let cohortCount = 0;
  for (const c of courses) {
    // Two finished intakes and one running, so the page shows both states.
    const runs = [
      { label: "2025 Intake", status: "completed" as const, start: 500, end: 420 },
      { label: "Jan 2026", status: "completed" as const, start: 240, end: 170 },
      { label: "Current Intake", status: "running" as const, start: 40, end: -30 },
    ];
    for (const r of runs) {
      const [co] = await db
        .insert(trainingCohort)
        .values({
          churchId,
          courseId: c.id,
          name: `${c.name} — ${r.label}`,
          status: r.status,
          startDate: iso(daysAgo(r.start)),
          endDate: iso(daysAgo(r.end)),
          venue: "Main auditorium",
          meetingDay: 0,
          meetingTime: "11:30",
          notes: null,
        })
        .returning({ id: trainingCohort.id });
      man.trainingCohort.push(co.id);
      cohortCount++;

      const instructor = pick(activeAdults);
      await db
        .insert(trainingInstructor)
        .values({ cohortId: co.id, memberId: instructor.id, role: "Instructor" })
        .onConflictDoNothing()
        .returning({ id: trainingInstructor.id })
        .then((r) => man.trainingInstructor.push(...r.map((x) => x.id)));

      const size = int(12, 28);
      const chosen = new Set<string>();
      while (chosen.size < size) chosen.add(pick(activeAdults).id);

      const enrolments: (typeof trainingEnrollment.$inferInsert)[] = [];
      for (const memberId of chosen) {
        const finished = r.status === "completed";
        const score = c.passMark != null ? int(38, 96) : null;
        const passed = score == null || c.passMark == null || score >= c.passMark;
        enrolments.push({
          churchId,
          cohortId: co.id,
          courseId: c.id,
          memberId,
          status: finished
            ? passed
              ? rnd() > 0.08 ? "completed" : "withdrawn"
              : "failed"
            : rnd() > 0.3 ? "in_progress" : "enrolled",
          enrolledAt: iso(daysAgo(r.start)),
          completedAt: finished && passed ? iso(daysAgo(r.end)) : null,
          score: finished ? score : null,
          grade: finished && passed ? (score! >= 80 ? "Distinction" : score! >= 65 ? "Merit" : "Pass") : null,
        });
      }
      const enrRows = await db
        .insert(trainingEnrollment)
        .values(enrolments)
        .onConflictDoNothing()
        .returning({ id: trainingEnrollment.id });
      man.trainingEnrollment.push(...enrRows.map((r) => r.id));
      enrolCount += enrolments.length;
    }
  }
  note(`${courses.length} courses, ${cohortCount} classes, ${enrolCount} enrolments`);

  /* ---------- follow-up interactions ---------- */
  const visitors = adults.filter((a) => a.status === "visitor" || a.status === "new_convert");
  const inters: (typeof followUpInteraction.$inferInsert)[] = [];
  for (const v of visitors) {
    for (let i = 0; i < int(1, 3); i++) {
      inters.push({
        churchId,
        memberId: v.id,
        type: pick(["call", "whatsapp", "visit", "sms"] as const),
        outcome: pick(["reached", "no_response", "scheduled"] as const),
        notes: "Followed up after service.",
        occurredAt: iso(daysAgo(int(1, 60))),
      });
    }
  }
  if (inters.length) {
    const iRows = await db
      .insert(followUpInteraction)
      .values(inters)
      .returning({ id: followUpInteraction.id });
    man.followUpInteraction.push(...iRows.map((r) => r.id));
  }
  note(`${visitors.length} people in follow-up, ${inters.length} logged contacts`);

  /* ---------- events ---------- */
  const events = await db
    .insert(event)
    .values([
      { churchId, title: "Annual Thanksgiving Service", date: iso(daysAgo(-14)), startTime: "09:00", venue: "Main Auditorium", address: `${pick(STREETS)}, Ikeja, Lagos`, isPublic: true, description: "Our yearly thanksgiving — come with your family." },
      { churchId, title: "Youth Convention 2026", date: iso(daysAgo(-38)), startTime: "16:00", venue: "Main Auditorium", isPublic: true, description: "Three days for young people, 15–30." },
      { churchId, title: "Workers' Retreat", date: iso(daysAgo(-60)), startTime: "08:00", venue: "Camp Ground, Mowe", isPublic: false, description: "Compulsory for all workers." },
      { churchId, title: "Christmas Carol Night", date: iso(daysAgo(-95)), startTime: "18:00", venue: "Church Grounds", isPublic: true, description: "Carols, drama and refreshments." },
      { churchId, title: "Marriage Seminar", date: iso(daysAgo(30)), startTime: "10:00", venue: "Fellowship Hall", isPublic: true, description: "For couples and intending couples." },
    ])
    .returning({ id: event.id });
  man.event.push(...events.map((r) => r.id));
  note(`${events.length} events`);

  /* ---------- forms + responses ---------- */
  const [firstTimerForm] = await db
    .insert(form)
    .values({
      churchId,
      title: "First Timer Card",
      description: "Welcome! Please tell us about yourself.",
      slug: `first-timer-${churchId.slice(0, 6)}`,
      status: "open",
      createMembers: true,
      addToFollowUp: true,
      notifyInApp: true,
      fields: [
        { id: "f1", type: "short_text", label: "Full name", required: true, map: "fullName" },
        { id: "f2", type: "phone", label: "Phone number", required: true, map: "phone" },
        { id: "f3", type: "email", label: "Email address", required: false, map: "email" },
        { id: "f4", type: "short_text", label: "What area do you live in?", required: false },
        {
          id: "f5",
          type: "select",
          label: "How did you hear about us?",
          required: false,
          options: ["A friend", "Social media", "Walked past", "Flyer", "Other"],
        },
        { id: "f6", type: "long_text", label: "Any prayer request?", required: false },
      ],
    })
    .returning({ id: form.id });
  man.form.push(firstTimerForm.id);

  const responses: (typeof formResponse.$inferInsert)[] = [];
  for (let i = 0; i < 34; i++) {
    const female = rnd() > 0.5;
    const name = `${female ? pick(FEMALE) : pick(MALE)} ${pick(SURNAMES)}`;
    responses.push({
      formId: firstTimerForm.id,
      churchId,
      data: {
        f1: name,
        f2: `080${int(10, 99)}${String(int(100000, 999999))}`,
        f3: `${name.split(" ")[0].toLowerCase()}${i}@example.com`,
        f4: pick(AREAS),
        f5: pick(["A friend", "Social media", "Walked past", "Flyer", "Other"]),
        f6: pick(["", "", "Please pray for my job search.", "Pray for my family.", "Thank God for a safe delivery."]),
      },
    });
  }
  const respRows = await db
    .insert(formResponse)
    .values(responses)
    .returning({ id: formResponse.id });
  man.formResponse.push(...respRows.map((r) => r.id));
  await db
    .update(form)
    .set({ responseCount: responses.length })
    .where(eq(form.id, firstTimerForm.id));
  note(`1 form with ${responses.length} responses`);

  /* ---------- devotionals + subscribers ---------- */
  const devos = await db
    .insert(devotional)
    .values([
      { churchId, type: "devotional", title: "Walking in the Light", body: `If we walk in the light, as he is in the light, we have fellowship one with another.\n\nToday, choose honesty in the small things.`, audience: "members", status: "sent", sentAt: daysAgo(2), recipients: 168, sentCount: 168 },
      { churchId, type: "devotional", title: "The Discipline of Waiting", body: `They that wait upon the Lord shall renew their strength.\n\nWaiting is not wasted time.`, audience: "both", status: "sent", sentAt: daysAgo(9), recipients: 194, sentCount: 194 },
      { churchId, type: "newsletter", title: "This Month at Church", body: `Thanksgiving service, the youth convention, and how the roof fund is doing.`, audience: "both", status: "sent", sentAt: daysAgo(16), recipients: 194, sentCount: 194 },
      { churchId, type: "devotional", title: "A Cheerful Giver", body: `God loves a cheerful giver.`, audience: "members", status: "scheduled", scheduledAt: daysAgo(-3) },
    ])
    .returning({ id: devotional.id });
  man.devotional.push(...devos.map((r) => r.id));

  const subs: (typeof subscriber.$inferInsert)[] = [];
  for (let i = 0; i < 46; i++) {
    const female = rnd() > 0.5;
    const n = `${female ? pick(FEMALE) : pick(MALE)} ${pick(SURNAMES)}`;
    subs.push({
      churchId,
      name: n,
      email: `${n.split(" ")[0].toLowerCase()}.sub${i}@example.com`,
      source: "public page",
    });
  }
  const subRows = await db
    .insert(subscriber)
    .values(subs)
    .onConflictDoNothing()
    .returning({ id: subscriber.id });
  man.subscriber.push(...subRows.map((r) => r.id));
  note(`${devos.length} devotionals, ${subs.length} subscribers`);

  /* ---------- short links + QR codes ---------- */
  /*
   * A showroom needs this one to look USED rather than merely present: the
   * point of a short link is the follow count beside it and the history of
   * where it has pointed, and an empty table of three links demonstrates
   * nothing. So each link gets a plausible run of daily figures, a split
   * between scans and typed follows, and the giving link gets a second
   * destination so the history has something in it.
   *
   * The codes are unique platform-wide, so each is prefixed to the demo church
   * — two demo churches, or a demo beside a real one that happened to want
   * "give", must not collide.
   */
  const codePrefix = `d${churchId.slice(0, 4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const linkSpecs = [
    {
      code: `${codePrefix}-give`,
      title: "Giving page",
      destination: "https://example.church/give",
      note: "On the screen at the front during the offering.",
      follows: 412,
      scanShare: 0.78,
      previous: "https://example.church/offering-old",
    },
    {
      code: `${codePrefix}-newhere`,
      title: "New here? Tell us about yourself",
      destination: "https://example.church/first-timer",
      note: "Back of the welcome card.",
      follows: 96,
      scanShare: 0.62,
      previous: null,
    },
    {
      code: `${codePrefix}-carols`,
      title: "Carol service registration",
      destination: "https://example.church/carols",
      note: "The 400 flyers we printed in November.",
      follows: 238,
      scanShare: 0.91,
      previous: null,
    },
  ] as const;

  const linkRows = await db
    .insert(shortLink)
    .values(
      linkSpecs.map((l) => ({
        churchId,
        code: l.code,
        title: l.title,
        destination: l.destination,
        note: l.note,
        clickCount: l.follows,
        lastClickAt: daysAgo(int(0, 2)),
        createdAt: daysAgo(int(40, 90)),
      })),
    )
    .returning({ id: shortLink.id, code: shortLink.code });
  man.shortLink.push(...linkRows.map((r) => r.id));

  const historyRows: (typeof shortLinkDestination.$inferInsert)[] = [];
  const statRows: (typeof shortLinkStat.$inferInsert)[] = [];

  for (let i = 0; i < linkRows.length; i++) {
    const spec = linkSpecs[i];
    const row = linkRows[i];

    // Oldest first in the array; the page orders by date, so this reads as a
    // history either way.
    if (spec.previous) {
      historyRows.push({
        linkId: row.id,
        churchId,
        destination: spec.previous,
        createdAt: daysAgo(70),
      });
    }
    historyRows.push({
      linkId: row.id,
      churchId,
      destination: spec.destination,
      createdAt: daysAgo(spec.previous ? 21 : 70),
    });

    /*
     * Sundays carry most of the follows, because that is what the chart is
     * for: a church looking at this should recognise its own week in it.
     */
    let left = spec.follows;
    const days: { day: string; clicks: number }[] = [];
    for (let d = 29; d >= 0 && left > 0; d--) {
      const date = daysAgo(d);
      const sunday = date.getDay() === 0;
      const want = sunday ? int(8, 30) : int(0, 4);
      const clicks = Math.min(left, want);
      left -= clicks;
      if (clicks > 0) days.push({ day: iso(date), clicks });
    }
    // Anything left over predates the window and is only in the total, which
    // is honest: the chart says "the last 30 days" and means it.
    for (const d of days) {
      statRows.push({ linkId: row.id, churchId, bucket: "day", key: d.day, clicks: d.clicks });
    }

    const scans = Math.round(spec.follows * spec.scanShare);
    statRows.push({ linkId: row.id, churchId, bucket: "source", key: "qr", clicks: scans });
    statRows.push({
      linkId: row.id,
      churchId,
      bucket: "source",
      key: "direct",
      clicks: spec.follows - scans,
    });
    statRows.push({
      linkId: row.id,
      churchId,
      bucket: "device",
      key: "phone",
      clicks: Math.round(spec.follows * 0.86),
    });
    statRows.push({
      linkId: row.id,
      churchId,
      bucket: "device",
      key: "computer",
      clicks: spec.follows - Math.round(spec.follows * 0.86),
    });
  }

  await db.insert(shortLinkDestination).values(historyRows);
  await db.insert(shortLinkStat).values(statRows);

  /*
   * Three saved designs, each from a different preset, so the list shows what
   * the designer can do rather than three identical black squares. Every one
   * of these presets is asserted scannable in design.test.ts.
   */
  const giveLink = linkRows[0];
  const carolsLink = linkRows[2];
  const codeRows = await db
    .insert(qrCode)
    .values([
      {
        churchId,
        title: "Give — screen at the front",
        kind: "link" as const,
        payload: { kind: "link" as const, url: `https://flockinsight.com/l/${giveLink.code}?s=qr` },
        design: brandPreset(PRESET_BY_ID.offeringboard, "#5b3df5"),
        shortLinkId: giveLink.id,
        downloadCount: 4,
      },
      {
        churchId,
        title: "Carol service flyer",
        kind: "link" as const,
        payload: { kind: "link" as const, url: `https://flockinsight.com/l/${carolsLink.code}?s=qr` },
        design: brandPreset(PRESET_BY_ID.bulletin, "#5b3df5"),
        shortLinkId: carolsLink.id,
        downloadCount: 2,
      },
      {
        churchId,
        title: "Guest WiFi — welcome desk",
        kind: "wifi" as const,
        payload: {
          kind: "wifi" as const,
          ssid: "Grace House Guest",
          password: "Welcome2026",
          security: "WPA" as const,
          hidden: false,
        },
        design: brandPreset(PRESET_BY_ID.welcomedesk, "#5b3df5"),
        shortLinkId: null,
        downloadCount: 1,
      },
    ])
    .returning({ id: qrCode.id });
  man.qrCode.push(...codeRows.map((r) => r.id));
  note(
    `${linkRows.length} short links with ${statRows.length} days of figures, ${codeRows.length} QR codes`,
  );

  // Persist the manifest last: if anything above failed, --undo would have
  // had an incomplete list anyway, and a half-written manifest is worse than
  // none. On a re-seed the previous manifest is replaced.
  await db
    .insert(platformSetting)
    .values({ key: manifestKey(churchId), value: JSON.stringify(man) })
    .onConflictDoUpdate({
      target: platformSetting.key,
      set: { value: JSON.stringify(man) },
    });
  const total = Object.values(man).reduce(
    (n, v) => n + (Array.isArray(v) ? v.length : 0),
    0,
  );
  note(`manifest saved — ${total} rows recorded for --undo`);

  return out;
}

