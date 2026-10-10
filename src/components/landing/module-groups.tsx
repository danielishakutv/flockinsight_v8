import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Database,
  FileText,
  FolderOpen,
  Globe,
  GraduationCap,
  HandCoins,
  HeartHandshake,
  Mail,
  MessageSquare,
  Network,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { MODULE_GROUPS } from "@/lib/landing-sections";
import type { LandingFeature } from "@/lib/landing-content";

/** Feature icon keys → components. Keeps the copy files free of JSX. */
const FEATURE_ICONS: Record<string, LucideIcon> = {
  attendance: ClipboardCheck,
  members: Users,
  groups: UsersRound,
  training: GraduationCap,
  giving: HandCoins,
  finance: Wallet,
  followup: HeartHandshake,
  comms: MessageSquare,
  reminders: Bell,
  forms: FileText,
  events: CalendarDays,
  media: FolderOpen,
  devotionals: Mail,
  public: Globe,
  analytics: BarChart3,
  reports: Database,
  branches: Network,
  roles: ShieldCheck,
};

/**
 * The eighteen modules, in five labelled sets.
 *
 * ## Why this is not a filter
 *
 * The obvious design is a row of chips that filters the grid. It was built that
 * way first and then deliberately changed, for three reasons:
 *
 * 1. **A filter hides content from crawlers and assistants.** Whatever is not
 *    in the chosen set is either absent from the DOM or `display: none`, and
 *    hidden content is weighted down or ignored. The module list is the single
 *    strongest evidence for the claim the whole page rests on — that this is an
 *    operations platform rather than a member database — so hiding four fifths
 *    of it to look tidy is a bad trade.
 * 2. **A CSS-only filter has a failure mode nobody sees.** It depends on
 *    `:checked` sibling selectors matching ids; rename a group and one chip
 *    silently shows an empty grid, which reads as a broken page. A test can
 *    catch the data mismatch — it does, in `landing-sections.test.ts` — but not
 *    a selector typo.
 * 3. **The group labels are the words buyers use.** "People", "Money",
 *    "Operations" are how a pastor describes the problem they arrived with.
 *    Printed as real `<h3>` headings they are scannable, linkable and
 *    crawlable; as chip labels they are none of those.
 *
 * So the groups are stacked, each with its heading, and the chips above became
 * anchor links that jump to them. Zero JavaScript, nothing hidden, and the jump
 * links double as an outline a screen reader can navigate.
 */
export function ModuleGroups({
  features,
  allLabel,
}: {
  /** The localised FEATURES array, so the cards translate with the page. */
  features: LandingFeature[];
  allLabel: string;
}) {
  const byIcon = new Map(features.map((f) => [f.icon, f]));

  return (
    <div>
      {/* The outline: jump links, not filters. */}
      <nav
        aria-label={allLabel}
        className="mx-auto mb-12 flex max-w-3xl flex-wrap justify-center gap-2"
      >
        {MODULE_GROUPS.map((g) => {
          const count = g.featureIcons.length;
          return (
            <a
              key={g.id}
              href={`#modules-${g.id}`}
              className="bg-background hover:border-primary hover:text-primary focus-visible:ring-ring inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {g.label}
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs font-bold">
                {count}
              </span>
            </a>
          );
        })}
      </nav>

      <div className="space-y-14">
        {MODULE_GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={`modules-${g.id}`}>
            <div className="mb-5 flex items-center gap-4">
              <h3
                id={`modules-${g.id}`}
                className="scroll-mt-24 text-xl font-extrabold tracking-tight"
              >
                {g.label}
              </h3>
              <div aria-hidden className="bg-border h-px flex-1" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {g.featureIcons.map((icon) => {
                const f = byIcon.get(icon);
                /*
                 * A group naming an icon that FEATURES does not have renders
                 * nothing rather than a broken card. The test asserts this
                 * cannot happen; this line is what keeps a data slip from
                 * taking the page down if it ever does.
                 */
                if (!f) return null;
                const Icon = FEATURE_ICONS[icon] ?? BookOpen;
                return (
                  <article
                    key={f.title}
                    className="bg-card group hover:border-primary/40 relative rounded-2xl border p-5 transition-all hover:shadow-lg hover:shadow-primary/5"
                  >
                    <div className="bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground grid size-11 place-items-center rounded-xl transition-colors">
                      <Icon className="size-5" />
                    </div>
                    <h4 className="mt-4 font-bold">{f.title}</h4>
                    {/*
                      `break-words` is load-bearing, not tidiness. One feature
                      body contains "flockinsight.com/c/your-church", which has
                      no break opportunity in it — at 320px it pushed its own
                      card wider than the screen. The old flat feature grid had
                      this class; regrouping the cards lost it.
                    */}
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed break-words text-pretty">
                      {f.body}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
