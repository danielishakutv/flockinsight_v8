import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/*
 * The answer key for start.ts. Server-only, and kept out of the Guide objects,
 * because every Guide ships to the browser through the help search.
 */
export const START_QUIZZES: GuideQuiz[] = [
  {
    slug: "getting-started",
    questions: [
      {
        q: "Why set up services and giving categories before importing anything?",
        options: [
          "Attendance and giving records attach to them, so doing them first saves re-entering work",
          "The import refuses to run without them, because every member row has to name a service and a category",
          "They decide your plan price",
          "They control who can sign in",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "Your church's timezone is set wrong. What quietly goes wrong?",
        options: [
          "A Sunday attendance record can land on Saturday",
          "Your plan is billed in the wrong currency, at the exchange rate of the wrong country",
          "Members cannot be imported",
          "Nothing; timezone is cosmetic",
        ],
        answer: 0,
        section: 0,
        why: "Timezone decides what date a Sunday record lands on and when reminders go out.",
      },
      {
        q: "You only have names and phone numbers for your congregation. Can you start?",
        options: [
          "No, every member needs an email address",
          "Only after recording a Sunday",
          "Only on the Growth plan",
          "Yes, that is enough to start",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "Your treasurer should record giving but must not see the member directory. What do you do?",
        options: [
          "Share the owner login",
          "Grant app access with every permission",
          "It cannot be done",
          "Give them a role with Giving and Finance only, in Settings, Roles",
        ],
        answer: 3,
        section: 3,
      },
      {
        q: "Can you change the currency after recording giving?",
        options: [
          "Yes, and old amounts are converted",
          "No, it is locked at sign-up",
          "Yes, but old records keep the amounts you typed; they are not converted",
          "Only support can",
        ],
        answer: 2,
        section: "faq",
      },
    ],
  },
];
