import { describe, expect, it } from "vitest";
import { chooseStage, stageKey, type StagePerson } from "./stage";
import { EMPTY_STAGE } from "@/lib/meetings-shared";

function person(over: Partial<StagePerson> & { peerId: string }): StagePerson {
  return {
    participantId: `pid-${over.peerId}`,
    name: over.peerId,
    role: "attendee",
    sfuSessionId: `cf-${over.peerId}`,
    micOn: true,
    cameraOn: false,
    sharing: false,
    joinedAt: "2026-10-14T10:00:00.000Z",
    ...over,
  };
}

const base = { stage: EMPTY_STAGE, spotlightPeerId: null, meetingTitle: "Sunday", churchName: "Grace" };

describe("what the recording shows", () => {
  it("shows a title card when nobody has a camera on", () => {
    const c = chooseStage({ ...base, people: [person({ peerId: "a" })] });
    expect(c.kind).toBe("empty");
    if (c.kind === "empty") expect(c.title).toBe("Sunday");
  });

  it("prefers a shared screen over everything", () => {
    const c = chooseStage({
      ...base,
      stage: { kind: "verse", reference: "John 3:16", translation: "web", body: "...", rev: 3 },
      spotlightPeerId: "b",
      people: [
        person({ peerId: "a", sharing: true, cameraOn: true }),
        person({ peerId: "b", cameraOn: true, role: "host" }),
      ],
    });
    expect(c.kind).toBe("track");
    if (c.kind === "track") {
      expect(c.trackName).toBe("screen");
      expect(c.sessionId).toBe("cf-a");
    }
  });

  it("then the shared stage, then the spotlight, then the host, then anyone", () => {
    const people = [
      person({ peerId: "guest", cameraOn: true, joinedAt: "2026-10-14T09:00:00.000Z" }),
      person({ peerId: "host", cameraOn: true, role: "host" }),
      person({ peerId: "spot", cameraOn: true }),
    ];
    const verse = chooseStage({
      ...base,
      people,
      spotlightPeerId: "spot",
      stage: { kind: "verse", reference: "Ps 23", translation: "kjv", body: "The Lord", rev: 1 },
    });
    expect(verse.kind).toBe("card");

    const spot = chooseStage({ ...base, people, spotlightPeerId: "spot" });
    expect(spot.kind === "track" && spot.sessionId).toBe("cf-spot");

    const host = chooseStage({ ...base, people });
    expect(host.kind === "track" && host.sessionId).toBe("cf-host");

    const anyone = chooseStage({ ...base, people: [people[0]] });
    expect(anyone.kind === "track" && anyone.sessionId).toBe("cf-guest");
  });

  it("skips a spotlit person whose camera is off", () => {
    const c = chooseStage({
      ...base,
      spotlightPeerId: "spot",
      people: [person({ peerId: "spot" }), person({ peerId: "other", cameraOn: true })],
    });
    expect(c.kind === "track" && c.sessionId).toBe("cf-other");
  });

  it("ignores anybody who has not published to the media server yet", () => {
    const c = chooseStage({
      ...base,
      people: [person({ peerId: "a", cameraOn: true, sharing: true, sfuSessionId: null })],
    });
    expect(c.kind).toBe("empty");
  });

  it("shows the current slide", () => {
    const c = chooseStage({
      ...base,
      people: [],
      stage: { kind: "slide", slides: ["m1", "m2"], urls: ["u1", "u2"], index: 1, rev: 2 },
    });
    expect(c.kind).toBe("slide");
    if (c.kind === "slide") {
      expect(c.url).toBe("u2");
      expect(c.caption).toBe("Slide 2 of 2");
    }
  });

  it("keys a choice by what it shows, so a re-sort does not look like a change", () => {
    const a = chooseStage({ ...base, people: [person({ peerId: "x", cameraOn: true })] });
    const b = chooseStage({
      ...base,
      people: [person({ peerId: "x", cameraOn: true, name: "renamed" })],
    });
    expect(stageKey(a)).toBe(stageKey(b));
  });
});
