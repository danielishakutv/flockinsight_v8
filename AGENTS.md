<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# The roadmap lives in the app, not in this repo

What to build next is kept in the `roadmap_item` table and edited at
`/superadmin/roadmap`, so it can be added to from a phone. **Read it before
planning work** — it is the current queue, and this file's neighbours
(`FEATURE-ROADMAP.md`, `OVERNIGHT-REVIEW.md`) are frozen historical notes.

Fetch it as JSON:

    # everything: specs, priorities, and the platform size frozen onto each
    # shipped item. Needs ROADMAP_FEED_KEY (see .env.example).
    curl -H "Authorization: Bearer $ROADMAP_FEED_KEY" https://flockinsight.com/api/roadmap

    # without a key: only items ticked "public", and no metrics at all.
    curl https://flockinsight.com/api/roadmap

Locally the same routes work against `http://localhost:3000`.

Moving an item to **Shipped** freezes how many churches, users and members
existed that day (`churchesAtShip` / `usersAtShip` / `membersAtShip`). Those are
snapshots and are never recomputed — the point is to know how big the platform
was when a feature landed. `unshipRoadmapItem` is the only thing that clears
them; an ordinary move between columns deliberately keeps them, so a mis-click
cannot rewrite history with today's larger numbers.

# Two traps that have already cost real bugs

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
