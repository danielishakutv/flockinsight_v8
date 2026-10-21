import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for comms.ts. Server-only; see start.quiz.ts. */
export const COMMS_QUIZZES: GuideQuiz[] = [
  {
    slug: "communication",
    questions: [
      {
        q: "A message is only for your workers, not the congregation. Which channel costs nothing and stays inside the app?",
        options: [
          "SMS",
          "A public form shared with the whole congregation",
          "A sender ID",
          "A staff notice",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "You send a 200-character SMS to 400 members. How many charges is that?",
        options: [
          "400",
          "200",
          "800: two pages each",
          "One flat charge for the whole send, whatever its length",
        ],
        answer: 2,
        section: 1,
        why: "An SMS is charged per page per person; under 160 characters stays one page.",
      },
      {
        q: "What does {name} do in a template?",
        options: [
          "Inserts the sender's name",
          "Gives each person their own copy with their own name",
          "Inserts the church's name, as it is set in Settings, at the top of every message",
          "Nothing; it is printed as typed",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "Where do you find out that 30 numbers failed because they were typed wrong?",
        options: [
          "Settings, Wallet",
          "Members, Import",
          "You cannot find out",
          "Communication, History",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "Does each recipient see who else received the message?",
        options: [
          "Yes, everyone on the list",
          "Only for email",
          "No: each person gets their own message",
          "Only staff see the list",
        ],
        answer: 2,
        section: "faq",
      },
    ],
  },
  {
    slug: "sms-sender-id",
    questions: [
      {
        q: "What is a sender ID?",
        options: [
          "Your church's bank account reference",
          "The name members see when your text arrives",
          "The password your church uses to sign in to its SMS account with the network",
          "A member's phone number",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "Which of these could be a valid sender ID?",
        options: [
          "\"GraceChapelIkejaMain\" (20 letters)",
          "\"GC!\" with a symbol",
          "\"GraceChapel\" (11 letters)",
          "Any name another church already uses",
        ],
        answer: 2,
        section: 0,
      },
      {
        q: "What do you need before a single SMS will send?",
        options: [
          "Only an approved sender ID",
          "Only money in the wallet",
          "A Growth plan",
          "An approved sender ID and money in the wallet",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "Your sender ID is rejected. What now?",
        options: [
          "You must wait a month to try again",
          "Contact the network yourself",
          "SMS is closed to your church",
          "Change it and submit again; there is no penalty",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "Can you send SMS while you wait for approval?",
        options: [
          "Yes, from a random number",
          "Yes, but only to staff",
          "Only with a top-up over a set amount",
          "No: use email in the meantime",
        ],
        answer: 3,
        section: "faq",
      },
    ],
  },
  {
    slug: "reminders",
    questions: [
      {
        q: "You switch on reminders but a service is never reminded about. What is a likely cause?",
        options: [
          "The service has too many members",
          "The service has no day or time set",
          "Reminders only work for Sunday",
          "Email is turned off for the church",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "What does {service} become in a reminder?",
        options: [
          "The member's name",
          "The church's name",
          "The start time of the next service, in the member's own timezone",
          "The service being reminded about",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "What should you think about before choosing SMS for a weekly reminder?",
        options: [
          "Nothing; it is included in your plan",
          "It only reaches active members",
          "It costs from the wallet every week for every member, so work out the monthly cost",
          "It requires every member to opt in",
        ],
        answer: 2,
        section: 0,
      },
      {
        q: "One member does not want reminders. What can you do?",
        options: [
          "Untick a per-member switch",
          "Remove their phone number or email, or set them inactive if they have left",
          "Block them in Settings, SMS",
          "Nothing at all",
        ],
        answer: 1,
        section: "faq",
      },
    ],
  },
];
