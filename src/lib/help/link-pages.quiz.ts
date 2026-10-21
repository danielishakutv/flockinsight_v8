import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for link-pages.ts. Server-only; see start.quiz.ts. */
export const LINK_PAGE_QUIZZES: GuideQuiz[] = [
  {
    slug: "link-pages",
    questions: [
      {
        q: "What problem does a link page solve?",
        options: [
          "It shortens one long address",
          "It sends SMS to your followers",
          "It replaces your public church page with a shorter one that search engines rank above your own website",
          "It holds all your links behind one address that never changes, so the bio never needs editing",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "Before you press Publish, what does the address show?",
        options: [
          "A \"coming soon\" page",
          "Nothing at all",
          "The draft as it stands",
          "Your public church page",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "Your form is still a draft. Will it appear in \"Add one of our pages\"?",
        options: [
          "Yes, marked as a draft, so that visitors can see what is coming next",
          "Only for owners",
          "No: only things that are actually live appear",
          "Yes, after a day",
        ],
        answer: 2,
        section: 2,
      },
      {
        q: "Where do a link page's colours come from?",
        options: [
          "A colour picker on each page",
          "The first link's image",
          "They are always black and white",
          "Your church theme in Settings; a style only arranges them",
        ],
        answer: 3,
        section: 3,
      },
      {
        q: "The carol form is full but you want it back next year. What should you do on the page?",
        options: [
          "Delete the link",
          "Switch it off with the toggle beside it, which hides it without deleting",
          "Take the whole page down",
          "Change the page address",
        ],
        answer: 1,
        section: 4,
      },
      {
        q: "You delete a link page. What happens to its address?",
        options: [
          "Your church keeps it for ever",
          "It redirects to your public page",
          "It stops working, and the word becomes free for anyone to take",
          "It keeps showing the old links",
        ],
        answer: 2,
        section: "faq",
      },
    ],
  },
];
