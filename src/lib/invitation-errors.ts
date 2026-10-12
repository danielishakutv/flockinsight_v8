/**
 * What to tell an admin when the org plugin refuses an invitation.
 *
 * Every refusal used to collapse into "Could not create the invitation. Please
 * try again." — including "Invitation limit reached", which retrying can never
 * fix. 98 of those reached the production log. Name the cause and the action.
 *
 * Pure: reads the `{ body: { code, message } }` shape Better Auth's APIError
 * carries, and anything else falls through to the generic line.
 */

const KNOWN: Record<string, string> = {
  INVITATION_LIMIT_REACHED:
    "Your church has too many invitations still waiting to be accepted. Cancel some in Settings → Team (or wait for them to expire), then try again.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    "Someone with that email is already on the team.",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
    "You don't have permission to manage the team.",
  INVALID_EMAIL: "That doesn't look like a valid email address.",
};

export const GENERIC_INVITATION_ERROR =
  "Could not create the invitation. Please try again.";

export function invitationErrorCode(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const body = (e as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function invitationErrorMessage(e: unknown): string {
  const code = invitationErrorCode(e);
  if (code && KNOWN[code]) return KNOWN[code];
  /*
   * Our own refusals from lib/org-plugin-guard.ts (demo church, team full,
   * not allowed) are already written for the person reading them, and are
   * marked with an FI_ code so a raw library message never leaks through here.
   */
  if (code?.startsWith("FI_")) {
    const message = (e as { body: { message?: unknown } }).body.message;
    if (typeof message === "string" && message) return message;
  }
  return GENERIC_INVITATION_ERROR;
}

/** Refusals no later invitation in the same batch can get past. */
export function isBatchStoppingInvitationError(e: unknown): boolean {
  const code = invitationErrorCode(e);
  return (
    code === "INVITATION_LIMIT_REACHED" ||
    code === "FI_TEAM_FULL" ||
    code === "FI_DEMO_CHURCH" ||
    code === "FI_NOT_ALLOWED"
  );
}
