import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for people.ts. Server-only; see start.quiz.ts. */
export const PEOPLE_QUIZZES: GuideQuiz[] = [
  {
    slug: "members",
    questions: [
      {
        q: "What is the only field you must fill in to add a member?",
        options: [
          "Phone number",
          "Email address",
          "First name",
          "Date of birth",
        ],
        answer: 2,
        section: 0,
      },
      {
        q: "Your spreadsheet has no phone number for some people. What should those cells hold?",
        options: [
          "\"N/A\"",
          "Nothing: leave them blank, because a blank means unknown",
          "A zero",
          "The church office number, so that every member has a contact on file",
        ],
        answer: 1,
        section: 1,
        why: "\"N/A\" would be imported as somebody's actual phone number.",
      },
      {
        q: "Dates of birth in your file are written 23/04/1985. What happens on import?",
        options: [
          "They are converted automatically",
          "The whole import is refused",
          "They are imported as the joining date",
          "Dates it cannot read are left empty, so you get no birthdays at all",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "You import the same file twice by mistake. What happens?",
        options: [
          "The second import is skipped automatically",
          "The second import updates the first",
          "The app asks you to confirm each duplicate",
          "Everyone is created twice; there is no duplicate check on names",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "A guardian is deleted. What happens to their children's records?",
        options: [
          "They are deleted too",
          "They become inactive",
          "They are kept and simply lose the link",
          "They move to another household automatically",
        ],
        answer: 2,
        section: 3,
      },
      {
        q: "Somebody has left the church. What is the better choice, and why?",
        options: [
          "Delete them, to keep the totals honest",
          "Remove their phone number",
          "Mark them Inactive: their giving, attendance and class records stay intact",
          "Move them to a group called Former members",
        ],
        answer: 2,
        section: "faq",
      },
    ],
  },
  {
    slug: "groups",
    questions: [
      {
        q: "What difference does a group's type (Ministry, Cell, Committee...) make?",
        options: [
          "Only Ministries can be messaged",
          "None in behaviour: the type is only a label to help you find things",
          "Cells have no leaders",
          "Committees are hidden from members, and only a Ministry can be given leaders",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "How many leaders can a group have?",
        options: [
          "One",
          "Two: a head and an assistant",
          "Only staff with logins",
          "As many as it really has",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "The pastor wants to text only the five home cells. What does the guide suggest?",
        options: [
          "Pick those groups as the audience in Communication",
          "Send to the whole church and ask others to ignore it",
          "Export every member and filter in a spreadsheet",
          "Groups cannot be messaged",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "Someone is removed from a group. What happens to their member record?",
        options: [
          "It is deleted",
          "It is untouched; they are only removed from that group",
          "It is marked inactive",
          "It is moved to Follow-up",
        ],
        answer: 1,
        section: "faq",
      },
      {
        q: "Which belongs in Training rather than Groups?",
        options: [
          "The choir",
          "Something with a start, an end and a certificate, like a membership class",
          "A home cell",
          "The ushering department",
        ],
        answer: 1,
        section: "faq",
      },
    ],
  },
  {
    slug: "follow-up",
    questions: [
      {
        q: "Who appears in Follow-up without anybody adding them?",
        options: [
          "Everyone who gave this month, so that a thank-you call goes out",
          "Every member with a birthday this week",
          "Only people added by the pastor",
          "Anyone whose status is Visitor or New convert",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "Why assign each person on the list to someone?",
        options: [
          "Unassigned people get forgotten; assigning puts a name against them",
          "It is needed before any SMS or email can be sent to a person on the list",
          "It changes their member status",
          "It removes them from the list",
        ],
        answer: 0,
        section: 1,
      },
      {
        q: "What does the stage (New, Contacted, In progress...) tell you?",
        options: [
          "Who has genuinely been spoken to",
          "How much they have given",
          "Which service they attended",
          "Which group they will join",
        ],
        answer: 0,
        section: 1,
      },
      {
        q: "Where are the automatic welcome messages for first visitors set up?",
        options: [
          "Settings, First-timers",
          "Members, Import",
          "Settings, Celebrations",
          "They cannot be automated",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "A visitor from months ago was never called. Are they still on the list?",
        options: [
          "No, names drop off after 30 days",
          "Only if they visited again",
          "Only on the Growth plan",
          "Yes: nobody drops off by age, only when marked Joined or Not interested",
        ],
        answer: 3,
        section: "faq",
      },
    ],
  },
  {
    slug: "celebrations",
    questions: [
      {
        q: "Where does the Celebrations page get its dates from?",
        options: [
          "The dates on member profiles",
          "Each person's phone calendar",
          "A separate birthday list you upload each month",
          "Attendance records",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "A member would rather not give their birth year. Can a birthday still be recorded?",
        options: [
          "No, the year is required",
          "Only as a note",
          "Only if they are a child",
          "Yes: the day and month are what the reminder needs",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "What does SMS need that email does not?",
        options: [
          "Nothing; they work the same",
          "Money in your wallet and an approved sender ID",
          "A paid plan above Growth",
          "The member's permission in writing, uploaded to their profile first",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "Your wallet runs out in a month with many birthdays. What happens to automatic SMS?",
        options: [
          "It keeps sending and bills you later",
          "It switches to email automatically",
          "It pauses and emails every member",
          "It stops silently, so keep an eye on the balance",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "Nobody shows on the Celebrations page. What is almost always the cause?",
        options: [
          "The feature is not on your plan",
          "Your timezone is wrong",
          "Missing dates of birth",
          "Nobody has a phone number",
        ],
        answer: 2,
        section: "faq",
      },
    ],
  },
];
