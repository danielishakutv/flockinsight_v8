import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for account.ts. Server-only; see start.quiz.ts. */
export const ACCOUNT_QUIZZES: GuideQuiz[] = [
  {
    slug: "team-roles",
    questions: [
      {
        q: "Someone is already in your Members list and needs a login. What should you use?",
        options: [
          "Settings, Team, Invite with their email, which keeps the member you have and links the two records automatically",
          "Share your own password",
          "Grant app access on their profile, which turns the person you have into a login",
          "Re-import them",
        ],
        answer: 2,
        section: 1,
      },
      {
        q: "What is the difference between View and Manage on a role?",
        options: [
          "Manage lets someone read a section and export it; View lets them add and change, but never delete",
          "View lets someone open and read a section; Manage lets them add, change and delete",
          "Manage hides the section",
          "View is for owners only",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "A role cannot view Giving. What does that person see in their menu?",
        options: [
          "A locked Giving item with a padlock, which they can tap to ask the owner for access",
          "Nothing: the section disappears from their menu",
          "Giving, but every page is empty",
          "A request-access button",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "Someone opens a direct link to a page their role does not allow. What happens?",
        options: [
          "It is refused, because permissions are enforced on the server too",
          "The page opens because they had the link",
          "It opens read-only",
          "The owner is asked to approve",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "Someone leaves and is removed from Settings, Team. What happens to what they recorded?",
        options: [
          "It is deleted with them",
          "It is hidden until they return",
          "It moves to the owner's name",
          "It stays: it is the church's data",
        ],
        answer: 3,
        section: "faq",
      },
    ],
  },
  {
    slug: "branches",
    questions: [
      {
        q: "What can a headquarters see about a linked branch?",
        options: [
          "Roll-up totals per branch: attendance, membership and giving",
          "Every member record and every individual giving entry, so headquarters can correct them directly",
          "Individual giving entries",
          "The branch's messages",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "A headquarters sends a branch an invitation. When does anything change?",
        options: [
          "Immediately, and the branch is told afterwards by email so it can object",
          "Only once the branch accepts",
          "After 7 days",
          "When support approves it",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "Which column is usually the real reason to open the branch report?",
        options: [
          "The branch with the lowest numbers, which the report sorts to the top so it is the first one you read",
          "The red flag for branches that recorded nothing in the range",
          "The giving total",
          "The zone name",
        ],
        answer: 1,
        section: 3,
      },
      {
        q: "How can a zonal pastor be sent exactly their zone's numbers for this month?",
        options: [
          "Filters live in the page address, so send that bookmarked link",
          "Export a screenshot",
          "Give them the HQ owner login",
          "It cannot be done",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "Does the headquarters pay for its branches?",
        options: [
          "No: each branch has its own plan",
          "Yes, always",
          "Only for zones",
          "Only during the trial",
        ],
        answer: 0,
        section: "faq",
      },
    ],
  },
  {
    slug: "reports",
    questions: [
      {
        q: "Which format is always the complete data, ready for Excel?",
        options: [
          "PDF",
          "A screenshot",
          "CSV",
          "The dashboard",
        ],
        answer: 2,
        section: 1,
      },
      {
        q: "You set a date range. What happens to reference lists such as giving categories and groups?",
        options: [
          "They are filtered by creation date, so only the categories and groups made inside the range come out",
          "They come out in full, because the rows pointing at them need the whole list",
          "They are left out",
          "They are filtered by last edit",
        ],
        answer: 1,
        section: 2,
      },
      {
        q: "How should you join two exported files together?",
        options: [
          "On the name",
          "On the row number",
          "On the id, which never changes",
          "On the date",
        ],
        answer: 2,
        section: 3,
      },
      {
        q: "Can a full export be uploaded back to restore your church?",
        options: [
          "Yes, from Settings",
          "No: treat it as a record, not a restore point",
          "Only by support",
          "Only the members file",
        ],
        answer: 1,
        section: "faq",
      },
      {
        q: "Someone without giving access opens a direct link to a giving report. What happens?",
        options: [
          "It downloads",
          "It downloads without amounts",
          "They cannot download it",
          "It emails the owner",
        ],
        answer: 2,
        section: 0,
      },
    ],
  },
  {
    slug: "contact-support",
    questions: [
      {
        q: "Where do your support tickets and our replies stay?",
        options: [
          "Only in your email inbox",
          "On WhatsApp",
          "Nowhere; each reply is separate",
          "Under Help & Support, Contact us",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "Which ticket gets fixed on the first reply?",
        options: [
          "One that says what you tried, what happened, where, how often, on which device, with a screenshot",
          "\"SMS is not working.\"",
          "One marked URGENT in capitals and sent to every address you can find, so that somebody is sure to pick it up first",
          "One sent three times",
        ],
        answer: 0,
        section: 1,
      },
      {
        q: "Automatic messages stopped. What should you check first?",
        options: [
          "Your plan's member limit, because automatic messages pause for everyone once you pass it",
          "Your browser version",
          "Your wallet balance",
          "The church logo",
        ],
        answer: 2,
        section: 2,
      },
      {
        q: "Someone on your team cannot see a section. What should you check first?",
        options: [
          "Their phone number",
          "Your wallet",
          "The church timezone",
          "Their role, in Settings, Roles",
        ],
        answer: 3,
        section: 2,
      },
    ],
  },
];
