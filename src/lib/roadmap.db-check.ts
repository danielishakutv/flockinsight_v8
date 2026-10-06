/**
 * The task list against a real database. Run with `pnpm test:db`.
 *
 * What is worth checking here is the shipping, because it is the one thing
 * that cannot be undone by doing it again: moving an item to shipped freezes
 * how big the platform was that day, and those three numbers can never be
 * worked out afterwards. The rule is that they are written once — a mis-tap
 * out of shipped and back in must not rewrite history with today's larger
 * numbers — and nothing in the type system says so.
 *
 * Creates its own rows and removes exactly those rows at the end. It never
 * touches an item it did not insert.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { roadmapItem } from "@/db/schema";
import {
  createRoadmapItem,
  getRoadmapItem,
  listRoadmap,
  platformSize,
  setRoadmapStatus,
  unshipRoadmapItem,
} from "@/lib/roadmap";

const mine: string[] = [];
const stamp = Date.now();

async function make(title: string, extra = {}) {
  const row = await createRoadmapItem({ title: `${title} ${stamp}`, ...extra });
  mine.push(row.id);
  return row;
}

beforeAll(async () => {
  // A platform size has to be readable before any of this means anything.
  const size = await platformSize();
  expect(size.churches).toBeGreaterThanOrEqual(0);
});

afterAll(async () => {
  if (mine.length > 0) {
    await db.delete(roadmapItem).where(inArray(roadmapItem.id, mine));
  }
});

describe("adding something", () => {
  it("lands on the to-do list, not shipped, with no stamps", async () => {
    const row = await make("check: a new task");
    expect(row.status).toBe("todo");
    expect(row.shippedAt).toBeNull();
    expect(row.churchesAtShip).toBeNull();
    expect(row.membersAtShip).toBeNull();
  });

  it("defaults to not public, because the queue is not an announcement", async () => {
    const row = await make("check: privacy default");
    expect(row.isPublic).toBe(false);
  });
});

describe("shipping", () => {
  it("stamps the date and the platform size", async () => {
    const row = await make("check: ship me");
    const size = await platformSize();

    await setRoadmapStatus(row.id, "shipped", { version: "9.9.9" });
    const after = await getRoadmapItem(row.id);

    expect(after?.status).toBe("shipped");
    expect(after?.shippedAt).toBeInstanceOf(Date);
    expect(after?.version).toBe("9.9.9");
    expect(after?.churchesAtShip).toBe(size.churches);
    expect(after?.usersAtShip).toBe(size.users);
    expect(after?.membersAtShip).toBe(size.members);
  });

  it("writes the stamps once — a trip out and back keeps the originals", async () => {
    const row = await make("check: mis-tap");
    await setRoadmapStatus(row.id, "shipped");
    const first = await getRoadmapItem(row.id);

    // Out of shipped WITHOUT unshipping — the mis-tap, then the correction.
    await setRoadmapStatus(row.id, "todo");
    await setRoadmapStatus(row.id, "shipped");
    const second = await getRoadmapItem(row.id);

    expect(second?.shippedAt?.toISOString()).toBe(
      first?.shippedAt?.toISOString(),
    );
    expect(second?.churchesAtShip).toBe(first?.churchesAtShip);
    expect(second?.membersAtShip).toBe(first?.membersAtShip);
  });

  it("does not wipe the version when none is supplied", async () => {
    // The bug this replaces: passing `{ version: null }` unconditionally
    // cleared the version off everything shipped from the page, where the
    // button sends no version at all.
    const row = await make("check: keep the version", { version: "1.2.3" });
    await setRoadmapStatus(row.id, "shipped");
    expect((await getRoadmapItem(row.id))?.version).toBe("1.2.3");
  });
});

describe("un-shipping", () => {
  it("is the one thing that clears the frozen size", async () => {
    const row = await make("check: unship");
    await setRoadmapStatus(row.id, "shipped", { version: "9.9.9" });
    expect((await getRoadmapItem(row.id))?.churchesAtShip).not.toBeNull();

    await unshipRoadmapItem(row.id);
    const after = await getRoadmapItem(row.id);

    expect(after?.status).toBe("todo");
    expect(after?.shippedAt).toBeNull();
    expect(after?.version).toBeNull();
    expect(after?.churchesAtShip).toBeNull();
    expect(after?.usersAtShip).toBeNull();
    expect(after?.membersAtShip).toBeNull();
  });
});

describe("the order the list reads", () => {
  it("puts everything still to do above everything shipped", async () => {
    const rows = await listRoadmap();
    const firstShipped = rows.findIndex((r) => r.status === "shipped");
    if (firstShipped === -1) return; // nothing shipped yet, nothing to prove
    expect(
      rows.slice(firstShipped).every((r) => r.status === "shipped"),
      "a to-do item is listed below a shipped one",
    ).toBe(true);
  });

  it("puts the more important to-dos first", async () => {
    const rank: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const todos = (await listRoadmap()).filter((r) => r.status === "todo");
    for (let i = 1; i < todos.length; i++) {
      expect(
        rank[todos[i - 1].priority],
        `${todos[i - 1].priority} is listed above ${todos[i].priority}`,
      ).toBeLessThanOrEqual(rank[todos[i].priority]);
    }
  });
});

describe("what the migration left behind", () => {
  it("kept the old five-value status on every row that had one", async () => {
    const rows = await listRoadmap();
    // Rows created by this test file are new and have no legacy value; every
    // row that predates migration 0094 should still carry what it used to be.
    const old = rows.filter((r) => !mine.includes(r.id) && r.legacyStatus);
    for (const r of old) {
      expect(
        ["idea", "planned", "in_progress", "shipped", "parked"],
        `${r.title} has legacy_status "${r.legacyStatus}"`,
      ).toContain(r.legacyStatus);
      // And it has to be consistent with where the row ended up.
      if (r.legacyStatus === "shipped") expect(r.status).toBe("shipped");
      else expect(r.status).toBe("todo");
    }
  });
});
