import type { MeetingRole, Stage } from "@/lib/meetings-shared";

/**
 * What a video recording shows, and whose voice it is captioned with.
 *
 * A meeting has one main picture at a time, and the room already decides what
 * it is: a shared screen beats everything, then whatever the host has put on
 * the shared stage (a verse, a note, a slide), then the person the host has
 * spotlit, then the host's own camera, then anybody's camera that is on. The
 * recording follows the same order, so a recording looks like the meeting did.
 *
 * Pure, so the order can be tested without a media server. The capture turns
 * a choice into pixels: a track is subscribed to through the media server's
 * adapter, a card is rendered once, a slide is fetched once.
 */

export type StagePerson = {
  participantId: string;
  peerId: string;
  name: string;
  role: MeetingRole | string;
  sfuSessionId: string | null;
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /** ISO. Earlier joiners win ties, which keeps the picture from flapping. */
  joinedAt: string;
};

export type StageChoice =
  | {
      kind: "track";
      trackName: "screen" | "cam";
      sessionId: string;
      participantId: string;
      peerId: string;
      caption: string;
    }
  | { kind: "slide"; key: string; url: string; caption: string }
  | { kind: "card"; key: string; title: string; body: string; footnote: string }
  | { kind: "empty"; key: string; title: string; body: string };

export type StageInput = {
  people: StagePerson[];
  stage: Stage;
  spotlightPeerId: string | null;
  meetingTitle: string;
  churchName: string;
};

const byArrival = (a: StagePerson, b: StagePerson) =>
  a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : 0;

const isHost = (role: string) => role === "host" || role === "cohost";

function camera(p: StagePerson): StageChoice {
  return {
    kind: "track",
    trackName: "cam",
    sessionId: p.sfuSessionId as string,
    participantId: p.participantId,
    peerId: p.peerId,
    caption: p.name,
  };
}

export function chooseStage(input: StageInput): StageChoice {
  const people = [...input.people].filter((p) => !!p.sfuSessionId).sort(byArrival);

  const sharer = people.find((p) => p.sharing);
  if (sharer) {
    return {
      kind: "track",
      trackName: "screen",
      sessionId: sharer.sfuSessionId as string,
      participantId: sharer.participantId,
      peerId: sharer.peerId,
      caption: `${sharer.name} is sharing their screen`,
    };
  }

  const stage = input.stage;
  if (stage.kind === "verse") {
    return {
      kind: "card",
      key: `verse:${stage.rev}:${stage.reference}`,
      title: stage.reference,
      body: stage.body,
      footnote: stage.translation.toUpperCase(),
    };
  }
  if (stage.kind === "text") {
    return {
      kind: "card",
      key: `text:${stage.rev}`,
      title: stage.title ?? "",
      body: stage.body,
      footnote: "",
    };
  }
  if (stage.kind === "slide") {
    const url = stage.urls[stage.index];
    if (url) {
      return {
        kind: "slide",
        key: `slide:${stage.index}:${url}`,
        url,
        caption: `Slide ${stage.index + 1} of ${stage.urls.length}`,
      };
    }
  }

  if (input.spotlightPeerId) {
    const spot = people.find((p) => p.peerId === input.spotlightPeerId && p.cameraOn);
    if (spot) return camera(spot);
  }

  const host = people.find((p) => isHost(p.role) && p.cameraOn);
  if (host) return camera(host);

  const anyone = people.find((p) => p.cameraOn);
  if (anyone) return camera(anyone);

  return {
    kind: "empty",
    key: "empty",
    title: input.meetingTitle,
    body: input.churchName,
  };
}

/** A stable identity for a choice, so the capture knows when it has changed. */
export function stageKey(choice: StageChoice): string {
  switch (choice.kind) {
    case "track":
      return `track:${choice.sessionId}:${choice.trackName}`;
    case "slide":
    case "card":
    case "empty":
      return `${choice.kind}:${choice.key}`;
  }
}

/** The line written under the picture. */
export function stageCaption(choice: StageChoice): string {
  switch (choice.kind) {
    case "track":
    case "slide":
      return choice.caption;
    case "card":
      return choice.title;
    case "empty":
      return "";
  }
}
