import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for meetings.ts. Server-only; see start.quiz.ts. */
export const MEETING_QUIZZES: GuideQuiz[] = [
  {
    slug: "meetings",
    questions: [
      {
        q: "What does somebody need to join a meeting set to \"Anyone with the link\"?",
        options: [
          "Only the link: they type their name and join in the browser",
          "An app installed on their phone",
          "A FlockInsight account",
          "An invitation email from the pastor, with a personal code that works for one person only",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "Wednesday prayer repeats every week. What happens to the link?",
        options: [
          "A new link is sent out each week",
          "It stays the same for the whole series",
          "It expires after each meeting",
          "It changes only when the passcode does",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "There is a funeral on one Wednesday. Which keeps the weekly series running?",
        options: [
          "Stop repeating, then start a fresh series again the week after the funeral",
          "Delete the meeting",
          "Cancel, which calls off one week only",
          "Change the room limit to zero",
        ],
        answer: 2,
        section: 2,
      },
      {
        q: "One person turns on low data mode. What does that change for everyone else?",
        options: [
          "Nothing: they still hear, and are heard by, everybody",
          "Everyone's video switches off",
          "The whole meeting drops to audio only",
          "The host is asked to approve it",
        ],
        answer: 0,
        section: 3,
      },
      {
        q: "You turn off \"Let anyone unmute themselves\". Who can still speak?",
        options: [
          "Nobody",
          "Only people on a laptop",
          "Hosts and co-hosts, plus anyone a host chooses \"Let them speak\" for",
          "Only people who joined first",
        ],
        answer: 2,
        section: 4,
      },
      {
        q: "A host starts recording. Who is told?",
        options: [
          "Everyone in the room, the moment it starts",
          "Nobody; recording is silent so that it never interrupts whoever is speaking",
          "Only the co-hosts",
          "Only people who join later",
        ],
        answer: 0,
        section: 7,
      },
      {
        q: "After the meeting, how does it count towards your attendance?",
        options: [
          "It counts automatically as a Sunday service",
          "One button turns the meeting's register into an attendance record",
          "You must type every name into Attendance",
          "Meetings cannot count towards attendance",
        ],
        answer: 1,
        section: 8,
      },
    ],
  },
];
