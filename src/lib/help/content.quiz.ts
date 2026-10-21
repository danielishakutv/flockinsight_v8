import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for content.ts. Server-only; see start.quiz.ts. */
export const CONTENT_QUIZZES: GuideQuiz[] = [
  {
    slug: "media",
    questions: [
      {
        q: "A large sermon is uploading. Can you keep working?",
        options: [
          "Yes: it uploads in the background while you use the rest of the app",
          "No: leaving the upload page cancels it, so you must stay on that page until it has finished",
          "Only on a computer",
          "Only if it is audio",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "How much free storage does every church get?",
        options: [
          "50MB",
          "200MB",
          "1GB",
          "Unlimited",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "You record your services on video. What does the guide suggest?",
        options: [
          "Upload every video here in full",
          "Convert the videos to photos",
          "Stop recording",
          "Put the video on YouTube and keep only the audio here",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "Who can open a shared media link?",
        options: [
          "Anyone with the link, so keep confidential things out of the library",
          "Only signed-in staff of your church; everyone else is sent to the sign-in page first",
          "Only members",
          "Nobody outside the app",
        ],
        answer: 0,
        section: "faq",
      },
      {
        q: "You delete a file whose link was shared last month. What happens to that link?",
        options: [
          "It breaks: anyone with the old link gets nothing",
          "It keeps working for 30 days",
          "It redirects to the library",
          "It shows a copy",
        ],
        answer: 0,
        section: "faq",
      },
    ],
  },
  {
    slug: "forms",
    questions: [
      {
        q: "What does somebody need to fill in a live form?",
        options: [
          "A free FlockInsight account, created in a minute on the form itself",
          "The app installed",
          "A member number",
          "Nothing: no account, no app, no login",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "When does a new form start collecting answers?",
        options: [
          "As soon as it is saved",
          "When you set it Live",
          "When the first question is added",
          "When a QR code is printed",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "A first-timer card has \"match or create a member\" on. The phone number matches an existing member. What happens?",
        options: [
          "A duplicate member is created",
          "The response is rejected",
          "It waits in a review queue until an admin decides which record it belongs to",
          "The response links to the existing member",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "Must a feedback survey create member records?",
        options: [
          "Yes, every form does",
          "No: each automation is a switch per form",
          "Only if it has a phone question",
          "Only on the Growth plan",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "Can a form be limited to members only?",
        options: [
          "No: a form link is public by design, so ask for a name and phone if you need to know who answered",
          "Yes, with a switch",
          "Only for staff",
          "Only by sending it by SMS",
        ],
        answer: 0,
        section: "faq",
      },
    ],
  },
  {
    slug: "devotionals",
    questions: [
      {
        q: "Who are subscribers?",
        options: [
          "Only staff with logins",
          "Every member on your register, added automatically when their record is created",
          "People who paid for a plan",
          "People who signed up on your public page, members or not",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "What does sending a devotional cost?",
        options: [
          "One SMS page per person",
          "A monthly add-on",
          "Nothing: it is email, free and unlimited",
          "It depends on the length: one SMS page for every 160 characters, per person",
        ],
        answer: 2,
        section: 0,
      },
      {
        q: "What makes a daily devotional realistic to keep up?",
        options: [
          "Writing each one the morning it goes out",
          "Scheduling ahead, with a buffer written before you launch",
          "Sending by SMS",
          "Only sending on Sundays",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "Someone wants to unsubscribe. What happens?",
        options: [
          "You must remove them by hand every time",
          "They must contact support",
          "Every email has an unsubscribe link and they are removed automatically",
          "They cannot unsubscribe",
        ],
        answer: 2,
        section: "faq",
      },
    ],
  },
  {
    slug: "events",
    questions: [
      {
        q: "Where does a public event appear?",
        options: [
          "Only inside the app, on the calendar your staff see once they have signed in",
          "On your public page and in the FlockInsight events directory",
          "Only in SMS messages",
          "On every member's profile",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "A convention needs registration. What does the guide suggest?",
        options: [
          "Ask people to reply by SMS",
          "Make a group for it",
          "Build a form and put its link in the event description",
          "Events have built-in tickets",
        ],
        answer: 2,
        section: 1,
      },
      {
        q: "A workers' meeting should not be seen outside the church. What do you do?",
        options: [
          "Do not mark it public",
          "Delete it after the meeting",
          "Leave the flyer off",
          "Events are always public",
        ],
        answer: 0,
        section: "faq",
      },
      {
        q: "What size should the event flyer be?",
        options: [
          "Whatever your designer produced; it is resized automatically",
          "Exactly 1080 by 1080 pixels",
          "Under 100KB",
          "Landscape only",
        ],
        answer: 0,
        section: "faq",
      },
    ],
  },
];
