"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { givingLink } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { audit } from "@/lib/audit";
import { PROVIDER_IDS } from "@/lib/gateways/specs";
import type { ProviderId } from "@/lib/gateways/types";
import {
  activateGateway,
  createGivingLink,
  deactivateGateways,
  saveGateway,
  updateGivingLink,
} from "@/lib/online-giving";

export type ActionResult = { ok: true; detail?: string } | { ok: false; error: string };

/*
 * Who may touch any of this: `giving.manage`.
 *
 * Not settings.manage. These are the keys to the church's money and the
 * wording on a page a congregation will see — that belongs to whoever already
 * keeps the giving records, not to whoever can rename the church.
 */
async function guard() {
  const ctx = await requireChurch();
  if (!(await can("giving.manage")))
    return { ctx, refusal: { ok: false as const, error: "You don't have permission to manage giving." } };
  const gate = await refuseWithoutFeature("onlineGiving");
  if (gate) return { ctx, refusal: gate };
  return { ctx, refusal: null };
}

const providerSchema = z.enum(["paystack", "flutterwave", "monnify", "link"]);

const gatewaySchema = z.object({
  provider: providerSchema,
  publicKey: z.string().trim().max(200).optional(),
  // Blank means "keep what is stored" — the form never shows a secret back.
  secret: z.string().trim().max(500).optional(),
  linkUrl: z.string().trim().max(500).optional(),
  extra: z.record(z.string(), z.string().trim().max(500)).optional(),
  activate: z.boolean().default(true),
});

/** Save a provider's credentials, check them against the provider, activate. */
export async function saveGatewayAction(
  input: z.input<typeof gatewaySchema>,
): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const parsed = gatewaySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const res = await saveGateway({
    churchId: ctx.church.id,
    churchCurrency: ctx.church.currency,
    provider: d.provider,
    publicKey: d.publicKey ?? null,
    secret: d.secret ?? null,
    linkUrl: d.linkUrl ?? null,
    extra: d.extra ?? {},
    userId: ctx.user.id,
    activate: d.activate,
  });

  await audit({
    churchId: ctx.church.id,
    action: "giving.gateway.save",
    summary: res.ok
      ? `Connected ${d.provider} for online giving`
      : `Tried to connect ${d.provider} for online giving and it was refused`,
    targetType: "church",
    targetId: ctx.church.id,
    // Never the keys, and never a fragment of them. The provider and the
    // outcome are the whole useful content of this line.
    meta: { provider: d.provider, ok: res.ok },
    severity: "notice",
  });

  revalidatePath("/settings/payments");
  if (!res.ok) return res;
  return { ok: true, detail: res.detail };
}

/** Switch which stored provider is in use. */
export async function activateGatewayAction(provider: string): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;
  if (!PROVIDER_IDS.includes(provider as ProviderId))
    return { ok: false, error: "We don't support that provider." };

  const res = await activateGateway(ctx.church.id, provider as ProviderId);
  await audit({
    churchId: ctx.church.id,
    action: "giving.gateway.activate",
    summary: `Switched online giving to ${provider}`,
    targetType: "church",
    targetId: ctx.church.id,
    meta: { provider, ok: res.ok },
    severity: "notice",
  });
  revalidatePath("/settings/payments");
  if (!res.ok) return res;
  return { ok: true, detail: res.detail };
}

/** Stop taking online gifts, without forgetting the keys. */
export async function stopOnlineGivingAction(): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;
  await deactivateGateways(ctx.church.id);
  await audit({
    churchId: ctx.church.id,
    action: "giving.gateway.deactivate",
    summary: "Turned off online giving",
    targetType: "church",
    targetId: ctx.church.id,
    severity: "warning",
  });
  revalidatePath("/settings/payments");
  return { ok: true };
}

const amountMode = z.enum(["open", "fixed", "preset"]);

const linkSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(120),
  description: z.string().trim().max(600).optional(),
  categoryId: z.string().uuid().nullish(),
  amountMode: amountMode.default("open"),
  fixedAmount: z.number().positive().nullish(),
  presetAmounts: z.array(z.number().positive()).max(8).default([]),
  minAmount: z.number().positive().nullish(),
  targetAmount: z.number().positive().nullish(),
  askPhone: z.boolean().default(true),
  allowAnonymous: z.boolean().default(true),
  showProgress: z.boolean().default(false),
  thankYouMessage: z.string().trim().max(600).optional(),
});

export type LinkActionResult =
  | { ok: true; slug?: string }
  | { ok: false; error: string };

export async function createGivingLinkAction(
  input: z.input<typeof linkSchema>,
): Promise<LinkActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const res = await createGivingLink({
    churchId: ctx.church.id,
    // The handle makes the slug readable; the church's own name is the
    // fallback for one that has not set a public handle yet.
    churchHandle: ctx.church.handle || ctx.church.name,
    userId: ctx.user.id,
    input: {
      ...parsed.data,
      description: parsed.data.description ?? null,
      categoryId: parsed.data.categoryId ?? null,
      fixedAmount: parsed.data.fixedAmount ?? null,
      minAmount: parsed.data.minAmount ?? null,
      targetAmount: parsed.data.targetAmount ?? null,
      thankYouMessage: parsed.data.thankYouMessage ?? null,
    },
  });
  if (!res.ok) return res;

  await audit({
    churchId: ctx.church.id,
    action: "giving.link.create",
    summary: `Created the giving link "${parsed.data.title}"`,
    targetType: "giving",
    targetId: res.id,
    targetLabel: parsed.data.title,
    meta: { slug: res.slug, amountMode: parsed.data.amountMode },
  });

  revalidatePath("/settings/payments");
  revalidatePath("/giving");
  return { ok: true, slug: res.slug };
}

export async function updateGivingLinkAction(
  id: string,
  input: z.input<typeof linkSchema>,
): Promise<LinkActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const res = await updateGivingLink({
    churchId: ctx.church.id,
    id: String(id || ""),
    input: {
      ...parsed.data,
      description: parsed.data.description ?? null,
      categoryId: parsed.data.categoryId ?? null,
      fixedAmount: parsed.data.fixedAmount ?? null,
      minAmount: parsed.data.minAmount ?? null,
      targetAmount: parsed.data.targetAmount ?? null,
      thankYouMessage: parsed.data.thankYouMessage ?? null,
    },
  });
  if (!res.ok) return res;

  await audit({
    churchId: ctx.church.id,
    action: "giving.link.update",
    summary: `Edited the giving link "${parsed.data.title}"`,
    targetType: "giving",
    targetId: id,
    targetLabel: parsed.data.title,
  });

  revalidatePath("/settings/payments");
  return { ok: true };
}

/**
 * Open or close a link.
 *
 * Closing rather than deleting, always. A link lives on a banner, in a WhatsApp
 * group and on somebody's fridge; the page has to keep answering, and what it
 * should say is "this collection has closed" — not 404, and certainly not take
 * a gift the church is no longer expecting.
 */
export async function setGivingLinkActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const { ctx, refusal } = await guard();
  if (refusal) return refusal;

  const done = await db
    .update(givingLink)
    .set({ isActive })
    .where(
      and(eq(givingLink.id, String(id || "")), eq(givingLink.churchId, ctx.church.id)),
    )
    .returning({ id: givingLink.id, title: givingLink.title });
  if (done.length === 0) return { ok: false, error: "That link no longer exists." };

  await audit({
    churchId: ctx.church.id,
    action: isActive ? "giving.link.open" : "giving.link.close",
    summary: `${isActive ? "Opened" : "Closed"} the giving link "${done[0].title}"`,
    targetType: "giving",
    targetId: id,
    targetLabel: done[0].title,
    severity: "notice",
  });

  revalidatePath("/settings/payments");
  return { ok: true };
}
