import type { Guide } from "./types";

export const LINK_PAGE_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "link-pages",
    title: "Link pages — one address for everything",
    category: "content",
    icon: "links",
    summary:
      "Instagram gives you one link. Your church has eight. A link page is one short address — flockinsight.com/hub/yourchurch — that holds all of them, and you add your own giving pages, forms, livestream and events from a list rather than typing addresses.",
    whoFor: [
      "Whoever runs the church's Instagram, TikTok or WhatsApp status",
      "Media and communications teams",
      "Anyone who has ever changed a bio link three times in one month",
    ],
    sections: [
      {
        title: "The problem it solves",
        blocks: [
          {
            kind: "text",
            text: "Instagram and TikTok allow one link in a bio. A church in one ordinary month wants people to find the giving page, the carol service form, the livestream, the WhatsApp group and the new-members sign-up. So the bio link gets changed every week, and anybody who screenshotted it in November is sent somewhere wrong in December.",
          },
          {
            kind: "text",
            text: "A link page is the one address that never changes. What is on it changes as often as you like — the bio does not.",
          },
          {
            kind: "note",
            text: "It is also the easiest thing to put a QR code on, because the destination stays editable after the flyers are printed. Make the page first, then make a code for it from the same screen.",
          },
        ],
      },
      {
        title: "Making one",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Open Links & QR codes, then New link page",
                detail:
                  "It sits above the QR codes and the short links on that screen.",
              },
              {
                title: "Give it a title and choose the address",
                detail:
                  "The title is what people read at the top of the page — usually just your church's name. The address is the short word after /hub/. Press Suggest and one is made from the title, leaving out the characters people type wrong.",
              },
              {
                title: "Add your links",
                detail:
                  "Two buttons. “Add one of our pages” opens a list of everything your church already has a public link for. “Any other link” is for everything else — a WhatsApp group, a YouTube channel, a Google form.",
              },
              {
                title: "Pick a style",
                detail:
                  "Five of them, and the preview beside you is the real page, not a drawing of it. Your colours come from your church theme in Settings, so a style only decides how they are arranged.",
              },
              {
                title: "Press Publish",
                detail:
                  "Until you do, the address shows nothing at all — not even “coming soon”. Nobody can stumble on a page you are still writing.",
              },
            ],
          },
        ],
      },
      {
        title: "Adding your own pages, without typing addresses",
        blocks: [
          {
            kind: "text",
            text: "This is the part worth knowing about. You should never have to remember that your building fund page lives at /give/grace-building-fund. Press “Add one of our pages”, and everything your church already has a public link for is in a list with the names you gave them.",
          },
          {
            kind: "text",
            text: "There is a dropdown at the top to narrow it by type, and a search box beside it. A church with forty forms and one giving page needs the dropdown; a church with four of everything needs the search.",
          },
          {
            kind: "table",
            headers: ["Type", "What appears in the list"],
            rows: [
              ["Church page", "Your public church page, if you have a handle set"],
              ["Giving page", "Every giving link that is switched on"],
              ["Form", "Every form that is open for answers"],
              ["Group contribution", "Every contribution that is not still a draft"],
              ["Event", "Every event marked as public"],
              ["Livestream", "Your watch pages"],
              ["First-timer welcome", "Your welcome link, if it is turned on"],
              ["Member sign-up", "Your join link, if it is turned on"],
              ["Short link", "Every active /l/ link you have made"],
            ],
          },
          {
            kind: "warning",
            text: "Only things that are actually live appear in that list. A form still in draft, a giving page you switched off, a welcome link you have not turned on — none of them show up. That is deliberate: a button in a bio that leads to a “not found” page is worse than no button, because nobody ever checks a bio link again after the day they set it.",
          },
          {
            kind: "note",
            text: "After you add one you can rename the button to anything. The list suggests the name you already gave the thing, but “Building fund 2026” on your records can read “Give to the new building” on the page.",
          },
        ],
      },
      {
        title: "The styles",
        blocks: [
          {
            kind: "text",
            text: "Five styles and three layouts, chosen from two rows of buttons. There is no colour picker, on purpose: your church colour is already set in Settings, so a style decides light or dark, flat or gradient, filled buttons or plain rules — never the colour itself. Change your theme in Settings and every link page follows.",
          },
          {
            kind: "table",
            headers: ["Style", "What it looks like"],
            rows: [
              ["Classic", "White page, your colour on the buttons"],
              ["Dark", "Near-black page, light buttons"],
              ["Bold", "Your colours across the whole page"],
              ["Soft", "A pale wash of your colour, gentle edges"],
              ["Minimal", "Plain text links and thin rules. Nothing else"],
            ],
          },
          {
            kind: "table",
            headers: ["Layout", "How each link shows"],
            rows: [
              ["Buttons", "Full-width buttons, name only. The usual thing"],
              ["Cards", "Roomier, with a line of explanation under each name"],
              ["List", "Compact rows. Best when there are a lot of links"],
            ],
          },
          {
            kind: "note",
            text: "The line of explanation is only drawn by the Cards layout, but it is never thrown away. Switch to Buttons and it is hidden; switch back to Cards and it is there again.",
          },
        ],
      },
      {
        title: "Changing it afterwards",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Drag is not needed — each link has an up and a down arrow, which is far easier on a phone.",
              "The switch beside a link hides it from the page without deleting it. Use it for things that come back: a carol service form, a convention registration.",
              "“Take it down” unpublishes the whole page. The address then shows nothing, and publishing again brings everything back exactly as it was.",
              "Changing the address breaks the old one. Everywhere you have already pasted it will stop working, so change it before you hand it out rather than after.",
            ],
          },
          {
            kind: "example",
            title: "A month at Living Faith",
            lines: [
              "They make one page at flockinsight.com/hub/livingfaith and put it in their Instagram bio, once.",
              "First Sunday in November: they add the carol service form from the list, and move it to the top.",
              "Mid-November: the form fills up, so they switch it off with the toggle — the wording stays, ready for next year.",
              "December: they add the livestream watch page, and change the style from Classic to Bold for Christmas.",
              "The bio has not been edited since the day they made it.",
            ],
          },
        ],
      },
      {
        title: "A page holds up to fifty links",
        blocks: [
          {
            kind: "text",
            text: "Which is far more than anybody should put on one. If you are near it, the honest answer is a second page — one for the main church and one for the youth ministry, say — rather than a page nobody can read to the bottom of.",
          },
          {
            kind: "note",
            text: "There is no limit on how many pages a church makes.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "How is this different from a short link?",
        a: "A short link sends people to one place. A link page gives them a choice of places. They work well together: you can put a short link on a link page, and you can make a QR code for a link page.",
      },
      {
        q: "Can I use my own domain?",
        a: "Not at the moment — the address is flockinsight.com/hub/yourword. If that matters for your church, tell us through Help → Contact us.",
      },
      {
        q: "Why can I not find my form in the list?",
        a: "Only forms that are open for answers appear. If yours is still a draft, or you closed it, publish or reopen it in Forms and it will be in the list. The same goes for a giving page that is switched off and a welcome link that has not been turned on.",
      },
      {
        q: "Does changing my church colour change the page?",
        a: "Yes, immediately, and that is the intent. Set the colour once in Settings and every link page, your public church page and your forms all agree. A style only arranges the colour; it never picks one.",
      },
      {
        q: "Will the page work on a slow connection?",
        a: "Yes. It is plain text and links with no JavaScript at all, which also means it works in whatever in-app browser Instagram is using this month — which is where this link actually gets opened.",
      },
      {
        q: "Can people see how many opened it?",
        a: "You can. The page's own screen shows how many times it has been opened, and the list on Links & QR codes shows it beside each page.",
      },
      {
        q: "What happens to the address if I delete the page?",
        a: "It stops working, and the word becomes free for anyone to take again. Unlike a short link code, which your church keeps for ever, a link page address is pasted into a bio you can edit rather than printed on four hundred flyers — so holding the word for ever would cost you your own church's name for nothing.",
      },
    ],
    links: [
      { label: "Links & QR codes", href: "/links" },
      { label: "Your church theme", href: "/settings" },
    ],
    tip: "Make the page first, then make a QR code pointing at it. One printed code, and you can change everything behind it for ever.",
    related: ["links-and-qr"],
    keywords: [
      "linktree",
      "link tree",
      "link in bio",
      "bio link",
      "hub",
      "landing page",
      "instagram",
      "tiktok",
      "whatsapp status",
      "all our links",
      "one link",
      "social media",
    ],
  },
];
