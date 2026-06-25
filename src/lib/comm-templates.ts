// Message templates for the Communication module. Placeholders {name} and
// {church} are filled in when sending. Safe to import on the client.

export type CommTemplate = {
  id: string;
  name: string;
  channel: "sms" | "email" | "both";
  subject?: string; // email
  body: string;
};

export const COMM_TEMPLATES: CommTemplate[] = [
  {
    id: "service-reminder",
    name: "Service reminder",
    channel: "both",
    subject: "Don't miss this week's service",
    body: "Hi {name}, this is a reminder that {church} has service this week. We can't wait to worship with you! God bless you.",
  },
  {
    id: "welcome",
    name: "Welcome first-timer",
    channel: "both",
    subject: "Welcome to {church}!",
    body: "Hi {name}, thank you for visiting {church}. We're so glad you came! We'd love to see you again. Please reach out if you have any questions.",
  },
  {
    id: "thank-you-giving",
    name: "Thank you for giving",
    channel: "both",
    subject: "Thank you for your generosity",
    body: "Dear {name}, thank you for your faithful giving to {church}. Your generosity helps advance the work of God. The Lord bless you and replenish you.",
  },
  {
    id: "birthday",
    name: "Happy birthday",
    channel: "both",
    subject: "Happy birthday from {church}! 🎉",
    body: "Happy birthday, {name}! 🎉 Everyone at {church} celebrates you today. May this new year be filled with God's favour and blessings.",
  },
  {
    id: "event",
    name: "Event / programme invite",
    channel: "both",
    subject: "You're invited — upcoming programme at {church}",
    body: "Hi {name}, {church} has a special programme coming up. Come and be blessed — bring a friend along! See you there.",
  },
  {
    id: "follow-up",
    name: "We missed you",
    channel: "both",
    subject: "We missed you at {church}",
    body: "Hi {name}, we missed you at {church} recently and you've been on our hearts. Is everything okay? We'd love to check in and pray with you.",
  },
  {
    id: "announcement",
    name: "General announcement",
    channel: "both",
    subject: "An update from {church}",
    body: "Dear {name}, we have an important announcement from {church}: ",
  },
  {
    id: "blank",
    name: "Blank message",
    channel: "both",
    subject: "",
    body: "",
  },
];
