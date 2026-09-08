import type { Guide } from "./types";

export const PUBLIC_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "public-page",
    title: "Your public church page",
    category: "public",
    icon: "public",
    summary:
      "A proper website for your church, without building one — service times, directions, events and a sign-up form, all kept current by itself.",
    whoFor: [
      "Churches with no website",
      "Churches whose website has not been updated since 2019",
    ],
    sections: [
      {
        title: "What you get",
        blocks: [
          {
            kind: "text",
            text: "One address — flockinsight.com/c/your-church — showing everything a visitor wants before they turn up. The parts that go stale on an ordinary website update themselves here, because they come from the same records you already keep.",
          },
          {
            kind: "table",
            headers: ["Section", "Where it comes from"],
            rows: [
              ["Service times", "Settings → Services, automatically"],
              ["Upcoming events", "Your public events, automatically"],
              ["Logo, cover, photos, about", "Settings → Public page"],
              ["Address and directions", "Settings → Public page"],
              ["Newsletter sign-up", "Built in"],
            ],
          },
        ],
      },
      {
        title: "Set it up",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → Public page",
                detail:
                  "Choose your link name first — 'grace-chapel' gives you flockinsight.com/c/grace-chapel. Short and obvious; you will be saying it out loud.",
              },
              {
                title: "Add your logo and a cover image",
                detail:
                  "The cover is the big picture at the top. A wide shot of a full auditorium works far better than an empty building.",
              },
              {
                title: "Write your tagline and about",
                detail:
                  "Two sentences, written for a stranger deciding whether to visit on Sunday — not your constitution.",
              },
              {
                title: "Add address, landmarks and map location",
                detail:
                  "Landmarks matter more than the street address in most Nigerian cities. 'Opposite the GTB on Allen Avenue' gets someone there; a postcode does not.",
              },
              {
                title: "Add contact details and social links",
                detail: "A phone number somebody actually answers.",
              },
              {
                title: "Pick a colour theme",
                detail:
                  "Seven to choose from under Branding. It sets the accent colours and the hero, so the page looks like your church rather than like ours.",
              },
              {
                title: "Fill the gallery",
                detail:
                  "A handful of real photos of real services. Nothing sells a church like seeing people in it.",
              },
            ],
          },
        ],
      },
      {
        title: "Being found",
        blocks: [
          {
            kind: "bullets",
            items: [
              "List in public directory decides whether people browsing for a church near them can find you. Leave it on unless you have a reason not to.",
              "Copy link or Share puts the address where you need it — WhatsApp status, Instagram bio, your printed bulletin.",
              "The Invite card on your dashboard is the quickest way to hand the link to a member so they can share it.",
              "Verify your church for the blue tick beside your name. See the Verification guide.",
            ],
          },
        ],
      },
      {
        title: "The newsletter sign-up",
        blocks: [
          {
            kind: "text",
            text: "Built into the page. Anyone — not only members — can leave their name and email. They land in Devotionals → Subscribers, where you can email them devotionals and newsletters for free. Over a year this quietly becomes one of the most useful lists your church has.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Do I need to buy a domain name?",
        a: "No. The flockinsight.com/c/ address works immediately and costs nothing. If you already own a domain, point it at your page.",
      },
      {
        q: "Can I change the link name later?",
        a: "Yes, but anything printed with the old one stops working. Settle it before the flyers go to press.",
      },
      {
        q: "Why is my page not showing service times?",
        a: "There are no services set up, or none have a day and time. Settings → Services.",
      },
      {
        q: "Can I hide the page while I work on it?",
        a: "Switch off the public listing while you build it, then turn it on when you are happy.",
      },
    ],
    links: [
      { label: "Edit public page", href: "/settings/public" },
      { label: "Browse the directory", href: "/churches" },
      { label: "Verification", href: "/settings/verification" },
    ],
    tip: "Put the link in every WhatsApp group your church runs. It answers 'what time is service?' and 'where are you?' for the rest of the year.",
    related: ["verification", "events", "devotionals"],
    keywords: ["public", "page", "website", "invite", "share", "directory", "profile", "link"],
  },

  {
    slug: "verification",
    title: "Verifying your church",
    category: "public",
    icon: "verification",
    summary:
      "Confirm the email address and phone number on your account, and earn the blue tick beside your church's name.",
    whoFor: ["The church owner or administrator"],
    sections: [
      {
        title: "Why bother",
        blocks: [
          {
            kind: "bullets",
            items: [
              "It proves the email and phone on your account really belong to you, so we can always reach you about a payment, a suspension or a sender ID decision.",
              "It stops anybody quietly changing those details behind your back.",
              "It puts a blue tick beside your church's name on your public page and in the directory — visitors can see yours is a real, contactable congregation.",
            ],
          },
          {
            kind: "note",
            text: "Until you verify, a reminder sits on your dashboard. It does not limit anything you can do — it is simply a job worth finishing.",
          },
        ],
      },
      {
        title: "How to do it",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settings → Verification",
                detail:
                  "Your account email and phone number are listed, each with its own Verify button.",
              },
              {
                title: "Press Verify",
                detail:
                  "A 6-digit code is sent — by email to the address, or by SMS to the number.",
              },
              {
                title: "Type the code in",
                detail:
                  "Codes last 10 minutes. If one expires or never arrives, start again for a fresh one. Check your spam folder for email codes.",
              },
            ],
          },
          {
            kind: "note",
            text: "The SMS code comes from FlockInsight and costs you nothing. It does not touch your wallet and does not need your own sender ID approved — so you can verify on day one.",
          },
        ],
      },
      {
        title: "Changing the email or phone later",
        blocks: [
          {
            kind: "text",
            text: "Same page — press Change, type the new detail, and enter the code sent to it. Nothing is saved until that code comes back. That is deliberate: it stops anyone entering an address they do not own, and it means the tick always refers to details somebody actually proved.",
          },
          {
            kind: "warning",
            text: "Changing a detail clears its tick until the new one is confirmed. Your church will briefly show as unverified.",
          },
        ],
      },
      {
        title: "Three different contacts — don't mix them up",
        blocks: [
          {
            kind: "table",
            headers: ["Contact", "Where it lives", "Who sees it"],
            rows: [
              ["Account contact", "Settings → Verification", "Only us — for account matters"],
              ["Public contact", "Settings → Public page", "Anyone visiting your page"],
              ["Login email", "Each person's own account", "Only that person"],
            ],
          },
          {
            kind: "text",
            text: "They can all be the same address if you like. They are separate so that changing the number on your public page does not affect how we reach you about a payment.",
          },
        ],
      },
      {
        title: "What comes next",
        blocks: [
          {
            kind: "text",
            text: "There is a second step after this, where a church leader provides an ID document to fully confirm the church. It is not open yet — there is nothing to send now, and we will get in touch when there is.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "The SMS code never arrived.",
        a: "Check the number is correct and complete, including the country code if you are outside Nigeria. Try again for a fresh code, and use email verification in the meantime.",
      },
      {
        q: "Do I need to verify to use FlockInsight?",
        a: "No. Everything works unverified. Verification earns the tick and secures your account contacts.",
      },
      {
        q: "Can two churches verify the same phone number?",
        a: "Use the church office's own number. A number shared across churches will cause confusion when we need to reach the right one.",
      },
    ],
    links: [
      { label: "Verification", href: "/settings/verification" },
      { label: "Public page", href: "/settings/public" },
    ],
    tip: "Verify the church office's address and number rather than one person's. They outlast whoever currently holds the role.",
    related: ["public-page", "billing", "contact-support"],
    keywords: ["verify", "verification", "tick", "badge", "confirm", "code", "otp"],
  },
];
