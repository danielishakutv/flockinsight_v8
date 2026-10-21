import "server-only";
import type { GuideQuiz } from "@/lib/certification-shared";

/* The answer key for publicpage.ts. Server-only; see start.quiz.ts. */
export const PUBLIC_QUIZZES: GuideQuiz[] = [
  {
    slug: "public-page",
    questions: [
      {
        q: "Where do the service times on your public page come from?",
        options: [
          "Settings, Services, automatically",
          "You type them on the page each week",
          "Your last attendance record",
          "The events directory",
        ],
        answer: 0,
        section: 0,
      },
      {
        q: "What does the guide say matters most for directions in most Nigerian cities?",
        options: [
          "The postcode, which every courier and taxi driver in the city works from",
          "Landmarks, such as \"Opposite the GTB on Allen Avenue\"",
          "GPS coordinates only",
          "The church's registration number",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "Someone who is not a member signs up for the newsletter on your page. Where do they land?",
        options: [
          "In Members as a visitor",
          "In Follow-up",
          "In Devotionals, Subscribers",
          "Nowhere; only members can sign up",
        ],
        answer: 2,
        section: 3,
      },
      {
        q: "You change your page's link name after printing flyers. What happens?",
        options: [
          "The old link redirects for ever",
          "Anything printed with the old one stops working",
          "Nothing; links never change",
          "The flyers update themselves",
        ],
        answer: 1,
        section: "faq",
      },
      {
        q: "Do you need to buy a domain name?",
        options: [
          "Yes, before the page goes live",
          "Only on the Growth plan",
          "Only outside Nigeria",
          "No: the flockinsight.com/c/ address works immediately and costs nothing",
        ],
        answer: 3,
        section: "faq",
      },
    ],
  },
  {
    slug: "verification",
    questions: [
      {
        q: "What does verifying your church's email and phone earn?",
        options: [
          "A discount on your plan for as long as both stay verified",
          "A blue tick beside your church's name",
          "Free SMS",
          "More storage",
        ],
        answer: 1,
        section: 0,
      },
      {
        q: "Does the verification SMS code cost you anything?",
        options: [
          "Yes: one SMS page from your wallet, at the same rate as any message you send",
          "No: it comes from FlockInsight and does not touch your wallet",
          "It needs your own sender ID approved first",
          "Only outside Nigeria",
        ],
        answer: 1,
        section: 1,
      },
      {
        q: "How long does a verification code last?",
        options: [
          "10 minutes",
          "1 minute",
          "24 hours",
          "Until used",
        ],
        answer: 0,
        section: 1,
      },
      {
        q: "You change the verified phone number. What happens to its tick?",
        options: [
          "It is cleared until the new number is confirmed",
          "It stays",
          "It moves to the email",
          "The church is suspended",
        ],
        answer: 0,
        section: 2,
      },
      {
        q: "Which contact is seen only by FlockInsight, for account matters?",
        options: [
          "The public contact on your page",
          "Each person's login email",
          "The account contact in Settings, Verification",
          "The newsletter address",
        ],
        answer: 2,
        section: 3,
      },
    ],
  },
];
