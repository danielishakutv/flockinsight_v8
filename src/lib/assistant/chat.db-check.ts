/**
 * Database-backed checks for the assistant's chat history and its retention.
 * Run with `pnpm test:db`.
 *
 * What only a real Postgres can show:
 *
 *   - Tenancy. Every read goes through one predicate (owner.ts); a
 *     conversation must never show up for another person, another scope, or
 *     a superadmin acting as a different church, and a deleted one must be
 *     gone at once.
 *   - Counts read back from written rows. The saved count per conversation is
 *     a grouped query joined in JS; a correlated subquery here would read 0
 *     forever with no error (AGENTS.md).
 *   - Retention that keeps what it promised to keep: a saved answer outlives
 *     the 180 days, a deleted conversation does not outlive its 30, and
 *     neither does the AI ledger's copy of what its answers were sent.
 *   - Foreign keys doing what the tenancy predicate assumes: a deleted
 *     church takes the support chats about it along, rather than leaving
 *     them to turn into an admin's ordinary platform chats.
 *
 * Fixtures are zzcheck- churches and accounts made here; retention runs only
 * over those accounts (onlyUserIds), and afterAll removes exactly what was
 * created.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiCall, assistantConversation, assistantMessage, church, member, user } from "@/db/schema";
import type { AssistantAsker, ChatOwner } from "@/lib/assistant/owner";

const chat = await import("@/lib/assistant/chat");
const { rateAnswer } = await import("@/lib/assistant/server");
const { runAssistantRetention, CLEARED_REQUEST_JSON } = await import("@/lib/assistant/retention");
const { getChurchAiSetting, setChurchAiEnabled, setChurchAiNotes } = await import("@/lib/ai/settings");

const stamp = Date.now();
const CHURCH_A = `zzcheck-church-a-${stamp}`;
const CHURCH_B = `zzcheck-church-b-${stamp}`;
const CHURCH_C = `zzcheck-church-c-${stamp}`;
// Letters only: a register name is matched word by word, and a word with digits in it is never a name.
const LETTERS = String(stamp).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const ME = `zzcheck-user-${stamp}`;
const OTHER = `zzcheck-other-${stamp}`;
const DAY = 86_400_000;
const callIds: string[] = [];

const askerChurch = (id: string) => ({ id, name: `ZZ Check ${id}`, plan: "growth", slug: id, isDemo: false });
const asChurch: AssistantAsker = { kind: "church", userId: ME, userName: "ZZ", church: askerChurch(CHURCH_A), canReadFigures: true };
const asOther: AssistantAsker = { kind: "church", userId: OTHER, userName: "ZZ", church: askerChurch(CHURCH_A), canReadFigures: true };
const actingAsB: AssistantAsker = { kind: "actingAs", userId: ME, userName: "ZZ", church: askerChurch(CHURCH_B) };
const onPlatform: AssistantAsker = { kind: "platform", userId: ME, userName: "ZZ", canReadFigures: true };

const ownerA: ChatOwner = { scope: "church", churchId: CHURCH_A, contextChurchId: null, userId: ME };

type Seeded = { id: string; answers: string[]; questions: string[] };

/** A conversation with `exchanges` question/answer pairs, written the way askAssistant writes them. */
async function seed(o: {
  owner: ChatOwner;
  title?: string | null;
  lastMessageAt: Date;
  deletedAt?: Date | null;
  exchanges?: number;
  saved?: number[];
  kinds?: string[];
  mode?: "help" | "advisor";
  figuresOk?: boolean | null;
  /** The ledger row every answer in it was written by. */
  callId?: string | null;
}): Promise<Seeded> {
  const exchanges = o.exchanges ?? 1;
  const [conv] = await db
    .insert(assistantConversation)
    .values({
      scope: o.owner.scope,
      churchId: o.owner.churchId,
      contextChurchId: o.owner.contextChurchId,
      userId: o.owner.userId,
      title: o.title === undefined ? `Chat ${stamp}` : o.title,
      messageCount: exchanges * 2,
      startedAt: new Date(o.lastMessageAt.getTime() - exchanges * 60_000),
      lastMessageAt: o.lastMessageAt,
      deletedAt: o.deletedAt ?? null,
    })
    .returning({ id: assistantConversation.id });
  const out: Seeded = { id: conv.id, answers: [], questions: [] };
  for (let i = 0; i < exchanges; i++) {
    // Both rows of an exchange share one timestamp, as one transaction's now() does.
    const at = new Date(o.lastMessageAt.getTime() - (exchanges - 1 - i) * 60_000);
    const [q] = await db
      .insert(assistantMessage)
      .values({
        conversationId: conv.id,
        churchId: o.owner.churchId,
        userId: o.owner.userId,
        role: "user",
        content: `Question ${i + 1}`,
        mode: o.mode ?? "help",
        createdAt: at,
      })
      .returning({ id: assistantMessage.id });
    const kind = o.kinds?.[i] ?? "answered";
    const [a] = await db
      .insert(assistantMessage)
      .values({
        conversationId: conv.id,
        churchId: o.owner.churchId,
        userId: o.owner.userId,
        role: "assistant",
        content: `Answer ${i + 1}`,
        answerKind: kind,
        sources: kind === "answered" ? ["guide:attendance"] : [],
        mode: o.mode ?? "help",
        figuresOk: o.mode === "advisor" ? (o.figuresOk ?? true) : null,
        reviewStatus: o.figuresOk === false ? "open" : "none",
        savedAt: o.saved?.includes(i) ? new Date(at.getTime() + 1000) : null,
        callId: o.callId ?? null,
        createdAt: at,
      })
      .returning({ id: assistantMessage.id });
    out.questions.push(q.id);
    out.answers.push(a.id);
  }
  return out;
}

const now = Date.now();
let recent: Seeded;
let older: Seeded;
let untitled: Seeded;
let deleted: Seeded;
let othersChat: Seeded;
let platformChat: Seeded;
let actingChat: Seeded;

beforeAll(async () => {
  await db
    .insert(church)
    .values([
      { id: CHURCH_A, name: `ZZ Check A ${stamp}`, slug: CHURCH_A, currency: "NGN", plan: "growth" },
      { id: CHURCH_B, name: `ZZ Check B ${stamp}`, slug: CHURCH_B, currency: "NGN", plan: "pro" },
    ])
    .onConflictDoNothing();
  await db
    .insert(user)
    .values([
      { id: ME, name: `ZZ Check ${stamp}`, email: `${ME}@example.com`, emailVerified: false },
      { id: OTHER, name: `ZZ Other ${stamp}`, email: `${OTHER}@example.com`, emailVerified: false },
    ])
    .onConflictDoNothing();

  recent = await seed({ owner: ownerA, title: "Attendance trend", lastMessageAt: new Date(now - 60_000), exchanges: 2, saved: [1] });
  older = await seed({ owner: ownerA, title: "First-timers", lastMessageAt: new Date(now - 2 * DAY), exchanges: 1, kinds: ["failed"] });
  untitled = await seed({ owner: ownerA, title: null, lastMessageAt: new Date(now - 3 * DAY) });
  deleted = await seed({ owner: ownerA, title: "Deleted", lastMessageAt: new Date(now - 30_000), deletedAt: new Date(now - 10_000) });
  othersChat = await seed({ owner: { ...ownerA, userId: OTHER }, title: "Not mine", lastMessageAt: new Date(now - 20_000) });
  platformChat = await seed({
    owner: { scope: "platform", churchId: null, contextChurchId: null, userId: ME },
    title: "Platform",
    lastMessageAt: new Date(now - 40_000),
    mode: "advisor",
    figuresOk: false,
  });
  actingChat = await seed({
    owner: { scope: "platform", churchId: null, contextChurchId: CHURCH_B, userId: ME },
    title: "Acting as B",
    lastMessageAt: new Date(now - 50_000),
  });
});

afterAll(async () => {
  await db.delete(assistantConversation).where(inArray(assistantConversation.userId, [ME, OTHER]));
  if (callIds.length > 0) await db.delete(aiCall).where(inArray(aiCall.id, callIds));
  await db.delete(user).where(inArray(user.id, [ME, OTHER]));
  // Members and the AI setting row cascade with their church.
  await db.delete(church).where(inArray(church.id, [CHURCH_A, CHURCH_B, CHURCH_C]));
});

/** A ledger row as runAi writes one for an assistant question, `ageDays` old. */
function call(feature: "chat" | "advisor" | "analytics", ageDays: number): Promise<string> {
  return db
    .insert(aiCall)
    .values({
      feature,
      promptId: feature === "analytics" ? "analytics-platform@1" : "assistant-chat@1",
      model: "claude-haiku-5-5",
      status: "ok",
      actorUserId: ME,
      budgetMonth: "2099-12",
      reservedNano: 0,
      costNano: 0,
      requestJson: JSON.stringify({ body: { zzcheck: stamp } }),
      requestSha256: "0".repeat(64),
      responseText: "An answer.",
      createdAt: new Date(now - ageDays * DAY),
    })
    .returning({ id: aiCall.id })
    .then((r) => {
      callIds.push(r[0].id);
      return r[0].id;
    });
}

describe("listConversations", () => {
  it("lists this person's church conversations newest first, with saved counts, and hides deleted ones", async () => {
    const { items, nextCursor } = await chat.listConversations({ asker: asChurch });
    expect(items.map((c) => c.id)).toEqual([recent.id, older.id, untitled.id]);
    expect(items[0]).toMatchObject({ title: "Attendance trend", messageCount: 4, savedCount: 1 });
    expect(items[1].savedCount).toBe(0);
    expect(nextCursor).toBeNull();
  });

  it("titles a conversation from before titles with its first question", async () => {
    const { items } = await chat.listConversations({ asker: asChurch });
    expect(items.find((c) => c.id === untitled.id)?.title).toBe("Question 1");
  });

  it("pages by cursor without repeating or skipping", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const r: Awaited<ReturnType<typeof chat.listConversations>> = await chat.listConversations({
        asker: asChurch,
        cursor,
        limit: 1,
      });
      seen.push(...r.items.map((c) => c.id));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([recent.id, older.id, untitled.id]);
  });

  it("keeps people, scopes and acted-as churches apart", async () => {
    expect((await chat.listConversations({ asker: asOther })).items.map((c) => c.id)).toEqual([othersChat.id]);
    expect((await chat.listConversations({ asker: onPlatform })).items.map((c) => c.id)).toEqual([platformChat.id]);
    expect((await chat.listConversations({ asker: actingAsB })).items.map((c) => c.id)).toEqual([actingChat.id]);
  });
});

describe("loadConversation", () => {
  it("loads a conversation question first, with mode, saved and figures flags", async () => {
    const r = await chat.loadConversation({ asker: asChurch, conversationId: recent.id });
    expect(r?.conversation).toMatchObject({ id: recent.id, title: "Attendance trend", full: false, contextChurch: null });
    expect(r?.items.map((i) => `${i.role}:${i.content}`)).toEqual([
      "user:Question 1",
      "assistant:Answer 1",
      "user:Question 2",
      "assistant:Answer 2",
    ]);
    const second = r?.items[3];
    expect(second?.role === "assistant" && second.savedAt).toBeTruthy();
    expect(second?.role === "assistant" && second.sources[0]?.href).toBe("/help/attendance");
  });

  it("names the church an admin was acting as", async () => {
    const r = await chat.loadConversation({ asker: actingAsB, conversationId: actingChat.id });
    expect(r?.conversation.contextChurch).toEqual({ id: CHURCH_B, name: `ZZ Check B ${stamp}` });
  });

  it("reads somebody else's, a deleted, or a malformed id as not found", async () => {
    expect(await chat.loadConversation({ asker: asChurch, conversationId: othersChat.id })).toBeNull();
    expect(await chat.loadConversation({ asker: asChurch, conversationId: deleted.id })).toBeNull();
    expect(await chat.loadConversation({ asker: onPlatform, conversationId: recent.id })).toBeNull();
    expect(await chat.loadConversation({ asker: asChurch, conversationId: "not-a-uuid" })).toBeNull();
  });
});

describe("renaming, saving and deleting", () => {
  it("renames with the title scrubbed and clipped, and refuses somebody else's", async () => {
    const r = await chat.renameConversation({ asker: asChurch, conversationId: older.id, title: "  Call 08031234567 back  " });
    expect(r).toEqual({ ok: true, title: "Call [phone removed] back" });
    expect(await chat.renameConversation({ asker: asChurch, conversationId: older.id, title: "   " })).toEqual({ ok: false });
    expect(await chat.renameConversation({ asker: asChurch, conversationId: othersChat.id, title: "Mine now" })).toEqual({
      ok: false,
    });
  });

  /*
   * A title is stored and read by every platform reviewer in the
   * transcripts, so a member's name typed into it goes the way it would in a
   * question: through the church's register.
   */
  it("removes names on the register from a new title, and refuses a title that is only a name", async () => {
    const first = `Zzngozi${LETTERS}`;
    const last = `Zzokafor${LETTERS}`;
    await db.insert(member).values({ churchId: CHURCH_A, firstName: first, lastName: last });
    const r = await chat.renameConversation({
      asker: asChurch,
      conversationId: older.id,
      title: `Follow-up plan for ${first} ${last}`,
    });
    expect(r).toEqual({ ok: true, title: "Follow-up plan for [name removed] [name removed]" });
    expect(await chat.renameConversation({ asker: asChurch, conversationId: older.id, title: `${first} ${last}` })).toEqual({
      ok: false,
    });
    const [stored] = await db
      .select({ title: assistantConversation.title })
      .from(assistantConversation)
      .where(eq(assistantConversation.id, older.id));
    expect(stored.title).toBe("Follow-up plan for [name removed] [name removed]");
  });

  it("saves only a real answer this person owns, and always unsaves", async () => {
    const save = await chat.setAnswerSaved({ asker: asChurch, messageId: recent.answers[0], saved: true });
    expect(save.ok && save.savedAt).toBeTruthy();
    // A failed answer, a question, and somebody else's answer cannot be saved.
    expect(await chat.setAnswerSaved({ asker: asChurch, messageId: older.answers[0], saved: true })).toEqual({ ok: false });
    expect(await chat.setAnswerSaved({ asker: asChurch, messageId: recent.questions[0], saved: true })).toEqual({ ok: false });
    expect(await chat.setAnswerSaved({ asker: asChurch, messageId: othersChat.answers[0], saved: true })).toEqual({
      ok: false,
    });
    const unsave = await chat.setAnswerSaved({ asker: asChurch, messageId: recent.answers[0], saved: false });
    expect(unsave).toEqual({ ok: true, savedAt: null });
  });

  it("lists saved answers with the question each one answered", async () => {
    const { items } = await chat.listSavedAnswers({ asker: asChurch });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ conversationId: recent.id, conversationTitle: "Attendance trend" });
    expect(items[0].answer.id).toBe(recent.answers[1]);
    expect(items[0].question?.id).toBe(recent.questions[1]);
    expect((await chat.listSavedAnswers({ asker: asOther })).items).toEqual([]);
  });

  it("deletes for this person only, and the conversation is gone from every read at once", async () => {
    const c = await seed({ owner: ownerA, title: "To delete", lastMessageAt: new Date(now - 5_000), saved: [0] });
    expect(await chat.deleteConversation({ asker: asOther, conversationId: c.id })).toEqual({ ok: false });
    expect(await chat.deleteConversation({ asker: asChurch, conversationId: c.id })).toEqual({ ok: true });
    expect((await chat.listConversations({ asker: asChurch })).items.map((x) => x.id)).not.toContain(c.id);
    expect((await chat.listSavedAnswers({ asker: asChurch })).items.map((x) => x.conversationId)).not.toContain(c.id);
    expect(await chat.loadConversation({ asker: asChurch, conversationId: c.id })).toBeNull();
  });
});

describe("rateAnswer", () => {
  it("keeps an advisor answer whose figures could not be checked in the queue, whatever the rating", async () => {
    expect(await rateAnswer({ asker: onPlatform, messageId: platformChat.answers[0], helpful: true })).toEqual({ ok: true });
    const [row] = await db
      .select({ reviewStatus: assistantMessage.reviewStatus, helpful: assistantMessage.helpful })
      .from(assistantMessage)
      .where(eq(assistantMessage.id, platformChat.answers[0]));
    expect(row).toEqual({ reviewStatus: "open", helpful: true });
  });

  it("refuses an answer in somebody else's conversation", async () => {
    expect(await rateAnswer({ asker: asChurch, messageId: othersChat.answers[0], helpful: false })).toEqual({ ok: false });
  });
});

describe("runAssistantRetention", () => {
  it("keeps saved answers past 180 days and purges deleted conversations after 30", async () => {
    // The calls that wrote the deleted chats' answers: far younger than the ledger's own 180 days.
    const purgedCall = await call("advisor", 40);
    const gracedCall = await call("advisor", 20);

    const expired = await seed({ owner: ownerA, title: "Old", lastMessageAt: new Date(now - 200 * DAY) });
    const keptSaved = await seed({ owner: ownerA, title: "Old but saved", lastMessageAt: new Date(now - 200 * DAY), saved: [0] });
    const purged = await seed({
      owner: ownerA,
      title: "Deleted long ago",
      lastMessageAt: new Date(now - 40 * DAY),
      deletedAt: new Date(now - 31 * DAY),
      saved: [0],
      mode: "advisor",
      callId: purgedCall,
    });
    const graced = await seed({
      owner: ownerA,
      title: "Deleted lately",
      lastMessageAt: new Date(now - 20 * DAY),
      deletedAt: new Date(now - 10 * DAY),
      mode: "advisor",
      callId: gracedCall,
    });

    const oldChat = await call("chat", 200);
    const oldAdvisor = await call("advisor", 181);
    const newAdvisor = await call("advisor", 10);
    const oldAnalytics = await call("analytics", 200);

    const r = await runAssistantRetention({ now: new Date(now), onlyUserIds: [ME, OTHER] });
    expect(r).toMatchObject({ expired: 1, removed: 1, cleared: 2, clearedWithChats: 1, more: false });

    const left = new Set(
      (
        await db
          .select({ id: assistantConversation.id })
          .from(assistantConversation)
          .where(inArray(assistantConversation.id, [expired.id, keptSaved.id, purged.id, graced.id, recent.id]))
      ).map((c) => c.id),
    );
    expect(left.has(expired.id)).toBe(false);
    expect(left.has(keptSaved.id)).toBe(true);
    expect(left.has(purged.id)).toBe(false);
    expect(left.has(graced.id)).toBe(true);
    expect(left.has(recent.id)).toBe(true);
    // The messages went with their conversations.
    expect(
      await db.select({ id: assistantMessage.id }).from(assistantMessage).where(eq(assistantMessage.conversationId, expired.id)),
    ).toEqual([]);

    const calls = await db
      .select({ id: aiCall.id, requestJson: aiCall.requestJson, responseText: aiCall.responseText, status: aiCall.status })
      .from(aiCall)
      .where(inArray(aiCall.id, [oldChat, oldAdvisor, newAdvisor, oldAnalytics, purgedCall, gracedCall]));
    const byId = new Map(calls.map((c) => [c.id, c]));
    expect(byId.get(oldChat)).toMatchObject({ requestJson: CLEARED_REQUEST_JSON, responseText: null, status: "ok" });
    expect(byId.get(oldAdvisor)).toMatchObject({ requestJson: CLEARED_REQUEST_JSON, responseText: null });
    expect(byId.get(newAdvisor)?.responseText).toBe("An answer.");
    // Only the assistant's calls: a briefing's payload is the ledger's own business.
    expect(byId.get(oldAnalytics)?.responseText).toBe("An answer.");
    /*
     * "A chat you delete is removed for good within 30 days": the ledger's
     * copy of what it sent goes with it, not 150 days later. One still in
     * its 30 days keeps its copy, because support can still restore it.
     */
    expect(byId.get(purgedCall)).toMatchObject({ requestJson: CLEARED_REQUEST_JSON, responseText: null, status: "ok" });
    expect(byId.get(gracedCall)?.responseText).toBe("An answer.");

    // A second run finds nothing left to do.
    expect(await runAssistantRetention({ now: new Date(now), onlyUserIds: [ME, OTHER] })).toMatchObject({
      expired: 0,
      removed: 0,
      cleared: 0,
      clearedWithChats: 0,
    });
  });
});

describe("deleting a church", () => {
  /*
   * The tenancy predicate reads a null context church as "asked on
   * /superadmin, about no church". Had the support chats about a deleted
   * church been left with a null there, they would have turned into the
   * admin's own platform chats, with that church's figures in them.
   */
  it("takes the support chats about it along, and leaves the admin's own platform chats alone", async () => {
    await db.insert(church).values({ id: CHURCH_C, name: `ZZ Check C ${stamp}`, slug: CHURCH_C, currency: "NGN", plan: "growth" });
    const aboutC = await seed({
      owner: { scope: "platform", churchId: null, contextChurchId: CHURCH_C, userId: ME },
      title: "Acting as C",
      lastMessageAt: new Date(now - 45_000),
      mode: "advisor",
    });
    await db.delete(church).where(eq(church.id, CHURCH_C));

    expect(
      await db.select({ id: assistantConversation.id }).from(assistantConversation).where(eq(assistantConversation.id, aboutC.id)),
    ).toEqual([]);
    expect((await chat.listConversations({ asker: onPlatform })).items.map((c) => c.id)).toEqual([platformChat.id]);
  });
});

describe("About our church", () => {
  it("never rewrites who turned AI on", async () => {
    await setChurchAiEnabled(CHURCH_A, true, ME);
    await setChurchAiNotes(CHURCH_A, "Two services on Sunday; we call first-timers on Monday.");
    const s = await getChurchAiSetting(CHURCH_A);
    expect(s).toMatchObject({
      enabled: true,
      changedByName: `ZZ Check ${stamp}`,
      notes: "Two services on Sunday; we call first-timers on Monday.",
    });
  });
});
