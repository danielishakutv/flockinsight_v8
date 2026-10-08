import type { Guide } from "./types";

/**
 * The guide for group contributions.
 *
 * Written for the person who actually runs one of these — a choir leader, a
 * department head, a committee treasurer — not for a church administrator. They
 * have never used the app before and will read this once, on a phone, probably
 * on a Sunday. So it opens with the thing they came for (how do I start one and
 * share it), and the controls that make the module trustworthy come after,
 * because a guide that opens with dual-signature policy is a guide nobody
 * finishes.
 */
export const CONTRIBUTION_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "contributions",
    title: "Group contributions — collecting money together",
    category: "giving",
    icon: "contributions",
    summary:
      "When a department, choir or ministry puts money together for one purpose — a levy, a goal, or a gift for someone. Everyone gets one link that shows exactly who has given and where the money went.",
    whoFor: [
      "Choir, department and ministry leaders",
      "Committee treasurers",
      "Anyone who has ever collected money for the church in a notebook",
    ],
    sections: [
      {
        title: "What this is for",
        blocks: [
          {
            kind: "text",
            text: "Every church does this constantly. The choir needs uniforms. The youth need transport to camp. The whole department wants to bless the pastor on his birthday. So somebody collects, writes names in a notebook, answers forty WhatsApp messages, and three weeks later nobody can say who paid what — or where the money went.",
          },
          {
            kind: "text",
            text: "A collection here fixes the part that causes the arguments: everybody can see the record before there is an argument. You get one link. You share it in the group chat. It shows the running total, every person who has given, and every naira that has left.",
          },
          {
            kind: "note",
            text: "This is separate from Giving on purpose. Giving is money the church received. A collection is money a group is holding for its own purpose — it does not touch the church's books until somebody records that it was handed over.",
          },
        ],
      },
      {
        title: "Start a collection",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Contributions → New collection",
                detail:
                  "You do not need to be a church administrator. If you lead a group, you can start a collection for that group.",
              },
              {
                title: "Pick the kind",
                detail:
                  "Everyone gives the same (a levy — 5,000 each), any amount toward a goal (people give what they can), or bless someone (a gift for one person).",
              },
              {
                title: "Name it the way you would say it out loud",
                detail:
                  '"Choir uniform levy", not "Q4 Textile Assessment". The name goes into a WhatsApp message.',
              },
              {
                title: "Say what it is for",
                detail:
                  "One or two lines. Anyone who opens the link reads this, so it is worth writing properly — it is the difference between people giving and people asking questions.",
              },
              {
                title: "Set the amount",
                detail:
                  "For a levy, the amount from each person is usually all you know — leave the goal blank and it is worked out from your list. For an open collection, set the goal.",
              },
              {
                title: "Add a deadline, and how to pay",
                detail:
                  "Account name and number, or just “Hand it to the treasurer on Sunday”. Both appear on the link.",
              },
              {
                title: "Start collecting",
                detail:
                  "Until you do this it is a draft and the link is not live, so you can set everything up first without anybody seeing it.",
              },
            ],
          },
        ],
      },
      {
        title: "Add the people — paste the list",
        blocks: [
          {
            kind: "text",
            text: "You almost certainly have the names already, in a WhatsApp message or a note on your phone. Do not type them in one at a time.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "Open the People tab → Paste a list",
                detail: "One name per line. Up to 500 at a time.",
              },
              {
                title: "Add a phone number, email or amount after a comma, if you have it",
                detail:
                  '"Grace Udo" on its own is fine. So is "Grace Udo, 08031234567" or "Grace Udo, 5000" — the amount is what you expect from her, if it differs from everyone else.',
              },
              {
                title: "It tells you what it did",
                detail:
                  "How many were added, how many were matched to people already on your members register, and how many were skipped because they were already on the list. Paste the same message twice and nobody is doubled.",
              },
            ],
          },
          {
            kind: "note",
            text: "You do not need anybody's email address, and you do not need them to be on the members register first. A name is enough. The register catches up later — see “People who are not members yet” below.",
          },
        ],
      },
      {
        title: "Record what comes in",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Record a payment",
                detail:
                  "Type the name. If they are on the list, it attaches to them; if they are on your members register, they are added to the list; if they are new, they are added. You never have to decide which first.",
              },
              {
                title: "The amount is filled in for you",
                detail:
                  "If you record against somebody who still owes, the outstanding amount is pre-filled — usually exactly what they are handing you.",
              },
              {
                title: "Attach a receipt, if there is one",
                detail:
                  "A photo of the teller or the bank's PDF. Optional, always.",
              },
            ],
          },
          {
            kind: "text",
            text: "Anyone with the link can also record their own payment themselves, which saves you transcribing forty messages on a Monday. What they submit shows as “awaiting confirmation” until you check it — it does not move the total until you do.",
          },
        ],
      },
      {
        title: "Share the link",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Share tab → Share on WhatsApp",
                detail:
                  "The message is written for you, and it sends the whole update rather than a bare link: the figure, the bar, who has given, what is still owed, where the money went and how to pay.",
              },
              {
                title: "Or choose “Just the link”",
                detail:
                  "One line and the address, if the group is large or the list is long. Everything is then behind a tap.",
              },
              {
                title: "Read it before you send it",
                detail:
                  "The message is shown on the same screen, exactly as it will arrive. You are pasting it into a chat of forty people; it is worth the ten seconds.",
              },
              {
                title: "Or copy the link",
                detail:
                  "It never changes, so a link you sent three weeks ago still works and still shows today's total.",
              },
            ],
          },
          {
            kind: "text",
            text: "The Share tab also lists, in plain words, exactly what people will see — so you know before you send it to forty people.",
          },
          {
            kind: "note",
            text: "The full update is the default on purpose. A link asks somebody to leave the chat, on a phone with no data left, to find out a figure that would have fitted in the message — so most of them do not, and you get asked “how much have we raised?” in the same group you posted the link in. The message that already answers it is the one that stops the asking. Anybody who opens the link can forward the same update on, from the Share button on the page itself.",
          },
          {
            kind: "table",
            headers: ["Who sees what", "What is on the link"],
            rows: [
              [
                "Everyone sees everything",
                "The total, the goal, every contributor and every amount. This is the setting that stops the arguments, and it is the default.",
              ],
              [
                "Totals only",
                "How much has come in and from how many people. No names, no amounts. Right for a bereavement collection.",
              ],
              [
                "No public link",
                "Nothing is shared. Only your team, inside FlockInsight.",
              ],
            ],
          },
          {
            kind: "note",
            text: "Anybody can be marked “Anonymous”. The link shows them as Anonymous; your own team always sees their real name.",
          },
          {
            kind: "warning",
            text: "“Show who has not given yet” is off by default, and it is worth leaving off. A public list of who still owes is right for six adults on a committee and can do real pastoral harm anywhere larger.",
          },
        ],
      },
      {
        title: "Hiding names, one person or everybody",
        blocks: [
          {
            kind: "text",
            text: "Somebody will ask for their name to come off the list, and they will ask after the link has already gone out. Both answers are one tap, and neither of them hides any money — the amounts, the total and what went out all stay exactly as they were. It is who, not how much.",
          },
          {
            kind: "table",
            headers: ["What you want", "Where"],
            rows: [
              [
                "One person off the list",
                "People tab → the ⋮ beside their name → Hide this name publicly. Their line reads “Anonymous”.",
              ],
              [
                "Everybody off the list",
                "The switch at the top of the People tab, or “Hide everyone’s name” in the collection’s settings. Every line reads “Anonymous”.",
              ],
              [
                "No list at all",
                "Set the link to “Totals only”. Then there are no rows to read, just the figures.",
              ],
            ],
          },
          {
            kind: "note",
            text: "When more than one person is hidden the lines are numbered — Anonymous 1, Anonymous 2 — and the same person keeps the same number on the page and in the WhatsApp message. Twenty lines all reading the same word would be a list nobody can check: you could not tell twenty people giving once from one person giving twenty times, which is the arithmetic the page exists to settle.",
          },
          {
            kind: "text",
            text: "“Hide everyone” wins over each person’s own setting. That is deliberate: a version that mixed the two could leave one person named in an otherwise anonymous list, and that one visible name is more exposed than they were before anybody touched the setting.",
          },
          {
            kind: "warning",
            text: "With every name hidden, “Find my record” disappears from the page, because there is nothing left to search for. Somebody who wants to check their own payment has to ask whoever is collecting — who can still see every real name. That is the honest cost of hiding them, and the page says so rather than searching an anonymous list and finding nothing.",
          },
          {
            kind: "note",
            text: "Your own team always sees real names, in the app, in the CSV and in Reports. This is privacy from the group chat, not from the treasurer — somebody has to confirm the money.",
          },
          {
            kind: "example",
            title: "A bereavement collection",
            lines: [
              "The collection is set up as normal and the link goes into the family's group chat.",
              "“Hide everyone’s name” is turned on before it is sent, so every line reads Anonymous 1, Anonymous 2 and so on.",
              "The total, every amount and every naira that goes out are all still public. Nobody can say the money was not accounted for.",
              "What nobody can say is who gave 200,000 and who gave 1,000 — which in a bereavement is the entire point.",
            ],
          },
        ],
      },
      {
        title: "When somebody disagrees about an amount",
        blocks: [
          {
            kind: "text",
            text: "This is the situation the module is really built for. Somebody says they paid 5,000 and the record says 2,000.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "Open the payment and press Dispute",
                detail:
                  "You have to say what is wrong with it. A dispute with no reason helps nobody.",
              },
              {
                title: "Two people then have to confirm it",
                detail:
                  "Not one. And more people have to confirm it than dispute it. Until that happens the money is not counted in the total.",
              },
              {
                title: "Or mark it as not counted",
                detail:
                  "For a transfer that never arrived. The record stays and says why — nothing is deleted.",
              },
            ],
          },
          {
            kind: "text",
            text: "The important part: the person who wrote the figure down cannot settle the argument on their own. Everyone who has confirmed a payment is named on it, so you can always see who checked what.",
          },
        ],
      },
      {
        title: "Money going out",
        blocks: [
          {
            kind: "text",
            text: "This is the half nobody else does, and the half people remember. “Where did our money go” is answered with a list.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "Money out tab → Record money out",
                detail:
                  "Handed to the church, spent on the purpose, withdrawn and held by a person, or refunded.",
              },
              {
                title: "Two people have to approve it",
                detail:
                  "By default — more eyes than money coming in, deliberately. Recording it counts as the first. One objection holds it.",
              },
              {
                title: "Attach the receipt",
                detail: "The invoice, the transfer slip, the photo of the receipt.",
              },
            ],
          },
          {
            kind: "note",
            text: "Only “Handed to the church” can be recorded in Finance, because it is the only one where the money actually reaches the church's books. It writes a single income row when it is fully approved.",
          },
          {
            kind: "warning",
            text: "You cannot pay out more than the collection is holding, and anything already waiting for approval is counted as committed — so two people cannot each take out the whole balance.",
          },
        ],
      },
      {
        title: "People who are not members yet",
        blocks: [
          {
            kind: "text",
            text: "Names typed into a collection are not members of your church register, and that is fine — it is how a real collection starts. When you are ready, match them up.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "Contributions → the “to match” button",
                detail:
                  "It lists everyone in your collections who is not on the register yet, strongest suggestions first.",
              },
              {
                title: "Accept a match, or add them to the register",
                detail:
                  "A suggestion based on the same email address or the same phone number is near-certain. One based only on the same name is a genuine guess, and is marked as one.",
              },
              {
                title: "One decision covers every collection",
                detail:
                  "The same woman appears in the choir levy, the harvest collection and last year's gift. You confirm once.",
              },
            ],
          },
          {
            kind: "note",
            text: "If she was already on the list twice — typed by hand in week one, added properly in week three — accepting the match joins them. Her payments move onto one row and nothing is lost.",
          },
        ],
      },
      {
        title: "Closing it off",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Close it",
                detail:
                  "No new payments. The link keeps working, so people can still see the record.",
              },
              {
                title: "Mark it settled",
                detail:
                  "When every naira is accounted for. It will not let you, and will tell you why, if anything is still waiting to be confirmed or approved.",
              },
            ],
          },
          {
            kind: "example",
            title: "The choir at Grace Chapel",
            lines: [
              "Sister Bisi starts “Choir uniform levy” at 5,000 each and pastes the 40 names from the choir WhatsApp group. The goal works itself out: 200,000.",
              "She shares the link in the group. Over two Sundays, 23 people give — some by transfer, recording it themselves on the link, some in cash at rehearsal.",
              "One sister says she paid 5,000 but it shows 2,500. Bisi disputes it; the assistant checks the bank alert and confirms. Two confirmations, so it counts. Nobody argued for a week about it.",
              "The tailor's deposit of 80,000 goes out — Bisi records it, the choir treasurer approves it, and it appears on the link under “Where the money went”.",
              "When the uniforms arrive she marks it settled. The whole thing is one CSV if the committee asks.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Do I have to be a church administrator to run one?",
        a: "No. If you lead a group, you can start and run a collection for that group. That is the point — the person who actually runs the choir levy is almost never an administrator.",
      },
      {
        q: "Does someone need an account to give, or to see the link?",
        a: "No. The link needs no sign-in and nothing to install. They can also record their own payment on it, and you confirm it afterwards.",
      },
      {
        q: "Can somebody with the link change the total?",
        a: "No. Anything they record shows as awaiting confirmation and is not counted until somebody in the church confirms it. They cannot touch anybody else's record.",
      },
      {
        q: "Is this money in the church's accounts?",
        a: "Not until you record that it was handed over. A collection is money the group is holding. Only “Handed to the church” can be recorded in Finance.",
      },
      {
        q: "Why is the total lower than the payments I can see?",
        a: "Because the total only counts payments that have been confirmed. Anything still awaiting confirmation, or disputed, is shown separately — it is a claim, not yet money.",
      },
      {
        q: "What happens to the receipts people upload?",
        a: "They count toward your church's file storage, and they are released a year after a collection is settled to free that space up. The record that a receipt existed is always kept. If you need to keep the files, turn on “Keep receipt files for good” on that collection.",
      },
      {
        q: "Can I get the whole thing as a spreadsheet?",
        a: "Yes — Download CSV on the Payments tab gives you the money in, the money out and the list of people on one sheet, including who confirmed each payment. Reports also has three contribution datasets.",
      },
      {
        q: "Someone gave but does not want their name shown. Can I hide it?",
        a: "Yes, two ways. For one person: the ⋮ beside their name on the People tab → Hide this name publicly. For everybody: the switch at the top of that tab. Either way the amounts stay on the page and your team still sees the real names. Somebody filling in the “I have paid” form can also tick “Don’t show my name” for themselves — though only if they are new to the list, because the names on that page are not secret and a tickbox must not be able to change a row that already belongs to somebody else.",
      },
    ],
    links: [
      { label: "Contributions", href: "/contributions" },
      { label: "People to match", href: "/contributions/people" },
      { label: "Groups & ministries", href: "/groups" },
      { label: "Reports", href: "/reports" },
    ],
    tip: "Share the link once at the start, not at the end. The reason a collection stalls is that nobody can see how close it is — and the reason people argue afterwards is that nobody could see it all along.",
    related: ["giving", "finance", "groups"],
    keywords: [
      "contribution",
      "contributions",
      "levy",
      "levies",
      "dues",
      "collection",
      "collect money",
      "group",
      "department",
      "ministry",
      "choir",
      "harambee",
      "ajo",
      "esusu",
      "adashe",
      "chama",
      "gift",
      "birthday",
      "bless",
      "pot",
      "together",
      "share link",
      "whatsapp",
      "receipt",
      "proof",
      "dispute",
      "confirm",
      "transparency",
      "payout",
      "handover",
      "anonymous",
      "hide names",
      "hide name",
      "privacy",
      "share on whatsapp",
      "whatsapp message",
      "send as text",
    ],
  },
];
