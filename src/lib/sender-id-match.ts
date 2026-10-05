/**
 * How a sender ID here is matched to a sender ID on the network.
 *
 * Pure — no server-only import — because this one rule has to be applied in
 * three places that cannot share a server module: the Termii client, the
 * reconcile job, and the superadmin screen in the browser. It was duplicated
 * by hand into the browser copy, which is exactly how two spellings of the
 * same registration come to be read as two different IDs.
 *
 * THE SAME REGISTRATION IS WRITTEN DIFFERENTLY IN THE TWO PLACES. A church
 * stored as "RPM  YOLA" is the network's "RPM YOLA"; Termii's own list has
 * returned an ID with different capitalisation from the one submitted.
 * Comparing them literally left an approved sender ID showing as awaiting
 * review, with no way to release it.
 */

export function normalizeSenderId(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export type NetworkSenderIdLike = {
  senderId: string;
  status: "approved" | "pending" | "rejected" | "unknown";
  raw: string;
};

/**
 * Index the network's list by normalized ID, preferring an approved entry.
 *
 * The account has carried the same ID more than once with different verdicts.
 * Taking whichever row came back last would make a church's fate depend on the
 * order Termii happens to page its results in — so an approved entry always
 * wins, and among entries of equal standing the first is kept.
 */
export function indexNetworkSenderIds<T extends NetworkSenderIdLike>(
  ids: readonly T[],
): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const n of ids) {
    if (!n.senderId) continue;
    const key = normalizeSenderId(n.senderId);
    const prev = byKey.get(key);
    if (!prev || (prev.status !== "approved" && n.status === "approved")) {
      byKey.set(key, n);
    }
  }
  return byKey;
}

/** The network's entry for one stored sender ID, or null if it has none. */
export function findOnNetwork<T extends NetworkSenderIdLike>(
  ids: readonly T[] | null | undefined,
  senderId: string | null | undefined,
): T | null {
  if (!ids || !senderId) return null;
  return indexNetworkSenderIds(ids).get(normalizeSenderId(senderId)) ?? null;
}
