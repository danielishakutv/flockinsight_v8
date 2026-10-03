import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { givingCategory } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { hasFeature } from "@/lib/entitlements-server";
import { isSecretBoxReady, SECRET_BOX_SETUP_HINT } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import {
  listGateways,
  listGivingLinks,
  listOnlinePayments,
  giveUrl,
} from "@/lib/online-giving";
import { PROVIDER_SPECS } from "@/lib/gateways/specs";
import { PlanGate } from "@/components/app/plan-gate";
import { GatewaySetup } from "@/components/settings/gateway-setup";
import { GivingLinksManager } from "@/components/settings/giving-links-manager";
import { OnlineGiftsRecent } from "@/components/settings/online-gifts-recent";

export const metadata = { title: "Online giving · Settings" };

/*
 * Never cached. Half this page is "are these keys still working", which is a
 * fact about the outside world, and a cached answer is the one thing worse
 * than no answer.
 */
export const dynamic = "force-dynamic";

/**
 * Online giving setup: the church's own gateway, and its collection links.
 *
 * Deliberately under Settings → Giving's neighbourhood rather than inside the
 * Giving module: connecting a gateway is a once-a-year act of configuration,
 * and the links are what get used week to week.
 */
export default async function PaymentsSettingsPage() {
  const { church: c } = await requireChurch();
  // The page is readable by anyone who can see giving; every write asks for
  // giving.manage, in the actions.
  await requireCan("giving.view");
  const canManage = await can("giving.manage");
  const allowed = await hasFeature("onlineGiving");

  const [gateways, links, categories, gifts] = await Promise.all([
    listGateways(c.id),
    listGivingLinks(c.id),
    db
      .select({ id: givingCategory.id, name: givingCategory.name })
      .from(givingCategory)
      .where(eq(givingCategory.churchId, c.id))
      .orderBy(asc(givingCategory.sortOrder), asc(givingCategory.name)),
    // Includes the ones that never completed — see the component.
    listOnlinePayments(c.id, 25),
  ]);

  return (
    <div className="space-y-6">
      {/*
        Readable off-plan, never writable. A church that has already taken
        gifts online and then downgraded can still see its links, its keys and
        what it raised — the plan decides what can be DONE, not what can be
        seen. (lib/entitlements.ts, rule two.)
      */}
      <PlanGate feature="onlineGiving" />

      {/*
        The server cannot hold a secret without PAYMENTS_ENC_KEY. Said here,
        plainly, rather than letting the church paste a live key and watch the
        save fail with something vague.
      */}
      {!isSecretBoxReady() && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <p className="font-semibold">
            This server isn&apos;t set up to store payment keys yet.
          </p>
          <p className="mt-1">
            Nothing can be connected until it is. {SECRET_BOX_SETUP_HINT}
          </p>
        </div>
      )}

      <GatewaySetup
        gateways={gateways}
        specs={Object.values(PROVIDER_SPECS)}
        currency={c.currency}
        canManage={canManage && allowed && isSecretBoxReady()}
        /*
         * Built on the server from the configured site URL, not from
         * window.location. A church pasting this into its gateway dashboard
         * must get the canonical address — a preview host or a LAN IP would
         * be accepted by the form and silently never called.
         */
        webhookBase={`${siteUrl()}/api/pay`}
      />

      <GivingLinksManager
        links={links.map((l) => ({ ...l, url: giveUrl(l.slug) }))}
        categories={categories}
        currency={c.currency}
        canManage={canManage && allowed}
        /*
         * A link is worthless without somewhere for the money to go, and the
         * manager says so instead of letting a church make six links that all
         * lead to "this church hasn't finished setting up".
         */
        hasActiveGateway={gateways.some((g) => g.isActive)}
      />

      <OnlineGiftsRecent gifts={gifts} currency={c.currency} />
    </div>
  );
}
