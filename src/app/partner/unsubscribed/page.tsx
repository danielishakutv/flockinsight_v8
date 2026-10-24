import Link from "next/link";
import { MailX } from "lucide-react";

export const metadata = {
  title: "Partner updates stopped",
  robots: { index: false, follow: false },
};

/**
 * Where the unsubscribe link lands. Public: the link works without signing
 * in, so this page cannot assume anybody is. It says plainly whether the link
 * worked, and what still arrives.
 */
export default async function PartnerUnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const worked = ok === "1";
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-6 text-center lg:p-10">
      <MailX className="text-primary mx-auto size-10" />
      <h1 className="text-2xl font-extrabold tracking-tight">
        {worked ? "You won't get the progress updates any more" : "That link didn't work"}
      </h1>
      <p className="text-muted-foreground">
        {worked
          ? "We've stopped the Monday and Thursday Partner updates. Emails about your account and your payments will still come."
          : "The unsubscribe link may be incomplete. You can turn the progress updates off from your Partner page instead."}
      </p>
      <p className="text-muted-foreground text-sm">
        Changed your mind? Turn them back on from your{" "}
        <Link href="/partner" className="text-primary font-semibold hover:underline">
          Partner page
        </Link>
        .
      </p>
    </div>
  );
}
