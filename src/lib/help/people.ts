import type { Guide } from "./types";

export const PEOPLE_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "members",
    title: "Adding & managing members",
    category: "people",
    icon: "members",
    summary:
      "Build your directory, import hundreds at once from a spreadsheet, and let people keep their own details up to date.",
    whoFor: [
      "Whoever keeps the church register",
      "Anyone moving off a paper book or an Excel sheet",
    ],
    sections: [
      {
        title: "Add one person",
        blocks: [
          {
            kind: "text",
            text: "Members → Add member. Only the first name is required. Everything else can be filled in later, so add someone the moment you meet them rather than waiting until you have all their details.",
          },
          {
            kind: "bullets",
            items: [
              "Names, gender, phone, email.",
              "Date of birth and wedding date — these feed the Celebrations page and the automatic birthday messages.",
              "Address, broken into house, street, city, LGA, state — so you can find everyone in one area later.",
              "Status: Active, Inactive, Visitor or New convert. Visitors and new converts are the ones Follow-up picks up automatically.",
              "Notes, for anything that doesn't fit a field.",
            ],
          },
        ],
      },
      {
        title: "Import a whole congregation from a spreadsheet",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Go to Members → Import and download the template",
                detail:
                  "It opens as a CSV with the columns already named and one example row showing the formats.",
              },
              {
                title: "Paste your existing list into it",
                detail:
                  "Only First name is compulsory. Leave any column you don't have completely blank rather than typing 'N/A' — a blank means 'unknown', 'N/A' becomes someone's actual phone number.",
              },
              {
                title: "Check your dates are YYYY-MM-DD",
                detail:
                  "1985-04-23, not 23/04/1985. Any date it can't read is left empty rather than guessed, so a whole column of the wrong format silently imports as no birthdays at all.",
              },
              {
                title: "Upload it",
                detail:
                  "You get a summary of how many were added and a line for each row it had to skip, with the reason.",
              },
            ],
          },
          {
            kind: "note",
            text: "Column names are matched loosely — 'Surname', 'Last name' and 'lastname' all work, as do 'Phone', 'Mobile' and 'Phone number', and 'DOB' or 'Birthday' for date of birth. Capitals and spaces are ignored. Up to 5,000 rows per file.",
          },
          {
            kind: "table",
            headers: ["Column", "Accepts", "Example"],
            rows: [
              ["First name", "Required", "Grace"],
              ["Last name / Surname", "Text", "Adeyemi"],
              ["Gender", "male / female / m / f", "female"],
              [
                "Status",
                "active / inactive / visitor / new_convert",
                "visitor",
              ],
              ["Phone / Mobile", "Any format", "08031234567"],
              ["Date of birth / DOB", "YYYY-MM-DD", "1985-04-23"],
              ["Date joined", "YYYY-MM-DD", "2024-01-07"],
              ["House, Street, City, LGA, State", "Text", "Ikeja"],
            ],
          },
          {
            kind: "warning",
            text: "Importing the same file twice creates everyone twice — there is no duplicate check on names. If an import goes wrong, select the affected people in the list and delete them in bulk before trying again.",
          },
        ],
      },
      {
        title: "Let people update their own details",
        blocks: [
          {
            kind: "text",
            text: "Chasing phone numbers is the least rewarding job in a church office, and there are two ways to stop doing it.",
          },
          {
            kind: "bullets",
            items: [
              "A personal update link: open someone's profile and generate one. It is a private web page only they can reach, where they fix their own details. Regenerate it to cut off the old link.",
              "A public sign-up link (Settings → Sign-up link): one link or QR code you can put in the bulletin or on a screen. Anyone who fills it in arrives in your Members list. You choose whether children can be added through it.",
            ],
          },
        ],
      },
      {
        title: "Households, children and families",
        blocks: [
          {
            kind: "text",
            text: "A household groups a family under one roof so you can see them together and avoid sending four copies of the same message to one address.",
          },
          {
            kind: "bullets",
            items: [
              "Members → Households creates and manages them.",
              "A child is a full member — they count in your totals — but usually has no phone or email of their own. Tick 'Child' and link a guardian.",
              "Deleting a guardian never deletes their children; the children simply lose the link.",
            ],
          },
        ],
      },
      {
        title: "Finding people and acting in bulk",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The search box matches name, phone, email and guardian name at the same time.",
              "Tick several people to delete them together, or to give a group of them app access at once.",
              "The data menu downloads what you are currently looking at — filter first, then download, and you get exactly that list.",
              "Badges beside a name show which classes that person has completed. See the Training guide.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Someone changed their phone number. Do I lose the old one?",
        a: "Yes — the field is overwritten. If the history matters, paste the old number into Notes before you change it.",
      },
      {
        q: "What is the difference between deleting a member and marking them inactive?",
        a: "Inactive keeps everything — their giving history, attendance and class records stay intact and they simply stop appearing as an active member. Deleting removes the person and everything attached to them, permanently. Prefer Inactive for anyone who has left.",
      },
      {
        q: "Can two people share one phone number?",
        a: "Yes. Couples often do. It is not treated as a duplicate.",
      },
      {
        q: "Is there a limit on how many members I can have?",
        a: "It depends on your plan. If an import would take you past it, the import stops and tells you before adding anyone. Settings → Plan & billing shows where you stand.",
      },
    ],
    links: [
      { label: "Members", href: "/members" },
      { label: "Import members", href: "/members/import" },
      { label: "Households", href: "/members/households" },
      { label: "Sign-up link", href: "/settings/signup" },
    ],
    tip: "Import with just names and phone numbers on day one. A directory that exists is worth more than a perfect one you never finish.",
    related: ["groups", "follow-up", "training", "celebrations"],
    keywords: ["member", "directory", "import", "csv", "spreadsheet", "family", "household"],
  },

  {
    slug: "groups",
    title: "Groups, ministries & departments",
    category: "people",
    icon: "groups",
    summary:
      "Organise people into choirs, ushers, home cells and committees — then message any of them in one go.",
    whoFor: ["Pastors and heads of department", "Anyone running home cells or units"],
    sections: [
      {
        title: "What a group is for",
        blocks: [
          {
            kind: "text",
            text: "A group is any organised body inside your church. The type is only a label to help you find things — every type behaves the same.",
          },
          {
            kind: "table",
            headers: ["Type", "Typically used for"],
            rows: [
              ["Ministry", "Choir, Ushering, Media, Children's church"],
              ["Department", "Administration, Maintenance, Security"],
              ["Cell", "Home fellowships and area meetings"],
              ["Committee", "Building committee, Planning committee"],
              ["Class", "A standing class or study group"],
              ["Group", "Anything else — Men's forum, Youth, Singles"],
            ],
          },
        ],
      },
      {
        title: "Create a group and fill it",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Groups → New group",
                detail:
                  "Give it a name and a type. Add the meeting day and time if it has one, so members can see when it gathers.",
              },
              {
                title: "Add members in bulk",
                detail:
                  "Open the group and add people — you can tick many at once rather than one at a time.",
              },
              {
                title: "Mark your leaders",
                detail:
                  "Any member of a group can be flagged as a leader, and given a title like 'Ministry Head' or 'Assistant'. A group can have as many leaders as it really has.",
              },
            ],
          },
        ],
      },
      {
        title: "What you get once groups exist",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Message just that group from Communication — pick the group as your audience instead of the whole church.",
              "Copy every phone number or email in the group to your clipboard in one click, for use anywhere else.",
              "Every member's profile lists the groups they belong to, so you can see at a glance that one person is carrying four departments.",
            ],
          },
          {
            kind: "example",
            title: "Grace Chapel, Ikeja",
            lines: [
              "They set up Choir, Ushering, Media and Technical as ministries, plus five home cells named by area.",
              "Each cell has a leader with the title 'Cell Leader'.",
              "Every Friday the pastor sends one SMS to the five cell leaders reminding them to submit their meeting count — audience: leaders of those groups, not the whole church.",
              "When the choir needed new robes, the choir head copied the 34 phone numbers out and sent sizes by WhatsApp.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can somebody be in more than one group?",
        a: "Yes, as many as you like. Most active members are in several.",
      },
      {
        q: "Does removing someone from a group delete the member?",
        a: "No. It only removes them from that group. Their member record is untouched.",
      },
      {
        q: "What is the difference between a group and a training class?",
        a: "A group is ongoing — you belong to the choir. A class runs, finishes, and leaves a record that you completed it. Use Training for anything with a start, an end and a certificate.",
      },
    ],
    links: [
      { label: "Groups", href: "/groups" },
      { label: "Communication", href: "/communication" },
    ],
    tip: "Make a group called 'Workers' containing everyone serving in any capacity. It becomes the audience you reach for most often.",
    related: ["members", "communication", "training"],
    keywords: ["group", "ministry", "department", "cell", "unit", "committee", "team"],
  },

  {
    slug: "follow-up",
    title: "Following up visitors & new converts",
    category: "people",
    icon: "followup",
    summary:
      "Stop losing first-timers. Capture them, assign someone to call, and see who has actually been contacted.",
    whoFor: ["Follow-up and welfare teams", "Pastors who want visitors to come back"],
    sections: [
      {
        title: "How people get into Follow-up",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Automatically — anyone whose status is Visitor or New convert appears without you doing anything.",
              "Manually — open any member and switch on follow-up, for a regular member going through something.",
              "Through a form — build a first-timer form, put the QR code on the welcome desk, and everyone who fills it lands here.",
            ],
          },
        ],
      },
      {
        title: "Work the list",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Assign each person to someone",
                detail:
                  "Unassigned people get forgotten. Assigning creates ownership — that person's name is now against it.",
              },
              {
                title: "Move them through the stages",
                detail:
                  "New → Contacted → In progress, then Joined or Not interested. The stage is the whole point: it tells you who has genuinely been spoken to.",
              },
              {
                title: "Log what happened after every contact",
                detail:
                  "A one-line note beats memory, and means anyone can pick up where the last person stopped.",
              },
              {
                title: "Close the loop",
                detail:
                  "Someone who starts attending becomes Joined — change their member status to Active and they leave the list. Someone who is not interested is marked so, and stops being chased.",
              },
            ],
          },
        ],
      },
      {
        title: "Let the automatic messages do the first touch",
        blocks: [
          {
            kind: "text",
            text: "Settings → First-timers sets up messages that go out on their own after someone first visits — a welcome the same day, a nudge a few days later. Your team then follows a warm contact rather than a cold one.",
          },
          {
            kind: "example",
            title: "A Sunday that works",
            lines: [
              "A first-timer scans the QR code at the welcome desk and fills in name, phone and how they heard about the church.",
              "They appear in Follow-up as New, and get an automatic welcome SMS that afternoon.",
              "Monday morning the follow-up head assigns them to a team member living in the same area.",
              "Tuesday that person calls, marks them Contacted and notes 'Wants to join the choir'.",
              "The following Sunday they attend again and are switched to Joined and Active — and the choir head is told.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Someone visited months ago and we never called. Can I still find them?",
        a: "Yes. Nobody drops off the list by age — they stay until someone marks them Joined or Not interested.",
      },
      {
        q: "Can two people work the list at once?",
        a: "Yes. Assignments are per person, so everyone can see their own names to call.",
      },
      {
        q: "Will marking someone Not interested delete them?",
        a: "No. They stay in Members with their history. They just stop appearing as outstanding follow-up.",
      },
    ],
    links: [
      { label: "Follow-up", href: "/follow-up" },
      { label: "First-timer settings", href: "/settings/first-timers" },
      { label: "Forms", href: "/forms" },
    ],
    tip: "Assign every new name the same day. An unassigned visitor is a visitor nobody calls.",
    related: ["members", "forms", "communication"],
    keywords: ["visitor", "first timer", "new convert", "followup", "welcome", "guest"],
  },

  {
    slug: "celebrations",
    title: "Birthdays & anniversaries",
    category: "people",
    icon: "celebrations",
    summary:
      "See who is celebrating this week, and let the church wish them well automatically.",
    whoFor: ["Church secretaries", "Anyone who keeps the pastoral touch going"],
    sections: [
      {
        title: "Seeing who is celebrating",
        blocks: [
          {
            kind: "text",
            text: "The Celebrations page lists birthdays and wedding anniversaries coming up, and the dashboard shows the next fortnight. It works off the dates on member profiles, so it is only as complete as your directory.",
          },
          {
            kind: "note",
            text: "You can record a birthday without a year, for people who would rather not say. The day and month are what the reminder needs.",
          },
        ],
      },
      {
        title: "Sending the wishes automatically",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Go to Settings → Celebrations",
                detail: "Switch on birthdays, wedding anniversaries, or both.",
              },
              {
                title: "Write the message",
                detail:
                  "Use the member's name as a placeholder so each person gets their own greeting rather than 'Dear member'.",
              },
              {
                title: "Choose SMS, email or both",
                detail:
                  "SMS costs money from your wallet and needs an approved sender ID. Email is free. Many churches send email to everyone and SMS only for birthdays.",
              },
              {
                title: "Check it once",
                detail:
                  "Put your own birthday in as a test member and confirm the message arrives looking the way you intended.",
              },
            ],
          },
          {
            kind: "warning",
            text: "Automatic SMS goes out on its own every day. If your wallet empties, the messages stop silently — keep an eye on the balance, especially in a month with a lot of birthdays.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Nobody shows up on the Celebrations page.",
        a: "Almost always missing dates of birth. Import them, or send out personal update links and let members fill in their own.",
      },
      {
        q: "Can I stop one person receiving these?",
        a: "Remove their date of birth, or clear their phone number if it is only the SMS you want to stop.",
      },
      {
        q: "Does it send at a sensible hour?",
        a: "Messages go out in your church's timezone, which is another reason to set that correctly in Settings → General.",
      },
    ],
    links: [
      { label: "Celebrations", href: "/celebrations" },
      { label: "Celebration settings", href: "/settings/celebrations" },
      { label: "Wallet", href: "/settings/wallet" },
    ],
    tip: "Turn on email greetings first. They cost nothing, so you can see whether people appreciate them before you spend on SMS.",
    related: ["members", "communication", "wallet-storage"],
    keywords: ["birthday", "anniversary", "wedding", "celebration", "greeting"],
  },
];
