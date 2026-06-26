import { getBanners } from "@/lib/banners";

/** Renders active promo banners for a placement. Returns null if none. */
export async function BannerSlot({
  placement,
}: {
  placement: "directory" | "events";
}) {
  const banners = await getBanners(placement);
  if (banners.length === 0) return null;
  return (
    <div className="space-y-2">
      {banners.map((b) => {
        const inner = b.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={b.imageUrl}
            alt={b.title}
            loading="lazy"
            className="w-full object-cover"
          />
        ) : (
          <div className="from-primary to-violet-600 bg-gradient-to-r p-5 text-center font-bold text-white">
            {b.title}
          </div>
        );
        return b.linkUrl ? (
          <a
            key={b.id}
            href={b.linkUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="block overflow-hidden rounded-2xl border shadow-sm transition hover:shadow-md"
          >
            {inner}
          </a>
        ) : (
          <div key={b.id} className="overflow-hidden rounded-2xl border shadow-sm">
            {inner}
          </div>
        );
      })}
    </div>
  );
}
