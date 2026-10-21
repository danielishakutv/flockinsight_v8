import "server-only";
/**
 * Every guide's quiz, gathered: the course's answer key.
 *
 * `server-only` is the boundary. help-guides.ts reaches the browser through
 * the help search, so the quizzes cannot live on the Guide objects; and with
 * this import at the top of this file and of every *.quiz.ts, Next refuses to
 * build if any client bundle reaches them, however indirectly.
 */
import { GUIDES } from "@/lib/help-guides";
import type { GuideQuiz } from "@/lib/certification-shared";
import { START_QUIZZES } from "@/lib/help/start.quiz";
import { SHORTCUT_QUIZZES } from "@/lib/help/shortcuts.quiz";
import { PEOPLE_QUIZZES } from "@/lib/help/people.quiz";
import { TRAINING_QUIZZES } from "@/lib/help/training.quiz";
import { MEETING_QUIZZES } from "@/lib/help/meetings.quiz";
import { SERVICE_QUIZZES } from "@/lib/help/services.quiz";
import { MONEY_QUIZZES } from "@/lib/help/money.quiz";
import { CONTRIBUTION_QUIZZES } from "@/lib/help/contributions.quiz";
import { COMMS_QUIZZES } from "@/lib/help/comms.quiz";
import { CONTENT_QUIZZES } from "@/lib/help/content.quiz";
import { STUDIO_QUIZZES } from "@/lib/help/studio.quiz";
import { LINK_QUIZZES } from "@/lib/help/links.quiz";
import { LINK_PAGE_QUIZZES } from "@/lib/help/link-pages.quiz";
import { PUBLIC_QUIZZES } from "@/lib/help/publicpage.quiz";
import { ACCOUNT_QUIZZES } from "@/lib/help/account.quiz";

export const ALL_QUIZZES: GuideQuiz[] = [
  ...START_QUIZZES,
  ...SHORTCUT_QUIZZES,
  ...PEOPLE_QUIZZES,
  ...TRAINING_QUIZZES,
  ...MEETING_QUIZZES,
  ...SERVICE_QUIZZES,
  ...MONEY_QUIZZES,
  ...CONTRIBUTION_QUIZZES,
  ...COMMS_QUIZZES,
  ...CONTENT_QUIZZES,
  ...STUDIO_QUIZZES,
  ...LINK_QUIZZES,
  ...LINK_PAGE_QUIZZES,
  ...PUBLIC_QUIZZES,
  ...ACCOUNT_QUIZZES,
];

export const QUIZZES: Map<string, GuideQuiz> = new Map(ALL_QUIZZES.map((q) => [q.slug, q]));

/**
 * The course, in the order the guides are listed. Every guide is a module; a
 * test refuses a guide that ships without a quiz.
 */
export const CURRICULUM: string[] = GUIDES.map((g) => g.slug);

export function getQuiz(slug: string): GuideQuiz | undefined {
  return QUIZZES.get(slug);
}

/** True when this slug is a module of the course and has a quiz to take. */
export function isCourseModule(slug: string): boolean {
  return CURRICULUM.includes(slug) && QUIZZES.has(slug);
}
