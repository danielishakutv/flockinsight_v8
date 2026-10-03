import type { Guide } from "./types";

export const MEETING_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "meetings",
    title: "Virtual meetings",
    category: "meetings",
    icon: "meetings",
    summary:
      "Hold a meeting in the browser — video, voice, screen sharing, scripture on screen and a recording if you want one. Nothing to install, and it holds up on a weak connection.",
    whoFor: [
      "Pastors running midweek prayer, Bible study or counselling",
      "Leadership teams meeting between services",
      "Anyone who has tried to get twelve people onto a call and given up",
    ],
    sections: [
      {
        title: "How it works, in one paragraph",
        blocks: [
          {
            kind: "note",
            text: "Meetings is in beta. It works, and churches are using it — it is newer than the rest of the platform and we are still hardening it, so you will see a Beta label on it. If something goes wrong in a meeting, tell us: that is exactly what the label is asking for.",
          },
          {
            kind: "text",
            text: "You create a meeting, you get a link, you send the link. Whoever opens it types their name and joins — in their browser, on a phone or a laptop, with no app and no account. Audio and video travel directly between the people in the meeting; our server only passes the handshake. That is what keeps it fast and what keeps it free to run.",
          },
          {
            kind: "note",
            text: "Because everyone's video goes to everyone else, quality falls as the room grows. Twelve people is comfortable. Beyond about sixteen, what you want is a livestream, not a meeting — so the room has a limit you can set, and we suggest a sensible one.",
          },
        ],
      },
      {
        title: "Start a meeting",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Meetings → New meeting",
                detail:
                  "Give it a name people will recognise in a WhatsApp message: 'Midweek prayer', not 'Meeting 3'.",
              },
              {
                title: "Leave the date blank to start now",
                detail:
                  "Or pick a date and time — the link then opens on its own ten minutes before, so nobody is staring at an empty room.",
              },
              {
                title: "Choose who can join",
                detail:
                  "Anyone with the link is right for prayer meetings and Bible study. Link plus passcode for a leadership meeting. Signed-in members only when it must be your own people.",
              },
              {
                title: "Share the link",
                detail:
                  "WhatsApp, email or the share button on a phone. The link never changes, so a weekly meeting can use the same one every week.",
              },
            ],
          },
        ],
      },
      {
        title: "A meeting that repeats",
        blocks: [
          {
            kind: "text",
            text: "Most church meetings are the same meeting every week. Set the date and time, then set Repeats, and you never have to create it again: as soon as one finishes, the next is on the calendar with the same settings.",
          },
          {
            kind: "table",
            headers: ["Repeats", "What you get"],
            rows: [
              ["Every day", "The same time, every day."],
              ["Every week", "The same weekday and time — Wednesday prayer at 6pm, for ever."],
              ["Every 2 weeks", "Every other week, keeping the week it started on."],
              [
                "Every month, on the same date",
                "The 5th of each month. A month too short for the date you picked uses its last day rather than slipping into the next month.",
              ],
              [
                "Every month, on the same weekday",
                "The first Sunday, the last Friday. Right for communion services and monthly vigils.",
              ],
            ],
          },
          {
            kind: "bullets",
            items: [
              "The link, the passcode and your host link stay the same every time. Print one link in a bulletin and it keeps working.",
              "Each week is kept separately: its own register, its own recordings, its own chat. 'Who came on the 14th' is a question you can still answer in December.",
              "Only the next one is on the calendar at a time, so the upcoming list stays short and honest.",
              "Edit any occurrence and the ones after it inherit the change. Moving it to a Thursday moves the series to Thursdays.",
              "Last one on sets an end date, if the series is a six-week course rather than something open-ended.",
            ],
          },
          {
            kind: "example",
            title: "Grace Chapel, midweek prayer",
            lines: [
              "Pastor Ada creates 'Midweek prayer', Wednesday 6:00pm, Repeats: every week, Data Saver on by default.",
              "She sends the link once, to the church WhatsApp group.",
              "Every Wednesday she opens that same link. The meeting for the following Wednesday appears the moment she ends it.",
              "In March somebody asks how many came in January. Each Wednesday is its own row on the Meetings page, with its own register.",
            ],
          },
          {
            kind: "note",
            text: "Cancel and Stop repeating are different on purpose. Cancel calls off one week and leaves the series running — a funeral on a Wednesday. Stop repeating keeps that week and ends the series.",
          },
          {
            kind: "warning",
            text: "A series nobody opens stops itself after six missed occurrences, so an abandoned meeting does not keep generating rows for ever. The last one stays on your list and you can put it back on at any time.",
          },
        ],
      },
      {
        title: "Low data mode — read this one",
        blocks: [
          {
            kind: "text",
            text: "Low data mode turns off video in both directions and keeps the voices. It uses roughly a tenth of the data, and on a weak or expensive connection it is the difference between taking part and giving up.",
          },
          {
            kind: "bullets",
            items: [
              "Anyone can turn it on for themselves at any time, from the More menu in the meeting.",
              "It is also offered on the screen before you join, before a camera has ever been opened.",
              "Set it as the default on any meeting where most people will be on mobile data — a midweek prayer meeting, say.",
              "It does not affect anyone else. One person on low data still hears and is heard by everybody.",
            ],
          },
          {
            kind: "example",
            title: "Grace Chapel, Wednesday prayer",
            lines: [
              "Twenty-two people, most of them on phones, most on mobile data.",
              "The meeting is set to low data by default, with the room limit at 16.",
              "The pastor turns their own camera on; everyone else stays on voice.",
              "Data used over 45 minutes: about 7MB each, instead of about 90MB.",
            ],
          },
        ],
      },
      {
        title: "Putting things on everyone's screen",
        blocks: [
          {
            kind: "text",
            text: "A host can put one thing on the shared screen at a time. Everyone sees it, including anyone who joins late.",
          },
          {
            kind: "table",
            headers: ["", "What it is for", "How"],
            rows: [
              [
                "Verse",
                "Reading a passage together.",
                "Type the reference — 'John 3:16', 'Ps 23', '1 cor 13:4-7'. Pick a translation, or paste your own text.",
              ],
              [
                "Slides",
                "A prepared deck, hymn sheets, a sermon outline.",
                "Pick images from your media library, in the order you want them. Export a PowerPoint as images and upload them under Media first.",
              ],
              [
                "Note",
                "A hymn number, an announcement, a name to pray for.",
                "Type it. It shows in very large type.",
              ],
              [
                "Your screen",
                "Anything else at all.",
                "Share your screen — it takes over the main area while it runs.",
              ],
            ],
          },
          {
            kind: "note",
            text: "Verses are fetched once and then kept for good, so the second time anyone anywhere puts John 3:16 on a screen it appears instantly and works even with no internet at our end.",
          },
        ],
      },
      {
        title: "Running the room",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Mute one person, or everyone at once, when somebody leaves their microphone open.",
              "Hands go to the top of the People list, so nobody who wants to speak gets lost in a list of forty.",
              "Make somebody a co-host and they can do all of this too — worth doing before the meeting, not during it.",
              "Turn on the lobby for counselling or a board meeting, and let people in one at a time.",
              "Remove somebody and they stay removed; the link will not let them back in.",
            ],
          },
        ],
      },
      {
        title: "Recording",
        blocks: [
          {
            kind: "text",
            text: "A host can record. Everyone in the room is told the moment it starts — there is no quiet recording, by design.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "More → Record video, or Record audio only",
                detail:
                  "Audio only is roughly a twentieth of the size and is usually what you want for a sermon or a Bible study.",
              },
              {
                title: "The recording is made on your own computer",
                detail:
                  "Nothing is uploaded while the meeting runs, so recording costs you no bandwidth during the call.",
              },
              {
                title: "When you stop, choose what to do with it",
                detail:
                  "Save it to your church media library, or download it to your device. If the upload fails, the file is still on your device and you can try again.",
              },
            ],
          },
          {
            kind: "warning",
            text: "Recording works best on Chrome or Firefox on a laptop. Recording from a phone is possible but it is hard work for the device, and a long meeting can run the battery down or be interrupted by the phone locking.",
          },
        ],
      },
      {
        title: "After the meeting",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The meeting page keeps a register — who joined, when they arrived, when they left and for how long.",
              "One button turns that register into an attendance record, so a midweek meeting counts towards your attendance like any service.",
              "The chat is kept as a transcript.",
              "'Run it again' copies every setting into a fresh meeting with a new link — the weekly meeting in one tap.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can I set up a meeting that happens every week?",
        a: "Yes. Pick the date and time of the first one, then set Repeats to Every week. The next occurrence goes on the calendar as soon as one finishes, and the link you shared keeps working every week — there is nothing to send out again.",
      },
      {
        q: "Does a repeating meeting give everyone a new link each week?",
        a: "No. The link, the passcode and your host link stay the same for the whole series. If somebody opens an older link it takes them to the current meeting.",
      },
      {
        q: "Do people need an account?",
        a: "No. Anyone with the link types a name and joins. Set the meeting to 'Signed-in members only' if you would rather they did need one.",
      },
      {
        q: "Does it work on an iPhone?",
        a: "Yes, in Safari or Chrome. Recording is the one thing that is better done from a laptop.",
      },
      {
        q: "Somebody cannot connect, and everyone else is fine.",
        a: "That is nearly always their network — some mobile networks make a direct connection impossible. Ask them to try Wi-Fi, or ask your administrator whether a relay server is configured for your deployment.",
      },
      {
        q: "How many people can join?",
        a: "You set the limit per meeting, up to 30. We suggest 12. Everyone's video is sent to everyone else, so a large room asks a lot of each person's connection — for a congregation-sized audience, stream it instead.",
      },
      {
        q: "Is the meeting private?",
        a: "The media goes directly between participants and is encrypted in transit; we never see or store it. What we hold is who joined and when, the chat, and anything the host put on the shared screen.",
      },
      {
        q: "Can I use my own translation of a verse?",
        a: "Yes. In the verse box, choose 'Use my own translation' and type or paste the text. It also means the screen works with no internet.",
      },
    ],
    links: [
      { label: "Meetings", href: "/meetings" },
      { label: "Media library", href: "/media" },
      { label: "Attendance", href: "/attendance" },
    ],
    tip: "Set your weekly prayer meeting to repeat every week, with Data Saver on by default, and pin the link in the WhatsApp group. Same link every week, nothing to create and no reminder to send.",
    related: ["attendance", "media"],
    keywords: [
      "meeting",
      "video call",
      "zoom",
      "conference",
      "screen share",
      "record",
      "prayer meeting",
      "bible study online",
      "webinar",
      "low data",
      "recurring meeting",
      "repeat",
      "every week",
      "weekly meeting",
      "schedule",
    ],
  },
];
