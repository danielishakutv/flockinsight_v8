import Link from "next/link";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { listAccounts, listCategories } from "@/lib/finance-data";
import { AccountsManager } from "@/components/finance/accounts-manager";
import { CategoriesManager } from "@/components/finance/categories-manager";

export const metadata = { title: "Finance · Settings" };

/**
 * The accounts and categories from /finance, reached from Settings.
 *
 * A second door, not a second implementation: the same managers, the same
 * server actions, the same permission checks, so the two screens cannot drift
 * apart or disagree about who may edit what.
 *
 * It is here because this is where a church looks when it wants to *configure*
 * something. Living only inside Finance meant whoever set it up was the only
 * one who knew it could be changed.
 *
 * Transfers are deliberately left on the Finance page. Moving money between
 * accounts is something you do on a Sunday, not something you set up once —
 * and a settings screen is a bad place to keep an action that writes to the
 * books.
 */
export default async function FinanceSettingsPage() {
  const { church } = await requireChurch();
  // Deliberately the finance gate, not the settings one. Being allowed into
  // Settings is not a reason to be allowed at the books.
  await requireCan("finance.view");
  const canManage = await can("finance.manage");

  const [accounts, categories] = await Promise.all([
    listAccounts(church.id),
    listCategories(church.id),
  ]);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold">Accounts</h2>
          <p className="text-muted-foreground text-sm">
            Where the church&apos;s money sits. Balances are worked out from
            what you record, so they cannot go stale. To move money between
            accounts, use{" "}
            <Link
              href="/finance/accounts"
              className="text-primary font-medium underline-offset-4 hover:underline"
            >
              transfers on the Finance page
            </Link>
            .
          </p>
        </div>
        <AccountsManager
          canManage={canManage}
          currency={church.currency}
          accounts={accounts}
        />
      </section>

      <section className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Categories are what income and spending is counted as — the finance
          breakdowns and reports group by them. Different from{" "}
          <Link
            href="/settings/giving"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            giving categories
          </Link>
          , which are what a gift was given <em>for</em>.
        </p>
        <CategoriesManager
          canManage={canManage}
          currency={church.currency}
          categories={categories}
        />
      </section>
    </div>
  );
}
