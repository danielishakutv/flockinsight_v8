import "server-only";
import { View, Text, Image, Svg, Path, StyleSheet } from "@react-pdf/renderer";
import type { ChurchBrand } from "@/lib/pdf-brand";

/**
 * The header and footer every FlockInsight PDF wears.
 *
 * Defined once so a church's documents look like a set, and so the branding
 * rule lives in one place: the church's logo, name and colours lead; our name
 * appears once, small, at the bottom. These get printed and handed to trustees
 * — they are the church's paperwork, not ours.
 */

export const PDF_COLORS = {
  white: "#ffffff",
  whiteSoft: "rgba(255,255,255,0.72)",
  whiteBox: "rgba(255,255,255,0.15)",
  slate900: "#0f172a",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748b",
  slate400: "#94a3b8",
  slate300: "#cbd5e1",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f8fafc",
};

/** Fallback mark, for a church that has not uploaded a logo. */
const CHURCH_PATHS = [
  "M10 9h4",
  "M12 7v5",
  "M14 21v-3a2 2 0 0 0-4 0v3",
  "m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9",
  "M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14",
];

const s = StyleSheet.create({
  band: {
    paddingVertical: 18,
    paddingHorizontal: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bandLeft: { flexDirection: "row", alignItems: "center", maxWidth: "68%" },
  logoBox: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: PDF_COLORS.whiteBox,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    overflow: "hidden",
  },
  logoImage: { width: 38, height: 38, objectFit: "contain" },
  churchName: {
    fontSize: 17,
    fontFamily: "Helvetica-Bold",
    color: PDF_COLORS.white,
  },
  eyebrow: {
    fontSize: 7,
    letterSpacing: 2,
    color: PDF_COLORS.whiteSoft,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },
  bandRight: { alignItems: "flex-end", maxWidth: "30%" },
  bandRightMain: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: PDF_COLORS.white,
    textAlign: "right",
  },
  bandRightSub: {
    fontSize: 8,
    color: PDF_COLORS.whiteSoft,
    marginTop: 2,
    textAlign: "right",
  },

  footer: {
    position: "absolute",
    bottom: 18,
    left: 28,
    right: 28,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  contact: {
    fontSize: 7,
    color: PDF_COLORS.slate500,
    maxWidth: "75%",
  },
  page: { fontSize: 7, color: PDF_COLORS.slate500 },
  // Our name: one line, smallest type, muted. Present, not prominent.
  attribution: { fontSize: 6, color: PDF_COLORS.slate400, marginTop: 3 },
});

/**
 * The coloured header band, in the church's own theme.
 *
 * The band colour is applied inline because StyleSheet.create is static and
 * every church has a different one.
 */
export function BrandBand({
  brand,
  label,
  right,
  rightSub,
}: {
  brand: ChurchBrand;
  /** What this document is — "Finance", "Giving statement". */
  label: string;
  right?: string;
  rightSub?: string;
}) {
  return (
    <View style={[s.band, { backgroundColor: brand.primary }]}>
      <View style={s.bandLeft}>
        <View style={s.logoBox}>
          {brand.logo ? (
            // react-pdf's Image draws into a PDF; it has no alt attribute and
            // the a11y rule is meant for HTML img.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image style={s.logoImage} src={brand.logo} />
          ) : (
            <Svg width={21} height={21} viewBox="0 0 24 24">
              {CHURCH_PATHS.map((d, i) => (
                <Path
                  key={i}
                  d={d}
                  stroke={PDF_COLORS.white}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
          )}
        </View>
        <View>
          <Text style={s.churchName}>{brand.name}</Text>
          <Text style={s.eyebrow}>{label.toUpperCase()}</Text>
        </View>
      </View>
      {(right || rightSub) && (
        <View style={s.bandRight}>
          {right && <Text style={s.bandRightMain}>{right}</Text>}
          {rightSub && <Text style={s.bandRightSub}>{rightSub}</Text>}
        </View>
      )}
    </View>
  );
}

/**
 * The footer: the church's contact details and the page number, with our name
 * on one small line beneath. Fixed, so it repeats on every page.
 */
export function BrandFooter({
  brand,
  generated,
}: {
  brand: ChurchBrand;
  generated: string;
}) {
  return (
    <View style={s.footer} fixed>
      <View style={s.footerRow}>
        <Text style={s.contact}>{brand.contact ?? brand.name}</Text>
        <Text
          style={s.page}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
        />
      </View>
      <Text style={s.attribution}>
        {generated} · Prepared with FlockInsight
      </Text>
    </View>
  );
}
