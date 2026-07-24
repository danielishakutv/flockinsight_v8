import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSignupBySlug } from "@/lib/member-signup";
import { MemberSignupForm } from "@/components/members/member-signup-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getSignupBySlug(slug);
  if (!data) return { title: "Sign-up link not found" };
  return {
    title: `${data.signup.title} · ${data.church.name}`,
    description: data.signup.intro,
    robots: { index: false },
  };
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getSignupBySlug(slug);
  if (!data) notFound();

  const { signup, church: c, groups } = data;

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 lg:py-12">
        {/* Church header */}
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

        {/* Intro */}
        <div className="bg-card border-t-primary mb-4 rounded-2xl border border-t-4 p-6">
          <h1 className="text-2xl font-extrabold tracking-tight">{signup.title}</h1>
          <p className="text-muted-foreground mt-2 whitespace-pre-wrap">
            {signup.intro}
          </p>
        </div>

        {signup.enabled ? (
          <MemberSignupForm
            config={{
              slug,
              successMessage: signup.successMessage,
              collectBirthday: signup.collectBirthday,
              collectAddress: signup.collectAddress,
              collectAnniversary: signup.collectAnniversary,
              collectChildren: signup.collectChildren,
              allowGroupSelect: signup.allowGroupSelect,
            }}
            groups={groups}
          />
        ) : (
          <div className="bg-card rounded-2xl border p-8 text-center">
            <p className="text-lg font-semibold">This sign-up link is currently closed.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Please contact {c.name} if you&apos;d like to join.
            </p>
          </div>
        )}

        <p className="text-muted-foreground mt-8 text-center text-xs">
          Powered by FlockInsight
        </p>
      </div>
    </div>
  );
}
