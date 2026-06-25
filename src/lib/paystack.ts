import "server-only";

const SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE = "https://api.paystack.co";

export function isPaystackConfigured(): boolean {
  return !!SECRET;
}

export async function paystackInit(opts: {
  email: string;
  amountNaira: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!SECRET) return { ok: false, error: "Payments aren't configured yet." };
  try {
    const res = await fetch(`${BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: opts.email,
        amount: Math.round(opts.amountNaira * 100), // kobo
        reference: opts.reference,
        callback_url: opts.callbackUrl,
        currency: "NGN",
        metadata: opts.metadata,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.status || !data?.data?.authorization_url) {
      return { ok: false, error: data?.message || "Could not start payment." };
    }
    return { ok: true, url: data.data.authorization_url as string };
  } catch {
    return { ok: false, error: "Could not reach Paystack." };
  }
}

export async function paystackVerify(reference: string): Promise<
  | { ok: true; status: string; amountNaira: number; metadata: unknown }
  | { ok: false; error: string }
> {
  if (!SECRET) return { ok: false, error: "Payments aren't configured yet." };
  try {
    const res = await fetch(
      `${BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${SECRET}` } },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.status || !data?.data) {
      return { ok: false, error: "Could not verify the payment." };
    }
    return {
      ok: true,
      status: data.data.status,
      amountNaira: (data.data.amount ?? 0) / 100,
      metadata: data.data.metadata,
    };
  } catch {
    return { ok: false, error: "Could not reach Paystack." };
  }
}
