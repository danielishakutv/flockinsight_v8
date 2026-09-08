/**
 * Help & guides.
 *
 * Pure data — icons are referenced by key so a guide can be handed to a client
 * component. The content itself lives in `lib/help/*.ts`, one file per area,
 * because a single file holding every guide grew past the point where anyone
 * could find the one they wanted to edit.
 *
 * `minutes` is computed from the content rather than typed, so a guide that
 * doubles in length stops claiming to be a 3-minute read.
 */
import { readingMinutes, type Guide } from "./help/types";
import { START_GUIDES } from "./help/start";
import { PEOPLE_GUIDES } from "./help/people";
import { TRAINING_GUIDES } from "./help/training";
import { SERVICE_GUIDES } from "./help/services";
import { MONEY_GUIDES } from "./help/money";
import { COMMS_GUIDES } from "./help/comms";
import { CONTENT_GUIDES } from "./help/content";
import { PUBLIC_GUIDES } from "./help/publicpage";
import { ACCOUNT_GUIDES } from "./help/account";

export type {
  Guide,
  GuideBlock,
  GuideLink,
  GuideSection,
} from "./help/types";
export { sectionBlocks } from "./help/types";

export const GUIDE_CATEGORIES: { key: string; title: string }[] = [
  { key: "start", title: "Getting started" },
  { key: "people", title: "Members & people" },
  { key: "training", title: "Training & classes" },
  { key: "services", title: "Services & attendance" },
  { key: "giving", title: "Money" },
  { key: "comms", title: "Communication & SMS" },
  { key: "content", title: "Content & engagement" },
  { key: "public", title: "Your public page" },
  { key: "account", title: "Account, billing & team" },
];

const ALL: Omit<Guide, "minutes">[] = [
  ...START_GUIDES,
  ...PEOPLE_GUIDES,
  ...TRAINING_GUIDES,
  ...SERVICE_GUIDES,
  ...MONEY_GUIDES,
  ...COMMS_GUIDES,
  ...CONTENT_GUIDES,
  ...PUBLIC_GUIDES,
  ...ACCOUNT_GUIDES,
];

export const GUIDES: Guide[] = ALL.map((g) => ({
  ...g,
  minutes: readingMinutes(g),
}));

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** The guides a given guide points at, in the order it listed them. */
export function relatedGuides(g: Guide): Guide[] {
  return (g.related ?? [])
    .map((slug) => GUIDES.find((x) => x.slug === slug))
    .filter((x): x is Guide => !!x);
}
