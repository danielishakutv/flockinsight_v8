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

# First-timers have their own door, and it is not the membership form

A church said: "Can we have registration of first-time worshippers on its own,
not under membership, because it's really making my people confused and they
are messing up the thing."

The mess was mechanical. `MemberFormFields` defaults `status` to **active**, so
registering a visitor through Members → Add and missing that one dropdown files
them as a full member — and then Follow-up never sees them (it reads
`status in ('visitor','new_convert') or in_follow_up`), the first-timer welcome
and invite crons never fire (same filter), and the membership count is
overstated. Nothing errors.

So `/first-timers` is the way in, and `registerFirstTimer()` in
`lib/first-timer-intake.ts` is the only function that writes one. **It takes no
status argument.** Everything through it is `status: 'visitor'`,
`inFollowUp: true`, `followUpStatus: 'new'`, and lands in the same `member`
table — Members, attendance, the exports and the reports are unchanged.

Three entry points, one function behind all of them:

- the **First-timers page**, and the same button inside **Follow-up**
- the public **`/welcome/<slug>`** link and QR, off by default, rate-limited,
  honeypotted, never indexed, and unable to set a status or name an inviter by
  id

A phone or email that is already on the register never makes a second row.
Their status is never changed — an active member who fills in a welcome card
has not stopped being a member — and **whether their blanks get filled depends
on who is asking**:

- a signed-in member of staff may fill a blank, and never overwrite a value;
- the public link may not, and does exactly one thing to a match: flags them
  for follow-up. `allowPatchExisting: false`. Matching is on phone number and
  email and neither is a secret, so without that flag anybody who knew a
  member's number could write their own email and address into that member's
  record. The reply is identical either way, so the form is not an oracle for
  "is this number a member here?".

**`invited_by_id` and `guardian_id` both reference `member.id` globally**, so
every write checks the target belongs to the same church and every read joins
with `eq(x.churchId, member.churchId)`. Without both, one church's member name
prints on another church's page and in its CSV export.

The Members form still defaults to active, deliberately: a church adding real
members there is right to get it. It now carries a line pointing at
`/first-timers` instead.

# Four traps that have already cost real bugs

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

**`db.transaction` is not isolation.** Postgres runs READ COMMITTED, so
wrapping "find what is free, then claim it" in one transaction does **not** stop
two requests claiming the same row: each selects the same rows, neither sees the
other's uncommitted write, and the second UPDATE waits for the first to commit
and then overwrites it. Silently. `requestPayout` shipped this way and its own
docstring said it was impossible — two taps would have made two withdrawal
requests for one balance. Any claim path (payouts, a credit, a seat, a slot)
needs all three: `.for("update")` on the select, the same predicate repeated in
the UPDATE with a `.returning()` count checked against what you meant to claim,
and a database constraint for the rule itself. Prove it with two deliberately
interleaved transactions over a SINGLE contested row — `Promise.all` that
happens to serialise passes whether the bug is there or not. See
`src/lib/partners.db-check.ts` (`pnpm test:db`).

**A WebRTC connection in a mesh must never be renegotiated mid-call.** Both
ends of a pair reach the same verdict about the same network at the same
moment, so two peers deciding to re-offer is the normal case rather than an
unlucky one. Perfect negotiation resolves a collision by rolling an offer back,
and a rollback leaves transceivers behind — after a few, the two sides no
longer agree on the order of their m-lines and every description either one
builds is refused by the other:

    The order of m-lines in answer doesn't match order in offer

That pair's audio is then finished for the rest of the call. Nothing throws
where a person can see it: the roster is right, the tiles stay lit, ICE says
connected, the video is perfect, and somebody talks to a room that cannot hear
them. It presents as "only one person could be heard".

So `meeting-client.ts` offers exactly twice per connection — once from each
side, to give each side's three transceivers an m-line, which an answer can
never do — and never again. A change that needs new SDP (turning RED on) is
applied by throwing the connection away and dialling it again, which is also
how a wedged connection recovers: one mechanism, in `rebuildPeer`. Resets
carry a grace window, because both ends usually notice at once and the second
request lands on the connection that replaced the one it was about.

`scripts/test-meeting-call.mjs` is how this was found and is the only thing
that can see it: three real browsers, one real meeting, and a grid of who could
hear whom. A unit test cannot — the thing under test is the browser's own SDP
machinery. Run it against `next build` + `next start`, never `next dev`.

**The transport is the SFU, not the mesh.** Every production meeting has
`transport: 'sfu'`: `max_participants` is 12 by default, `MESH_CEILING` is 6,
and the Cloudflare Realtime credentials are set — so `chooseTransport` has
never returned `mesh` for a real room. Hours were spent fixing the mesh path
for a bug reported in an SFU room, because the mesh is what `meeting-client.ts`
reads like. **Check `meeting.transport` in the database before believing any
theory about a real meeting.**

The SFU half lives in `src/lib/meeting-sfu.ts`: one sendonly publisher
connection, one recvonly subscriber connection, and `publish`/`pull`/`close`
over an HTTP proxy at `api/meet/[code]/sfu`. Two things about it are easy to get
wrong and both have cost a meeting.

Everything a peer sends arrives on the ONE subscriber connection, so **anything
not handed back accumulates for the whole call**. Forgetting a departed peer
locally is not enough — their mid has to be closed on the media server, or the
transceiver, its decoder and its jitter buffer stay for the rest of the
meeting. The cost then grows with CHURN, not with the size of the room: a
two-person test never shows it, and a room joined forty-eight times freezes
phones. `src/lib/meeting-sfu-churn.test.ts` holds the arithmetic.

And **a session id is public** — every publisher's id is in every roster,
because that is how anybody pulls anybody. So naming one proves nothing. The
route hands back an HMAC proof when it mints a session and requires it on every
later action; without that, any guest could close any participant's tracks for
the whole room.
