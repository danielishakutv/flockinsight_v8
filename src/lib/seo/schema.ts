import { siteUrl } from "@/lib/site";
import { APP_VERSION } from "@/lib/version";
import { FEATURES } from "@/lib/landing-content";
import { ENTITY_SENTENCE } from "@/lib/seo/keywords";

/**
 * Structured data, built once and shared by every public page.
 *
 * ## Why this is not inline on each page
 *
 * Entity consistency. The systems that decide whether to cite a site resolve it
 * to an entity first, and the strongest signal that two pages belong to the
 * same entity is that they describe it identically — same `@id`, same name,
 * same one-sentence description, same publisher. When each page wrote its own
 * Organization block, the landing page and the pricing page disagreed about
 * what FlockInsight was in three small ways, and the cheapest way to look like
 * two half-credible sites instead of one credible one is to let that happen.
 *
 * So: one `@id` per entity, referenced by every page. `${site}/#organization`
 * is declared in full on the home page and referenced by `@id` everywhere
 * else, which is what the `@id` mechanism is for.
 *
 * ## What is deliberately absent
 *
 * `aggregateRating` and `review`. Google requires rating data for a product
 * rich result and it is genuinely tempting, but we have no verified reviews.
 * Inventing them is the single fastest way for a domain to lose its rich
 * results entirely, and a pastor checking a 4.9 that leads nowhere is a lost
 * sale rather than a won one. If real reviews ever exist, they go here.
 *
 * `FAQPage` is only emitted where the questions are also rendered visibly on
 * the same page. Structured data that does not match what a visitor sees is
 * cloaking, and it is treated as such.
 */

export type Crumb = { name: string; path: string };

/** The organisation. Declared in full on the home page only. */
export function organizationSchema() {
  const site = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${site}/#organization`,
    name: "FlockInsight",
    alternateName: "FlockInsight Church Management",
    url: site,
    logo: {
      "@type": "ImageObject",
      url: `${site}/icon-512`,
      width: 512,
      height: 512,
    },
    description: ENTITY_SENTENCE,
    email: "support@flockinsight.com",
    parentOrganization: {
      "@type": "Organization",
      name: "Toko Technologies",
      description: "A division of Toko Academy Ltd.",
    },
    /*
     * Nigeria named first because it is where the company is, then the regions
     * where churches actually use it. This used to be Nigeria and "Africa"
     * only, which is the same mistake the old <title> made in a place nobody
     * thought to check.
     */
    areaServed: [
      { "@type": "Country", name: "Nigeria" },
      { "@type": "Country", name: "Ghana" },
      { "@type": "Country", name: "Kenya" },
      { "@type": "Country", name: "Uganda" },
      { "@type": "Country", name: "South Africa" },
      { "@type": "Country", name: "United Kingdom" },
      { "@type": "Place", name: "Africa" },
      { "@type": "Place", name: "Europe" },
    ],
    knowsLanguage: ["en", "fr", "pt", "sw", "ha", "ig", "yo", "pcm"],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@flockinsight.com",
      availableLanguage: ["English", "French", "Portuguese"],
    },
  };
}

/** The website, with the directory as its search action. */
export function websiteSchema() {
  const site = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${site}/#website`,
    name: "FlockInsight",
    url: site,
    publisher: { "@id": `${site}/#organization` },
    inLanguage: ["en", "fr", "pt"],
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${site}/churches?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * The product.
 *
 * `offers` with a price and a currency is what Google requires before it will
 * produce a software rich result at all, so the free trial is declared as a
 * real zero-price offer rather than left out. It is also true: seven Sundays,
 * no card.
 */
export function softwareSchema() {
  const site = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${site}/#software`,
    name: "FlockInsight",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Church Management Software",
    operatingSystem: "Web browser, Android, iOS",
    url: site,
    publisher: { "@id": `${site}/#organization` },
    description: ENTITY_SENTENCE,
    featureList: FEATURES.map((f) => f.title),
    softwareVersion: APP_VERSION,
    inLanguage: ["en", "fr", "pt", "sw", "ha", "ig", "yo", "pcm"],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "NGN",
      description: "First 7 Sundays free, no card required.",
      availability: "https://schema.org/InStock",
    },
    // No aggregateRating. See the note at the top of this file.
  };
}

/**
 * Breadcrumbs.
 *
 * Worth more than it looks on a generated page. A country or comparison page
 * three levels deep is otherwise an orphan as far as a crawler's sense of site
 * structure goes, and BreadcrumbList is also one of the few schema types that
 * reliably changes what a search result looks like.
 */
export function breadcrumbSchema(crumbs: Crumb[]) {
  const site = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, ...crumbs].map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${site}${c.path === "/" ? "" : c.path}`,
    })),
  };
}

/**
 * An FAQ block.
 *
 * Only call this with questions the page also renders visibly. The array is
 * passed in from the same constant the page maps over, so the two cannot
 * disagree — which is not a style preference: structured data that does not
 * match the visible page is cloaking.
 */
export function faqSchema(faq: { q: string; a: string }[], id: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${siteUrl()}${id}#faq`,
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/**
 * A marketing page that is about something, with a named author entity.
 *
 * `WebPage` plus `about`/`isPartOf` is what ties a generated country page back
 * to the product rather than leaving it floating as an unattributed page of
 * text that happens to mention us.
 */
export function pageSchema({
  path,
  name,
  description,
  about = "software",
}: {
  path: string;
  name: string;
  description: string;
  /** Which `@id` the page is about. */
  about?: "software" | "organization";
}) {
  const site = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${site}${path}#webpage`,
    url: `${site}${path}`,
    name,
    description,
    isPartOf: { "@id": `${site}/#website` },
    about: { "@id": `${site}/#${about}` },
    publisher: { "@id": `${site}/#organization` },
  };
}
