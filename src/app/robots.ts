import type { MetadataRoute } from "next";

const BASE = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

/**
 * Everything under here is a signed-in surface. Indexing it would leak church
 * data into search results and fill the index with login redirects.
 */
const PRIVATE = [
  "/api/",
  "/dashboard",
  "/settings",
  "/superadmin",
  "/members",
  "/giving",
  "/finance",
  "/training",
  "/attendance",
  "/groups",
  "/follow-up",
  "/analytics",
  "/media",
  "/forms",
  "/devotionals",
  "/communication",
  "/my-events",
  "/notifications",
  "/help",
  "/onboarding",
  "/accept-invitation",
  "/reports",
  "/branches",
  "/celebrations",
  "/todos",
  "/set-password",
  "/suspended",
  // Public but not for indexing: a form submission page and an unsubscribe
  // link have no search value, and /m/ is somebody's private update link.
  "/f/",
  "/n/",
  "/m/",
];

/**
 * Crawlers that fetch a page to answer a person's question, and cite the
 * source back to them. These send real readers, so they are welcome.
 */
const ASSISTANT_CRAWLERS = [
  "OAI-SearchBot", // ChatGPT search index
  "ChatGPT-User", // a person asked ChatGPT to open the page
  "Claude-User", // a person asked Claude to open the page
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot", // Siri and Spotlight
  "Bingbot",
  "DuckDuckBot",
];

/**
 * Crawlers that harvest pages to train models. They return no traffic and no
 * citation, so they get nothing. Blocking these does NOT affect whether
 * ChatGPT or Perplexity can cite us — that is the list above.
 */
const TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot", // Common Crawl, the source most training sets start from
  "Google-Extended", // Gemini training; does not affect Google Search
  "Applebot-Extended",
  "FacebookBot",
  "Meta-ExternalAgent",
  "Bytespider",
  "Amazonbot",
  "cohere-ai",
  "Diffbot",
  "omgili",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Ordinary search engines.
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // Assistants that cite and link back.
      ...ASSISTANT_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: PRIVATE,
      })),
      // Training harvesters.
      ...TRAINING_CRAWLERS.map((userAgent) => ({
        userAgent,
        disallow: "/",
      })),
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
