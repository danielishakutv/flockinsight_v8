import "server-only";
import { formatMoney } from "@/lib/money";
import { rangeLabel, type BranchStat, type RangeKey } from "@/lib/branches-shared";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Totals = {
  branches: number;
  members: number;
  newMembers: number;
  services: number;
  attendanceTotal: number;
  giving: number;
};

/**
 * The roll-up email a headquarters gets. Deliberately a table of numbers with
 * the quiet branches called out — the useful part of this email is knowing
 * which branch didn't record anything, not the grand total.
 */
export function branchReportEmail(opts: {
  churchName: string;
  currency: string;
  range: RangeKey;
  rows: BranchStat[];
  totals: Totals;
}): { subject: string; html: string; text: string } {
  const { churchName, currency, range, rows, totals } = opts;
  const period = rangeLabel(range).toLowerCase();
  const avg = totals.services
    ? Math.round(totals.attendanceTotal / totals.services)
    : 0;
  const quiet = rows.filter((r) => r.services === 0);

  const branchWord = totals.branches === 1 ? "branch" : "branches";
  const subject = `${churchName}: ${totals.branches} ${branchWord}, ${avg.toLocaleString()} average attendance`;

  const row = (r: BranchStat) => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #eee">
        <b>${escapeHtml(r.name)}</b>
        ${r.zone ? `<div style="color:#8a86a0;font-size:12px">${escapeHtml(r.zone)}</div>` : ""}
      </td>
      <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right">${r.members.toLocaleString()}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right">${r.attendanceAvg ? r.attendanceAvg.toLocaleString() : "—"}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right">${r.giving ? escapeHtml(formatMoney(r.giving, r.currency)) : "—"}</td>
    </tr>`;

  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1a1626">
    <div style="font-size:20px;font-weight:800;margin-bottom:4px">Flock<span style="color:#5b3df5">Insight</span></div>
    <h1 style="font-size:18px;margin:12px 0 4px">${escapeHtml(churchName)} — branch report</h1>
    <p style="color:#8a86a0;font-size:13px;margin:0 0 20px">${escapeHtml(period)}</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr>
        ${[
          ["Branches", String(totals.branches)],
          ["Members", totals.members.toLocaleString()],
          ["Avg attendance", avg.toLocaleString()],
          ["Giving", formatMoney(totals.giving, currency)],
        ]
          .map(
            ([label, value]) => `
        <td style="padding:10px;background:#f7f6fb;border-radius:10px;vertical-align:top">
          <div style="color:#8a86a0;font-size:11px;text-transform:uppercase;font-weight:700">${label}</div>
          <div style="font-size:18px;font-weight:800">${escapeHtml(value)}</div>
        </td>`,
          )
          .join('<td style="width:8px"></td>')}
      </tr>
    </table>

    ${
      quiet.length > 0
        ? `<div style="background:#fff6e8;border:1px solid #f6dcb4;border-radius:10px;padding:12px;margin-bottom:20px">
             <b style="font-size:14px">${quiet.length} branch${quiet.length === 1 ? "" : "es"} recorded nothing ${escapeHtml(period)}</b>
             <div style="color:#6b6580;font-size:13px;margin-top:4px">${quiet
               .slice(0, 8)
               .map((q) => escapeHtml(q.name))
               .join(", ")}${quiet.length > 8 ? `, and ${quiet.length - 8} more` : ""}</div>
           </div>`
        : ""
    }

    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="text-align:left;color:#8a86a0;font-size:11px;text-transform:uppercase">
          <th style="padding:6px">Branch</th>
          <th style="padding:6px;text-align:right">Members</th>
          <th style="padding:6px;text-align:right">Avg att.</th>
          <th style="padding:6px;text-align:right">Giving</th>
        </tr>
      </thead>
      <tbody>${rows.map(row).join("")}</tbody>
    </table>

    <a href="${BASE_URL}/branches" style="display:inline-block;margin-top:22px;background:#5b3df5;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Open the full dashboard</a>
    <p style="font-size:12px;color:#8a86a0;margin-top:22px">
      You're getting this because automatic branch reports are on for
      ${escapeHtml(churchName)}. Turn them off under Branches → Automatic reports.
    </p>
  </div>`;

  const text = [
    `${churchName} — branch report (${period})`,
    `${totals.branches} branches · ${totals.members} members · ${avg} average attendance · ${formatMoney(totals.giving, currency)} giving`,
    "",
    ...rows.map(
      (r) =>
        `${r.name}: ${r.members} members, ${r.attendanceAvg || 0} avg attendance, ${formatMoney(r.giving, r.currency)}`,
    ),
    "",
    `${BASE_URL}/branches`,
  ].join("\n");

  return { subject, html, text };
}
