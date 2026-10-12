/**
 * Run `fn` over `items` with at most `limit` running at once.
 *
 * The same shape as `Promise.allSettled(items.map(fn))` - one settled result
 * per item, in input order, so `results[i]` still lines up with `items[i]` -
 * but without starting every call at the same instant. A bulk SMS used to make
 * one gateway call per personalised message strictly one after another (400
 * members, minutes); doing them all at once instead would open hundreds of
 * sockets to one provider from one process. This is the middle.
 *
 * Pure, so it can be tested without a network.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        // Recorded against its own item, never allowed to stop the others.
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
