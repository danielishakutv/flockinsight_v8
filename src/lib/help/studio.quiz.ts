import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for studio.ts. Server-only; see start.quiz.ts. */
export const STUDIO_QUIZZES: GuideQuiz[] = [
  {
    slug: "photo-studio",
    questions: [
      {
        q: "Where does the photo studio do its work?",
        options: [
          "On FlockInsight's servers, after each photo is uploaded and checked for size",
          "On your own phone or laptop; nothing is uploaded",
          "In the media library",
          "On Cloudinary",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "How many photos can you process in one batch?",
        options: [
          "10",
          "Up to 100",
          "500",
          "No limit",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "The logo looks tiny even at 30% size. What should you turn on?",
        options: [
          "Trim blank edges",
          "Remove background",
          "A line of text",
          "Original size",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "Which output size suits WhatsApp, Instagram and your website?",
        options: [
          "Print (3200px)",
          "Original size",
          "Social (1600px)",
          "Large (2400px)",
        ],
        answer: 2,
        section: 3,
      },
      {
        q: "When you save the settings as your church's brand, what is saved for the whole church?",
        options: [
          "The settings, but not the logo file itself",
          "The logo file and every processed photo",
          "Only the logo",
          "Nothing; settings are per device",
        ],
        answer: 0,
        section: 5,
      },
      {
        q: "What does processing a photo here remove that matters for privacy?",
        options: [
          "Faces",
          "The photo's colours",
          "The date it was taken from the filename",
          "The hidden location (GPS) data",
        ],
        answer: 3,
        section: 6,
      },
    ],
  },
];
