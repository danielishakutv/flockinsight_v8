<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# The roadmap lives in the app, not in this repo

What to build next is kept in the `roadmap_item` table and read at
`/superadmin/roadmap`, so it can be added to from a phone. **Read it before
planning work** — it is the current queue. Everything under `docs/archive/`
is a frozen historical note, superseded by it.

It is a **task list with two statuses**: `todo` and `shipped`. It used to be a
five-column kanban board (idea / planned / in_progress / shipped / parked);
migration 0094 collapsed those and kept each row's original value in
`legacy_status`. The four retired names are still *read* as `todo` by
`readStatus()`, so an old script or an old link does not break.

Read it:

    # everything: specs, priorities, and the platform size frozen onto each
    # shipped item. Needs ROADMAP_FEED_KEY (see .env.example).
    curl -H "Authorization: Bearer $ROADMAP_FEED_KEY" https://flockinsight.com/api/roadmap

    # without a key: only items ticked "public", and no metrics at all.
    curl https://flockinsight.com/api/roadmap

**A key that is offered and refused gets a 401**, not an empty public feed. If
you get `{"scope":"public","counts":{"total":0}}` with no key, that really is
an empty public list; with a key you would have been told.

Write it — this is how you tick something off after shipping it, without
anybody opening the page:

    # add
    curl -X POST https://flockinsight.com/api/roadmap \
      -H "Authorization: Bearer $ROADMAP_FEED_KEY" \
      -H "content-type: application/json" \
      -d '{"title":"...","detail":"the spec","priority":"high","area":"Training"}'

    # tick it off (the id comes from GET)
    curl -X PATCH https://flockinsight.com/api/roadmap \
      -H "Authorization: Bearer $ROADMAP_FEED_KEY" \
      -H "content-type: application/json" \
      -d '{"id":"<id>","status":"shipped","version":"0.69.0"}'

Writes take the key **in a header only** — `x-roadmap-key` or
`Authorization: Bearer`. `?key=` reads but cannot write, because a key in a URL
ends up in access logs and browser history. A signed-in superadmin session does
not write here either: a cookie rides along on a cross-site request, and a POST
with `content-type: text/plain` is a simple request that never clears a
preflight, so a session-authorised write was a CSRF hole. Superadmins write
through the page, whose server actions Next.js origin-checks. Writes also
require `content-type: application/json` (415 otherwise), which is the second
lock on the same door.

There is deliberately **no DELETE**: everything else can be undone from the
page, so deleting stays behind a confirmation dialog where a human can see
what they are about to lose. Every write is recorded in the audit trail as
"Roadmap feed key", because there is no person behind it.

Locally the same routes work against your dev server.

Moving an item to **shipped** freezes how many churches, users and members
existed that day (`churchesAtShip` / `usersAtShip` / `membersAtShip`). Those are
snapshots and are never recomputed — the point is to know how big the platform
was when a feature landed. `unshipRoadmapItem` is the only thing that clears
them (the Un-ship button, and `PATCH ... "status":"todo"` on something that was
shipped); toggling status any other way deliberately keeps them, so a mis-tap
cannot rewrite history with today's larger numbers.

# Three traps that have already cost real bugs

**A raw `sql` template drops the table qualifier when the query has no join.**
So a correlated subquery like

    sql`(select count(*) from ${cohort} where ${cohort.courseId} = ${course.id})`

renders as `where "course_id" = "id"`, Postgres binds *both* names to the inner
table, and the count is silently 0 — no error, just zeroes on the page forever.
Add a join and drizzle qualifies properly, which is why this breaks in some
queries and not others. Use a grouped aggregate joined in JS instead.
`src/lib/sql-safety.test.ts` fails the build on the shape.

**`backdrop-filter` makes an element the containing block for `position:
fixed` descendants.** A `fixed inset-0` drawer rendered inside the
`backdrop-blur` admin header resolved against the 56px header instead of the
viewport, so the menu opened as an empty sliver. Render overlays through a
portal to `document.body` (see `components/superadmin/superadmin-nav.tsx`).

**A PDF's built-in fonts cannot draw ₦.** Helvetica and the other thirteen
standard fonts are WinAnsi-encoded — 256 characters, no Naira sign — so every
money figure in every PDF the platform made read `¦3,659,040.00` for months.
Nothing threw and nothing was logged; the glyph simply was not there. The PDFs
now embed Noto Sans (`src/lib/pdf-font.ts`, registered once from
`lib/pdf-chrome`), which also has no arrows: `→` draws an empty box the same
silent way. `src/lib/pdf-font.test.ts` reads the .ttf files and fails on both.
