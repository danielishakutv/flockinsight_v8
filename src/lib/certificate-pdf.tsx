import "server-only";
import {
  Document,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { PDF_COLORS as C } from "@/lib/pdf-chrome";
import { PDF_FONT, registerPdfFonts } from "@/lib/pdf-font";
import { encodeQr, moduleAt } from "@/lib/qr/encode";
import { rankInfo, type CertRank } from "@/lib/certification-shared";

/**
 * The FlockInsight course certificate.
 *
 * Not church paperwork, so it does not use the church BrandBand: it carries
 * the FlockInsight product name only (and, per the authorship rule, no maker's
 * line). Set in Noto Sans like every PDF here; the text is ASCII plus the
 * middle dot, which pdf-font.test.ts checks this file for by name.
 */

// Idempotent. pdf-chrome registers too, but nothing else from it is needed
// beyond the colours, so this file says so itself rather than relying on it.
registerPdfFonts();

const RANK_COLOR: Record<CertRank, string> = {
  professional: "#0284c7",
  master: "#7c3aed",
  expert: "#d97706",
};

const VERIFY_BASE = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

export type CertificatePdfInput = {
  holderName: string;
  rank: CertRank;
  code: string;
  issuedAt: Date;
  activeWeeksAtIssue: number;
  modulesAtIssue: string[];
};

const s = StyleSheet.create({
  page: { fontFamily: PDF_FONT, color: C.slate700, backgroundColor: C.white, padding: 28 },
  frame: { flex: 1, borderWidth: 2, borderRadius: 6, paddingVertical: 34, paddingHorizontal: 48 },
  wordmark: { fontFamily: PDF_FONT, fontWeight: 700, fontSize: 16, color: C.slate900, letterSpacing: 0.5 },
  eyebrow: { fontFamily: PDF_FONT, fontSize: 10, color: C.slate500, letterSpacing: 2, marginTop: 26 },
  certifies: { fontFamily: PDF_FONT, fontSize: 12, color: C.slate600, marginTop: 18 },
  name: { fontFamily: PDF_FONT, fontWeight: 700, fontSize: 34, color: C.slate900, marginTop: 8 },
  isA: { fontFamily: PDF_FONT, fontSize: 12, color: C.slate600, marginTop: 10 },
  rank: { fontFamily: PDF_FONT, fontWeight: 700, fontSize: 24, marginTop: 4 },
  requirement: { fontFamily: PDF_FONT, fontSize: 11, color: C.slate600, marginTop: 14, maxWidth: 520, lineHeight: 1.5 },
  footer: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: "auto" },
  footerText: { fontFamily: PDF_FONT, fontSize: 9, color: C.slate500, maxWidth: 560, lineHeight: 1.5 },
});

/** "21 October 2026", in UTC so the server's own zone never moves the date. */
function longDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function requirementSentence(input: CertificatePdfInput): string {
  const base = `having completed all ${input.modulesAtIssue.length} modules of the FlockInsight course and passed the quiz for each`;
  if (input.rank === "professional") return `${base}.`;
  const span = input.rank === "expert" ? "more than a year" : "more than three months";
  return `${base}, and used FlockInsight in ${input.activeWeeksAtIssue} separate weeks across ${span}.`;
}

/**
 * The verification URL as ONE path of dark modules: hundreds of <Rect>s would
 * bloat the file for the same picture. A four-module quiet zone, per the
 * standard. Null when it cannot be encoded; the printed URL still works.
 */
function qrPath(text: string): { d: string; size: number } | null {
  const result = encodeQr(text);
  if (!result.ok) {
    console.error("[certificate-pdf] QR left off the certificate:", result.error);
    return null;
  }
  const { symbol } = result;
  const parts: string[] = [];
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      if (moduleAt(symbol, x, y)) parts.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    }
  }
  return { d: parts.join(""), size: symbol.size + 8 };
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const info = rankInfo(input.rank);
  const color = RANK_COLOR[input.rank];
  const verifyUrl = `${VERIFY_BASE}/cert/${input.code}`;
  const verifyShown = verifyUrl.replace(/^https?:\/\//, "");
  const qr = qrPath(verifyUrl);

  return renderToBuffer(
    <Document title={`${info.label} - ${input.holderName}`} author="FlockInsight">
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={[s.frame, { borderColor: color }]}>
          <Text style={s.wordmark}>FlockInsight</Text>
          <Text style={s.eyebrow}>CERTIFICATE OF ACHIEVEMENT</Text>
          <Text style={s.certifies}>This certifies that</Text>
          <Text style={s.name}>{input.holderName}</Text>
          <Text style={s.isA}>is a</Text>
          <Text style={[s.rank, { color }]}>{info.label}</Text>
          <Text style={s.requirement}>{requirementSentence(input)}</Text>

          <View style={s.footer}>
            <Text style={s.footerText}>
              {`Issued ${longDate(input.issuedAt)} · Certificate ${input.code} · Check it at ${verifyShown}`}
            </Text>
            {qr && (
              <Svg width={72} height={72} viewBox={`0 0 ${qr.size} ${qr.size}`}>
                <Path d={qr.d} fill={C.slate900} />
              </Svg>
            )}
          </View>
        </View>
      </Page>
    </Document>,
  );
}
