import type { Guide } from "./types";

export const STUDIO_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "photo-studio",
    title: "The photo studio",
    category: "content",
    icon: "media",
    summary:
      "Put your church's logo on a whole service's photographs at once, shrink them for WhatsApp, and download the lot as a zip.",
    whoFor: [
      "Media and social media teams",
      "Whoever takes the photos on Sunday",
      "Anyone currently doing this one photo at a time in a phone app",
    ],
    sections: [
      {
        title: "What it is for",
        blocks: [
          {
            kind: "text",
            text: "Every church posts photographs, and every church wants its name on them. Done by hand, the logo lands somewhere different every week, at a different size, and sometimes over somebody's face. The studio puts the same mark in the same place on two hundred photos in one go — and makes each file small enough to actually send.",
          },
          {
            kind: "note",
            text: "Nothing is uploaded. All of the work happens on your own phone or laptop, which is why it is fast on a slow connection and why it uses none of your church's storage.",
          },
        ],
      },
      {
        title: "Your first batch, start to finish",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Open Photo studio from the menu",
                detail:
                  "It sits beside Media. Anyone who can see the media library can use it.",
              },
              {
                title: "Add photos",
                detail:
                  "Tap Add photos, or drag them onto the page, or paste them straight from your clipboard. Up to 100 at a time — do a very big wedding in two batches.",
              },
              {
                title: "Add your logo",
                detail:
                  "Upload the file, or tap “Use my church logo” if you have already set one in Settings. A logo on a plain white background is fine.",
              },
              {
                title: "Tidy the logo",
                detail:
                  "Remove background knocks out the white. Trim blank edges takes off the empty space around it, which is what makes the size slider behave. Crop lets you drag a box around just the part you want.",
              },
              {
                title: "Choose where it goes",
                detail:
                  "Tap one of the nine positions, then set the size, the distance from the edge, and the strength. Watch the preview beside it — that is exactly what you will get.",
              },
              {
                title: "Do portrait and landscape separately",
                detail:
                  "Switch the tab at the top. Each photo automatically uses the settings for its own shape, so a mixed batch comes out consistent without sorting it first.",
              },
              {
                title: "Press Process",
                detail:
                  "It works through them one at a time and shows you how far it has got. A hundred photos takes a couple of minutes on a phone.",
              },
              {
                title: "Download",
                detail:
                  "Download all gives you a single zip file. Or tap the little size badge on any one photo to save just that one.",
              },
            ],
          },
        ],
      },
      {
        title: "Getting the logo right",
        blocks: [
          {
            kind: "table",
            headers: ["Problem", "What to do"],
            rows: [
              [
                "A white box around the logo",
                "Turn on Remove background. If a pale halo is left, raise the slider.",
              ],
              [
                "The logo itself is disappearing",
                "Lower the Remove background slider. It only ever works inward from the edges, so white inside a letter is never touched.",
              ],
              [
                "The logo looks tiny even at 30%",
                "Turn on Trim blank edges — most of that 30% is empty space in the file.",
              ],
              [
                "It is sitting on somebody's face",
                "Move it to a corner, or use bottom-centre for portraits. Portrait photos are nearly always a person, and the bottom corners are where hands and elbows end up.",
              ],
              [
                "It is too loud",
                "Drop the strength to 70–80%. A watermark that competes with the photograph gets cropped out by whoever shares it.",
              ],
            ],
          },
        ],
      },
      {
        title: "Size, shape and quality",
        blocks: [
          {
            kind: "text",
            text: "The quality is preserved; the file size is not. A 4MB photo straight off a camera usually comes out under 500KB with nothing you can see lost — which is the difference between a service's photos being shareable on WhatsApp and not.",
          },
          {
            kind: "table",
            headers: ["Setting", "Use it for"],
            rows: [
              ["Social (1600px)", "WhatsApp, Instagram, Facebook, your website. The right answer nearly always."],
              ["Large (2400px)", "A projector, or a photo somebody might crop into later."],
              ["Print (3200px)", "A banner or a printed programme."],
              ["Original size", "When somebody has specifically asked for the full-resolution file."],
              ["Square · 1:1", "Instagram grid posts."],
              ["Portrait · 4:5", "The biggest an Instagram feed post can be."],
              ["Story · 9:16", "WhatsApp status, Instagram and Facebook stories."],
              ["WebP / JPEG", "WebP is about a third smaller and works on every modern phone. Choose JPEG if you are handing the file to a printer."],
            ],
          },
          {
            kind: "note",
            text: "Shapes other than “As taken” crop from the middle outward, so check the preview before processing a hundred — a square crop can cut somebody out of their own photograph.",
          },
        ],
      },
      {
        title: "A line of text",
        blocks: [
          {
            kind: "text",
            text: "Turn on A line of text to burn the service and the date, a sermon title or a verse onto the photo. Because it is part of the image, it survives being forwarded — unlike a caption, which is lost the moment somebody saves the picture.",
          },
          {
            kind: "bullets",
            items: [
              "The quick buttons add your church's name, today's date, or “Sunday Service” without typing.",
              "Leave the shade behind the words on. White text over a bright sky is unreadable, and you cannot tell which photos have one until you look at all of them.",
            ],
          },
        ],
      },
      {
        title: "Save it as your church's brand",
        blocks: [
          {
            kind: "text",
            text: "Once it looks right, give the settings a name and save them. Everyone in your church then opens the studio with the same position, size, strength and output settings — on any phone. That is the part that makes four volunteers produce one consistent look.",
          },
          {
            kind: "note",
            text: "The settings are saved for the whole church; the logo file itself is not. Upload the logo once per device, or set it under Settings so “Use my church logo” is one tap.",
          },
        ],
      },
      {
        title: "Two things it quietly does for you",
        blocks: [
          {
            kind: "bullets",
            items: [
              "It removes the hidden location data. A photo taken on a phone carries the GPS coordinates of where it was taken — including inside a member's home. Processing a photo here strips that, so you are not publishing somebody's address along with the picture.",
              "It respects how the phone was held. Photos that come out sideways in other tools come out the right way up here, which also means the watermark lands where you put it.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Are my photos uploaded anywhere?",
        a: "No. They are processed on your own device and never sent to us. That is also why it uses none of your 200MB storage and works on a weak connection.",
      },
      {
        q: "Does it work on a phone?",
        a: "Yes — it is built for one. A hundred photos takes a couple of minutes. Keep the tab open while it works; switching apps mid-batch can make the browser stop it.",
      },
      {
        q: "Why is there a limit of 100 photos?",
        a: "Each photo has to be opened up to its full pixel size to be processed, and your phone holds the finished ones until you download them. Past a hundred, a phone runs out of memory and the tab closes with no explanation — so the limit is there to stop that happening, not because the tool cannot cope.",
      },
      {
        q: "Can I undo the background removal?",
        a: "Yes. Every control re-derives from the logo you uploaded, so you can turn anything off, move a slider back, or start again without re-uploading.",
      },
      {
        q: "The zip will not open on my computer",
        a: "It is a standard zip and opens with the built-in tools on Windows, Mac, Android and iPhone. If one photo seems missing, check whether two of your originals had the same filename — the studio numbers the second one rather than overwriting it.",
      },
      {
        q: "Can I put the logo on a video?",
        a: "Not yet. This is photographs only. Videos go in the media library as they are.",
      },
    ],
    links: [
      { label: "Photo studio", href: "/studio" },
      { label: "Media library", href: "/media" },
      { label: "Set your church logo", href: "/settings" },
    ],
    tip: "Set it up once, save it as your brand, and Sunday's job becomes: add photos, press Process, download. Everything before that is a one-off.",
    related: ["media", "public-page"],
    keywords: [
      "watermark",
      "logo",
      "photos",
      "pictures",
      "images",
      "compress",
      "resize",
      "batch",
      "zip",
      "branding",
      "social media",
      "instagram",
      "whatsapp status",
      "crop",
      "remove background",
    ],
  },
];
