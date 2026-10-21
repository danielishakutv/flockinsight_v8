import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for training.ts. Server-only; see start.quiz.ts. */
export const TRAINING_QUIZZES: GuideQuiz[] = [
  {
    slug: "training",
    questions: [
      {
        q: "You run Foundation Class in January, May and September. How is that set up?",
        options: [
          "Three courses, one per month",
          "One course with three classes",
          "One class with three courses",
          "One group with three cohorts of badges",
        ],
        answer: 1,
        section: 0,
        why: "A course is the teaching, set up once; a class is one running of it with its own dates and register.",
      },
      {
        q: "What decides a member's standing, the rank shown beside their name?",
        options: [
          "How many courses they have started, whether or not they have finished them yet",
          "The date they joined the church",
          "Their best score in any class",
          "Their highest completed course level",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "A class has no test: attending is passing. What do you do with the pass mark?",
        options: [
          "Set it to 0",
          "Leave it blank",
          "Set it to 100",
          "Set it to 50",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "What does Mark all complete do to people who withdrew or did not pass?",
        options: [
          "Completes them too",
          "Deletes them from the register",
          "Moves them into the next class of the same course, so they can try again",
          "Leaves them exactly as they are",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "Why will the app refuse to delete a class that has completed students?",
        options: [
          "Only support can delete classes",
          "Classes can never be deleted",
          "The class must be emptied of instructors first",
          "Deleting it would take their badges with it; set it to Completed or Cancelled instead",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "Somebody took Foundation twice. How many Foundation badges do they get?",
        options: [
          "Two",
          "One: one course is one badge",
          "None until a third",
          "It depends on their scores",
        ],
        answer: 1,
        section: "faq",
      },
    ],
  },
];
