import { describe, expect, it } from "vitest";
import { getChurchBrand, type BrandSource } from "@/lib/pdf-brand";

/**
 * "Branded PDFs carrying your logo & colours" is sold from Pro.
 *
 * This is a silent behaviour change — nothing errors either way, the document
 * simply looks like the church's or it does not — so it is pinned here. The
 * failure mode worth guarding against is the opposite of the obvious one: a
 * caller that does not pass a plan must get the PLAIN document, never the paid
 * one, or the gate is decoration.
 */

const base: BrandSource = {
  id: "church-1",
  name: "Grace Chapel",
  // Not a URL and not a stored key, so nothing is fetched or read from disk.
  logo: null,
  // A real theme id — a made-up one silently falls back to the default, which
  // would make this whole file pass without testing anything.
  theme: "forest",
  handle: "grace",
  slug: "grace-chapel",
};

describe("branded PDFs follow the plan", () => {
  it("gives a Pro church its own theme", async () => {
    const pro = await getChurchBrand({ ...base, plan: "pro" });
    const starter = await getChurchBrand({ ...base, plan: "starter" });
    // The church picked Forest; a plan without branding gets the default, so
    // the two must differ somewhere a reader would see.
    expect(pro.primary).not.toBe(starter.primary);
  });

  it("gives Enterprise the same as Pro", async () => {
    const pro = await getChurchBrand({ ...base, plan: "pro" });
    const ent = await getChurchBrand({ ...base, plan: "enterprise" });
    expect(ent.primary).toBe(pro.primary);
  });

  it("gives Starter and Growth the default colours", async () => {
    const starter = await getChurchBrand({ ...base, plan: "starter" });
    const growth = await getChurchBrand({ ...base, plan: "growth" });
    const unthemed = await getChurchBrand({ ...base, theme: null, plan: "pro" });
    expect(starter.primary).toBe(unthemed.primary);
    expect(growth.primary).toBe(unthemed.primary);
  });

  it("falls back to plain when the caller says nothing about the plan", async () => {
    /*
     * The one that matters. A call site that forgets to pass the plan must not
     * hand out the paid document — an unsaid plan is the smallest allowance,
     * exactly as everywhere else in lib/entitlements.ts.
     */
    const silent = await getChurchBrand(base);
    const starter = await getChurchBrand({ ...base, plan: "starter" });
    expect(silent.primary).toBe(starter.primary);
    expect(silent.logo).toBeNull();
  });

  it("still produces a complete, usable document on every plan", async () => {
    // The data is not what is being sold; the document looking like theirs is.
    // So a Starter PDF must still have a name, colours and a working link.
    for (const plan of ["starter", "growth", "pro", "enterprise", "nonsense"]) {
      const brand = await getChurchBrand({ ...base, plan });
      expect(brand.name).toBe("Grace Chapel");
      expect(brand.primary).toMatch(/^#?[0-9a-fA-F]{3,8}$|^rgb/);
      expect(brand.referralUrl).toBeTruthy();
    }
  });

  it("never carries a logo on a plan that has not paid for one", async () => {
    // A remote logo would otherwise be fetched and embedded. Asserting on the
    // result rather than on whether the fetch happened: the output is the promise.
    const brand = await getChurchBrand({
      ...base,
      logo: "https://example.invalid/logo.png",
      plan: "growth",
    });
    expect(brand.logo).toBeNull();
  });
});
