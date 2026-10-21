import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for money.ts. Server-only; see start.quiz.ts. */
export const MONEY_QUIZZES: GuideQuiz[] = [
  {
    slug: "giving",
    questions: [
      {
        q: "How many categories is each gift filed under?",
        options: [
          "As many as apply",
          "None until month end",
          "Exactly one",
          "Two: one for Giving and one for Finance",
        ],
        answer: 2,
        section: 0,
      },
      {
        q: "How do most churches record an ordinary Sunday offering?",
        options: [
          "One line per envelope",
          "As one lump with the giver left blank, naming only those who want theirs recorded",
          "Only as a note on the attendance record",
          "Once a month, as a total",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "Why be consistent about the payment method (cash, transfer, card...)?",
        options: [
          "It decides the category",
          "It is how you reconcile against your bank",
          "It changes the receipt colour",
          "It is required for anonymous gifts",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "On a building project, which gap is the useful one to watch?",
        options: [
          "Between this month and last month",
          "Between pledged and actually paid",
          "Between tithe and offering",
          "Between members and visitors",
        ],
        answer: 1,
        section: 3,
      },
      {
        q: "A member finishes paying their pledge. What happens to their reminders?",
        options: [
          "They stop automatically",
          "They continue until the project closes",
          "They switch to email",
          "An admin must remove them by hand",
        ],
        answer: 0,
        section: 3,
      },
      {
        q: "Someone gave in dollars. How is it recorded?",
        options: [
          "In your church's single currency: convert it and note the original amount and rate",
          "In dollars, alongside your currency",
          "It cannot be recorded",
          "As a pledge",
        ],
        answer: 0,
        section: "faq",
      },
    ],
  },
  {
    slug: "finance",
    questions: [
      {
        q: "What question does Finance answer that Giving does not?",
        options: [
          "Who gave the most this year",
          "Who has pledged to the building fund, and how much each person still owes on it",
          "What the church has, and where the money went",
          "Which members are tithing",
        ],
        answer: 2,
        section: 0,
      },
      {
        q: "Your church starts using FlockInsight in July. What should each account's opening balance be?",
        options: [
          "Zero, always",
          "What it held on the day you started",
          "Last year's closing total, carried forward from your old ledger in January",
          "Leave it blank",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "You move money between two of your own accounts as a transfer. How does it affect income and expense totals?",
        options: [
          "It counts as both income and an expense",
          "It counts as income only",
          "It is left out of them; only the balances change",
          "It is counted as giving",
        ],
        answer: 2,
        section: 2,
      },
      {
        q: "The Building Project giving category is linked to a fund account. What happens to a building-fund gift recorded in Giving?",
        options: [
          "You must also type it into Finance",
          "It is added to the fund account as income automatically",
          "It is held as pending until the treasurer approves it and moves it across to the fund",
          "It moves to the general account",
        ],
        answer: 1,
        section: 3,
      },
      {
        q: "Why can nothing be paid into a fund account by hand?",
        options: [
          "Because fund accounts are read-only",
          "Because only owners can add money",
          "It is a temporary limitation",
          "So its balance always reflects what was genuinely given",
        ],
        answer: 3,
        section: 3,
      },
      {
        q: "Can you delete an account that has transactions against it?",
        options: [
          "No: you are offered to close it instead, so the books stay whole",
          "Yes, and its transactions go with it",
          "Yes, after a confirmation",
          "Only support can",
        ],
        answer: 0,
        section: "faq",
      },
    ],
  },
  {
    slug: "wallet-storage",
    questions: [
      {
        q: "Which of these is paid from the wallet?",
        options: [
          "Your monthly plan",
          "Email newsletters and devotionals, charged per hundred subscribers",
          "Adding members",
          "Every SMS you send, including automatic ones",
        ],
        answer: 3,
        section: 0,
      },
      {
        q: "Your payment succeeded at the bank but the balance has not moved after a few minutes. What should you do?",
        options: [
          "Pay again",
          "Contact support with the reference rather than paying again",
          "Pay again with a different card, since the first payment will be refunded on its own",
          "Wait a month",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "What fills storage fastest?",
        options: [
          "Photos",
          "Documents",
          "Member records",
          "Video",
        ],
        answer: 3,
        section: 2,
      },
      {
        q: "The wallet reaches zero. What happens to automatic birthday SMS?",
        options: [
          "They stop quietly, with no error in front of anyone",
          "They keep sending and the balance goes negative",
          "They are converted to email",
          "Every admin gets an error popup",
        ],
        answer: 0,
        section: 3,
      },
      {
        q: "Does the wallet pay your subscription?",
        options: [
          "Yes, automatically",
          "Only for yearly plans",
          "Only during the trial",
          "No, they are separate; the subscription is in Settings, Plan & billing",
        ],
        answer: 3,
        section: "faq",
      },
    ],
  },
  {
    slug: "billing",
    questions: [
      {
        q: "How long is the free trial for a new church?",
        options: [
          "Its first seven Sundays",
          "7 days",
          "One calendar month from the day you sign up",
          "One year",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "The trial ends and you have not picked a plan. What happens to your data?",
        options: [
          "It is deleted after 30 days",
          "It is kept exactly as it was; you choose a plan to carry on adding",
          "It is exported and emailed to you",
          "It becomes read-only for everyone except support",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "When does a downgrade take effect?",
        options: [
          "Immediately, and the unused part of the month is refunded to your wallet",
          "After 7 days",
          "When support approves it",
          "At renewal, so you keep what you paid for until then",
        ],
        answer: 3,
        section: 1,
      },
      {
        q: "An import would take you past your member limit. What happens?",
        options: [
          "It tells you it would exceed the limit and adds nobody",
          "It adds members up to the limit and stops",
          "It adds everyone and bills you extra",
          "It adds everyone as inactive",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "Do children count towards your member limit?",
        options: [
          "No",
          "Yes, a child is a full member",
          "Only over 12",
          "Only if they have a phone number",
        ],
        answer: 1,
        section: "faq",
      },
    ],
  },
];
