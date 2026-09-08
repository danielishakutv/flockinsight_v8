import type { Guide } from "./types";

export const ACCOUNT_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "team-roles",
    title: "Your team & what each person can see",
    category: "account",
    icon: "team",
    summary:
      "Give people logins, and control exactly what each one can open — so the ushering head cannot read the giving records.",
    whoFor: ["Church owners and administrators"],
    sections: [
      {
        title: "Why this matters more than it sounds",
        blocks: [
          {
            kind: "text",
            text: "The instinct is to give everybody full access because it is simpler. In a church it is the wrong instinct: giving records, member phone numbers and home addresses are exactly the things that cause trouble when they travel. Roles take five minutes to set up and settle the question permanently.",
          },
        ],
      },
      {
        title: "Invite someone",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → Team → Invite",
                detail:
                  "Enter their email address. They get a link that lets them join your church and set their own password.",
              },
              {
                title: "Give them a role",
                detail:
                  "Assign it when you invite, or afterwards on the Team tab.",
              },
            ],
          },
          {
            kind: "note",
            text: "If the person is already in your Members list, open their profile and use Grant app access instead. It turns the person you already have into a login, rather than creating a second record of the same human being. Revoking it later removes the login and keeps the member.",
          },
        ],
      },
      {
        title: "Build your roles",
        blocks: [
          {
            kind: "text",
            text: "Settings → Roles. A role is a named set of ticks — View and Manage for each part of the app. Create the roles your church actually has, not the ones a manual suggests.",
          },
          {
            kind: "table",
            headers: ["Role", "Typically gets", "Deliberately not"],
            rows: [
              ["Pastor", "Everything", "—"],
              [
                "Church secretary",
                "Members, Attendance, Groups, Communication, Training",
                "Giving, Finance",
              ],
              ["Treasurer", "Giving, Finance", "Members, Communication"],
              ["Ushering head", "Attendance manage", "Everything else"],
              ["Follow-up lead", "Follow-up, Members view, Communication", "Giving, Finance, Settings"],
              ["Class secretary", "Training manage, Members view", "Everything else"],
              ["Media team", "Media, Events, Public page", "Members, money"],
            ],
          },
          {
            kind: "bullets",
            items: [
              "View lets someone open and read a section. Manage lets them add, change and delete in it.",
              "A section a role cannot view disappears from that person's menu entirely — they do not see a locked door, they see nothing.",
              "It is enforced on the server too, so a direct link to a page someone lacks permission for still refuses them.",
              "The Owner always has everything and cannot be locked out.",
            ],
          },
        ],
      },
      {
        title: "A sensible starting point",
        blocks: [
          {
            kind: "example",
            title: "Grace Chapel's four roles",
            lines: [
              "Pastor — full access. Two people have it.",
              "Admin — everything except Finance. The church secretary.",
              "Finance — Giving and Finance only. The treasurer and one assistant.",
              "Worker — Attendance manage, Members view, Follow-up manage. Nine people, including the ushering and welcome heads.",
              "Nobody had to be talked out of anything, because nobody ever saw what they were not given.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Someone left the church. What do I do?",
        a: "Remove them from Settings → Team. Their login stops working immediately. Anything they recorded stays — it is the church's data, not theirs.",
      },
      {
        q: "Can one person have two roles?",
        a: "One role each. If somebody genuinely needs a combination nobody else has, make a role for it.",
      },
      {
        q: "Can I see who changed something?",
        a: "Records show who recorded them. For a full trail of everything, ask support.",
      },
      {
        q: "The invitation email never arrived.",
        a: "Check spam first. If it is genuinely missing, send it again — and confirm the address is spelled correctly.",
      },
    ],
    links: [
      { label: "Team", href: "/settings/team" },
      { label: "Roles", href: "/settings/roles" },
      { label: "Members", href: "/members" },
    ],
    tip: "Make sure at least two people have full access. One person with the only login is one lost phone away from a locked-out church.",
    related: ["members", "training", "finance"],
    keywords: ["team", "staff", "role", "permission", "invite", "access", "login", "security"],
  },

  {
    slug: "branches",
    title: "Running several churches (branches)",
    category: "account",
    icon: "network",
    summary:
      "Link your branches to a headquarters and see one report across all of them — without any branch losing control of its own records.",
    whoFor: [
      "Denominations, dioceses and church groups",
      "Any church with more than one location",
    ],
    sections: [
      {
        title: "What linking does, and what it does not",
        blocks: [
          {
            kind: "text",
            text: "Every branch stays a normal, separate church: its own members, attendance, giving, team and plan. Nothing is shared automatically.",
          },
          {
            kind: "text",
            text: "Linking does exactly one thing — it lets the headquarters see roll-up numbers per branch: attendance, membership and giving totals. The headquarters never sees a branch's member records, individual giving entries or messages.",
          },
          {
            kind: "note",
            text: "Either side can leave the network at any time from the Branches page. This is what makes it safe for a branch to agree to.",
          },
        ],
      },
      {
        title: "Add a branch",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Make sure the branch has its own account",
                detail:
                  "Each branch signs up for FlockInsight itself. If they have not yet, ask them to before you try to link.",
              },
              {
                title: "From the headquarters, go to Branches → Add a branch",
                detail: "Search for the church by name, add a short note, and send the invitation.",
              },
              {
                title: "The branch accepts",
                detail:
                  "They see it on their own Branches page and accept or decline. Nothing changes until they accept — a headquarters can never help itself to another church's data.",
              },
            ],
          },
        ],
      },
      {
        title: "Zones, states and cities",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Group branches into zones — North Zone, Lagos Region, a province or a district, whatever you call them. Tick branches in the table, type the zone name, set it.",
              "Filter the dashboard by zone, state, city and country, plus a date range.",
              "Filters live in the page address, so you can bookmark one zone's numbers for this month, or send that exact view to a zonal pastor.",
            ],
          },
        ],
      },
      {
        title: "Read the report",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The four boxes at the top cover the whole network for your chosen range: branches, members, average attendance and giving.",
              "The table breaks it down per branch, ending with when each last recorded anything.",
              "A branch that has recorded nothing in the range is flagged in red. That column is usually the real reason to open this page — it finds the branch that has quietly stopped, not the one with the lowest numbers.",
              "Export gives you the current filtered view as a spreadsheet, totals included.",
            ],
          },
          {
            kind: "example",
            title: "A monthly overseer's routine",
            lines: [
              "First Monday of the month, open Branches, set the range to last month.",
              "Look at the red column first: two branches recorded nothing. Call those pastors — usually it is a person who left, not a church that collapsed.",
              "Filter to each zone and send the zonal pastors their own bookmarked link.",
              "Export the whole thing for the board pack.",
            ],
          },
        ],
      },
      {
        title: "Get it emailed automatically",
        blocks: [
          {
            kind: "text",
            text: "Branches → Automatic reports. Turn it on, choose weekly or monthly. It goes to everyone with a login at the headquarters, plus any extra addresses you add — a bishop, an overseer, a board member who does not use the app. The email leads with the totals, then names the branches that recorded nothing, then lists every branch.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can the headquarters see who gave what at a branch?",
        a: "No. Only totals. Individual giving records never leave the branch.",
      },
      {
        q: "Does the headquarters pay for the branches?",
        a: "No. Each branch has its own plan and pays for itself.",
      },
      {
        q: "Can a branch be in two networks?",
        a: "A branch links to one headquarters.",
      },
      {
        q: "A branch recorded nothing — are they still using it?",
        a: "Usually the person who recorded has left or changed phone. A call sorts it faster than an email.",
      },
    ],
    links: [
      { label: "Branches", href: "/branches" },
      { label: "Analytics", href: "/analytics" },
    ],
    tip: "Agree one recording routine across every branch before you compare them. Numbers collected differently cannot be compared honestly, however neat the table looks.",
    related: ["analytics", "reports", "team-roles"],
    keywords: ["branch", "network", "headquarters", "hq", "zone", "denomination", "multi-site"],
  },

  {
    slug: "reports",
    title: "Downloading your data",
    category: "account",
    icon: "reports",
    summary:
      "Take any part of your records as a spreadsheet or PDF — or the whole thing in one file, ready for analysis.",
    whoFor: ["Anyone preparing a board report", "Anyone who wants their data in Excel"],
    sections: [
      {
        title: "Where to find it",
        blocks: [
          {
            kind: "text",
            text: "Reports in the main menu. Everything FlockInsight holds for your church is listed, grouped into People, Attendance, Giving, Groups, Engagement, Communication, and Account & operations.",
          },
          {
            kind: "note",
            text: "You only see what your role allows. Someone without giving access does not see the giving reports, and cannot download them even with a direct link.",
          },
        ],
      },
      {
        title: "Three ways to download",
        blocks: [
          {
            kind: "table",
            headers: ["Format", "Best for", "Watch out for"],
            rows: [
              [
                "CSV",
                "Real analysis — opens in Excel, Sheets or Numbers",
                "Nothing. This is always the complete data",
              ],
              [
                "PDF",
                "Reading and circulating",
                "Long or wide datasets are trimmed to fit the page, and the PDF says so",
              ],
              [
                "Full export",
                "Everything at once, or a backup of your own",
                "One ZIP with a folder per category, plus a data dictionary and README",
              ],
            ],
          },
        ],
      },
      {
        title: "Choosing a period",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Set a From and To date, or use a preset — this month, last three months, this year, last year.",
              "The range applies to each dataset's own main date, which is the sensible one in each case: a member's join date, a gift's date, a service's date, a message's send date. Each report card tells you which.",
              "Reference lists — giving categories, projects, groups, services, roles, your team — have no date to filter on and always come out in full. That is deliberate: you need the whole list to make sense of the rows pointing at it.",
            ],
          },
        ],
      },
      {
        title: "Joining the files together",
        blocks: [
          {
            kind: "text",
            text: "This is what makes an export useful rather than merely readable. Every row starts with its own id, and carries the ids of whatever it relates to alongside the readable name.",
          },
          {
            kind: "example",
            title: "Counting attendance by ministry",
            lines: [
              "group-memberships.csv has group_id, group_name, member_id and member_name.",
              "Join group-memberships to members on member_id, and to groups on group_id.",
              "Always join on the id, never the name. Two people are called John Doe, and a category can be renamed tomorrow — the id never changes.",
            ],
          },
          {
            kind: "note",
            text: "data-dictionary.csv, in the full export, lists every file, what one row means, which date it filters on, and exactly which columns join to which.",
          },
        ],
      },
      {
        title: "A word on privacy",
        blocks: [
          {
            kind: "warning",
            text: "These files contain real personal data — names, phone numbers, email addresses, home addresses and giving records. Once downloaded they are outside the app and outside its permissions. Do not email them around, do not leave them in a shared Downloads folder, and delete them when you are finished. A leaked giving spreadsheet is the fastest way to lose a congregation's trust.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "My CSV looks like nonsense in Excel.",
        a: "Use Excel's Data → From Text/CSV and choose UTF-8, rather than double-clicking. That preserves names with accents.",
      },
      {
        q: "Can I schedule a report to email itself?",
        a: "Not for a single church. Church networks can have an automatic branch report — see the Branches guide.",
      },
      {
        q: "Is the full export a backup?",
        a: "It is a usable copy of your data, which is worth keeping. It cannot be uploaded back to restore your church, so treat it as a record rather than a restore point.",
      },
    ],
    links: [
      { label: "Reports", href: "/reports" },
      { label: "Analytics", href: "/analytics" },
    ],
    tip: "Take a full export once a quarter and keep it somewhere safe. It costs you two minutes and means your church's records exist somewhere you control.",
    related: ["analytics", "giving", "finance", "branches"],
    keywords: ["report", "export", "csv", "download", "excel", "data", "backup", "pdf"],
  },

  {
    slug: "contact-support",
    title: "Getting help from a person",
    category: "account",
    icon: "help",
    summary:
      "How to reach us, and what to include so the first reply actually solves it.",
    whoFor: ["Anyone stuck"],
    sections: [
      {
        title: "Open a ticket",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Help & Support → Contact us",
                detail: "Describe what is happening and submit. Our team is notified by email.",
              },
              {
                title: "Follow the conversation in the same place",
                detail:
                  "Your tickets and our replies stay under Contact us, so nothing gets lost in an inbox.",
              },
            ],
          },
        ],
      },
      {
        title: "What to tell us",
        blocks: [
          {
            kind: "text",
            text: "The difference between a one-reply fix and a week of back-and-forth is usually four lines of detail.",
          },
          {
            kind: "bullets",
            items: [
              "What you were trying to do.",
              "What you expected, and what happened instead.",
              "Exactly where — the page name or the address in the bar.",
              "Whether it happens every time or happened once.",
              "Phone or computer, and which browser.",
              "A screenshot, if you can. It is worth more than a paragraph.",
            ],
          },
          {
            kind: "example",
            title: "Two versions of the same ticket",
            lines: [
              "Slow: 'SMS is not working.'",
              "Fast: 'Trying to send an SMS to the Choir group from Communication. I press Send and get an error saying insufficient balance, but Settings → Wallet shows ₦4,200. Happens every time, on my laptop in Chrome. Screenshot attached.'",
              "The second one gets fixed on the first reply.",
            ],
          },
        ],
      },
      {
        title: "Things worth checking first",
        blocks: [
          {
            kind: "table",
            headers: ["Symptom", "Check this first"],
            rows: [
              ["SMS is not sending", "Wallet balance, and whether your sender ID is approved"],
              ["Automatic messages stopped", "Wallet balance — this is nearly always it"],
              ["Someone cannot see a section", "Their role, in Settings → Roles"],
              ["Charts are empty", "Whether anything is recorded in that period"],
              ["Cannot add a member", "Your plan's member limit"],
              ["Nobody on Celebrations", "Whether members have dates of birth"],
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "How quickly will I hear back?",
        a: "We aim for the same working day. Anything that stops your church using the app is treated first.",
      },
      {
        q: "Can you look at my church's data to help?",
        a: "With your permission we can enter your account to see what you are seeing. Everything we change is recorded against us, never against you.",
      },
      {
        q: "I want a feature that does not exist.",
        a: "Tell us anyway. Most of what has been built came from a church asking for it.",
      },
    ],
    links: [
      { label: "Contact support", href: "/help/support" },
      { label: "All guides", href: "/help" },
    ],
    tip: "Send the screenshot. One picture of the error usually saves three messages of description.",
    related: ["getting-started", "wallet-storage", "billing"],
    keywords: ["support", "contact", "ticket", "help", "problem", "bug", "email"],
  },
];
