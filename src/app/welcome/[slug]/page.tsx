import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWelcomeBySlug } from "@/lib/first-timer-intake";
import { WelcomeForm } from "@/components/first-timers/welcome-form";

export const dynamic = "force-dynamic";

/**
 * The welcome card, as a page.
 *
 * `getWelcomeBySlug` returns null for an unknown slug AND for one a church has
 * switched off, so both land on the same 404. That is deliberate: a different
 * answer for each would turn this URL into a way of discovering which churches
 * are on the platform.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getWelcomeBySlug(slug);
  if (!data) return { title: "Welcome link not found" };
  return {
    title: `${data.signup.title} · ${data.church.name}`,
    description: data.signup.intro,
    // Never indexed. It is a card handed to someone in a building, not a page
    // for search results, and an indexed one would collect strangers.
    robots: { index: false, follow: false },
  };
}

export default async function WelcomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getWelcomeBySlug(slug);
  if (!data) notFound();

  const { signup, church: c } = data;

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-xl px-4 py-8 lg:py-12">
        <div className="mb-6 flex items-center gap-3">
          {c.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.logo}
              alt=""
              className="size-12 shrink-0 rounded-xl border object-cover"
            />
          ) : null}
          <p className="font-semibold">{c.name}</p>
        </div>

        <div className="bg-card border-t-primary mb-4 rounded-2xl border border-t-4 p-6">
          <h1 className="text-2xl font-extrabold tracking-tight">
            {signup.title}
          </h1>
          <p className="text-muted-foreground mt-2 whitespace-pre-wrap">
            {signup.intro}
          </p>
        </div>

        <div className="bg-card rounded-2xl border p-6">
          <WelcomeForm
            slug={slug}
            collectEmail={signup.collectEmail}
            collectAddress={signup.collectAddress}
            collectInvitedBy={signup.collectInvitedBy}
            successMessage={signup.successMessage}
          />
        </div>

        <p className="text-muted-foreground mt-8 text-center text-xs">
          Powered by FlockInsight
        </p>
      </div>
    </div>
  );
}
