import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { canManageContribution, getContribution } from "@/lib/contributions";
import { METHOD_LABEL, PAYOUT_KIND_LABEL } from "@/lib/contributions-shared";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { audit } from "@/lib/audit";

/**
 * GET /contributions/<id>/export — the whole collection as one CSV.
 *
 * Money in, money out and the roster in one file rather than three downloads,
 * with a `Section` column separating them. A treasurer taking this to a
 * committee meeting needs the three figures to reconcile on one sheet; three
 * files is three chances for the version in the meeting to be the wrong one.
 *
 * Who confirmed each payment is a column, because that is the question the
 * meeting actually asks about a disputed figure.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { church, user } = await requireChurch();

  const access = await getAccess();
  const hasModulePermission =
    access.isOwner || access.perms.has("contributions.manage");
  const canManage = await canManageContribution({
    churchId: church.id,
    userId: user.id,
    potId: id,
    hasModulePermission,
  });
  const canRead =
    access.isOwner || access.perms.has("contributions.view") || canManage;
  if (!canRead) return new Response("Not found", { status: 404 });

  const pot = await getContribution(church.id, id);
  if (!pot) return new Response("Not found", { status: 404 });

  const rows: (string | number | null)[][] = [];

  rows.push(["Collection", pot.title]);
  if (pot.groupName) rows.push(["Group", pot.groupName]);
  if (pot.honoureeName) rows.push(["For", pot.honoureeName]);
  rows.push(["Status", pot.status]);
  rows.push(["Currency", church.currency]);
  rows.push(["Collected (confirmed)", pot.raised]);
  rows.push(["Awaiting confirmation", pot.pendingIn]);
  rows.push(["Disputed", pot.disputedIn]);
  rows.push(["Paid out (approved)", pot.paidOut]);
  rows.push(["Awaiting approval to pay out", pot.pendingOut]);
  rows.push(["Still held", pot.balance]);
  if (pot.target !== null) rows.push(["Goal", pot.target]);
  rows.push([]);

  rows.push([
    "Section",
    "Who",
    "Amount",
    "Date",
    "Method",
    "Reference",
    "Standing",
    "Recorded by",
    "Source",
    "Confirmed by",
    "Disputed by",
    "Receipt",
    "Note",
  ]);
  for (const e of pot.entries) {
    rows.push([
      "Payment in",
      e.contributorName,
      e.amount,
      e.paidOn,
      e.method ? METHOD_LABEL[e.method] : "",
      e.reference ?? "",
      e.status,
      e.recordedByName ?? "",
      e.source === "self" ? "Reported by the giver" : "Recorded by the team",
      e.approvals
        .filter((a) => a.decision === "confirm")
        .map((a) => a.actorName)
        .join("; "),
      e.approvals
        .filter((a) => a.decision === "dispute")
        .map((a) => a.actorName)
        .join("; "),
      e.proofUrl
        ? "attached"
        : e.proofReleasedAt
          ? `released ${e.proofReleasedAt.slice(0, 10)}`
          : "",
      e.note ?? e.resolutionNote ?? "",
    ]);
  }

  rows.push([]);
  rows.push([
    "Section",
    "What",
    "Amount",
    "Date",
    "Method",
    "Reference",
    "Standing",
    "Payee",
    "In Finance",
    "Approved by",
    "Objections",
    "Receipt",
    "Note",
  ]);
  for (const p of pot.payouts) {
    rows.push([
      "Payment out",
      p.purpose ?? PAYOUT_KIND_LABEL[p.kind],
      p.amount,
      p.paidOn,
      p.method ? METHOD_LABEL[p.method] : "",
      p.reference ?? "",
      p.status,
      p.payee ?? "",
      p.financeTransactionId ? "yes" : "no",
      p.approvals
        .filter((a) => a.decision === "confirm")
        .map((a) => a.actorName)
        .join("; "),
      p.approvals
        .filter((a) => a.decision === "dispute")
        .map((a) => a.actorName)
        .join("; "),
      p.proofUrl
        ? "attached"
        : p.proofReleasedAt
          ? `released ${p.proofReleasedAt.slice(0, 10)}`
          : "",
      p.resolutionNote ?? "",
    ]);
  }

  rows.push([]);
  rows.push([
    "Section",
    "Name",
    "On the register",
    "Phone",
    "Email",
    "Expected",
    "Paid",
    "Awaiting",
    "Outstanding",
    "Payments",
  ]);
  for (const c of pot.contributors) {
    rows.push([
      "Person",
      c.name,
      c.memberId ? (c.memberName ?? "yes") : "no",
      c.phone ?? "",
      c.email ?? "",
      c.expected ?? "",
      c.paid,
      c.pending,
      c.outstanding,
      c.entryCount,
    ]);
  }

  await audit({
    churchId: church.id,
    action: "contributions.contribution.export",
    summary: `Downloaded the full record of "${pot.title}" as CSV`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    severity: "warning",
  });

  const slug = pot.slug.replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
  return new Response(CSV_BOM + toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contribution-${slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
