import type { Guide } from "./types";

export const START_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "getting-started",
    title: "Getting started with FlockInsight",
    category: "start",
    icon: "sparkles",
    summary:
      "Set your church up properly in about half an hour, in the order that avoids rework later.",
    whoFor: [
      "The person setting the church up for the first time",
      "Anyone who signed up, looked around, and wasn't sure what to do first",
    ],
    sections: [
      {
        title: "Do these four things first",
        blocks: [
          {
            kind: "text",
            text: "The order matters. Services and giving categories are what attendance and giving records attach themselves to, so setting them up before you import anything saves you re-entering work.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "Set your church details — Settings → General",
                detail:
                  "Name, country, state, timezone and currency. Timezone decides when reminders go out and what date a Sunday record lands on, so a wrong one quietly puts your Sunday attendance on Saturday. Currency cannot be meaningfully changed once you have giving records, so get it right now.",
              },
              {
                title: "Add your services — Settings → Services",
                detail:
                  "One entry per regular gathering: Sunday First Service, Sunday Second Service, Midweek, Vigil. These become the options when you record attendance, and they drive automatic service reminders.",
              },
              {
                title: "Add your giving categories — Settings → Giving",
                detail:
                  "Tithe, Offering, Building Project, Welfare, Thanksgiving — whatever your church actually counts separately. Every gift is filed under one of these, and your reports break down by them.",
              },
              {
                title: "Bring your people in — Members → Import",
                detail:
                  "Upload a spreadsheet rather than typing. See the Members guide for the exact columns. If you only have names and phone numbers, that is enough to start.",
              },
            ],
          },
        ],
      },
      {
        title: "Then record your first Sunday",
        blocks: [
          {
            kind: "text",
            text: "From the dashboard, tap the big Record button in the middle of the bottom bar (on a phone) or the top right (on a computer). Pick the service and the date, count your heads into the boxes, and save. That single record is enough to start your attendance chart.",
          },
          {
            kind: "note",
            text: "You do not need every member in the system to record attendance. Headcounts work from day one; matching individual people to those counts can come later.",
          },
        ],
      },
      {
        title: "How the pieces fit together",
        blocks: [
          {
            kind: "table",
            headers: ["When you want to…", "Go to"],
            rows: [
              ["Count who came on Sunday", "Attendance"],
              ["Keep a directory of your congregation", "Members"],
              ["Organise people into choirs, ushers, cells", "Groups"],
              ["Track membership and leadership classes", "Training"],
              ["Record offerings and tithes", "Giving"],
              ["Keep the church's books — income and expenses", "Finance"],
              ["Chase up first-timers", "Follow-up"],
              ["Send an SMS or email to everyone", "Communication"],
              ["Collect sign-ups with a shareable link", "Forms"],
              ["Download any of it as a spreadsheet", "Reports"],
            ],
          },
          {
            kind: "text",
            text: "Members is the centre of it. Almost everything else points back at a member record, which is why it is worth getting your directory in before the rest.",
          },
        ],
      },
      {
        title: "Bring your team in",
        blocks: [
          {
            kind: "text",
            text: "You should not be the only person who can use this. Settings → Team invites someone by email; Settings → Roles controls what each of them can see.",
          },
          {
            kind: "example",
            title: "A realistic set of roles for a mid-sized church",
            lines: [
              "Pastor — everything.",
              "Church secretary — Members, Attendance, Groups, Communication. No Finance, no Giving.",
              "Treasurer — Giving and Finance only. Cannot see the member directory.",
              "Ushering head — Attendance only, so they can record headcounts on a Sunday and nothing else.",
            ],
          },
          {
            kind: "note",
            text: "Someone already in your Members list can be given a login without being typed in twice — open their profile and use Grant app access.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Do I have to finish everything before I can use it?",
        a: "No. Services and a few members are enough to start recording attendance the same day. Giving, Finance, Forms and the rest can wait until you need them.",
      },
      {
        q: "Can I change the currency later?",
        a: "You can change the setting, but existing giving and finance records keep the amounts you already typed — they are not converted. Set it correctly before you record money.",
      },
      {
        q: "What happens when the free trial ends?",
        a: "Your data stays exactly as it is. You are asked to pick a plan before you can carry on adding to it. Nothing is deleted.",
      },
      {
        q: "Does it work on a phone?",
        a: "Yes, and it is built phone-first — recording attendance on a Sunday is meant to be done standing up. You can also install it to your home screen so it opens like an app.",
      },
    ],
    links: [
      { label: "General settings", href: "/settings" },
      { label: "Add services", href: "/settings/services" },
      { label: "Giving categories", href: "/settings/giving" },
      { label: "Import members", href: "/members/import" },
    ],
    tip: "Set the timezone before anything else. It is the one setting that quietly corrupts dates on every record you make afterwards.",
    related: ["members", "attendance", "team-roles"],
    keywords: ["setup", "begin", "start", "onboarding", "first", "new"],
  },
];
