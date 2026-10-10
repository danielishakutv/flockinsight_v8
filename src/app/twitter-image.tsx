import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

/**
 * The same card again, declared for X.
 *
 * X falls back to og:image when twitter:image is absent, so this file is not
 * strictly required — but `twitter.card` is set to "summary_large_image" in the
 * root layout, and a declared large card with no declared large image is
 * exactly the combination that renders as a cropped thumbnail on some clients.
 * One file removes the ambiguity.
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
