import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for contributions.ts. Server-only; see start.quiz.ts. */
export const CONTRIBUTION_QUIZZES: GuideQuiz[] = [
  {
    slug: "contributions",
    questions: [
      {
        q: "How is a group collection different from Giving?",
        options: [
          "It is the same thing with a different name",
          "It is only for tithes",
          "It is the church's own income, recorded in Finance under the group's name the moment anybody pays into it",
          "It is money a group is holding for its own purpose, outside the church's books until it is handed over",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "Who can start a collection for the choir?",
        options: [
          "Only a church administrator",
          "Only the pastor",
          "The person who leads that group",
          "Only someone with Finance permission",
        ],
        answer: 2,
        section: 1,
      },
      {
        q: "Somebody records their own payment on the public link. What happens to the total?",
        options: [
          "It goes up straight away",
          "It goes up at once, and the entry is flagged for the treasurer to review at the end of the month",
          "Nothing until you confirm it; it shows as awaiting confirmation",
          "The payment is rejected",
        ],
        answer: 2,
        section: 3,
      },
      {
        q: "For a bereavement collection, which link setting keeps names and amounts off the page while showing how much came in?",
        options: [
          "Everyone sees everything",
          "No public link",
          "Totals only",
          "Show who has not given yet",
        ],
        answer: 2,
        section: 4,
      },
      {
        q: "A member says she paid 5,000 but the record says 2,000. Who can settle the dispute?",
        options: [
          "The person who wrote the figure down, alone",
          "Two people must confirm it, and more must confirm than dispute",
          "Anyone with the link",
          "Only FlockInsight support",
        ],
        answer: 1,
        section: 7,
      },
      {
        q: "Which kind of money going out can be recorded in Finance?",
        options: [
          "Only \"Handed to the church\"",
          "Every kind",
          "Only refunds",
          "None of them",
        ],
        answer: 0,
        section: 8,
      },
      {
        q: "With every name hidden, what happens to \"Find my record\" on the page?",
        options: [
          "It still searches the real names",
          "It asks for a phone number",
          "It shows amounts only",
          "It disappears, because there is nothing left to search for",
        ],
        answer: 3,
        section: 6,
      },
    ],
  },
];
