import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for services.ts. Server-only; see start.quiz.ts. */
export const SERVICE_QUIZZES: GuideQuiz[] = [
  {
    slug: "services",
    questions: [
      {
        q: "Your two Sunday services have different congregations. How should you set them up?",
        options: [
          "As two services, so you can see if one grows while the other shrinks",
          "As one service, to keep reports simple",
          "As one service with a note each week saying which congregation came, which keeps the reports simple",
          "As two groups",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "You no longer hold the Tuesday service. What should you do with it?",
        options: [
          "Delete it",
          "Rename it to \"Old\"",
          "Leave it as it is and ignore it; a service with no new records never shows up in any of your reports",
          "Switch it off: it leaves the recording screen and its history stays in your reports",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "You are holding a one-off crusade. How do you record its attendance?",
        options: [
          "Create a new service and delete it afterwards",
          "It cannot be recorded",
          "Skip the service on the recording screen and type an event name instead",
          "Record it under Sunday First Service",
        ],
        answer: 2,
        section: 2,
      },
      {
        q: "Your service time changes from 7:00 to 7:30. What do you do?",
        options: [
          "Create a new service at 7:30",
          "Edit the existing one: the history stays and reminders move to the new time",
          "Nothing; times are only labels",
          "Ask support to change it",
        ],
        answer: 1,
        section: "faq",
      },
    ],
  },
  {
    slug: "attendance",
    questions: [
      {
        q: "Two ushers both record Sunday First Service for the same date. What happens?",
        options: [
          "It is one record: the second save updates the first, and the last save wins",
          "The congregation is counted twice",
          "The second save is refused",
          "Both are kept side by side, and the reports use the average of the two counts for that date",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "You counted 10 adults, 2 of them first-timers. What is the total?",
        options: [
          "10: first-timers describe people already counted",
          "12",
          "8: first-timers are taken off, since they are not yet members",
          "It depends on the service",
        ],
        answer: 0,
        section: 1,
      },
      {
        q: "Your church only counts one overall number. Can you still use Attendance?",
        options: [
          "No, every box must be filled",
          "Only on a paid plan",
          "Only by importing a spreadsheet",
          "Yes: put the one total in and ignore the breakdown",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "Why add a note such as \"Heavy rain\" to a record?",
        options: [
          "It is required to save",
          "Months later it explains a dip nobody could otherwise account for",
          "It sends an SMS to absent members",
          "It changes the total",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "You forgot to record last Sunday. Can you still add it?",
        options: [
          "No, the window closes after 24 hours",
          "Only an owner can",
          "Only by import",
          "Yes: change the date when recording",
        ],
        answer: 3,
        section: "faq",
      },
    ],
  },
  {
    slug: "analytics",
    questions: [
      {
        q: "Attendance was low this Sunday. What does the guide advise?",
        options: [
          "Resist reading anything into one week; three low Sundays is a pattern",
          "Act on it straight away",
          "Delete the record",
          "Compare it with last Sunday only, since the week before is the fairest comparison you have",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "Where do you look to know whether you are really growing?",
        options: [
          "Last Sunday's total",
          "The giving report",
          "The trend line over three months",
          "The number of groups",
        ],
        answer: 2,
        section: 2,
      },
      {
        q: "Many first-timers but flat attendance tells you what?",
        options: [
          "The first-timers are not staying",
          "Outreach has stopped",
          "Your timezone is wrong",
          "Children are being under-counted",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "The charts are empty. What are they drawn from?",
        options: [
          "Giving records",
          "Member profiles",
          "Meeting chats",
          "Attendance records only",
        ],
        answer: 3,
        section: "faq",
      },
    ],
  },
];
