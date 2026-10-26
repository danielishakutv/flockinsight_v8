import { describe, expect, it } from "vitest";
import type { ChatUsage } from "@/lib/assistant/advisor-shared";
import type { ChatAnswer, ChatQuestion, ConversationSummary, SavedAnswer } from "@/lib/assistant/shared";
import {
  bumpChat,
  chatMarkdown,
  chatUrl,
  filenameFromDisposition,
  filterChats,
  filterSaved,
  firstParam,
  limitReached,
  markdownFilename,
  PDF_FAILURE_KEY,
  pdfHref,
  pdfOutcome,
  searchKey,
  tabFromParam,
} from "./chat-shared";

const ID = "3f1c2a8e-5b6d-4c7e-9f00-112233445566";
const MSG = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f99887766";

function usage(over: Partial<ChatUsage> = {}): ChatUsage {
  return {
    mode: "help",
    advisorAvailable: false,
    advisorUnavailableReason: "plan",
    monthly: { used: 3, limit: 30 },
    daily: { used: 1, limit: 25 },
    resetsAt: { month: "2026-11-01T00:00:00.000Z", day: "2026-10-27T00:00:00.000Z" },
    dormant: null,
    ...over,
  };
}

function summary(id: string, title: string, over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    title,
    messageCount: 2,
    savedCount: 0,
    startedAt: "2026-10-01T09:00:00.000Z",
    lastMessageAt: "2026-10-01T09:00:00.000Z",
    ...over,
  };
}

const question: ChatQuestion = {
  role: "user",
  id: "q1",
  content: "How is attendance trending?\nAnd giving?",
  redactions: 0,
  mode: "advisor",
  createdAt: "2026-10-20T10:00:00.000Z",
};

const answer: ChatAnswer = {
  role: "assistant",
  id: "a1",
  content: "Attendance is up.\n\n## Recommendations\n1. Keep going.\n",
  kind: "answered",
  sources: [
    { ref: "facts", title: "Your figures", href: null },
    { ref: "guide:attendance", title: "Attendance", href: "/help/attendance" },
  ],
  helpful: null,
  mode: "advisor",
  figuresOk: true,
  savedAt: null,
  createdAt: "2026-10-20T10:00:00.000Z",
};

describe("the URL holds the page's state", () => {
  it("reads only 'saved' as the saved tab", () => {
    expect(tabFromParam("saved")).toBe("saved");
    expect(tabFromParam("chats")).toBe("chats");
    expect(tabFromParam("SAVED")).toBe("chats");
    expect(tabFromParam(undefined)).toBe("chats");
    expect(tabFromParam(["saved"])).toBe("chats");
  });

  it("takes the first of a repeated param and treats empty as absent", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("x")).toBe("x");
    expect(firstParam("")).toBeNull();
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam(null)).toBeNull();
  });

  it("names a chat, the saved tab, or nothing for a new chat", () => {
    expect(chatUrl("/assistant", { conversationId: ID, tab: "chats" })).toBe(`/assistant?c=${ID}`);
    expect(chatUrl("/assistant", { conversationId: null, tab: "chats" })).toBe("/assistant");
    // The saved tab is its own view: the chat behind it is not part of its address.
    expect(chatUrl("/superadmin/ask", { conversationId: ID, tab: "saved" })).toBe("/superadmin/ask?tab=saved");
  });

  it("points a PDF at the export route, with the answer when there is one", () => {
    expect(pdfHref("/assistant/export", ID)).toBe(`/assistant/export?c=${ID}&format=pdf`);
    expect(pdfHref("/assistant/export", ID, MSG)).toBe(`/assistant/export?c=${ID}&format=pdf&m=${MSG}`);
  });

  it("names a Markdown download like the PDF route names its file", () => {
    expect(markdownFilename(new Date(2026, 0, 5, 23, 59))).toBe("flockinsight-assistant-2026-01-05.md");
  });
});

describe("a PDF download says why it failed", () => {
  const reply = (status: number, contentType: string | null, redirected = false) => ({
    status,
    contentType,
    redirected,
  });

  it("saves only a PDF", () => {
    expect(pdfOutcome(reply(200, "application/pdf"))).toBeNull();
    expect(pdfOutcome(reply(200, "Application/PDF; charset=binary"))).toBeNull();
  });

  it("gives each of the route's refusals its own cause", () => {
    expect(pdfOutcome(reply(429, "text/plain; charset=utf-8"))).toBe("tooMany");
    expect(pdfOutcome(reply(403, "text/plain; charset=utf-8"))).toBe("withheld");
    expect(pdfOutcome(reply(404, "text/plain; charset=utf-8"))).toBe("notFound");
    expect(pdfOutcome(reply(500, "text/plain; charset=utf-8"))).toBe("failed");
    expect(pdfOutcome(reply(400, "text/plain; charset=utf-8"))).toBe("failed");
  });

  it("never saves the sign-in page as a PDF when the session has ended", () => {
    expect(pdfOutcome(reply(200, "text/html; charset=utf-8", true))).toBe("signedOut");
    expect(pdfOutcome(reply(200, "text/html; charset=utf-8", false))).toBe("failed");
    expect(pdfOutcome(reply(200, null))).toBe("failed");
  });

  it("has a sentence for every cause", () => {
    const causes = ["tooMany", "withheld", "notFound", "failed", "offline", "signedOut"] as const;
    for (const c of causes) expect(PDF_FAILURE_KEY[c]).toMatch(/^assistantPage\./);
    expect(Object.keys(PDF_FAILURE_KEY).sort()).toEqual([...causes].sort());
  });

  it("takes the file name the route gives, and nothing that is a path", () => {
    expect(filenameFromDisposition('attachment; filename="flockinsight-assistant-2026-10-26.pdf"')).toBe(
      "flockinsight-assistant-2026-10-26.pdf",
    );
    expect(filenameFromDisposition("attachment; filename=report.pdf")).toBe("report.pdf");
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"')).toBeNull();
    expect(filenameFromDisposition('attachment; filename=".hidden"')).toBeNull();
    expect(filenameFromDisposition("attachment")).toBeNull();
    expect(filenameFromDisposition(null)).toBeNull();
  });
});

describe("which allowance has run out", () => {
  it("is none while both have room", () => {
    expect(limitReached(usage())).toBeNull();
  });

  it("puts the month first, because tomorrow does not fix it", () => {
    expect(limitReached(usage({ monthly: { used: 30, limit: 30 }, daily: { used: 25, limit: 25 } }))).toBe("monthly");
  });

  it("finds the day when the month has room", () => {
    expect(limitReached(usage({ daily: { used: 25, limit: 25 } }))).toBe("daily");
  });

  it("never reads a null limit as zero", () => {
    expect(limitReached(usage({ monthly: { used: 5000, limit: null } }))).toBeNull();
  });

  it("has no month in the platform scope", () => {
    expect(limitReached(usage({ monthly: null, daily: { used: 59, limit: 60 } }))).toBeNull();
    expect(limitReached(usage({ monthly: null, daily: { used: 60, limit: 60 } }))).toBe("daily");
  });
});

describe("the history search", () => {
  const items = [summary("1", "Réunion de prière"), summary("2", "First-timers follow up"), summary("3", "Giving trend")];

  it("folds accents, case and spacing", () => {
    expect(searchKey("  Réunion   DE prière ")).toBe("reunion de priere");
  });

  it("needs every word, in any order", () => {
    expect(filterChats(items, "reunion").map((i) => i.id)).toEqual(["1"]);
    expect(filterChats(items, "follow first").map((i) => i.id)).toEqual(["2"]);
    expect(filterChats(items, "giving prayer")).toEqual([]);
  });

  it("shows everything for an empty search, in the list's order", () => {
    expect(filterChats(items, "   ").map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("matches saved answers on the question as well as the chat's title", () => {
    const saved: SavedAnswer[] = [
      { conversationId: "c1", conversationTitle: "Sunday", question, answer },
      { conversationId: "c2", conversationTitle: "Giving ideas", question: null, answer: { ...answer, id: "a2" } },
    ];
    expect(filterSaved(saved, "attendance").map((s) => s.conversationId)).toEqual(["c1"]);
    expect(filterSaved(saved, "giving").map((s) => s.conversationId)).toEqual(["c1", "c2"]);
  });
});

describe("a question moves its chat to the top", () => {
  const items = [summary("a", "A"), summary("b", "B", { savedCount: 2, messageCount: 4 })];

  it("moves an existing chat up, keeping its saved count", () => {
    const next = bumpChat(items, { id: "b", title: "B", lastMessageAt: "2026-10-26T08:00:00.000Z", addMessages: 2 });
    expect(next.map((i) => i.id)).toEqual(["b", "a"]);
    expect(next[0]).toMatchObject({ messageCount: 6, savedCount: 2, lastMessageAt: "2026-10-26T08:00:00.000Z" });
  });

  it("adds a new chat at the top", () => {
    const next = bumpChat(items, { id: "c", title: "New one", lastMessageAt: "2026-10-26T08:00:00.000Z", addMessages: 2 });
    expect(next.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(next[0]).toMatchObject({ title: "New one", messageCount: 2, savedCount: 0 });
  });

  it("never lists a chat twice", () => {
    const next = bumpChat(items, { id: "a", title: "A", lastMessageAt: "2026-10-26T08:00:00.000Z", addMessages: 2 });
    expect(next.filter((i) => i.id === "a")).toHaveLength(1);
  });
});

describe("a chat as Markdown", () => {
  const labels = {
    question: "Question",
    answer: "Answer",
    sources: "Sources",
    sourceTitle: (s: { ref: string; title: string }) => (s.ref === "facts" ? "Your figures" : s.title),
    leftOut: (n: number) => `${n} left out`,
  };

  it("quotes each line of the question and keeps the answer as written", () => {
    const md = chatMarkdown({ title: "  Sunday\nreview ", exchanges: [{ question, answer }], labels });
    expect(md.startsWith("# Sunday review\n")).toBe(true);
    expect(md).toContain("> How is attendance trending?\n> And giving?");
    expect(md).toContain("## Recommendations\n1. Keep going.");
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("writes the sources out as text, with the path for a guide", () => {
    const md = chatMarkdown({ title: "T", exchanges: [{ question, answer }], labels });
    expect(md).toContain("Sources: Your figures, Attendance (/help/attendance)");
  });

  it("leaves out the question when it is gone, and the sources line when there are none", () => {
    const md = chatMarkdown({
      title: "T",
      exchanges: [{ question: null, answer: { ...answer, sources: [] } }],
      labels,
    });
    expect(md).not.toContain("## Question");
    expect(md).not.toContain("Sources:");
    expect(md).toContain("## Answer");
  });

  it("leaves out a withheld answer and its question, and says how many went", () => {
    const withheld = { ...answer, id: "a2", content: "", sources: [], withheld: true as const };
    const md = chatMarkdown({
      title: "T",
      exchanges: [
        { question, answer },
        { question: { ...question, id: "q2", content: "And the giving trend?" }, answer: withheld },
      ],
      labels,
    });
    expect(md).not.toContain("And the giving trend?");
    expect(md.match(/## Answer/g)).toHaveLength(1);
    expect(md.trimEnd().endsWith("_1 left out_")).toBe(true);
    expect(chatMarkdown({ title: "T", exchanges: [{ question, answer }], labels })).not.toContain("left out");
  });
});
