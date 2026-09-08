import type { Guide } from "./types";

export const MONEY_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "giving",
    title: "Recording giving, projects & pledges",
    category: "giving",
    icon: "giving",
    summary:
      "Record every offering and tithe under your own categories, run building-fund projects, and track who has pledged what.",
    whoFor: ["Treasurers and finance teams", "Anyone counting the offering"],
    sections: [
      {
        title: "Set your categories first",
        blocks: [
          {
            kind: "text",
            text: "Settings → Giving. A category is anything you count separately: Tithe, Offering, Building Project, Welfare, Thanksgiving, Seed. Every gift is filed under exactly one, and your totals break down by them.",
          },
          {
            kind: "note",
            text: "Fewer categories, used consistently, beat twenty used loosely. You can always split one later; merging is harder.",
          },
        ],
      },
      {
        title: "Record a gift",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Giving → Record giving",
                detail: "Amount, category and date are the essentials.",
              },
              {
                title: "Say who gave it, if you know",
                detail:
                  "Pick a member to attach it to their record, or just type a name for someone who is not in your directory. Leave it blank for anonymous offering — most Sunday offering is recorded this way, as one lump.",
              },
              {
                title: "Add the method",
                detail:
                  "Cash, transfer, card, cheque, online or other. Worth being consistent about, because it is how you reconcile against your bank.",
              },
              {
                title: "Save",
                detail:
                  "Totals for the month, the year and all time update immediately, along with the breakdown by category.",
              },
            ],
          },
          {
            kind: "text",
            text: "For a normal Sunday most churches record two or three lines: one for total offering, one for total tithe, and named entries only where someone specifically wants theirs recorded.",
          },
        ],
      },
      {
        title: "Import years of history",
        blocks: [
          {
            kind: "text",
            text: "Giving → Import takes a spreadsheet, so a church moving off Excel can bring everything across rather than starting from zero. Categories in the file are matched to your existing ones by name.",
          },
        ],
      },
      {
        title: "Projects and pledges",
        blocks: [
          {
            kind: "text",
            text: "A project is a fundraising target — a building, a bus, a generator. A pledge is one person's promise towards it.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "Create the project with its target",
                detail: "Giving → Projects. Give it a name and the amount you are raising.",
              },
              {
                title: "Record pledges against it",
                detail:
                  "Who promised how much, and how often they intend to pay — once, weekly, monthly, quarterly, yearly, or your own wording.",
              },
              {
                title: "Record payments as they come in",
                detail:
                  "Each payment reduces what that person still owes. A pledge closes itself when it is fully paid.",
              },
              {
                title: "Watch the progress",
                detail:
                  "The project shows how much is pledged against the target, and how much of that has actually arrived. Those two are rarely the same number, and the gap is the useful one.",
              },
            ],
          },
          {
            kind: "example",
            title: "A building fund at Grace Chapel",
            lines: [
              "Target: ₦25,000,000 for the new roof.",
              "142 members pledge, totalling ₦18,400,000 — so they are already short on promises alone, which they learn in week one rather than month six.",
              "By March, ₦9,100,000 has actually been paid.",
              "The outstanding report shows who has fallen behind, and reminders go to those people only — not to the whole church.",
            ],
          },
          {
            kind: "note",
            text: "People who have finished paying stop receiving reminders automatically.",
          },
        ],
      },
      {
        title: "Statements and receipts",
        blocks: [
          {
            kind: "bullets",
            items: [
              "A giving statement PDF covers any period, broken down by category, with the entries behind it — the document to take to a board meeting.",
              "It carries your church's own logo, colours and contact details, not ours.",
              "Individual members' giving history sits on their profile, for anyone who asks what they gave last year.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Should I record every individual offering envelope?",
        a: "Only if your church already does. Most record the Sunday total as one line and name only tithes and pledges. Recording 300 envelopes weekly is a lot of typing for very little you will ever use.",
      },
      {
        q: "Can I change a gift's category after saving?",
        a: "Yes. Edit the record. If that category is linked to a finance fund, the money moves across with it.",
      },
      {
        q: "Someone gave in dollars.",
        a: "Everything is recorded in your church's single currency. Convert it yourself and note the original amount and rate in the note field.",
      },
      {
        q: "What is the difference between Giving and Finance?",
        a: "Giving is what came in from your members. Finance is your whole books — including what went out. See the Finance guide.",
      },
    ],
    links: [
      { label: "Giving", href: "/giving" },
      { label: "Giving categories", href: "/settings/giving" },
      { label: "Projects", href: "/giving/projects" },
      { label: "Import giving", href: "/giving/import" },
    ],
    tip: "Record the Sunday offering the same day, while the count sheet is still in front of you. Nothing is harder to reconstruct than a month of remembered offerings.",
    related: ["finance", "reports", "members"],
    keywords: ["giving", "offering", "tithe", "donation", "pledge", "project", "building fund"],
  },

  {
    slug: "finance",
    title: "Finance — the church's books",
    category: "giving",
    icon: "wallet",
    summary:
      "Record what comes in and what goes out, see what each account really holds, and let giving categories fill their own funds.",
    whoFor: ["Treasurers", "Church administrators", "Anyone who has to answer 'how much do we actually have?'"],
    sections: [
      {
        title: "Giving and Finance are not the same thing",
        blocks: [
          {
            kind: "table",
            headers: ["", "Giving", "Finance"],
            rows: [
              ["Answers", "What did members give?", "What do we have, and where did it go?"],
              ["Covers", "Money in, from the congregation", "Money in and out, from anywhere"],
              ["Examples", "Tithe, offering, pledges", "Rent, diesel, salaries, bank balances"],
            ],
          },
          {
            kind: "text",
            text: "Most churches need both. Giving tells you about your people; Finance tells you about your position.",
          },
        ],
      },
      {
        title: "Set up your accounts",
        blocks: [
          {
            kind: "text",
            text: "An account is anywhere money actually sits: the current account, the offering box, a mobile wallet, the building-fund account.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "Finance → Accounts → Add account",
                detail: "Name it as your treasurer would say it out loud.",
              },
              {
                title: "Set the opening balance",
                detail:
                  "What it held on the day you started using FlockInsight. This matters — a church joining mid-year starts from the truth rather than from zero.",
              },
              {
                title: "Add your income and expense categories",
                detail:
                  "Finance → Categories. Separate lists for each side of the books: income might be Offering, Rent received, Donations; expenses might be Diesel, Salaries, Repairs, Transport.",
              },
            ],
          },
        ],
      },
      {
        title: "Record what moves",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Income and expenses each get an amount, a date, an account, a category, and optionally a payee and a reference.",
              "Balances are worked out from what you record plus the opening balance — never typed in by hand, so they cannot drift.",
              "Transfers move money between your own accounts. They change balances but are deliberately left out of your income and expense totals, so moving ₦500,000 between your own accounts does not appear as half a million earned and half a million spent.",
            ],
          },
        ],
      },
      {
        title: "Funds — where Giving and Finance meet",
        blocks: [
          {
            kind: "text",
            text: "This is the part worth understanding, because it saves the most work.",
          },
          {
            kind: "text",
            text: "Give a giving category — say Building Project — its own fund account. From then on, every gift recorded under Building Project is added to that account as income automatically. You never type it twice. Link a category that already has three years of giving behind it and the whole history comes across with it.",
          },
          {
            kind: "warning",
            text: "A fund account can be spent from and transferred out of, but nothing can be paid into it by hand. Money enters it one way only — by someone actually giving. That is what keeps the balance honest: it always reflects what was genuinely given, never what someone typed in.",
          },
          {
            kind: "example",
            title: "The roof fund",
            lines: [
              "Grace Chapel links the 'Building Project' giving category to a fund account.",
              "Every Sunday's building-fund offering is recorded once, in Giving. It appears in Finance by itself.",
              "In March they pay ₦2,000,000 to the roofing contractor — recorded as an expense from the fund account.",
              "The fund balance now shows what is genuinely left to spend, and the giving records still show every naira that was ever given. Neither can contradict the other.",
            ],
          },
        ],
      },
      {
        title: "Finding things and getting them out",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Search the ledger by payee, reference, note or amount.",
              "Filter by type, account, category, method or date range.",
              "What you download is what you filtered to — so you can produce 'all diesel expenses this year' as a spreadsheet in about fifteen seconds.",
              "PDFs carry your church's own branding.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Do I have to use Finance if I already use Giving?",
        a: "No. Plenty of churches only track giving. Finance is for when you also need to account for what goes out.",
      },
      {
        q: "Why can't I pay money into my building fund account by hand?",
        a: "Because a fund's balance is meant to prove what was given. If money could be typed in directly, the balance could show more than anyone ever gave. Record it as giving in that category instead and it arrives by itself.",
      },
      {
        q: "I deleted an account by mistake.",
        a: "An account with transactions against it cannot be deleted at all — you are offered the option to close it instead, so the books stay whole.",
      },
      {
        q: "Can the treasurer see Finance without seeing members?",
        a: "Yes. Settings → Roles — give Finance and Giving, and leave Members off.",
      },
    ],
    links: [
      { label: "Finance", href: "/finance" },
      { label: "Accounts", href: "/finance/accounts" },
      { label: "Categories", href: "/finance/categories" },
      { label: "Giving categories", href: "/settings/giving" },
    ],
    tip: "Enter opening balances on the day you start. Everything after that adds up by itself; a missing opening balance is wrong forever.",
    related: ["giving", "reports", "team-roles"],
    keywords: ["finance", "expense", "income", "account", "balance", "books", "ledger", "fund", "transfer"],
  },

  {
    slug: "wallet-storage",
    title: "Your wallet & storage",
    category: "account",
    icon: "wallet",
    summary:
      "One balance that pays for SMS and extra storage. How to top it up and what happens when it runs out.",
    whoFor: ["Whoever pays for things", "Anyone whose SMS suddenly stopped sending"],
    sections: [
      {
        title: "What the wallet pays for",
        blocks: [
          {
            kind: "text",
            text: "Your subscription plan is separate. The wallet covers usage on top of it — the things that cost real money each time you use them.",
          },
          {
            kind: "table",
            headers: ["Paid from the wallet", "Not paid from the wallet"],
            rows: [
              ["Every SMS you send", "Your monthly or yearly plan"],
              ["Automatic SMS — birthdays, reminders", "Email of any kind, which is free"],
              ["Extra storage above your free allowance", "Members, attendance, giving — all included"],
            ],
          },
        ],
      },
      {
        title: "Topping up",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → Wallet",
                detail: "Your balance and every movement in and out are listed.",
              },
              {
                title: "Choose an amount and pay",
                detail: "Payment goes through Paystack — card or bank transfer.",
              },
              {
                title: "The balance updates when payment confirms",
                detail:
                  "If a payment succeeds at the bank but the balance has not moved after a few minutes, contact support with the reference rather than paying again.",
              },
            ],
          },
        ],
      },
      {
        title: "Storage",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Every church gets a free allowance for sermons, photos and documents.",
              "Settings → Storage shows what you have used and sells more in bundles if you need it.",
              "Extra storage renews monthly and is taken from the wallet, so keep enough in there to cover it.",
              "Video is what fills storage. An hour of video can outweigh a thousand photos.",
            ],
          },
        ],
      },
      {
        title: "When the balance hits zero",
        blocks: [
          {
            kind: "warning",
            text: "SMS stops sending. Automatic messages — birthdays, service reminders, first-timer welcomes — stop quietly, without an error in front of anyone. Nothing in your records is lost, but the messages simply do not go.",
          },
          {
            kind: "text",
            text: "This is the single most common support question, and it is almost always an empty wallet on a month with a lot of birthdays.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "How much is one SMS?",
        a: "Settings → Wallet shows the current price. A long message counts as more than one page, so keep automatic messages short.",
      },
      {
        q: "Is email charged?",
        a: "No. Email is free and unlimited, which is why it is worth using for anything that does not have to be an SMS.",
      },
      {
        q: "Can I get a refund on my balance?",
        a: "Contact support. It is not automatic.",
      },
      {
        q: "Does the wallet pay my subscription?",
        a: "No, they are separate. Settings → Plan & billing handles the subscription.",
      },
    ],
    links: [
      { label: "Wallet", href: "/settings/wallet" },
      { label: "Storage", href: "/settings/storage" },
      { label: "Plan & billing", href: "/settings/billing" },
    ],
    tip: "Top up before December. Birthdays, Christmas messages and end-of-year programmes land in the same few weeks and empty a wallet faster than any other month.",
    related: ["communication", "sms-sender-id", "billing", "media"],
    keywords: ["wallet", "balance", "topup", "credit", "storage", "sms cost", "paystack"],
  },

  {
    slug: "billing",
    title: "Plans & billing",
    category: "account",
    icon: "billing",
    summary:
      "What each plan includes, how the free trial works, and how to upgrade without losing anything.",
    whoFor: ["Whoever pays the bill"],
    sections: [
      {
        title: "The free trial",
        blocks: [
          {
            kind: "text",
            text: "New churches get their first seven Sundays free — a real trial, long enough to run the thing properly rather than click around for a fortnight.",
          },
          {
            kind: "bullets",
            items: [
              "You are reminded before it ends, more than once.",
              "When it ends you pick a plan to carry on adding data.",
              "Nothing is deleted. Your members, attendance and giving are all exactly where you left them.",
            ],
          },
        ],
      },
      {
        title: "Choosing and changing a plan",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → Plan & billing",
                detail: "Shows your current plan, what it costs and when it renews.",
              },
              {
                title: "Compare what you need",
                detail:
                  "Plans differ mainly on how many members you can hold and which features are open. The member count is what most churches hit first.",
              },
              {
                title: "Upgrade",
                detail:
                  "Takes effect immediately after payment. Higher member limits apply straight away, so a blocked import will go through.",
              },
              {
                title: "Downgrade",
                detail:
                  "Takes effect at renewal, so you keep what you paid for until then.",
              },
            ],
          },
          {
            kind: "note",
            text: "Payment history is on the same page — every payment, with its date and reference. That is where to look before contacting support about a charge.",
          },
        ],
      },
      {
        title: "If you go over your member limit",
        blocks: [
          {
            kind: "text",
            text: "Adding members beyond your plan is blocked before anything is saved, not halfway through. An import tells you it would exceed the limit and adds nobody, so you are never left with half your congregation loaded.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "What happens to my data if I stop paying?",
        a: "It is kept. You are asked to choose a plan before you can add more, but nothing is deleted and you can pick up where you stopped.",
      },
      {
        q: "Can I pay yearly?",
        a: "Where a yearly option is offered it is on the billing page, usually cheaper than twelve months.",
      },
      {
        q: "Do children count towards my member limit?",
        a: "Yes. A child is a full member.",
      },
      {
        q: "We're a small church and cannot afford it.",
        a: "Talk to us through Help & Support. There are arrangements for churches genuinely unable to pay.",
      },
    ],
    links: [
      { label: "Plan & billing", href: "/settings/billing" },
      { label: "Wallet", href: "/settings/wallet" },
      { label: "Contact support", href: "/help/support" },
    ],
    tip: "Mark the renewal date in your church calendar. A failed card on renewal day is easier to sort out before it lapses than after.",
    related: ["wallet-storage", "contact-support"],
    keywords: ["billing", "plan", "subscription", "trial", "upgrade", "payment", "price"],
  },
];
