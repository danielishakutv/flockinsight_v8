/**
 * The richer landing-page sections: the module explorer, the two comparison
 * tables, the proof strip and the audience cards.
 *
 * Kept out of `landing-content.ts` because that file is already the home of the
 * original copy and was heading past seven hundred lines. The split is by
 * *shape*, not by language: everything here is still translated into the same
 * three reviewed languages, because a French heading above an English table is
 * the exact failure the comment at the top of `landing-content.ts` warns about.
 *
 * ## Why there are tables on a marketing page
 *
 * Not decoration. Of all the content formats measured for whether an AI
 * assistant will quote a page, a clean table with real column headers and
 * comparable values is the strongest — assistants cite two to seven sources
 * per answer, and a table is the format they can lift without interpreting a
 * layout. The two tables below are therefore written to be *extracted*: short
 * cells, one fact each, no marketing voice inside the grid.
 *
 * ## Why the comparison table admits where we lose
 *
 * `COMPARISON_TERMS` in `lib/seo/keywords.ts` makes `honestWeakness` a required
 * field and a test asserts it is a real sentence. This is where those sentences
 * are rendered. A table that only lists our wins is read as marketing by a
 * person and discounted by a model; the one that names the trade-off is the one
 * that gets quoted. It also happens to be true, which is the better reason.
 */

/** A group of modules, so eighteen cards become five readable sets. */
export type ModuleGroup = {
  /** Stable id — used for the CSS-only filter's radio inputs. */
  id: string;
  label: string;
  /** Matches `icon` keys on FEATURES in `landing-content.ts`. */
  featureIcons: string[];
};

/**
 * The eighteen modules, grouped.
 *
 * A flat grid of eighteen cards is a wall: a visitor reads four and scrolls
 * past the rest, which wastes the one section that proves the central claim.
 * Grouped into five sets with a filter, the same content becomes something a
 * pastor can navigate to the part they came for — and the group labels
 * themselves ("People", "Money", "Operations") are the words a buyer uses when
 * they describe their problem.
 *
 * Every icon here must exist in FEATURES or the group renders short;
 * `landing-sections.test.ts` fails the build on a mismatch.
 */
export const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: "people",
    label: "People",
    featureIcons: ["members", "groups", "followup", "training"],
  },
  {
    id: "money",
    label: "Money",
    featureIcons: ["giving", "finance", "reports"],
  },
  {
    id: "gathering",
    label: "Gatherings",
    featureIcons: ["attendance", "events", "analytics"],
  },
  {
    id: "comms",
    label: "Communication",
    featureIcons: ["comms", "reminders", "devotionals", "forms"],
  },
  {
    id: "operations",
    label: "Operations & public",
    featureIcons: ["media", "public", "branches", "roles"],
  },
];

/**
 * What one subscription replaces.
 *
 * This is the anchoring table, and it is doing a specific job: a price read in
 * isolation is judged absolutely, which makes any figure feel like a new cost.
 * A price read beside the six things it removes is judged relatively, which is
 * how brains actually work. The right-hand column is deliberately specific
 * about the tool being replaced, because "various tools" persuades nobody.
 */
export type ReplacesRow = {
  /** The job. */
  job: string;
  /** What a church without this uses today. */
  insteadOf: string;
  /** The module that absorbs it. */
  module: string;
};

export const REPLACES: ReplacesRow[] = [
  {
    job: "Counting the congregation",
    insteadOf: "A notebook, then a spreadsheet nobody updates",
    module: "Attendance",
  },
  {
    job: "Knowing who is in the church",
    insteadOf: "Three WhatsApp groups and a printed register",
    module: "Members & households",
  },
  {
    job: "Texting the whole church",
    insteadOf: "A separate bulk-SMS website, paid separately",
    module: "Communication",
  },
  {
    job: "Collecting registrations",
    insteadOf: "Google Forms, then copying answers by hand",
    module: "Forms",
  },
  {
    job: "Committee and staff meetings",
    insteadOf: "Zoom, on a separate paid plan",
    module: "Meetings",
  },
  {
    job: "Keeping the books",
    insteadOf: "A treasurer's own spreadsheet, on their own laptop",
    module: "Finance",
  },
  {
    job: "One link for everything",
    insteadOf: "Linktree, plus a QR generator with a watermark",
    module: "Links & hub pages",
  },
  {
    job: "Sermons people can find",
    insteadOf: "A Google Drive folder shared by link",
    module: "Media library",
  },
];

/**
 * The proof strip under the hero.
 *
 * Facts about the product, not about its traction. We publish no church count
 * and `FORBIDDEN_CLAIMS` exists to keep it that way, so the reassurance a
 * visitor gets here has to come from specificity instead of social proof —
 * which is the honest trade and, for a careful pastor, the more convincing one.
 */
export type ProofPoint = { value: string; label: string; detail: string };

export const PROOF: ProofPoint[] = [
  {
    value: "18",
    label: "modules, one login",
    detail: "People, money, gatherings, communication and operations.",
  },
  {
    value: "61",
    label: "countries profiled",
    detail: "Each with its own currency, timezone and address format.",
  },
  {
    value: "41",
    label: "currencies",
    detail: "Recorded as themselves, never converted into somebody else's.",
  },
  {
    value: "8",
    label: "languages",
    detail: "English, French, Portuguese, Swahili, Hausa, Igbo, Yoruba, Pidgin.",
  },
];

/** Who it is for, with the thing each of them actually needs. */
export type AudienceCard = { title: string; body: string };

export const AUDIENCE_CARDS: AudienceCard[] = [
  {
    title: "Local churches",
    body: "One register, one set of books, and a public page that keeps its own service times current.",
  },
  {
    title: "Campus & student fellowships",
    body: "A congregation that turns over every year, so importing and exporting a whole cohort has to be quick.",
  },
  {
    title: "House fellowships & cells",
    body: "Dozens of small groups with their own leaders, each messaging only their own people.",
  },
  {
    title: "Ministries & outreaches",
    body: "Projects with targets and pledges, and a shareable link that shows what has come in.",
  },
  {
    title: "Multi-branch denominations",
    body: "Branch records stay private to the branch; headquarters sees roll-up totals by zone.",
  },
  {
    title: "Diaspora congregations",
    body: "Pounds or Euros for the books, the home-country language in the interface, two timezones in the calendar.",
  },
];

/* ============================================================
 * Translations
 * ========================================================== */

export type SectionCopy = {
  /** The extractable summary paragraph directly under the H1. */
  summaryHeading: string;
  moduleTitle: string;
  moduleIntro: string;
  moduleGroupAll: string;
  replacesTitle: string;
  replacesIntro: string;
  replacesCols: { job: string; insteadOf: string; module: string };
  compareTitle: string;
  compareIntro: string;
  compareCols: { what: string; edge: string; weakness: string };
  compareFootnote: string;
  audienceTitle: string;
  proofTitle: string;
  previewTitle: string;
  previewIntro: string;
};

export const sectionCopy: Record<"en" | "fr" | "pt", SectionCopy> = {
  en: {
    summaryHeading: "In short",
    moduleTitle: "Eighteen modules, one login",
    moduleIntro:
      "Pick the part you came for. Everything here is included on a paid plan — there is no module you discover later is extra.",
    moduleGroupAll: "Everything",
    replacesTitle: "One subscription, instead of eight",
    replacesIntro:
      "Most churches are not choosing between us and a competitor. They are choosing between us and the eight things they already pay for or do by hand.",
    replacesCols: {
      job: "The job",
      insteadOf: "What churches use today",
      module: "Module here",
    },
    compareTitle: "How we compare, including where we lose",
    compareIntro:
      "Every one of these is better than us at something. Here is what, in their words as much as ours — because a comparison that only lists our wins is worth nothing to you.",
    compareCols: {
      what: "Compared with",
      edge: "Where FlockInsight is stronger",
      weakness: "Where they are stronger",
    },
    compareFootnote:
      "Written by us, about competitors we respect. If anything here is out of date, tell us and we will correct it.",
    audienceTitle: "Who it is for",
    proofTitle: "What you are actually getting",
    previewTitle: "See it before you sign up",
    previewIntro:
      "No form, no card, no email. This is the real interface, with a demo church's records in it.",
  },
  fr: {
    summaryHeading: "En résumé",
    moduleTitle: "Dix-huit modules, une seule connexion",
    moduleIntro:
      "Choisissez ce qui vous intéresse. Tout est inclus dans un forfait payant — aucun module ne se révèle payant plus tard.",
    moduleGroupAll: "Tout",
    replacesTitle: "Un seul abonnement, au lieu de huit",
    replacesIntro:
      "La plupart des églises ne choisissent pas entre nous et un concurrent. Elles choisissent entre nous et les huit choses qu'elles paient déjà ou font à la main.",
    replacesCols: {
      job: "La tâche",
      insteadOf: "Ce que les églises utilisent aujourd'hui",
      module: "Module ici",
    },
    compareTitle: "Comparaison, y compris là où nous perdons",
    compareIntro:
      "Chacun d'eux fait quelque chose mieux que nous. Voici quoi — parce qu'une comparaison qui ne liste que nos victoires ne vous sert à rien.",
    compareCols: {
      what: "Comparé à",
      edge: "Où FlockInsight est plus fort",
      weakness: "Où ils sont plus forts",
    },
    compareFootnote:
      "Rédigé par nous, au sujet de concurrents que nous respectons. Si quelque chose ici n'est plus à jour, dites-le-nous et nous le corrigerons.",
    audienceTitle: "Pour qui c'est fait",
    proofTitle: "Ce que vous obtenez réellement",
    previewTitle: "Voyez-le avant de vous inscrire",
    previewIntro:
      "Pas de formulaire, pas de carte, pas d'e-mail. C'est la vraie interface, avec les données d'une église de démonstration.",
  },
  pt: {
    summaryHeading: "Em resumo",
    moduleTitle: "Dezoito módulos, uma só conta",
    moduleIntro:
      "Escolha a parte que lhe interessa. Está tudo incluído num plano pago — não há módulo que depois se descubra ser à parte.",
    moduleGroupAll: "Tudo",
    replacesTitle: "Uma assinatura, em vez de oito",
    replacesIntro:
      "A maioria das igrejas não está a escolher entre nós e um concorrente. Está a escolher entre nós e as oito coisas que já paga ou faz à mão.",
    replacesCols: {
      job: "A tarefa",
      insteadOf: "O que as igrejas usam hoje",
      module: "Módulo aqui",
    },
    compareTitle: "Como nos comparamos, incluindo onde perdemos",
    compareIntro:
      "Cada um destes é melhor do que nós em algo. Fica aqui o quê — porque uma comparação que só lista as nossas vitórias não lhe serve de nada.",
    compareCols: {
      what: "Comparado com",
      edge: "Onde o FlockInsight é mais forte",
      weakness: "Onde eles são mais fortes",
    },
    compareFootnote:
      "Escrito por nós, sobre concorrentes que respeitamos. Se algo aqui estiver desactualizado, diga-nos e corrigimos.",
    audienceTitle: "Para quem é",
    proofTitle: "O que recebe de facto",
    previewTitle: "Veja antes de se inscrever",
    previewIntro:
      "Sem formulário, sem cartão, sem e-mail. É a interface real, com os registos de uma igreja de demonstração.",
  },
};

export function sections(locale: string): SectionCopy {
  if (locale === "fr") return sectionCopy.fr;
  if (locale === "pt") return sectionCopy.pt;
  return sectionCopy.en;
}
