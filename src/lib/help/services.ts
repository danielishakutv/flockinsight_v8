import type { Guide } from "./types";

export const SERVICE_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "services",
    title: "Setting up your services",
    category: "services",
    icon: "services",
    summary:
      "Define the gatherings your church actually holds. Everything about attendance and reminders hangs off this list.",
    whoFor: ["Whoever is setting the church up", "Anyone adding a new service"],
    sections: [
      {
        title: "What counts as a service",
        blocks: [
          {
            kind: "text",
            text: "Anything that happens on a repeating schedule and that you would want to count separately. If two Sunday services have different congregations, they are two services — combining them hides the fact that one is growing and the other shrinking.",
          },
          {
            kind: "example",
            title: "A typical Nigerian church's list",
            lines: [
              "Sunday First Service — Sunday, 07:00",
              "Sunday Second Service — Sunday, 09:30",
              "Midweek Service — Wednesday, 17:30",
              "Digging Deep — Tuesday, 17:30",
              "Vigil — Friday, 22:00",
            ],
          },
        ],
      },
      {
        title: "Add and manage them",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → Services → Add service",
                detail: "Name it, set the day of the week and the start time.",
              },
              {
                title: "Keep the names short and recognisable",
                detail:
                  "The name appears in every dropdown and on every report. 'First Service' beats 'Sunday Morning Worship Service (First)'.",
              },
              {
                title: "Retire rather than delete",
                detail:
                  "A service you no longer run can be switched off so it stops appearing in the recording screen. Its history stays in your reports.",
              },
            ],
          },
          {
            kind: "warning",
            text: "Deleting a service that already has attendance behind it loses the link between those records and the service. Switch it off instead — the numbers stay attached to something real.",
          },
        ],
      },
      {
        title: "One-off events don't need a service",
        blocks: [
          {
            kind: "text",
            text: "For a crusade, a convention or a special programme, don't create a service you will never use again. On the recording screen, skip the service and type an event name instead — 'Crusade', 'Vigil', 'Special Programme'. It is counted and kept like any other record.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can two services be on the same day?",
        a: "Yes, as many as you hold. Each keeps its own count for that date.",
      },
      {
        q: "We changed our service time. Do I make a new one?",
        a: "No — edit the existing one. The history stays with it, and the reminders start going out at the new time.",
      },
      {
        q: "Does the time have to be exact?",
        a: "It only matters for automatic service reminders, which are timed from it. If you don't use those, treat it as a label.",
      },
    ],
    links: [
      { label: "Services", href: "/settings/services" },
      { label: "Record attendance", href: "/attendance/record" },
    ],
    tip: "Set these up before importing anything. Attendance attaches to services, so adding them later means going back over records.",
    related: ["attendance", "reminders"],
    keywords: ["service", "sunday", "midweek", "schedule", "vigil"],
  },

  {
    slug: "attendance",
    title: "Recording attendance",
    category: "services",
    icon: "attendance",
    summary:
      "Count your Sunday in under a minute on a phone, split by adults, teens, children and first-timers.",
    whoFor: ["Ushering teams", "Whoever submits the Sunday numbers"],
    sections: [
      {
        title: "Record a service",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Tap Record",
                detail:
                  "The round button in the middle of the bottom bar on a phone, or the top right on a computer. It is deliberately the easiest thing to reach.",
              },
              {
                title: "Pick the service and the date",
                detail:
                  "It defaults to today. For a service you forgot to record, change the date and it files correctly in your history.",
              },
              {
                title: "Count into the boxes",
                detail:
                  "Big plus and minus buttons, made for thumbs while standing. You can also tap the number and type it if you already have a total from the ushers.",
              },
              {
                title: "Add a note if anything was unusual",
                detail:
                  "'Heavy rain', 'Combined service', 'Public holiday'. In six months this is what explains a dip nobody can otherwise account for.",
              },
              {
                title: "Save",
                detail:
                  "The total works itself out. Recording the same service and date again edits that record rather than creating a second one, so two ushers submitting cannot double your congregation.",
              },
            ],
          },
        ],
      },
      {
        title: "What you can count",
        blocks: [
          {
            kind: "table",
            headers: ["Group", "Split by gender?", "Counted in the total?"],
            rows: [
              ["Adults", "Male / Female", "Yes"],
              ["Teens", "Male / Female", "Yes"],
              ["Children", "Male / Female", "Yes"],
              ["First-timers", "Male / Female", "Included in the above"],
              ["New converts", "Male / Female", "Included in the above"],
            ],
          },
          {
            kind: "note",
            text: "First-timers and new converts are a description of people you have already counted, not extra people. Ten adults including two first-timers is a total of ten, not twelve.",
          },
          {
            kind: "text",
            text: "You do not have to fill everything in. A church that only ever counts one total number can put it in and ignore the rest — the breakdown is there when you want it, not a requirement.",
          },
        ],
      },
      {
        title: "Fixing and reviewing",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Attendance lists every record newest first. Open one to edit or delete it.",
              "Import brings in historical attendance from a spreadsheet, for churches with years of records already.",
              "Export downloads what you are looking at as a spreadsheet, or a PDF for a board meeting.",
            ],
          },
          {
            kind: "example",
            title: "Sunday morning at Grace Chapel",
            lines: [
              "The head usher counts during the second song: 84 men, 96 women, 31 teens, 44 children — of whom 6 are first-timers.",
              "He opens the app on his phone, taps Record, picks Sunday First Service, and thumbs the numbers in. Total 255.",
              "He notes '2 buses from the Ojota branch visiting'.",
              "By the time the sermon starts it is saved, and the pastor can see it from his own phone.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Two people recorded the same service. Are we double-counted?",
        a: "No. One service on one date is one record — the second person's numbers update the first rather than adding to them. Last save wins, so agree who submits.",
      },
      {
        q: "Can I record without internet?",
        a: "You need a connection to save. The app opens and shows what it already has when you're offline, but a new record has to reach the server.",
      },
      {
        q: "How do I record who specifically attended, not just how many?",
        a: "Individual check-in exists underneath, but the day-to-day flow is headcounts because that is what an usher can realistically do during a service.",
      },
      {
        q: "We forgot last Sunday. Can we still add it?",
        a: "Yes. Change the date when recording. There is no window that closes.",
      },
    ],
    links: [
      { label: "Attendance", href: "/attendance" },
      { label: "Record now", href: "/attendance/record" },
      { label: "Import history", href: "/attendance/import" },
    ],
    tip: "Give your head usher a login with attendance permission only. They record from their own phone and the numbers stop passing through three people.",
    related: ["services", "analytics", "team-roles"],
    keywords: ["attendance", "headcount", "count", "record", "usher", "sunday"],
  },

  {
    slug: "analytics",
    title: "Reading your analytics",
    category: "services",
    icon: "analytics",
    summary:
      "Turn the numbers you record into questions you can answer — is the church growing, and which service is carrying it?",
    whoFor: ["Pastors", "Anyone reporting to a board or a headquarters"],
    sections: [
      {
        title: "What the dashboard tells you",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Headline numbers for the current period, with the trend against the period before.",
              "An attendance chart over time — the shape matters more than any single Sunday.",
              "Birthdays and anniversaries coming up in the next fortnight.",
              "Anything outstanding that needs you.",
            ],
          },
        ],
      },
      {
        title: "What Analytics adds",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Attendance broken down by adults, teens and children, so you can see whether growth is families or singles.",
              "Male against female split.",
              "Service comparison — First Service against Second, midweek against Sunday.",
              "First-timers over time, which is the closest thing to a measure of whether outreach is working.",
            ],
          },
        ],
      },
      {
        title: "Questions worth asking of it",
        blocks: [
          {
            kind: "table",
            headers: ["Question", "Where to look"],
            rows: [
              [
                "Are we actually growing, or was last Sunday just good?",
                "The trend line over three months, not week to week",
              ],
              [
                "Which service should we invest in?",
                "Service comparison over a quarter",
              ],
              [
                "Are first-timers coming back?",
                "First-timer count against total growth — many visitors and flat attendance means they are not staying",
              ],
              [
                "Is our children's work keeping up?",
                "Children as a share of the total, over a year",
              ],
            ],
          },
          {
            kind: "note",
            text: "One low Sunday is weather, a holiday or a clash. Three low Sundays is a pattern. Resist reading anything into a single week.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "My charts are empty.",
        a: "There is nothing recorded yet, or nothing in the period selected. Charts are drawn from attendance records only.",
      },
      {
        q: "Can I get these numbers out for a report?",
        a: "Yes — Reports downloads any of it as a spreadsheet or a PDF.",
      },
      {
        q: "Who can see analytics?",
        a: "Anyone with the Analytics permission. It is worth restricting: attendance numbers are sensitive in most churches.",
      },
    ],
    links: [
      { label: "Analytics", href: "/analytics" },
      { label: "Reports", href: "/reports" },
    ],
    tip: "Look at the same chart on the first Monday of every month. A number checked regularly changes behaviour; a number checked once a year does not.",
    related: ["attendance", "reports", "branches"],
    keywords: ["analytics", "chart", "growth", "trend", "report", "statistics"],
  },
];
