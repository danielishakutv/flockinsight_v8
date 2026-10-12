import { describe, expect, it } from "vitest";
import { mapLimit } from "@/lib/concurrency";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await tick(n % 3);
      running--;
      return n;
    });
    expect(peak).toBe(3);
  });

  it("keeps results in input order, whatever order they finish in", async () => {
    const res = await mapLimit([30, 1, 15, 0], 4, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(res.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      30, 1, 15, 0,
    ]);
  });

  it("records a throw against its own item and carries on", async () => {
    const res = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n * 10;
    });
    expect(res[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(res[1].status).toBe("rejected");
    expect((res[1] as PromiseRejectedResult).reason.message).toBe("boom");
    expect(res[2]).toEqual({ status: "fulfilled", value: 30 });
  });

  it("handles an empty list and a silly limit", async () => {
    expect(await mapLimit([], 5, async (n) => n)).toEqual([]);
    const res = await mapLimit([1, 2], 0, async (n) => n);
    expect(res).toHaveLength(2);
  });
});
