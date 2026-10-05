import type { Guide } from "./types";

export const LINK_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "links-and-qr",
    title: "Short links & QR codes",
    category: "content",
    icon: "links",
    summary:
      "One short address you can read out from the front — and change where it goes afterwards, without reprinting anything. Plus QR codes with your logo or your initials in the middle, adjusted automatically so they always scan.",
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
            kind: "text",
            text: "Four questions, and the code is adjusted for you so that it always scans. There is nothing to get right, and nothing that can be saved broken.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "New QR code",
                detail:
                  "Or press the QR code button beside the share link on a form, your public page or a group collection — it opens with the address already filled in.",
              },
              {
                title: "Paste where it should go",
                detail:
                  "A web address, straight in. You can leave off the https://. For anything else — your WiFi, a phone call, a WhatsApp message already written, a contact card — change the dropdown above the field.",
              },
              {
                title: "Pick a look and a colour",
                detail:
                  "Six looks, each drawn as itself so you can see what you are choosing. Any colour: if the one you pick is too light for a camera, a darker shade of the same colour is used and it says so under the preview.",
              },
              {
                title: "Put your logo or your initials in the middle",
                detail:
                  "Nothing, your church’s initials, or your logo. Whichever you choose, the code is rebuilt around it — stronger error correction, and a denser grid if it needs one — so a middle never costs you a working code.",
              },
              {
                title: "Add words underneath, if you want",
                detail:
                  "Optional, and worth it: a code with nothing beside it gets scanned far less often than one that says what it is for.",
              },
              {
                title: "Check where it goes, then download",
                detail:
                  "Beside the preview it says in plain text exactly what scanning it opens, with a button to open it yourself. PNG for a screen or a WhatsApp message; SVG for anything going to a printer.",
              },
            ],
          },
          {
            kind: "note",
            text: "There used to be thirty settings here — fourteen dot shapes, eight corner styles, gradients, an error-correction level, a grid size — and a panel that told you what was wrong with whatever you had chosen. Most combinations warned and some could not be saved at all. Everything that decides whether a code works is now worked out for you, so the settings that remain are only about how it looks.",
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
        title: "How it makes sure it scans",
        blocks: [
          {
            kind: "text",
            text: "A beautiful QR code that does not scan is worse than a plain one, and you find out weeks later, on four hundred printed flyers, with nothing in the preview having looked wrong. So the code is measured — and then adjusted until it passes, rather than reported on.",
          },
          {
            kind: "table",
            headers: ["What is measured", "What is done about it"],
            rows: [
              [
                "Contrast between your colour and the paper",
                "If a camera could not tell them apart, a darker shade of the same colour is used. The same colour, darker — never swapped for black.",
              ],
              [
                "What the middle costs, in error-correction codewords",
                "Counted exactly rather than estimated as a percentage of the picture, which is the figure every other generator quotes and is up to eightfold wrong. The correction level is then raised until the middle sits inside half the budget, leaving the other half for a crease, a glare or a thumb.",
              ],
              [
                "Whether the middle reaches the code’s own markings",
                "The grid is made denser until it does not — or, only if nothing else works, the middle is made slightly smaller. You are told either way.",
              ],
              [
                "The border and the dot size",
                "Fixed at the standard’s four squares, with the dots always filling their cells. Both were settings, and both were only ever a way to break the code.",
              ],
            ],
          },
          {
            kind: "text",
            text: "Anything adjusted is listed under the preview, one line each: “We used a darker shade of your colour”, “We turned the error correction up”. Nothing is changed silently, and nothing waits for your approval.",
          },
          {
            kind: "text",
            text: "There is one further check, and it is optional. “Read it back” draws the finished picture, samples every square the way a camera does, and compares what came back against what was encoded. It is a reassurance rather than a gate — worth pressing before a big print run.",
          },
        ],
      },
      {
        title: "When something looks off",
        blocks: [
          {
            kind: "table",
            headers: ["What you see", "What is happening"],
            rows: [
              [
                "The colour came out darker than the one I picked",
                "It was too light for a camera to separate from the paper. The line under the preview says so. Pick a darker colour yourself if you would rather choose which shade.",
              ],
              [
                "The code got bigger when I added my logo",
                "A logo covers squares, and the only way to make that recoverable is to have more of them. This is the code being made to work, not something going wrong.",
              ],
              [
                "No preview at all",
                "The destination is empty, or what it points at is too long for any QR code. Point it at a short link instead — which is what the message suggests.",
              ],
              [
                "The PNG will not download but the SVG will",
                "An image in the design is on a host that will not let a browser read its pixels back. Upload the logo through the designer rather than pasting a web address, and both will work.",
              ],
              [
                "It scans on my phone but not on an old handheld scanner",
                "Some older handheld and till scanners are fussier than a phone. Choose the Classic look in black for anything that has to work on one of those.",
              ],
              [
                "It will not scan from a printed sheet at all",
                "Almost always printed too small. Each square needs to be about half a millimetre, which for a typical code means roughly 20mm across as an absolute minimum and 30mm to be comfortable.",
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
              "It does not offer gradients, patterned dots, a photograph behind the code, or light dots on a dark background. Those all produced warnings nobody could act on, and none of them is what a church asks for.",
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
        a: "Because a logo covers squares, and the only way to make that recoverable is to have more of them. It is done for you, and the line under the preview says when it happened.",
      },
      {
        q: "Can I still choose the error correction level and the grid size?",
        a: "No, and that is deliberate. Those two decide whether a code with something in the middle works; they follow from what is in the middle rather than from taste; and leaving them to a person is what made most combinations warn. They are worked out for you every time.",
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
