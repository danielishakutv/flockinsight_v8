import type { Metadata } from "next";
import { LinkIcon } from "lucide-react";
import { getMemberByUpdateToken } from "@/lib/member-update";
import { MemberUpdateForm } from "@/components/members/member-update-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Update your details",
  robots: { index: false },
};

export default async function MemberUpdatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getMemberByUpdateToken(token);

  // A single-use link that's already been used (or was regenerated) resolves to
  // nothing — show a friendly note rather than a bare 404.
  if (!data) {
    return (
      <div className="bg-muted/40 grid min-h-dvh place-items-center px-4">
        <div className="bg-card w-full max-w-md rounded-2xl border p-8 text-center">
          <div className="bg-muted text-muted-foreground mx-auto mb-3 grid size-12 place-items-center rounded-xl">
            <LinkIcon className="size-6" />
          </div>
          <h1 className="text-lg font-bold">This link is no longer active</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Update links can only be used once. If you still need to update your
            details, please ask your church to send you a fresh link.
          </p>
        </div>
      </div>
    );
  }

  const c = data.church;

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 lg:py-12">
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
            Hi {data.member.firstName || "there"}, update your details
          </h1>
          <p className="text-muted-foreground mt-2">
            We&apos;ve filled in what we already have for you at{" "}
            <strong>{c.name}</strong>. Review it, correct anything, add your
            children, and save.
            {data.config.requireVerification
              ? " We'll send you a quick code to confirm it's you."
              : ""}{" "}
            This link can be used once.
          </p>
        </div>

        <MemberUpdateForm data={data} />

        <p className="text-muted-foreground mt-8 text-center text-xs">
          This is your personal link — please don&apos;t share it. Powered by
          FlockInsight.
        </p>
      </div>
    </div>
  );
}
