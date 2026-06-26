import "server-only";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { banner } from "@/db/schema";

export type BannerRow = {
  id: string;
  title: string;
  imageUrl: string | null;
  linkUrl: string | null;
};

/** Active banners for a placement (includes 'both'). */
export async function getBanners(
  placement: "directory" | "events",
): Promise<BannerRow[]> {
  return db
    .select({
      id: banner.id,
      title: banner.title,
      imageUrl: banner.imageUrl,
      linkUrl: banner.linkUrl,
    })
    .from(banner)
    .where(
      and(
        eq(banner.active, true),
        or(eq(banner.placement, placement), eq(banner.placement, "both")),
      ),
    )
    .orderBy(asc(banner.sortOrder))
    .limit(5);
}
