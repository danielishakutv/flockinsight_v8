import type { Guide } from "./types";

export const CONTENT_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "media",
    title: "The media library",
    category: "content",
    icon: "media",
    summary:
      "Keep sermons, photos, bulletins and flyers in one place, and share any of them with a link.",
    whoFor: ["Media teams", "Anyone currently sending sermons through WhatsApp"],
    sections: [
      {
        title: "Upload",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Media → Upload files",
                detail: "Audio, video, images, PDFs — most file types are accepted.",
              },
              {
                title: "Pick a category",
                detail:
                  "Sermon, Photo, or Document/Other. This is what makes the library findable a year from now.",
              },
              {
                title: "Let it upload in the background",
                detail:
                  "You can carry on using the rest of the app while a large sermon uploads. Images and video are compressed automatically as they go, so they take far less space than the original.",
              },
            ],
          },
        ],
      },
      {
        title: "Share and play",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Copy link gives you a shareable address for WhatsApp, your bulletin or social media.",
              "Audio and video play inside the app — nobody has to download a sermon to listen to it.",
              "Anything can be downloaded where you want people to keep a copy.",
            ],
          },
        ],
      },
      {
        title: "Watch your storage",
        blocks: [
          {
            kind: "text",
            text: "Every church gets 200MB free, shown as a live bar at the top of the library. It goes further than it sounds for audio and documents, and disappears immediately with video.",
          },
          {
            kind: "table",
            headers: ["Roughly", "Uses about"],
            rows: [
              ["A 45-minute sermon as audio", "20–40 MB"],
              ["A 45-minute sermon as video", "300 MB – 1 GB"],
              ["A photo from a phone", "1–3 MB"],
              ["A PDF bulletin", "Under 1 MB"],
            ],
          },
          {
            kind: "note",
            text: "If you record video, put it on YouTube and keep only the audio here. You will not run out of space, and members on limited data will thank you.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can people outside the church open a shared link?",
        a: "Yes. Anyone with the link can open it — that is the point of it. Do not put anything confidential in the library.",
      },
      {
        q: "I ran out of space.",
        a: "Settings → Storage sells more in monthly bundles, paid from your wallet. Or delete old video, which is almost always what filled it.",
      },
      {
        q: "Does deleting a file break links I already shared?",
        a: "Yes. Anyone with the old link gets nothing.",
      },
    ],
    links: [
      { label: "Media library", href: "/media" },
      { label: "Storage", href: "/settings/storage" },
    ],
    tip: "Name files the way you would search for them — 'Faith That Works — Pastor Emeka — 2026-09-07' beats 'recording_final_2.mp3'.",
    related: ["wallet-storage", "public-page", "devotionals"],
    keywords: ["media", "sermon", "audio", "video", "photo", "file", "upload", "storage"],
  },

  {
    slug: "forms",
    title: "Building forms",
    category: "content",
    icon: "forms",
    summary:
      "Make your own sign-up or feedback form, share one link, and have the answers come straight into your church records.",
    whoFor: ["Anyone running a registration", "Follow-up and welcome teams"],
    sections: [
      {
        title: "What churches use forms for",
        blocks: [
          {
            kind: "bullets",
            items: [
              "First-timer cards, as a QR code on the welcome desk.",
              "Event and convention registration.",
              "Membership class sign-ups.",
              "Workers' availability and rota surveys.",
              "Prayer requests.",
              "Feedback after a programme.",
            ],
          },
        ],
      },
      {
        title: "Build it",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Forms → New form",
                detail: "Give it a title and, if you want, a short description at the top.",
              },
              {
                title: "Add your questions",
                detail:
                  "Choose the answer type for each: short text, paragraph, email, phone, number, date, dropdown, multiple choice, checkboxes, or yes/no. Mark the ones that must be answered, and drag to reorder.",
              },
              {
                title: "Choose your own link",
                detail:
                  "Something like flockinsight.com/f/easter-2026. Short and readable, because you will be reading it out from the pulpit.",
              },
              {
                title: "Set it Live",
                detail:
                  "Nothing is collected until you do. Set it Closed when registration ends.",
              },
            ],
          },
          {
            kind: "note",
            text: "Anyone can fill in a live form. They do not need an account, an app, or a login.",
          },
        ],
      },
      {
        title: "The part that saves the most work",
        blocks: [
          {
            kind: "text",
            text: "A form can put people straight into your church records instead of leaving you a spreadsheet to retype.",
          },
          {
            kind: "bullets",
            items: [
              "Match or create a member — if the phone or email matches someone you already have, it links to them; if not, it creates a new member record.",
              "Add them to Follow-up automatically, which is exactly what you want on a first-timer card.",
              "Get an email and an in-app notification on every response, so you know the moment somebody registers.",
              "Each of these is a switch per form, so a feedback survey does not have to create members.",
            ],
          },
          {
            kind: "example",
            title: "A first-timer card that runs itself",
            lines: [
              "Fields: name, phone, email, area, how did you hear about us, prayer request.",
              "Switches on: match or create a member, add to Follow-up, notify the welcome team.",
              "The QR code is printed on a card at the welcome desk.",
              "A visitor scans and fills it in during announcements. By the time the service ends they are a member record, sitting in Follow-up, assigned and waiting for a call — and nobody typed anything.",
            ],
          },
        ],
      },
      {
        title: "Responses",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The count updates live while people are filling it in.",
              "Read responses inside the app, or download the lot as a spreadsheet in one click.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can I edit a form after people have answered?",
        a: "Yes, but be careful — earlier responses will not have answers to a question you added later. For a big change, make a second form.",
      },
      {
        q: "Can I limit it to members only?",
        a: "No. A form link is public by design, so it works for visitors. Ask for a name and phone number if you need to know who answered.",
      },
      {
        q: "How do I make the QR code?",
        a: "Any free QR generator, pointed at your form link. Print it on a card and it lasts as long as the form is live.",
      },
    ],
    links: [
      { label: "Forms", href: "/forms" },
      { label: "Follow-up", href: "/follow-up" },
    ],
    tip: "Keep a first-timer form live permanently. Registration forms come and go, but that one earns its place every single Sunday.",
    related: ["follow-up", "members", "events"],
    keywords: ["form", "survey", "registration", "responses", "signup", "collect", "qr"],
  },

  {
    slug: "devotionals",
    title: "Devotionals & newsletters",
    category: "content",
    icon: "devotionals",
    summary:
      "Write a daily devotional or a weekly newsletter, and email it to members and subscribers for free.",
    whoFor: ["Pastors", "Anyone producing regular written content"],
    sections: [
      {
        title: "Write and send",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Devotionals → New devotional or New newsletter",
                detail: "Add a title, an optional cover image and your message.",
              },
              {
                title: "Choose who receives it",
                detail:
                  "Your members, your subscribers, or both. Subscribers are people who signed up on your public page without necessarily being members.",
              },
              {
                title: "Send now or schedule it",
                detail:
                  "Scheduling is what makes a daily devotional realistic — write a week on Monday and let them go out one a day.",
              },
            ],
          },
          {
            kind: "note",
            text: "This is email, so it is free and unlimited. It does not touch your SMS wallet at all.",
          },
        ],
      },
      {
        title: "Subscribers",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Anyone who signs up on your public page is added automatically.",
              "You can add or remove people by hand.",
              "The full list downloads as a spreadsheet.",
              "Subscribers are a genuine outreach list — people following your church without having joined it.",
            ],
          },
        ],
      },
      {
        title: "Making it sustainable",
        blocks: [
          {
            kind: "example",
            title: "What actually lasts",
            lines: [
              "A weekly newsletter every church can keep up: what happened on Sunday, what is coming, one testimony, one need.",
              "A daily devotional needs a month of content written before you launch. Churches that start without a buffer stop by week three.",
              "Schedule ahead. The pastor who writes seven on a Monday morning still has a devotional going out on the Thursday he is travelling.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Does it cost anything?",
        a: "No. Email is free and unlimited on every plan.",
      },
      {
        q: "Can I send a devotional by SMS?",
        a: "Not from here — this is email. A devotional would run to several SMS pages per person, which gets expensive fast.",
      },
      {
        q: "Someone wants to unsubscribe.",
        a: "Every email has an unsubscribe link, and they are removed automatically. You can also remove them by hand.",
      },
      {
        q: "Can I see who opened it?",
        a: "Devotionals show how many were sent. Detailed open tracking is not part of it.",
      },
    ],
    links: [
      { label: "Devotionals", href: "/devotionals" },
      { label: "Subscribers", href: "/devotionals/subscribers" },
      { label: "Public page", href: "/settings/public" },
    ],
    tip: "Write four weeks ahead before you announce a daily devotional. The announcement is easy; week five is what stops people.",
    related: ["public-page", "communication", "media"],
    keywords: ["devotional", "newsletter", "email", "subscribers", "mailing list", "schedule"],
  },

  {
    slug: "events",
    title: "Events & programmes",
    category: "content",
    icon: "events",
    summary:
      "Publish your crusades, conventions and programmes with a flyer, and have them show up where people are looking.",
    whoFor: ["Anyone announcing a programme"],
    sections: [
      {
        title: "Create an event",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Events → New",
                detail:
                  "Title, date, time and venue. Add the flyer you already designed — it is what people actually look at.",
              },
              {
                title: "Decide whether it is public",
                detail:
                  "A public event appears on your church's public page and in the FlockInsight events directory, where people looking for a church near them can find it. A private one stays internal.",
              },
              {
                title: "Share the link",
                detail:
                  "Every event has its own page you can send to WhatsApp or social media, with the flyer, the details and directions.",
              },
            ],
          },
        ],
      },
      {
        title: "Pair it with a form",
        blocks: [
          {
            kind: "text",
            text: "For anything needing registration — a convention, a marriage seminar, a workers' retreat — build a form and put its link in the event description. You get a flyer people can share and a register that fills itself.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "Will people outside my church see it?",
        a: "Only if you mark it public, in which case it appears in the public events directory. That is usually what you want for a crusade and not what you want for a workers' meeting.",
      },
      {
        q: "What size should the flyer be?",
        a: "Whatever your designer produced. It is resized automatically. A tall portrait flyer looks best on a phone.",
      },
      {
        q: "Can people RSVP?",
        a: "Use a form for that and link it from the event.",
      },
    ],
    links: [
      { label: "Events", href: "/my-events" },
      { label: "Forms", href: "/forms" },
      { label: "Public page", href: "/settings/public" },
    ],
    tip: "Publish the event before you print the flyer, and put its short link on the flyer itself. One address that always has the current details beats a poster nobody can update.",
    related: ["forms", "public-page", "communication"],
    keywords: ["event", "programme", "program", "flyer", "crusade", "conference", "convention"],
  },
];
