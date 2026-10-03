import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, Clock, HandHeart } from "lucide-react";
import { getPublicGivingLink, settleOnlinePayment } from "@/lib/online-giving";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Wordmark } from "@/components/brand";

export const metadata = { title: "Thank you" };
export const dynamic = "force-dynamic";

/**
 * Where the gateway sends the giver back to.
 *
 * This page SETTLES the payment, by asking the gateway what happened — it
 * never believes the query string. Anyone can type `?reference=…&status=success`
 * into a URL bar, and a thank-you page that trusted that would write a giving
 * row for money nobody paid.
 *
 * It is also one of two ways a gift gets recorded, the other being the
 * webhook. Both call the same settle function, which is idempotent: whichever
 * arrives first writes the giving row. On a Nigerian mobile connection the
 * redirect frequently wins, which is exactly why it is here and not only in a
 * background job.
 */
export default async function GiveThanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const link = await getPublicGivingLink(slug);
  if (!link) notFound();

  /*
   * The reference, from whichever name the provider uses on the way back.
   *
   * Ours is always in there somewhere — Paystack echoes `reference`,
   * Flutterwave sends `tx_ref`, Monnify sends `paymentReference`. The
   * gateway's OWN id (`transaction_id`) is deliberately ignored: we verify by
   * the reference we chose, so one settle path serves every provider.
   */
  const raw =
    query.reference ?? query.tx_ref ?? query.paymentReference ?? query.ref;
  const reference = Array.isArray(raw) ? raw[0] : raw;

  const settled = reference ? await settleOnlinePayment(reference) : null;
  const status = settled?.ok ? settled.status : null;

  return (
    <div className="bg-muted/30 grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            {status === "success" ? (
              <>
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-600">
                  <HandHeart className="size-7" />
                </span>
                <h1 className="text-2xl font-extrabold tracking-tight">
                  Thank you{settled?.ok && settled.giverName ? `, ${settled.giverName.split(" ")[0]}` : ""}!
                </h1>
                <p className="text-lg font-bold">
                  {settled?.ok
                    ? formatMoney(settled.amount, settled.currency)
                    : null}
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {settled?.ok && settled.thankYouMessage
                    ? settled.thankYouMessage
                    : `Your gift has reached ${link.churchName}. A receipt is on its way to your email.`}
                </p>
              </>
            ) : status === "pending" ? (
              <>
                {/*
                  Pending is its own screen, not a failure and not a success.
                  A bank transfer can take minutes to clear, and telling
                  somebody it failed would have them pay twice.
                */}
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-600">
                  <Clock className="size-7" />
                </span>
                <h1 className="text-2xl font-extrabold tracking-tight">
                  Still going through
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Your bank hasn&apos;t confirmed this one yet. It usually takes
                  a minute or two. There is no need to pay again — if it
                  completes, {link.churchName} will see it and you&apos;ll get a
                  receipt.
                </p>
              </>
            ) : (
              <>
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-600">
                  <CircleAlert className="size-7" />
                </span>
                <h1 className="text-2xl font-extrabold tracking-tight">
                  That gift didn&apos;t go through
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {settled && !settled.ok
                    ? settled.error
                    : "Nothing has been taken from your account. You can try again, or speak to the church."}
                </p>
              </>
            )}

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button asChild variant={status === "success" ? "outline" : "default"}>
                <Link href={`/give/${link.slug}`}>
                  {status === "success" ? "Give again" : "Try again"}
                </Link>
              </Button>
              {link.churchHandle && (
                <Button asChild variant="ghost">
                  <Link href={`/c/${link.churchHandle}`}>
                    Visit {link.churchName}
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="text-center">
          <Wordmark className="justify-center text-sm opacity-60" logoClassName="size-5" />
        </div>
      </div>
    </div>
  );
}
