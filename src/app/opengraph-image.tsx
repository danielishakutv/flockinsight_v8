import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * The site's default link preview.
 *
 * Next's file convention makes an `opengraph-image` apply to its segment *and
 * every segment beneath it*, so this one card covers /pricing, /churches,
 * /events, /demo, /blog, /changelog, /roadmap, /terms and /privacy without a
 * file each. Only routes where a specific title earns a specific card — a
 * church's own page, a blog post, an event with a flyer, a country page —
 * override it.
 *
 * It also emits og:image:width, og:image:height and og:image:type for us.
 * That matters more than it sounds: WhatsApp decides whether to draw the large
 * card or the small square one from the declared dimensions, without
 * downloading the file to measure it. A correctly shaped image with no
 * declared size still renders small.
 */
export const alt =
  "FlockInsight — one platform for church attendance, members, giving, finances, training and follow-up";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Church operations platform",
    title: "Run your whole church from one login",
    /*
     * Short enough to finish. `ogCard` hard-truncates a subtitle at 150
     * characters so a long one cannot push the chips off the canvas, and the
     * first draft of this line ran to 168 — so every share of the home page
     * ended "...fellowships and…". A card is read in a chat list in about a
     * second; a sentence that visibly gives up is worse than a shorter one.
     */
    subtitle:
      "Attendance, members, groups, training, giving, finances and follow-up — for churches, fellowships and ministries anywhere.",
    chips: ["18 modules", "7 Sundays free", "Built for slow data"],
  });
}
