import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for links.ts. Server-only; see start.quiz.ts. */
export const LINK_QUIZZES: GuideQuiz[] = [
  {
    slug: "links-and-qr",
    questions: [
      {
        q: "Flyers are already printed with a code for flockinsight.com/l/carols, and the form moves. What do you do?",
        options: [
          "Reprint the flyers",
          "Rename the short word to match the new form, so that the printed code finds it under its new name",
          "Nothing can be done",
          "Edit the short link to point at the new address; the printed code follows",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "Which change breaks every printed copy?",
        options: [
          "Changing where the link goes",
          "Changing the short word itself",
          "Pausing it for a week while the event is being rearranged",
          "Adding a note",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "Why does a suggested code never contain 0, o, 1, l or i?",
        options: [
          "People mistake them for each other when reading a poster",
          "They are reserved for FlockInsight",
          "QR codes cannot encode those characters, so a scanner would read a different address",
          "They make the link longer",
        ],
        answer: 0,
        section: 1,
      },
      {
        q: "Last year's event link is retired. Can another church take the word?",
        options: [
          "No: it stays reserved to you, so old flyers cannot be sent somewhere unexpected",
          "Yes, straight away",
          "Yes, after 30 days",
          "Only if you delete it",
        ],
        answer: 0,
        section: 3,
      },
      {
        q: "For anything printed, which kind of QR code does the guide recommend?",
        options: [
          "One that encodes the final address directly",
          "A WiFi code",
          "A code with a photograph behind it",
          "One that encodes your short link, so the destination can change later",
        ],
        answer: 3,
        section: 5,
      },
      {
        q: "A code will not scan from a printed sheet at all. What is almost always the cause?",
        options: [
          "The colour is too dark for a phone camera to tell the squares apart",
          "The short link expired",
          "The logo is missing",
          "It was printed too small",
        ],
        answer: 3,
        section: 7,
      },
      {
        q: "Deleting a QR code design from your list does what to printed copies?",
        options: [
          "Stops them working",
          "Nothing: the code is just a picture and keeps working",
          "Redirects them to your public page",
          "Makes them show an error page",
        ],
        answer: 1,
        section: "faq",
      },
    ],
  },
];
