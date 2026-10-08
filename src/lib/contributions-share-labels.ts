import type { ShareLabels } from "@/lib/contributions-shared";
import type { TFunction } from "@/lib/i18n/translate";

/**
 * The WhatsApp message's own words, from the dictionary.
 *
 * Its own module because two screens compose the same message — the church's
 * share tab and the public page, where anybody who opened the link can forward
 * it on. Two copies of this mapping would eventually send two differently
 * worded messages about the same collection, and the one that drifted would be
 * the one a stranger forwarded.
 *
 * The placeholders in braces are filled by `shareText`, so the dictionary
 * entries carry them verbatim: a translator moves `{raised}` and `{target}`
 * around the sentence rather than retyping the arithmetic.
 */
export function shareLabels(t: TFunction): ShareLabels {
  return {
    raisedOf: t("contributions.msgRaisedOf"),
    raised: t("contributions.msgRaised"),
    fromPeople: t("contributions.msgFromPeople"),
    fromOnePerson: t("contributions.msgFromOnePerson"),
    fromPeopleOf: t("contributions.msgFromPeopleOf"),
    whoHasGiven: t("contributions.msgWhoHasGiven"),
    stillToGive: t("contributions.msgStillToGive"),
    whereItWent: t("contributions.msgWhereItWent"),
    leftInPot: t("contributions.msgLeftInPot"),
    howToPay: t("contributions.msgHowToPay"),
    awaiting: t("contributions.msgAwaiting"),
    andMore: t("contributions.msgAndMore"),
    closed: t("contributions.msgClosed"),
    settled: t("contributions.msgSettled"),
    goalReached: t("contributions.msgGoalReached"),
    seeAndRecord: t("contributions.msgSeeAndRecord"),
    seeEverything: t("contributions.msgSeeEverything"),
    forPerson: t("contributions.msgForPerson"),
  };
}
