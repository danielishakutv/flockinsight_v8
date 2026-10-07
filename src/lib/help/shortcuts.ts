import type { Guide } from "./types";
import { SHORTCUTS, keysLabel } from "@/lib/shortcuts";
import { en } from "@/lib/i18n/dictionaries/en";

/**
 * The keyboard shortcuts guide.
 *
 * The tables are BUILT from `lib/shortcuts.ts` rather than typed out, because a
 * written guide is exactly the kind of thing that goes quietly wrong: somebody
 * changes a key, the sheet in the app updates itself, and the guide goes on
 * telling four hundred churches to press a key that now does something else.
 *
 * English only, deliberately. The rest of the guides are written in English
 * too — the app shell is translated, the handbook is not yet — so pulling the
 * labels out of the English dictionary here matches what every other guide
 * does, and the in-app cheat sheet is the translated one.
 */

/** The label a shortcut shows, in English, straight from the dictionary. */
function label(key: string): string {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}

/**
 * `Ctrl K` rather than `⌘K`, since a guide is read on a page that cannot know
 * what machine the reader is on. The app's own sheet shows the right one.
 */
function keys(k: readonly string[]): string {
  return keysLabel(k, false);
}

function tableFor(group: string): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Press", "What it does"],
    rows: SHORTCUTS.filter((s) => s.group === group).map((s) => [
      keys(s.keys),
      label(s.labelKey),
    ]),
  };
}

export const SHORTCUT_GUIDES: Omit<Guide, "minutes">[] = [
  {
    slug: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    category: "start",
    icon: "shortcuts",
    summary:
      "On a computer, you can reach any page and start any of the common jobs without touching the mouse. One box finds everything; two keys go anywhere. Press ? inside the app for the same list at any time.",
    whoFor: [
      "Anybody who uses FlockInsight on a laptop or desktop",
      "Church secretaries and administrators who are in the app every day",
      "Welcome desks and ushers registering people on a Sunday",
    ],
    sections: [
      {
        title: "The one to learn first",
        blocks: [
          {
            kind: "text",
            text: "Press Ctrl and K together (⌘ and K on a Mac) and a search box opens in the middle of the screen. Type two or three letters of whatever you want — a page, a setting, a job — and press Enter. That is the whole thing.",
          },
          {
            kind: "text",
            text: "It reaches every module in your menu and all twenty-one setting pages, which is the part most people find useful: “where do I change the service times?” is “Ctrl K, type serv, Enter” instead of four clicks into Settings.",
          },
          {
            kind: "note",
            text: "You do not have to remember it. The search box at the top of the screen on a computer is the same thing — click it and it opens, with the keys printed on the right-hand side.",
          },
        ],
      },
      {
        title: "Finding things",
        blocks: [
          { kind: "table", ...tableFor("find") },
          {
            kind: "text",
            text: "The / key jumps straight to the search box on the page you are already on — the one above a list of members, or giving, or files. Useful when you know you are in the right place and just want to filter it.",
          },
        ],
      },
      {
        title: "Going somewhere",
        blocks: [
          {
            kind: "text",
            text: "Press G, let go, then press the letter. Not both at once — one after the other, like spelling a short word. You have about a second and a half for the second key.",
          },
          { kind: "table", ...tableFor("go") },
          {
            kind: "bullets",
            items: [
              "G is for “go”.",
              "Most letters are simply the first letter of the page: G then M for Members, G then A for Attendance.",
              "Three are not, because the first letter was already taken: G then R for g-r-oups, G then V for first-timers (V for visitors), and G then B for Facilities (B for bookings).",
            ],
          },
          {
            kind: "note",
            text: "Only the pages your role can open are listed, and only the ones your plan includes. If a key in this table does nothing for you, that page is not one you have access to — the list you get when you press ? inside the app is your own.",
          },
        ],
      },
      {
        title: "Doing something",
        blocks: [
          {
            kind: "text",
            text: "Same idea, but starting with N for “new”. These work from anywhere in the app — you do not have to be on the right page first. Press N then M while you are looking at the giving report and the Add member form opens.",
          },
          { kind: "table", ...tableFor("do") },
          {
            kind: "example",
            title: "A Sunday at the welcome desk",
            lines: [
              "Grace is on the welcome desk at Living Faith. Four new people come in during worship.",
              "She presses N then V. The first-timer form opens. She fills in a name and a phone number, presses Save and add another, and the form comes back empty.",
              "Four people registered without her leaving the page she was on, or finding the right menu item four times.",
              "Everyone she registered is a visitor, in follow-up, and on the members register — exactly as if she had used the button.",
            ],
          },
          {
            kind: "note",
            text: "A shortcut can never do something your role is not allowed to do. If you cannot add a member with the button, N then M will not add one either — the key simply is not yours.",
          },
        ],
      },
      {
        title: "Help",
        blocks: [
          { kind: "table", ...tableFor("help") },
          {
            kind: "text",
            text: "The ? key is the one worth remembering after Ctrl K. It shows this same list, inside the app, filtered down to the keys that work for you.",
          },
        ],
      },
      {
        title: "When they do not fire",
        blocks: [
          {
            kind: "text",
            text: "On purpose, in three situations. All three are deliberate, so none of them is a fault to report.",
          },
          {
            kind: "steps",
            items: [
              {
                title: "While you are typing",
                detail:
                  "Typing “Grace Mensah” into a name box must put an M in the box, not jump to Members. Any time the cursor is in a field, the keys belong to the field.",
              },
              {
                title: "While a form is open",
                detail:
                  "If the Add member window is up with six fields filled in, a stray G will not navigate away and lose it. Close the form first — Escape does that.",
              },
              {
                title: "Anything your browser already uses",
                detail:
                  "Ctrl P still prints, Ctrl C still copies, Ctrl L still goes to the address bar. Ctrl K is the only combination FlockInsight claims.",
              },
            ],
          },
        ],
      },
      {
        title: "The tips that appear now and then",
        blocks: [
          {
            kind: "text",
            text: "Once in a while a small card appears in the bottom-left corner of a computer screen suggesting one shortcut — usually for the page you have just opened the long way round. It goes away by itself after a few seconds.",
          },
          {
            kind: "bullets",
            items: [
              "One at a time, and never more than two days apart.",
              "Six in total, ever. Then they stop by themselves.",
              "Once you have actually used a shortcut, you are never shown a tip about that one again.",
              "They only appear on a computer. There is nothing to teach on a phone, so there is nothing to see there.",
              "“No more tips” on the card stops them for good, and Settings → General can turn them back on.",
            ],
          },
          {
            kind: "note",
            text: "The shortcuts themselves keep working whether or not the tips are on. Turning the tips off turns off the teaching, not the keys.",
          },
        ],
      },
    ],
    faq: [
      {
        q: "I pressed G then M and nothing happened.",
        a: "Most likely the cursor was in a search box or another field, in which case the letters went into the field instead. Click on an empty part of the page and try again. If you had a form open, close it first with Escape. And if your role cannot open Members, that key is not one of yours — press ? to see the list that is.",
      },
      {
        q: "Do these work on my phone?",
        a: "No, and nothing is hidden from you because of it — there is no keyboard to press. Everything a shortcut does is a tap away in the menu or on the page. The tips never appear on a phone either.",
      },
      {
        q: "I am on a Mac. Is it Ctrl or Command?",
        a: "Command (⌘) and K. The app works out which machine you are on and prints the right one on the search box and in the ? list; this written guide says Ctrl because it cannot know.",
      },
      {
        q: "Can I change which keys do what?",
        a: "Not at the moment. If a particular combination clashes with something you use, tell us through Help → Contact us and say which — that is the sort of thing worth changing for everybody.",
      },
      {
        q: "Will a shortcut let somebody do something they should not?",
        a: "No. A shortcut is only another way of opening a page or a form you already have permission to open, and every save is checked on the server exactly as it is when you use the buttons. Keys your role cannot use are not shown to you and do nothing if pressed.",
      },
      {
        q: "How do I stop the tips?",
        a: "Press “No more tips” on the card, or go to Settings → General and switch off Shortcut tips. The same place can reset them if you want to be shown them again.",
      },
    ],
    links: [
      { label: "Help & guides", href: "/help" },
      { label: "Your settings", href: "/settings" },
    ],
    tip: "If you only ever learn one, learn Ctrl K (⌘K on a Mac). It reaches everything else, including the pages that have no shortcut of their own.",
    related: ["getting-started"],
    keywords: [
      "keyboard",
      "shortcut",
      "shortcuts",
      "hotkey",
      "hot keys",
      "command palette",
      "ctrl k",
      "cmd k",
      "quick keys",
      "faster",
      "search",
      "tips",
    ],
  },
];
