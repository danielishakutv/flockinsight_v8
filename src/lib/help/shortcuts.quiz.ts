import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for shortcuts.ts. Server-only; see start.quiz.ts. */
export const SHORTCUT_QUIZZES: GuideQuiz[] = [
  {
    slug: "keyboard-shortcuts",
    questions: [
      {
        q: "You want the page where service times are changed. What is the quickest way on a computer?",
        options: [
          "Press S three times",
          "Press Ctrl and K together, type a few letters such as \"serv\", and press Enter",
          "Right-click anywhere and choose Settings",
          "There is no shortcut for it; open Settings from the menu and click through to Services each time",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "How do you use a \"go\" shortcut such as G then M?",
        options: [
          "Press G, let go, then press M within about a second and a half",
          "Hold G and M down together for about a second and a half, until the page changes",
          "Press Ctrl, G and M together",
          "Type \"gm\" into the search box",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "You press N then M while the cursor is in a name box. What happens?",
        options: [
          "The Add member form opens",
          "The letters go into the box; while you are typing, the keys belong to the field",
          "Members opens and the box is cleared",
          "The app asks which one you meant",
        ],
        answer: 1,
        section: 8,
      },
      {
        q: "A volunteer's role cannot add members. What does N then M do for them?",
        options: [
          "It opens the form and lets them fill it in, then refuses to save it with a permissions error",
          "It adds the member and flags it for review",
          "It asks an admin for approval",
          "Nothing: a shortcut can never do something your role is not allowed to do",
        ],
        answer: 3,
        section: 3,
      },
      {
        q: "Inside a box where you are writing a devotional, what does Ctrl B do?",
        options: [
          "Narrows the menu",
          "Makes the word bold, and leaves the menu where it is",
          "Opens the bookings page",
          "Nothing at all",
        ],
        answer: 1,
        section: 8,
      },
      {
        q: "How do the shortcut tips stop appearing?",
        options: [
          "They never stop unless support switches them off",
          "After six in total, or straight away with \"No more tips\"; Settings, General can turn them back on",
          "Only by uninstalling the app",
          "They stop when your trial ends",
        ],
        answer: 1,
        section: 9,
      },
    ],
  },
];
