import { asc } from "drizzle-orm";
import { db } from "@/db";
import { banner } from "@/db/schema";
import { BannerManager } from "@/components/superadmin/banner-manager";

export const metadata = { title: "Banners · Admin" };

export default async function SuperadminBannersPage() {
  const rows = await db.select().from(banner).orderBy(asc(banner.sortOrder)).limit(100);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Banners & ads
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Promo/ad banners shown on the public church directory and events pages.
        </p>
      </div>
      <BannerManager
        banners={rows.map((b) => ({
          id: b.id,
          title: b.title,
          imageUrl: b.imageUrl,
          linkUrl: b.linkUrl,
          placement: b.placement,
          active: b.active,
          sortOrder: b.sortOrder,
        }))}
      />
    </div>
  );
}
