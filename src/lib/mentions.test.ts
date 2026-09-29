import { describe, expect, it } from "vitest";
import { mentionQuery, splitMentions } from "@/components/meetings/chat-panel";

/**
 * When the @ picker opens, and how a sent message is picked apart again.
 * The cases that matter are the ones where an "@" is not a mention.
 */

describe("mentionQuery", () => {
  it("opens on an @ at the start of a message", () => {
    expect(mentionQuery("@ma", 3)).toEqual({ at: 0, query: "ma" });
  });

  it("opens on an @ after a space", () => {
    expect(mentionQuery("hello @ma", 9)).toEqual({ at: 6, query: "ma" });
  });

  it("stays shut inside an email address", () => {
    // Otherwise the picker springs open halfway through typing an address.
    expect(mentionQuery("mail pastor@church.org", 22)).toBeNull();
  });

  it("closes once a space follows the name", () => {
    expect(mentionQuery("@mary is here", 13)).toBeNull();
  });

  it("offers everyone on a bare @", () => {
    expect(mentionQuery("@", 1)).toEqual({ at: 0, query: "" });
  });

  it("reads from the caret, not the end of the text", () => {
    // Someone editing the middle of a sentence is still mentioning somebody.
    expect(mentionQuery("@ma and the rest", 3)).toEqual({ at: 0, query: "ma" });
  });
});

describe("splitMentions", () => {
  const people = ["Mary", "Mary Jane", "Daniel"];

  it("pulls a mention out of the surrounding text", () => {
    expect(splitMentions("hi @Daniel ok", people)).toEqual(["hi ", "@Daniel", " ok"]);
  });

  it("prefers the longest matching name", () => {
    // "@Mary Jane" must not be read as "@Mary" followed by " Jane".
    expect(splitMentions("@Mary Jane hello", people)).toEqual([
      "@Mary Jane",
      " hello",
    ]);
  });

  it("ignores an @ that is not anybody", () => {
    expect(splitMentions("email me@example.com", people)).toEqual([
      "email me@example.com",
    ]);
  });

  it("matches regardless of case", () => {
    expect(splitMentions("@daniel", people)).toEqual(["@daniel"]);
  });

  it("returns the message unchanged when nobody is in the room", () => {
    expect(splitMentions("@Mary", [])).toEqual(["@Mary"]);
  });

  it("does not trip over a name containing regex characters", () => {
    expect(splitMentions("hi @A.B ok", ["A.B"])).toEqual(["hi ", "@A.B", " ok"]);
  });
});
