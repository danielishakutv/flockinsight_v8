/**
 * Seed demo data so the dashboard/analytics have something to show.
 *
 * Creates (idempotently):
 *   - a demo church (tenant)
 *   - a demo owner login:  demo@flockinsight.app  /  demo1234
 *   - a few services
 *   - ~40 congregation members
 *   - 12 weeks of attendance sessions with realistic, growing headcounts
 *
 * Run with:  pnpm db:seed
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./index";
import {
  church,
  staff,
  user,
  account,
  service,
  member,
  attendanceSession,
} from "./schema";
import { auth } from "../lib/auth";

const DEMO_EMAIL = "demo@flockinsight.app";
const DEMO_PASSWORD = "demo1234";
const DEMO_SLUG = "grace-chapel-demo";

const FIRST_NAMES = [
  "John", "Mary", "David", "Sarah", "Emmanuel", "Grace", "Daniel", "Esther",
  "Samuel", "Ruth", "Peter", "Deborah", "Joseph", "Faith", "Michael", "Joy",
  "Paul", "Blessing", "James", "Mercy", "Stephen", "Rebecca", "Andrew", "Hannah",
  "Philip", "Naomi", "Thomas", "Abigail", "Isaac", "Lydia", "Caleb", "Priscilla",
  "Joshua", "Rachel", "Nathan", "Eunice", "Simon", "Dorcas", "Mark", "Tabitha",
];
const LAST_NAMES = [
  "Adeyemi", "Okafor", "Nwosu", "Eze", "Bello", "Okoro", "Abubakar", "Ogunleye",
  "Chukwu", "Adebayo", "Obi", "Ibrahim", "Olawale", "Uche", "Danjuma", "Effiong",
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

async function main() {
  console.log("🌱 Seeding FlockInsight demo data...");

  // 1) Demo owner login (create user + credential account directly to avoid
  //    request-scoped cookie handling).
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(DEMO_PASSWORD);

  let [owner] = await db.select().from(user).where(eq(user.email, DEMO_EMAIL));
  if (!owner) {
    const userId = randomUUID();
    [owner] = await db
      .insert(user)
      .values({
        id: userId,
        name: "Demo Pastor",
        email: DEMO_EMAIL,
        emailVerified: true,
      })
      .returning();
    await db.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    });
    console.log(`  ✓ created owner login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } else {
    console.log("  • owner login already exists");
  }

  // 2) Demo church (tenant)
  let [demoChurch] = await db
    .select()
    .from(church)
    .where(eq(church.slug, DEMO_SLUG));
  if (!demoChurch) {
    [demoChurch] = await db
      .insert(church)
      .values({
        id: randomUUID(),
        name: "Grace Chapel (Demo)",
        slug: DEMO_SLUG,
        timezone: "Africa/Lagos",
      })
      .returning();
    await db.insert(staff).values({
      id: randomUUID(),
      organizationId: demoChurch.id,
      userId: owner.id,
      role: "owner",
    });
    console.log("  ✓ created demo church + owner membership");
  } else {
    console.log("  • demo church already exists — skipping data seed");
    console.log("\n✅ Done.");
    process.exit(0);
  }

  const churchId = demoChurch.id;

  // 3) Services
  const services = await db
    .insert(service)
    .values([
      { churchId, name: "Sunday First Service", dayOfWeek: 0, startTime: "08:00", sortOrder: 1 },
      { churchId, name: "Sunday Second Service", dayOfWeek: 0, startTime: "10:30", sortOrder: 2 },
      { churchId, name: "Midweek Service", dayOfWeek: 3, startTime: "18:00", sortOrder: 3 },
    ])
    .returning();
  console.log(`  ✓ created ${services.length} services`);

  // 4) Members
  const genders = ["male", "female"] as const;
  const statuses = ["active", "active", "active", "visitor", "new_convert"] as const;
  const memberValues = Array.from({ length: 40 }, (_, i) => ({
    churchId,
    firstName: pick(FIRST_NAMES, i),
    lastName: pick(LAST_NAMES, i * 3 + 1),
    gender: genders[i % 2],
    status: pick([...statuses], i),
    phone: `080${String(10000000 + i * 137).slice(0, 8)}`,
    createdBy: owner.id,
  }));
  await db.insert(member).values(memberValues);
  console.log(`  ✓ created ${memberValues.length} congregation members`);

  // 5) Attendance — last 12 weeks, growing trend
  const sundayFirst = services[0];
  const sundaySecond = services[1];
  const midweek = services[2];

  const today = new Date();
  // find the most recent Sunday
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - today.getDay());

  const sessions: (typeof attendanceSession.$inferInsert)[] = [];
  for (let w = 11; w >= 0; w--) {
    const sunday = new Date(lastSunday);
    sunday.setDate(lastSunday.getDate() - w * 7);
    const sundayStr = sunday.toISOString().slice(0, 10);

    const growth = (11 - w) * 4; // grows over time
    const wobble = ((w * 7) % 11) - 5; // small +/- variation

    // Sunday first service
    const m1 = 60 + growth + wobble;
    const f1 = 80 + growth + Math.round(wobble / 2);
    const c1 = 25 + Math.round(growth / 2);
    sessions.push({
      churchId,
      serviceId: sundayFirst.id,
      date: sundayStr,
      maleCount: m1,
      femaleCount: f1,
      childrenCount: c1,
      firstTimerCount: 3 + (w % 4),
      newConvertCount: 1 + (w % 3),
      totalCount: m1 + f1 + c1,
      recordedBy: owner.id,
    });

    // Sunday second service
    const m2 = 70 + growth - wobble;
    const f2 = 95 + growth;
    const c2 = 30 + Math.round(growth / 2);
    sessions.push({
      churchId,
      serviceId: sundaySecond.id,
      date: sundayStr,
      maleCount: m2,
      femaleCount: f2,
      childrenCount: c2,
      firstTimerCount: 5 + (w % 5),
      newConvertCount: 2 + (w % 3),
      totalCount: m2 + f2 + c2,
      recordedBy: owner.id,
    });

    // Midweek (Wednesday of that week)
    const wed = new Date(sunday);
    wed.setDate(sunday.getDate() + 3);
    const m3 = 35 + Math.round(growth / 2);
    const f3 = 50 + Math.round(growth / 2);
    sessions.push({
      churchId,
      serviceId: midweek.id,
      date: wed.toISOString().slice(0, 10),
      maleCount: m3,
      femaleCount: f3,
      childrenCount: 10,
      firstTimerCount: 1 + (w % 2),
      newConvertCount: w % 2,
      totalCount: m3 + f3 + 10,
      recordedBy: owner.id,
    });
  }
  await db.insert(attendanceSession).values(sessions);
  console.log(`  ✓ created ${sessions.length} attendance sessions (12 weeks)`);

  console.log("\n✅ Done. Log in with:");
  console.log(`   ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
