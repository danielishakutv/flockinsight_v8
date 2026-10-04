import type { Guide } from "./types";

export const LINK_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "links-and-qr",
    title: "Short links & QR codes",
    category: "content",
    icon: "links",
    summary:
      "One short address you can read out from the front — and change where it goes afterwards, without reprinting anything. Plus QR codes in your own colours, checked to be sure they will really scan.",
    whoFor: [
      "Whoever makes the bulletin, the flyers and the slides",
      "Media and communications teams",
      "Anyone who has ever read a long web address out to a congregation",
    ],
    sections: [
      {
        title: "The problem it solves",
        blocks: [
          {
            kind: "text",
            text: "A church prints four hundred flyers in November with a QR code for the carol service registration. In December the form moves, or the date changes, or the giving page gets a new address. The flyers are now litter, and nobody can do anything about it because a printed code is permanent.",
          },
          {
            kind: "text",
            text: "A short link is the one thing that fixes that. The code points at flockinsight.com/l/carols, and flockinsight.com/l/carols points wherever you say — today, and differently next week. The printed thing never has to change again.",
          },
          {
            kind: "note",
            text: "It also means you can read a link out loud. “Go to flockinsight.com slash L slash give” is something a congregation can actually write down.",
          },
        ],
      },
      {
        title: "Making a short link",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Open Links & QR codes, then New short link",
                detail:
                  "It sits beside Forms in the menu. Anyone with permission to view it can see the figures; creating and editing needs the manage permission.",
              },
              {
                title: "Paste where it should go",
                detail:
                  "Your giving page, a form, a Google Doc, a YouTube video — anything with an address. You can leave off the https://.",
              },
              {
                title: "Choose the short word",
                detail:
                  "Short and easy to say: give, carols, newhere, cells. Or press Suggest and one is made for you, leaving out the characters people get wrong.",
              },
              {
                title: "Add a note for your future self",
                detail:
                  "“On the back of the 2026 carol service flyer.” In two years this is the only thing that will tell you whether the link is safe to change.",
              },
            ],
          },
          {
            kind: "note",
            text: "A suggested code never contains 0, o, 1, l or i. Those are the five characters people mistake for each other when reading a link off a poster, and they are the commonest reason a short link does not work for the person who needed it.",
          },
        ],
      },
      {
        title: "Changing where a link goes",
        blocks: [
          {
            kind: "text",
            text: "Open the link from the list, press Edit, and change the address. It takes effect at once, everywhere — including on everything already printed. Every address the link has ever pointed at is kept on its page, with who changed it and when, so you can always see what it used to do.",
          },
          {
            kind: "warning",
            text: "Changing where it GOES is safe and is the whole point. Changing the short word itself breaks every printed copy, and frees the old word for another church to take. The edit screen warns you when you are about to do the second one.",
          },
        ],
      },
      {
        title: "Pausing and retiring",
        blocks: [
          {
            kind: "table",
            headers: ["State", "What a visitor sees", "When to use it"],
            rows: [
              [
                "Live",
                "They go straight where you pointed it",
                "Normal.",
              ],
              [
                "Paused",
                "A page saying the link is paused and may come back",
                "Registration closed for now; a form being rewritten.",
              ],
              [
                "Retired",
                "A page saying it has been retired and there may be a newer link",
                "Last year's event. The word stays reserved to you, so nobody else can take it and send your old flyers somewhere unexpected.",
              ],
              [
                "Expired",
                "A page saying it stopped working on a date",
                "Set a date and it stops itself — useful for a code on a ticket.",
              ],
            ],
          },
          {
            kind: "note",
            text: "Each of those is a different page with a different sentence, on purpose. “This link is not available” covering four situations means nobody — not the visitor, not whoever they ring about it — can tell which one it is.",
          },
        ],
      },
      {
        title: "Making a QR code",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "New QR code",
                detail:
                  "Or press the QR code button that now sits beside the share link on a form, your public page and a group collection — it opens the designer with the address already filled in.",
              },
              {
                title: "Decide what scanning it should do",
                detail:
                  "Eleven things, not just a web address: your WiFi, a phone call, a WhatsApp message already written, a contact card, a place on the map, an event a phone can add to its calendar.",
              },
              {
                title: "Pick a look",
                detail:
                  "Twelve complete designs, each shown drawn as itself and each already in your church's colour. Picking one keeps whatever you have put in the middle.",
              },
              {
                title: "Change anything you like",
                detail:
                  "Fourteen dot shapes, eight corner styles, gradients, bands of colour, your logo or your initials in the middle, a caption frame. Every change redraws instantly.",
              },
              {
                title: "Read the check beside the preview",
                detail:
                  "This is the part that matters. See below.",
              },
              {
                title: "Download",
                detail:
                  "PNG for a screen or a WhatsApp message. SVG for anything going to a printer — it has no resolution to get wrong and prints at any size.",
              },
            ],
          },
        ],
      },
      {
        title: "Dynamic codes: the one to use for anything printed",
        blocks: [
          {
            kind: "text",
            text: "Choose “One of your short links” as what the code points at, and the code encodes your short link rather than the final address. You can then change the destination for ever afterwards, and the printed code follows.",
          },
          {
            kind: "text",
            text: "It also means the code counts its own scans. A camera sends nothing that identifies it, so a scan and somebody typing the link look identical — unless the code carries a mark, which a code made here does. That is why the figures can tell you “nineteen people scanned the poster and four typed it in”.",
          },
          {
            kind: "note",
            text: "Short links are on the Growth plan, because they are a redirect we serve on every scan for as long as the poster exists. The QR designer itself is on Starter, because it runs entirely on your own phone and costs us nothing.",
          },
        ],
      },
      {
        title: "Will it scan? — what the checks actually do",
        blocks: [
          {
            kind: "text",
            text: "A beautiful QR code that does not scan is worse than a plain one, and you find out weeks later, on four hundred printed flyers, with nothing in the preview having looked wrong. So every design is measured rather than eyeballed, and every finding tells you the number behind it.",
          },
          {
            kind: "table",
            headers: ["The check", "What it measures", "Why it matters"],
            rows: [
              [
                "Contrast",
                "The ratio between the darkest your dots get and the lightest your background gets",
                "Under about 3:1 a camera cannot tell them apart at all. A church foyer is much dimmer than the screen you are choosing the colour on.",
              ],
              [
                "What the middle costs",
                "How many codewords your logo covers, counted exactly",
                "Error correction repairs whole codewords of eight dots each — so the usual “your logo covers 9% of the picture” is up to eight times wrong in either direction. This counts the real ones.",
              ],
              [
                "What is left over",
                "The codewords still spare after the decoration",
                "That spare capacity is what survives a crease, a glare, a thumb over the corner and a cheap printer. About half is as much as a logo should take.",
              ],
              [
                "The structure",
                "Whether anything covers the three corner squares, the dotted lines or the format strip",
                "Those carry no redundancy at all. Covering them is fatal, so it is refused rather than warned about.",
              ],
              [
                "Printed size",
                "How many millimetres across each dot would be",
                "Under about 0.4mm no camera can resolve it however good the design is. More codes fail from being printed too small than from any decorative choice.",
              ],
            ],
          },
          {
            kind: "text",
            text: "Then there is “Read it back”, which does something different and stronger: it draws the finished picture, samples every dot the way a camera does, and compares what came back against what was encoded. It reports how many dots read wrong and can show you exactly where on the code. That is the only honest answer when your dots are filled with a photograph, and the map is usually the diagnosis — a ring around the middle is the logo, a drift across one corner is the photograph, a scatter through the whole field is the contrast.",
          },
        ],
      },
      {
        title: "The badge beside the preview",
        blocks: [
          {
            kind: "table",
            headers: ["It says", "It means"],
            rows: [
              ["Scans anywhere", "Good contrast, nothing spent on decoration. Print it."],
              ["Scans", "Fine. Something is using up a little margin."],
              [
                "Scans on screen — test a print",
                "It works, and it is close enough to the edge that paper, a fold or a dim room could tip it. Print one and try it before ordering four hundred.",
              ],
              [
                "Will not scan",
                "Something is definitely wrong and the findings say which. It cannot be saved in this state.",
              ],
            ],
          },
          {
            kind: "note",
            text: "There are four states rather than two because the middle one is the commonest outcome of a bold design, and collapsing it into either “fine” or “broken” is how churches end up printing the broken one.",
          },
        ],
      },
      {
        title: "When it looks wrong",
        blocks: [
          {
            kind: "table",
            headers: ["What you see", "What is happening", "What to do"],
            rows: [
              [
                "“Not enough contrast”",
                "Your brand colour is lighter than a camera can separate from the background",
                "Use a darker shade of the same colour. The check tells you the ratio you have; anything over 4.5:1 stops mattering which phone.",
              ],
              [
                "“The middle covers more than the code can recover”",
                "The logo is too big for this grid",
                "Three ways out, and the right one depends on you: make the logo smaller, raise the error correction, or raise “Smallest grid”. A denser grid has more codewords, so the same logo costs proportionally less.",
              ],
              [
                "The letters look like noise",
                "Letters only read as letters on a small grid",
                "Point the code at a short link instead of a long address. A shorter message makes a smaller grid and bigger letters.",
              ],
              [
                "The PNG will not download but the SVG will",
                "An image in the design is on a host that will not let a browser read its pixels back",
                "Upload the logo or photograph through the designer rather than pasting a web address, and both will work.",
              ],
              [
                "“This check could not run”",
                "Same cause, and the design itself may be perfect",
                "It is the check that failed, not the code. Nothing needs changing unless the other findings say so.",
              ],
              [
                "Your phone scans it and an old scanner does not",
                "Probably light dots on a dark background",
                "Some older handheld and till scanners refuse an inverted code outright. If it is going anywhere other than a phone, test it on that device.",
              ],
            ],
          },
        ],
      },
      {
        title: "A WiFi code for the welcome desk",
        blocks: [
          {
            kind: "example",
            title: "Grace House stops reading the password out",
            lines: [
              "New QR code → WiFi.",
              "Network name exactly as it appears in the list of networks, including capital letters.",
              "Password typed exactly as it is — semicolons and colons are handled.",
              "Pick the Welcome desk look, print it small, put it in an acrylic holder on the desk.",
              "Visitors join by pointing a camera at it. Nobody reads a password out again.",
            ],
          },
          {
            kind: "warning",
            text: "A WiFi code carries the password inside it — that is how it works. So the printed code deserves the same care as the password itself. Put it on your guest network, not the one the office computers are on.",
          },
        ],
      },
      {
        title: "What it does not do",
        blocks: [
          {
            kind: "bullets",
            items: [
              "It does not record who followed a link. The figures are totals per day, per source and per device, and nothing identifies a person — which is also the only way to be certain it cannot leak.",
              "It cannot tell a WhatsApp share from somebody typing the link. WhatsApp and most apps send nothing that says where a click came from, so both are counted as direct.",
              "It cannot check what your code looks like printed. It can tell you the millimetres per dot and that is genuinely most of it — but a test print costs one sheet of paper.",
              "The scannability findings are in English, like the rest of the written guides, even where the app itself is in another language.",
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: "Can I use my own domain instead of flockinsight.com?",
        a: "Not yet. Every short link is on flockinsight.com/l/… for now.",
      },
      {
        q: "If I delete a QR code design, do the printed ones stop working?",
        a: "No. Deleting a design only removes it from your list — the code itself is just a picture, and every printed copy keeps working. What stops a printed code working is pausing or retiring the short link it points at.",
      },
      {
        q: "Why does my code look bigger after I added a logo?",
        a: "Because a logo covers dots, and the only way to make that recoverable is to have more dots. The designer raises the grid for you when you make the middle larger, so the logo cannot reach the parts of the code that nothing can repair.",
      },
      {
        q: "Can two churches have the same short word?",
        a: "No. A short link has no church in it, so each word belongs to exactly one church — and stays yours even after you retire it, so your old flyers can never start pointing somewhere unexpected.",
      },
      {
        q: "What happens to a code if we move to a smaller plan?",
        a: "Nothing you have already made disappears. The figures and the designs stay readable; you cannot create or edit short links until the plan covers them again. Existing links keep redirecting.",
      },
      {
        q: "Does a QR code expire?",
        a: "The picture never does. The short link behind it can be given a date if you want it to stop working — otherwise it works until you pause or retire it.",
      },
    ],
    links: [
      { label: "Links & QR codes", href: "/links" },
      { label: "Forms", href: "/forms" },
      { label: "Your public page", href: "/settings/public" },
    ],
    tip: "For anything that goes to a printer, download the SVG. It prints crisply at any size, the file is smaller than the PNG, and there is no resolution to choose wrongly.",
    related: ["photo-studio"],
    keywords: [
      "qr",
      "qr code",
      "short link",
      "shortener",
      "link",
      "redirect",
      "poster",
      "flyer",
      "bulletin",
      "wifi",
      "scan",
      "dynamic qr",
      "vcard",
      "contact card",
      "whatsapp link",
    ],
  },
];
