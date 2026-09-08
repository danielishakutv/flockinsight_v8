import type { Guide } from "./types";

export const COMMS_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "communication",
    title: "Sending SMS, email & staff notices",
    category: "comms",
    icon: "comms",
    summary:
      "Reach your whole church, one group, or a handful of people — and see afterwards what actually arrived.",
    whoFor: ["Church secretaries", "Pastors", "Group and department heads"],
    sections: [
      {
        title: "Choosing the channel",
        blocks: [
          {
            kind: "table",
            headers: ["", "SMS", "Email", "Staff notice"],
            rows: [
              ["Goes to", "Phone numbers", "Email addresses", "Inside the app"],
              ["Cost", "From your wallet, per person", "Free", "Free"],
              ["Needs setting up", "An approved sender ID", "Nothing", "Nothing"],
              ["Best for", "Anything urgent or same-day", "Anything long", "Your team, not the congregation"],
            ],
          },
          {
            kind: "text",
            text: "The rule of thumb: if it must be read today, SMS. If it is long or can wait, email — it costs nothing. If it is only for your workers, use a staff notice and spend nothing at all.",
          },
        ],
      },
      {
        title: "Send a message",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Open Communication and pick your channel",
                detail: "SMS, email, or a staff notice.",
              },
              {
                title: "Choose who it goes to",
                detail:
                  "Everyone, one group, or people you tick individually. Sending to a group rather than everyone is how you avoid annoying 400 people with something meant for 12.",
              },
              {
                title: "Write it, or start from a template",
                detail:
                  "Templates save the messages you send repeatedly. Use {name} and {church} and each person gets their own copy with their own name in it, not 'Dear member'.",
              },
              {
                title: "Check the cost before you send",
                detail:
                  "For SMS you are shown how many pages and how many recipients, so you know the cost before committing.",
              },
              {
                title: "Send",
                detail: "It goes out immediately, or you can schedule it for later.",
              },
            ],
          },
          {
            kind: "warning",
            text: "An SMS is charged per page per person. A 200-character message to 400 members is two pages each — 800 charges, not 400. Keep bulk SMS under 160 characters and it stays one page.",
          },
        ],
      },
      {
        title: "See what actually happened",
        blocks: [
          {
            kind: "text",
            text: "Communication → History keeps every message you have ever sent, with the outcome for each recipient. This is where you find out that 30 numbers failed because they were typed wrong, rather than assuming everyone got it.",
          },
          {
            kind: "bullets",
            items: [
              "Open any past message to see who received it and who did not.",
              "Download the results as a spreadsheet.",
              "Failures usually mean a wrong number format — a good prompt to clean those member records.",
            ],
          },
        ],
      },
      {
        title: "Writing messages people read",
        blocks: [
          {
            kind: "example",
            title: "The same announcement, three ways",
            lines: [
              "Too long (2 pages, twice the cost): 'Dear esteemed member of Grace Chapel, we write to inform you that our monthly thanksgiving service will hold this coming Sunday the 14th of September 2026 at the main auditorium by 9:30am prompt. Please come with your family.'",
              "Right (1 page): 'Grace Chapel: Thanksgiving service this Sunday 14 Sept, 9:30am, main auditorium. Come with your family.'",
              "Better still, for anything not urgent: send it by email, where length costs nothing, and save the SMS budget for the reminder on Saturday night.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Why did my SMS fail?",
        a: "Usually an empty wallet, a sender ID not yet approved, or badly formatted numbers. The history page tells you which.",
      },
      {
        q: "Can I message people who are not members?",
        a: "Not through Communication — it sends to your member records. Add them as members, or export the numbers and use another tool.",
      },
      {
        q: "Can I schedule a message?",
        a: "Yes. Useful for a Saturday-evening reminder about Sunday service.",
      },
      {
        q: "Does everyone see who else received it?",
        a: "No. Each person gets their own message and cannot see the rest of the list.",
      },
    ],
    links: [
      { label: "Communication", href: "/communication" },
      { label: "History", href: "/communication/history" },
      { label: "SMS settings", href: "/settings/sms" },
      { label: "Wallet", href: "/settings/wallet" },
    ],
    tip: "Send the long version by email and a one-line SMS pointing at it. You get the detail across and pay for one page.",
    related: ["sms-sender-id", "reminders", "groups", "wallet-storage"],
    keywords: ["communication", "broadcast", "bulk", "sms", "email", "notice", "template", "message"],
  },

  {
    slug: "sms-sender-id",
    title: "Getting your SMS sender ID approved",
    category: "comms",
    icon: "sms",
    summary:
      "Make your texts arrive from your church's name instead of a random number. This has to be done once, before any SMS works.",
    whoFor: ["Whoever is setting up SMS for the first time"],
    sections: [
      {
        title: "What a sender ID is",
        blocks: [
          {
            kind: "text",
            text: "It is the name your members see when your text arrives — 'GraceChapel' instead of an unknown number. Networks require it to be registered before they will carry your messages, which is why this cannot be skipped.",
          },
          {
            kind: "bullets",
            items: [
              "Between 3 and 11 characters.",
              "Letters, numbers, spaces and hyphens only.",
              "No two churches can share one, so a name already taken on the network cannot be yours.",
            ],
          },
        ],
      },
      {
        title: "Apply for it",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → SMS",
                detail: "Type the name you want members to see.",
              },
              {
                title: "Submit it",
                detail:
                  "It is sent for approval automatically. You do not need to contact the network yourself.",
              },
              {
                title: "Wait, and check the status",
                detail:
                  "Use Check approval status. It usually takes a few hours and can take longer over a weekend. If the name is already approved on the network it is adopted instantly.",
              },
              {
                title: "Top up your wallet while you wait",
                detail:
                  "Approval and money are separate — you need both before a single SMS will send.",
              },
            ],
          },
          {
            kind: "note",
            text: "Pick something recognisable at a glance. 'GraceChapel' is read as your church; 'GC2026' looks like spam and gets ignored.",
          },
        ],
      },
      {
        title: "If it is rejected",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The reason is shown on the same page.",
              "Common causes: the name is taken, it is too generic ('CHURCH'), or it resembles a bank or government body.",
              "Change it and submit again — there is no penalty for trying a second name.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can I send SMS while I wait for approval?",
        a: "No. Nothing sends until it is approved. Use email in the meantime — it works immediately and costs nothing.",
      },
      {
        q: "Can I change it later?",
        a: "Yes, but the new one goes through approval again, and SMS pauses until it clears.",
      },
      {
        q: "Does this work outside Nigeria?",
        a: "Sender ID rules vary by country and some networks ignore them entirely. If you are outside Nigeria, ask support what applies where you are before you budget for SMS.",
      },
    ],
    links: [
      { label: "SMS settings", href: "/settings/sms" },
      { label: "Wallet", href: "/settings/wallet" },
    ],
    tip: "Apply on the day you sign up, even if you don't plan to send yet. Approval takes hours, and you don't want to discover that on the morning you need to reach everyone.",
    related: ["communication", "wallet-storage", "reminders"],
    keywords: ["sms", "sender id", "approval", "termii", "text message", "network"],
  },

  {
    slug: "reminders",
    title: "Automatic service reminders",
    category: "comms",
    icon: "reminders",
    summary:
      "Remind your members about every service without anyone remembering to send it.",
    whoFor: ["Church secretaries", "Anyone currently sending a manual reminder every week"],
    sections: [
      {
        title: "Set them up once",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → Reminders, and switch them on",
                detail: "Nothing sends until you do.",
              },
              {
                title: "Choose email, SMS, or both",
                detail:
                  "Email is free. SMS costs from the wallet every week for every member, which adds up quickly on a large congregation — work out the monthly cost before choosing SMS for a weekly reminder.",
              },
              {
                title: "Choose when",
                detail:
                  "The day before, or the same day. The day before tends to work better for a Sunday service; the same morning suits midweek.",
              },
              {
                title: "Set the time of day",
                detail:
                  "In your church's timezone. Saturday evening is the sweet spot for a Sunday reminder.",
              },
              {
                title: "Choose who gets them",
                detail: "Active members only, or everyone.",
              },
              {
                title: "Write the message and test it",
                detail:
                  "Use Email me a test and read it as a member would before letting it go to 400 people.",
              },
            ],
          },
        ],
      },
      {
        title: "Placeholders",
        blocks: [
          {
            kind: "table",
            headers: ["Type this", "It becomes"],
            rows: [
              ["{name}", "The member's own name"],
              ["{church}", "Your church's name"],
              ["{service}", "The service being reminded about"],
              ["{day}", "The day it holds"],
              ["{time}", "The start time"],
            ],
          },
          {
            kind: "example",
            title: "A reminder that fits one SMS page",
            lines: [
              "Template: 'Hi {name}, {church} {service} holds {day} at {time}. We look forward to seeing you.'",
              "Arrives as: 'Hi Grace, Grace Chapel Sunday First Service holds Sunday at 07:00. We look forward to seeing you.'",
            ],
          },
        ],
      },
      {
        title: "Why reminders sometimes don't send",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The service has no day or time set — reminders are timed off those, so a service missing them is skipped.",
              "The wallet is empty, if you chose SMS.",
              "The sender ID is not approved yet.",
              "Members have no phone number, or no email, depending on the channel.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Will members get one reminder per service?",
        a: "Yes. If you run three services on a Sunday and remind for all three, that is three messages. Most churches remind only for the main one.",
      },
      {
        q: "Can one person opt out?",
        a: "Remove their phone number or email, or set them inactive if they have genuinely left. There is no per-member switch.",
      },
      {
        q: "Can I use different wording for different services?",
        a: "The template is shared across services — {service} is what makes it fit each one.",
      },
    ],
    links: [
      { label: "Reminder settings", href: "/settings/reminders" },
      { label: "Services", href: "/settings/services" },
      { label: "Wallet", href: "/settings/wallet" },
    ],
    tip: "Start with email only for a month. It costs nothing, and you will see from attendance whether reminders make any difference before you pay for SMS.",
    related: ["services", "communication", "sms-sender-id"],
    keywords: ["reminder", "automatic", "service day", "schedule", "notify", "weekly"],
  },
];
