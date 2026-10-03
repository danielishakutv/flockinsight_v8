import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  churchGateway,
  giving,
  givingCategory,
  givingLink,
  member,
  onlinePayment,
} from "@/db/schema";
import { adapterFor } from "@/lib/gateways";
import { PROVIDER_SPECS, supportsCurrency } from "@/lib/gateways/specs";
import type { GatewayCredentials, ProviderId } from "@/lib/gateways/types";
import { openJson, openSecret, sealJson, sealSecret, secretHint } from "@/lib/secret-box";
import { normalizePhone } from "@/lib/sms";
import { siteUrl } from "@/lib/site";
import { slugify, randomSuffix } from "@/lib/slug";

/**
 * Online giving: a church collecting through its own payment gateway.
 *
 * THE SHAPE OF THE WHOLE THING, in one paragraph. A church stores its own
 * gateway keys (sealed). It creates one or more collection links, each with a
 * slug, a giving category and a rule about how much. A giver opens
 * /give/<slug>, we write an `online_payment` row with a reference WE choose,
 * and send them to the gateway. When the payment completes we hear about it
 * twice — once from a webhook, once from the giver's own redirect — and
 * whichever arrives first verifies it with the gateway and writes the `giving`
 * row. The second one sees `givingId` is set and stops.
 *
 * WHY THE REFERENCE IS OURS. It is the only thread tying a gateway
 * transaction back to a church, a link and a person. If it were the gateway's,
 * a payment that completes while the giver's phone dies would be money in the
 * church's account that nothing here can account for.
 */

/* ============================================================
 * Credentials
 * ========================================================== */

export type GatewayRow = {
  id: string;
  provider: ProviderId;
  publicKey: string | null;
  linkUrl: string | null;
  isActive: boolean;
  verifiedAt: string | null;
  lastError: string | null;
  /** "••••wxyz" — enough to recognise which key is stored. Never the key. */
  secretHint: string | null;
  /** Which extra fields have a value stored, without the values. */
  extraKeys: string[];
};

/** Open the sealed columns into something an adapter can use. */
function credsFrom(row: {
  publicKey: string | null;
  secretSealed: string | null;
  extraSealed: string | null;
  linkUrl: string | null;
}): GatewayCredentials {
  return {
    publicKey: row.publicKey,
    secret: openSecret(row.secretSealed),
    extra: openJson(row.extraSealed),
    linkUrl: row.linkUrl,
  };
}

/** Every gateway this church has configured, for the settings page. */
export async function listGateways(churchId: string): Promise<GatewayRow[]> {
  const rows = await db
    .select()
    .from(churchGateway)
    .where(eq(churchGateway.churchId, churchId))
    .orderBy(desc(churchGateway.isActive), asc(churchGateway.provider));

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider as ProviderId,
    publicKey: r.publicKey,
    linkUrl: r.linkUrl,
    isActive: r.isActive,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    lastError: r.lastError,
    secretHint: secretHint(openSecret(r.secretSealed)),
    extraKeys: Object.keys(openJson(r.extraSealed)),
  }));
}

export type ActiveGateway = {
  provider: ProviderId;
  creds: GatewayCredentials;
  /** False for "link": nothing comes back, so nothing can be reconciled. */
  reportsBack: boolean;
};

/**
 * The gateway a church is collecting through right now, or null.
 *
 * Returns null when the secret cannot be opened — a key that cannot be
 * decrypted is not a configured gateway, and pretending otherwise would send a
 * giver to a checkout that fails. The public page then says the church is not
 * set up, which is both true and actionable.
 */
export async function getActiveGateway(
  churchId: string,
): Promise<ActiveGateway | null> {
  const [row] = await db
    .select()
    .from(churchGateway)
    .where(and(eq(churchGateway.churchId, churchId), eq(churchGateway.isActive, true)))
    .limit(1);
  if (!row) return null;

  const provider = row.provider as ProviderId;
  const creds = credsFrom(row);
  const spec = PROVIDER_SPECS[provider];
  if (!spec) return null;
  if (spec.id === "link") {
    if (!creds.linkUrl) return null;
  } else if (!creds.secret) {
    return null;
  }
  return { provider, creds, reportsBack: spec.reportsBack };
}

export type SaveGatewayResult =
  | { ok: true; verified: boolean; detail?: string }
  | { ok: false; error: string };

/**
 * Store (or replace) a church's credentials for one provider, then prove they
 * work before anything is activated.
 *
 * A blank secret means "keep the one already stored" — the form never shows a
 * stored secret back, so an edit that only changes the public key must not
 * wipe the secret. Saying "leave blank to keep" is how every other credential
 * form in the world behaves.
 */
export async function saveGateway(opts: {
  churchId: string;
  churchCurrency: string;
  provider: ProviderId;
  publicKey?: string | null;
  secret?: string | null;
  extra?: Record<string, string>;
  linkUrl?: string | null;
  userId?: string | null;
  /** Make it the one in use once it checks out. */
  activate: boolean;
}): Promise<SaveGatewayResult> {
  const spec = PROVIDER_SPECS[opts.provider];
  if (!spec) return { ok: false, error: "We don't support that provider." };

  if (!supportsCurrency(opts.provider, opts.churchCurrency))
    return {
      ok: false,
      error: `${spec.name} can't charge in ${opts.churchCurrency}. It supports ${spec.currencies.join(", ")}.`,
    };

  const [existing] = await db
    .select()
    .from(churchGateway)
    .where(
      and(
        eq(churchGateway.churchId, opts.churchId),
        eq(churchGateway.provider, opts.provider),
      ),
    )
    .limit(1);

  // Start from what is stored, so a partial edit keeps the rest.
  const secretPlain =
    opts.secret && opts.secret.trim()
      ? opts.secret.trim()
      : openSecret(existing?.secretSealed ?? null);
  const extraPlain = { ...openJson(existing?.extraSealed ?? null) };
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    const value = (v ?? "").trim();
    // An empty box means "leave it alone", with one exception: a field that
    // was never set stays unset, which is the same thing.
    if (value) extraPlain[k] = value;
  }
  const publicKey =
    opts.publicKey && opts.publicKey.trim()
      ? opts.publicKey.trim()
      : (existing?.publicKey ?? null);
  const linkUrl =
    opts.linkUrl && opts.linkUrl.trim()
      ? opts.linkUrl.trim()
      : (existing?.linkUrl ?? null);

  // Required fields, checked against the same spec the form renders from.
  for (const field of spec.fields) {
    if (!field.required) continue;
    const value =
      field.key === "publicKey"
        ? publicKey
        : field.key === "secret"
          ? secretPlain
          : field.key === "linkUrl"
            ? linkUrl
            : extraPlain[field.key];
    if (!value) return { ok: false, error: `${field.label} is required.` };
  }

  const creds: GatewayCredentials = {
    publicKey,
    secret: secretPlain,
    extra: extraPlain,
    linkUrl,
  };

  /*
   * Checked BEFORE storing, and the result decides whether it can be
   * activated. A church that pastes a revoked key should hear it now, not from
   * a giver standing in front of a QR code on a Sunday.
   */
  const adapter = adapterFor(opts.provider);
  if (!adapter) return { ok: false, error: "We don't support that provider." };
  const checked = await adapter.check(creds);

  let secretSealed = existing?.secretSealed ?? null;
  if (secretPlain) {
    const sealed = sealSecret(secretPlain);
    if (!sealed.ok) return { ok: false, error: sealed.error };
    secretSealed = sealed.sealed;
  }
  let extraSealed = existing?.extraSealed ?? null;
  if (Object.keys(extraPlain).length > 0) {
    const sealed = sealJson(extraPlain);
    if (!sealed.ok) return { ok: false, error: sealed.error };
    extraSealed = sealed.sealed;
  }

  const makeActive = opts.activate && checked.ok;

  await db.transaction(async (tx) => {
    if (makeActive) {
      // One active gateway per church. Done first, so there is never an
      // instant with two — a giver arriving mid-switch must get one answer.
      await tx
        .update(churchGateway)
        .set({ isActive: false })
        .where(eq(churchGateway.churchId, opts.churchId));
    }
    const values = {
      churchId: opts.churchId,
      provider: opts.provider,
      publicKey,
      secretSealed,
      extraSealed,
      linkUrl,
      isActive: makeActive ? true : (existing?.isActive ?? false),
      verifiedAt: checked.ok ? new Date() : (existing?.verifiedAt ?? null),
      lastError: checked.ok ? null : checked.error,
      createdBy: opts.userId ?? null,
    };
    if (existing) {
      await tx
        .update(churchGateway)
        .set(values)
        .where(eq(churchGateway.id, existing.id));
    } else {
      await tx.insert(churchGateway).values(values);
    }
  });

  if (!checked.ok) return { ok: false, error: checked.error };
  return { ok: true, verified: true, detail: checked.detail };
}

/** Switch which stored gateway is in use. Re-checks before switching. */
export async function activateGateway(
  churchId: string,
  provider: ProviderId,
): Promise<SaveGatewayResult> {
  const [row] = await db
    .select()
    .from(churchGateway)
    .where(
      and(eq(churchGateway.churchId, churchId), eq(churchGateway.provider, provider)),
    )
    .limit(1);
  if (!row) return { ok: false, error: "That provider isn't set up yet." };

  const adapter = adapterFor(provider);
  if (!adapter) return { ok: false, error: "We don't support that provider." };
  const checked = await adapter.check(credsFrom(row));

  await db.transaction(async (tx) => {
    await tx
      .update(churchGateway)
      .set({ isActive: false })
      .where(eq(churchGateway.churchId, churchId));
    await tx
      .update(churchGateway)
      .set({
        isActive: checked.ok,
        verifiedAt: checked.ok ? new Date() : row.verifiedAt,
        lastError: checked.ok ? null : checked.error,
      })
      .where(eq(churchGateway.id, row.id));
  });

  if (!checked.ok) return { ok: false, error: checked.error };
  return { ok: true, verified: true, detail: checked.detail };
}

/** Stop collecting online, without forgetting the keys. */
export async function deactivateGateways(churchId: string): Promise<void> {
  await db
    .update(churchGateway)
    .set({ isActive: false })
    .where(eq(churchGateway.churchId, churchId));
}

/* ============================================================
 * Collection links
 * ========================================================== */

export type LinkInput = {
  title: string;
  description?: string | null;
  categoryId?: string | null;
  amountMode: "open" | "fixed" | "preset";
  fixedAmount?: number | null;
  presetAmounts?: number[];
  minAmount?: number | null;
  targetAmount?: number | null;
  askPhone?: boolean;
  allowAnonymous?: boolean;
  showProgress?: boolean;
  thankYouMessage?: string | null;
};

/**
 * A slug nobody has taken. Church-prefixed, so two churches can both run a
 * "Building fund" and both get a readable address.
 */
async function freeSlug(churchHandle: string, title: string): Promise<string> {
  const base = `${slugify(churchHandle) || "church"}-${slugify(title) || "give"}`.slice(
    0,
    60,
  );
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${randomSuffix(4)}`;
    const [taken] = await db
      .select({ id: givingLink.id })
      .from(givingLink)
      .where(eq(givingLink.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export async function createGivingLink(opts: {
  churchId: string;
  churchHandle: string;
  userId?: string | null;
  input: LinkInput;
}): Promise<{ ok: true; id: string; slug: string } | { ok: false; error: string }> {
  const d = opts.input;
  if (!d.title.trim()) return { ok: false, error: "Give it a title." };
  if (d.amountMode === "fixed" && !(d.fixedAmount && d.fixedAmount > 0))
    return { ok: false, error: "Set the amount this link collects." };
  if (d.amountMode === "preset" && !(d.presetAmounts ?? []).some((n) => n > 0))
    return { ok: false, error: "Add at least one suggested amount." };

  const slug = await freeSlug(opts.churchHandle, d.title);
  const [row] = await db
    .insert(givingLink)
    .values({
      churchId: opts.churchId,
      slug,
      title: d.title.trim().slice(0, 120),
      description: d.description?.trim() || null,
      categoryId: d.categoryId || null,
      amountMode: d.amountMode,
      fixedAmount: d.amountMode === "fixed" ? (d.fixedAmount ?? null) : null,
      presetAmounts:
        d.amountMode === "preset"
          ? (d.presetAmounts ?? []).filter((n) => n > 0).slice(0, 8)
          : [],
      minAmount: d.minAmount ?? null,
      targetAmount: d.targetAmount ?? null,
      askPhone: d.askPhone ?? true,
      allowAnonymous: d.allowAnonymous ?? true,
      showProgress: d.showProgress ?? false,
      thankYouMessage: d.thankYouMessage?.trim() || null,
      createdBy: opts.userId ?? null,
    })
    .returning({ id: givingLink.id, slug: givingLink.slug });
  return { ok: true, id: row.id, slug: row.slug };
}

export async function updateGivingLink(opts: {
  churchId: string;
  id: string;
  input: Partial<LinkInput> & { isActive?: boolean; closesAt?: Date | null };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const d = opts.input;
  if (d.amountMode === "fixed" && !(d.fixedAmount && d.fixedAmount > 0))
    return { ok: false, error: "Set the amount this link collects." };

  const done = await db
    .update(givingLink)
    .set({
      ...(d.title !== undefined ? { title: d.title.trim().slice(0, 120) } : {}),
      ...(d.description !== undefined
        ? { description: d.description?.trim() || null }
        : {}),
      ...(d.categoryId !== undefined ? { categoryId: d.categoryId || null } : {}),
      ...(d.amountMode !== undefined ? { amountMode: d.amountMode } : {}),
      ...(d.fixedAmount !== undefined ? { fixedAmount: d.fixedAmount ?? null } : {}),
      ...(d.presetAmounts !== undefined
        ? { presetAmounts: d.presetAmounts.filter((n) => n > 0).slice(0, 8) }
        : {}),
      ...(d.minAmount !== undefined ? { minAmount: d.minAmount ?? null } : {}),
      ...(d.targetAmount !== undefined ? { targetAmount: d.targetAmount ?? null } : {}),
      ...(d.askPhone !== undefined ? { askPhone: d.askPhone } : {}),
      ...(d.allowAnonymous !== undefined ? { allowAnonymous: d.allowAnonymous } : {}),
      ...(d.showProgress !== undefined ? { showProgress: d.showProgress } : {}),
      ...(d.thankYouMessage !== undefined
        ? { thankYouMessage: d.thankYouMessage?.trim() || null }
        : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.closesAt !== undefined ? { closesAt: d.closesAt } : {}),
    })
    // Scoped to the church, so an id from a form can only touch its own links.
    .where(and(eq(givingLink.id, opts.id), eq(givingLink.churchId, opts.churchId)))
    .returning({ id: givingLink.id });
  if (done.length === 0) return { ok: false, error: "That link no longer exists." };
  return { ok: true };
}

export type LinkRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  amountMode: "open" | "fixed" | "preset";
  fixedAmount: number | null;
  presetAmounts: number[];
  minAmount: number | null;
  targetAmount: number | null;
  askPhone: boolean;
  allowAnonymous: boolean;
  showProgress: boolean;
  thankYouMessage: string | null;
  isActive: boolean;
  closesAt: string | null;
  /** Settled gifts through this link. */
  raised: number;
  givers: number;
  createdAt: string;
};

/**
 * The church's links, with what each has raised.
 *
 * The totals come from a GROUPED aggregate joined in JS, not a correlated
 * subquery. A raw `sql` subquery against the same table loses its qualifier
 * when the outer query has no join, so `where link_id = id` binds both names
 * to the inner table and every total comes back as zero — silently, for ever.
 * See lib/sql-safety.test.ts, which fails the build on that shape.
 */
export async function listGivingLinks(churchId: string): Promise<LinkRow[]> {
  const [links, totals] = await Promise.all([
    db
      .select({
        id: givingLink.id,
        slug: givingLink.slug,
        title: givingLink.title,
        description: givingLink.description,
        categoryId: givingLink.categoryId,
        categoryName: givingCategory.name,
        amountMode: givingLink.amountMode,
        fixedAmount: givingLink.fixedAmount,
        presetAmounts: givingLink.presetAmounts,
        minAmount: givingLink.minAmount,
        targetAmount: givingLink.targetAmount,
        askPhone: givingLink.askPhone,
        allowAnonymous: givingLink.allowAnonymous,
        showProgress: givingLink.showProgress,
        thankYouMessage: givingLink.thankYouMessage,
        isActive: givingLink.isActive,
        closesAt: givingLink.closesAt,
        createdAt: givingLink.createdAt,
      })
      .from(givingLink)
      .leftJoin(givingCategory, eq(givingCategory.id, givingLink.categoryId))
      .where(eq(givingLink.churchId, churchId))
      .orderBy(desc(givingLink.isActive), desc(givingLink.createdAt)),
    db
      .select({
        linkId: onlinePayment.linkId,
        raised: sql<string>`coalesce(sum(${onlinePayment.amount}), 0)`,
        givers: count(),
      })
      .from(onlinePayment)
      .where(
        and(
          eq(onlinePayment.churchId, churchId),
          eq(onlinePayment.status, "success"),
          isNotNull(onlinePayment.linkId),
        ),
      )
      .groupBy(onlinePayment.linkId),
  ]);

  const byLink = new Map(
    totals.map((t) => [t.linkId, { raised: Number(t.raised), givers: Number(t.givers) }]),
  );

  return links.map((l) => ({
    ...l,
    amountMode: l.amountMode as "open" | "fixed" | "preset",
    fixedAmount: l.fixedAmount ?? null,
    presetAmounts: l.presetAmounts ?? [],
    minAmount: l.minAmount ?? null,
    targetAmount: l.targetAmount ?? null,
    closesAt: l.closesAt ? l.closesAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
    raised: byLink.get(l.id)?.raised ?? 0,
    givers: byLink.get(l.id)?.givers ?? 0,
  }));
}

export type PublicLink = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  amountMode: "open" | "fixed" | "preset";
  fixedAmount: number | null;
  presetAmounts: number[];
  minAmount: number | null;
  targetAmount: number | null;
  askPhone: boolean;
  allowAnonymous: boolean;
  showProgress: boolean;
  thankYouMessage: string | null;
  /** Why it cannot be given to, if it cannot. */
  closedReason: string | null;
  churchId: string;
  churchName: string;
  churchLogo: string | null;
  churchHandle: string | null;
  currency: string;
  provider: ProviderId | null;
  /** The church's own page, when it collects through a plain link. */
  externalUrl: string | null;
  raised: number;
  givers: number;
};

/** Everything the public page needs, in one read. */
export async function getPublicGivingLink(slug: string): Promise<PublicLink | null> {
  const [row] = await db
    .select({
      link: givingLink,
      churchId: church.id,
      churchName: church.name,
      churchLogo: church.logo,
      churchHandle: church.handle,
      currency: church.currency,
      churchStatus: church.status,
    })
    .from(givingLink)
    .innerJoin(church, eq(church.id, givingLink.churchId))
    .where(eq(givingLink.slug, slug))
    .limit(1);
  if (!row) return null;

  const [totals] = await db
    .select({
      raised: sql<string>`coalesce(sum(${onlinePayment.amount}), 0)`,
      givers: count(),
    })
    .from(onlinePayment)
    .where(
      and(
        eq(onlinePayment.linkId, row.link.id),
        eq(onlinePayment.status, "success"),
      ),
    );

  const gateway = await getActiveGateway(row.churchId);

  /*
   * One reason, chosen in order of what the giver can do about it. "This
   * church isn't set up to take online gifts yet" is useful; "closed" when the
   * truth is "suspended" is not.
   */
  const closedReason =
    row.churchStatus === "suspended"
      ? "This church's account is on hold, so giving is paused."
      : !row.link.isActive
        ? "This collection is closed."
        : row.link.closesAt && row.link.closesAt.getTime() < Date.now()
          ? "This collection has closed."
          : !gateway
            ? "This church hasn't finished setting up online giving yet."
            : null;

  return {
    id: row.link.id,
    slug: row.link.slug,
    title: row.link.title,
    description: row.link.description,
    amountMode: row.link.amountMode as "open" | "fixed" | "preset",
    fixedAmount: row.link.fixedAmount ?? null,
    presetAmounts: row.link.presetAmounts ?? [],
    minAmount: row.link.minAmount ?? null,
    targetAmount: row.link.targetAmount ?? null,
    askPhone: row.link.askPhone,
    allowAnonymous: row.link.allowAnonymous,
    showProgress: row.link.showProgress,
    thankYouMessage: row.link.thankYouMessage,
    closedReason,
    churchId: row.churchId,
    churchName: row.churchName,
    churchLogo: row.churchLogo,
    churchHandle: row.churchHandle,
    currency: row.currency,
    provider: gateway?.provider ?? null,
    externalUrl: gateway?.provider === "link" ? (gateway.creds.linkUrl ?? null) : null,
    raised: Number(totals?.raised ?? 0),
    givers: Number(totals?.givers ?? 0),
  };
}

/** The public URL for a link, for copying and for QR codes. */
export function giveUrl(slug: string): string {
  return `${siteUrl()}/give/${slug}`;
}

/* ============================================================
 * Taking a gift
 * ========================================================== */

/** A reference nobody can guess and no two churches can collide on. */
function newReference(): string {
  return `FI-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export type StartGiftResult =
  | { ok: true; checkoutUrl: string; reference: string }
  | { ok: false; error: string };

/**
 * Begin a gift: write the row, then hand the giver to the gateway.
 *
 * The amount is re-derived from the LINK, never taken from the form, except
 * where the link says the giver chooses. A posted amount on a fixed-price link
 * is somebody editing a hidden field.
 */
export async function startOnlineGift(opts: {
  slug: string;
  amount: number;
  name: string | null;
  email: string;
  phone: string | null;
  note: string | null;
}): Promise<StartGiftResult> {
  const link = await getPublicGivingLink(opts.slug);
  if (!link) return { ok: false, error: "That giving link doesn't exist." };
  if (link.closedReason) return { ok: false, error: link.closedReason };

  const gateway = await getActiveGateway(link.churchId);
  if (!gateway)
    return {
      ok: false,
      error: "This church hasn't finished setting up online giving yet.",
    };

  // Decide the amount from the link's own rule.
  let amount = opts.amount;
  if (link.amountMode === "fixed") amount = link.fixedAmount ?? 0;
  if (!(amount > 0)) return { ok: false, error: "Enter how much you'd like to give." };
  if (link.minAmount && amount < link.minAmount)
    return {
      ok: false,
      error: `The smallest gift through this link is ${link.minAmount}.`,
    };

  const email = (opts.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return {
      ok: false,
      error: "Enter an email address — the gateway needs one to send a receipt.",
    };

  const phone = opts.phone ? normalizePhone(opts.phone) : null;
  const reference = newReference();

  /*
   * Matched to a member where we can, by phone first and then email.
   *
   * Phone first because it is the identifier a Nigerian congregation actually
   * has on file; email is often shared or absent. A miss is fine — the gift is
   * recorded under the name they typed, exactly like a cash gift from a
   * visitor.
   */
  let memberId: string | null = null;
  if (phone || email) {
    const [match] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.churchId, link.churchId),
          phone ? eq(member.phone, phone) : eq(member.email, email),
        ),
      )
      .limit(1);
    memberId = match?.id ?? null;
  }

  await db.insert(onlinePayment).values({
    churchId: link.churchId,
    linkId: link.id,
    provider: gateway.provider,
    reference,
    amount,
    currency: link.currency,
    giverName: opts.name?.trim() || null,
    giverEmail: email,
    giverPhone: phone,
    memberId,
    note: opts.note?.trim()?.slice(0, 300) || null,
  });

  const adapter = adapterFor(gateway.provider);
  if (!adapter) return { ok: false, error: "This church's payment setup is broken." };

  const started = await adapter.start(gateway.creds, {
    reference,
    amount,
    currency: link.currency,
    email,
    name: opts.name?.trim() || null,
    phone,
    callbackUrl: `${siteUrl()}/give/${link.slug}/thanks?reference=${encodeURIComponent(reference)}`,
    description: `${link.title} — ${link.churchName}`,
    churchName: link.churchName,
  });

  if (!started.ok) {
    /*
     * The gateway refused before the giver ever saw a checkout. Recorded as
     * failed with the reason, rather than left pending for ever: a row stuck
     * at "pending" reads as a gift that might still arrive, and this one never
     * will.
     */
    await db
      .update(onlinePayment)
      .set({ status: "failed", failReason: started.error })
      .where(eq(onlinePayment.reference, reference));
    return { ok: false, error: started.error };
  }

  if (started.gatewayRef) {
    await db
      .update(onlinePayment)
      .set({ gatewayRef: started.gatewayRef })
      .where(eq(onlinePayment.reference, reference));
  }

  return { ok: true, checkoutUrl: started.checkoutUrl, reference };
}

export type SettleResult =
  | {
      ok: true;
      status: "success" | "failed" | "pending";
      /** True when THIS call wrote the giving row. */
      recorded: boolean;
      amount: number;
      currency: string;
      linkSlug: string | null;
      thankYouMessage: string | null;
      churchName: string;
      giverName: string | null;
    }
  | { ok: false; error: string };

/**
 * Find out what really happened to a payment, and record it once.
 *
 * Called from the giver's redirect AND from the webhook, deliberately: both
 * are unreliable on their own — a webhook can be delayed and a phone can die
 * on the way back from a bank app — and between them a completed payment is
 * almost always settled within seconds.
 *
 * SAFE TO CALL ANY NUMBER OF TIMES. The gateway is asked each time; the giving
 * row is written only if `givingId` is still null, under a conditional update
 * that only one caller can win.
 */
export async function settleOnlinePayment(reference: string): Promise<SettleResult> {
  const [row] = await db
    .select({
      payment: onlinePayment,
      churchName: church.name,
      currency: church.currency,
      linkSlug: givingLink.slug,
      linkTitle: givingLink.title,
      categoryId: givingLink.categoryId,
      thankYouMessage: givingLink.thankYouMessage,
    })
    .from(onlinePayment)
    .innerJoin(church, eq(church.id, onlinePayment.churchId))
    .leftJoin(givingLink, eq(givingLink.id, onlinePayment.linkId))
    .where(eq(onlinePayment.reference, reference))
    .limit(1);
  if (!row) return { ok: false, error: "We don't have a record of that payment." };

  const p = row.payment;

  // Already settled. Answered from our own record without troubling the
  // gateway — this is the common case when a webhook and a redirect race.
  if (p.givingId) {
    return {
      ok: true,
      status: "success",
      recorded: false,
      amount: p.amount,
      currency: p.currency,
      linkSlug: row.linkSlug,
      thankYouMessage: row.thankYouMessage,
      churchName: row.churchName,
      giverName: p.giverName,
    };
  }

  const gateway = await getActiveGateway(p.churchId);
  const adapter = gateway ? adapterFor(gateway.provider) : null;
  if (!gateway || !adapter)
    return { ok: false, error: "This church's payment setup is no longer available." };

  const verified = await adapter.verify(gateway.creds, reference);
  if (!verified.ok) return { ok: false, error: verified.error };

  if (verified.status !== "success") {
    await db
      .update(onlinePayment)
      .set({
        // "pending" is left alone rather than written as failed: an abandoned
        // checkout and a transfer still clearing look identical here, and only
        // one of them is over.
        status: verified.status === "failed" ? "failed" : p.status,
        failReason: verified.message ?? null,
      })
      .where(eq(onlinePayment.id, p.id));
    return {
      ok: true,
      status: verified.status,
      recorded: false,
      amount: p.amount,
      currency: p.currency,
      linkSlug: row.linkSlug,
      thankYouMessage: row.thankYouMessage,
      churchName: row.churchName,
      giverName: p.giverName,
    };
  }

  /*
   * What the GATEWAY says was paid, not what we asked for.
   *
   * They can differ — a currency switch, a partial transfer, somebody editing
   * the amount on the checkout — and the church's books have to agree with the
   * church's bank account, not with our intention.
   */
  const paidAmount = verified.amount > 0 ? verified.amount : p.amount;
  const paidCurrency = verified.currency || p.currency;
  const today = new Date().toISOString().slice(0, 10);

  const [gift] = await db
    .insert(giving)
    .values({
      churchId: p.churchId,
      categoryId: row.categoryId ?? null,
      memberId: p.memberId,
      giverName: p.giverName || "Online giver",
      amount: paidAmount,
      method: "online",
      date: today,
      note: [row.linkTitle, p.note].filter(Boolean).join(" — ").slice(0, 500) || null,
    })
    .returning({ id: giving.id });

  /*
   * The latch. `givingId is null` in the WHERE is what makes a double settle
   * impossible: the loser of the race updates no rows, sees it, and removes
   * the duplicate gift it just wrote.
   */
  const claimed = await db
    .update(onlinePayment)
    .set({
      status: "success",
      givingId: gift.id,
      gatewayRef: verified.gatewayRef ?? p.gatewayRef,
      amount: paidAmount,
      currency: paidCurrency,
      paidAt: new Date(),
      failReason: null,
    })
    .where(and(eq(onlinePayment.id, p.id), sql`${onlinePayment.givingId} is null`))
    .returning({ id: onlinePayment.id });

  if (claimed.length === 0) {
    // Somebody else got there first. Undo our gift so the church does not see
    // the same offering twice.
    await db.delete(giving).where(eq(giving.id, gift.id));
    return {
      ok: true,
      status: "success",
      recorded: false,
      amount: paidAmount,
      currency: paidCurrency,
      linkSlug: row.linkSlug,
      thankYouMessage: row.thankYouMessage,
      churchName: row.churchName,
      giverName: p.giverName,
    };
  }

  // Mirror into Finance and thank the giver. Both best-effort by design: the
  // gift is recorded either way, and neither is worth losing it for.
  try {
    const { syncGivingToFinance } = await import("@/lib/finance-giving-sync");
    await syncGivingToFinance(p.churchId, gift.id);
  } catch (e) {
    console.error("[online-giving] finance sync failed", e);
  }
  try {
    const { sendGivingReceipt } = await import("@/lib/giving-receipts");
    const [cat] = row.categoryId
      ? await db
          .select({ name: givingCategory.name })
          .from(givingCategory)
          .where(eq(givingCategory.id, row.categoryId))
          .limit(1)
      : [];
    await sendGivingReceipt({
      churchId: p.churchId,
      churchName: row.churchName,
      currency: paidCurrency,
      firstName: (p.giverName || "Friend").split(" ")[0],
      phone: p.giverPhone,
      email: p.giverEmail,
      amount: paidAmount,
      categoryName: cat?.name ?? null,
      method: "online",
      date: today,
    });
  } catch (e) {
    console.error("[online-giving] receipt failed", e);
  }

  return {
    ok: true,
    status: "success",
    recorded: true,
    amount: paidAmount,
    currency: paidCurrency,
    linkSlug: row.linkSlug,
    thankYouMessage: row.thankYouMessage,
    churchName: row.churchName,
    giverName: p.giverName,
  };
}

/** Recent online gifts, for the church's own page. */
export async function listOnlinePayments(churchId: string, limit = 50) {
  const rows = await db
    .select({
      id: onlinePayment.id,
      reference: onlinePayment.reference,
      provider: onlinePayment.provider,
      amount: onlinePayment.amount,
      currency: onlinePayment.currency,
      status: onlinePayment.status,
      giverName: onlinePayment.giverName,
      giverEmail: onlinePayment.giverEmail,
      note: onlinePayment.note,
      failReason: onlinePayment.failReason,
      paidAt: onlinePayment.paidAt,
      createdAt: onlinePayment.createdAt,
      linkTitle: givingLink.title,
    })
    .from(onlinePayment)
    .leftJoin(givingLink, eq(givingLink.id, onlinePayment.linkId))
    .where(eq(onlinePayment.churchId, churchId))
    .orderBy(desc(onlinePayment.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
