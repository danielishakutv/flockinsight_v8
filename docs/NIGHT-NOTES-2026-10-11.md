# Overnight notes — 11 October 2026

Written for: you, first thing. Everything below is either **live on
flockinsight.com** or **explicitly not built**, and I have tried to make which
is which impossible to mistake.

---

## Deployed to production tonight

Two releases went out, both verified live and both with the database migration
applied (`deploy.sh` runs `pnpm db:migrate`, so nothing is pending).

| Release | What | Live |
|---|---|---|
| **0.73.2** | The meeting faults you reported | ✅ `e82f356` |
| **0.74.0** | Branch groups + the Branches UI bug | ✅ `4782051` |

Full, plain-English detail for both is in the in-app changelog
(`/changelog`) — written for your churches, not for me.

---

## 1. The meetings faults — and an important correction

**I was fixing the wrong half of the module yesterday.** This is the thing most
worth your knowing.

Every meeting in your database has `transport: 'sfu'`. `max_participants` is 12,
`MESH_CEILING` is 6, and your Cloudflare Realtime credentials are set — so
`chooseTransport` has never once returned `mesh` for a real room. Both functions
I rewrote yesterday begin with a mesh-only guard. The mesh bug I measured was
real and the fix stands, but **it was never what your churches were hitting.**
That is now the first thing written in the SFU section of `AGENTS.md`.

What was actually wrong, in your SFU rooms:

**The freezes (2 laptops + an iPhone).** Every voice in an SFU room arrives on
one subscriber connection, and each pull adds a transceiver to it. The cleanup
reclaimed cameras and *skipped anybody who had left the room*, and never looked
at microphones at all. So a person who left took nothing with them — their
transceiver, its decoder and its jitter buffer stayed for the whole meeting,
pointed at a Cloudflare session that had gone, and every later pull renegotiated
a description carrying all of them.

The cost grows with **churn**, not room size. That is why no test ever showed it
and why the bad meeting was the one with 11 people and **48 joins**: a browser
holding ~50 dead audio decoders renegotiating a 50-section SDP is a browser that
stops responding. `src/lib/meeting-sfu-churn.test.ts` proves it — 12
arrive-and-leave cycles in a room never bigger than 2 left **12** transceivers
attached. It now fails the build if that ever comes back.

**The audio drops on a good line.** The link verdict flips to "fair" at just 2%
concealed speech, with no hysteresis, and takes the *worst* of everybody
arriving — so in a room of ten, one rough four-second window flips it. The
verdict carries the jitter buffer, and re-timing a live receiver is itself
audible. A link flickering good/fair was a link clicking every few seconds. An
improvement now needs a second opinion; getting worse still acts immediately.

**Your mic after starting the recording.** The recorder was handed the *live*
mic track — the same one the room hears — and fed it into a WebAudio graph. It
now clones what it is given and stops only its own clones.

I want to be straight with you: **I am not certain that alone was the cause.**
Two of my reviewers argued it would not silence the Cloudflare publisher. So the
honest half of the fix is the second half — the People panel now *measures* what
your own microphone is actually sending (it was a hardcoded zero on this
transport, whether working or not), and says plainly when your device is making
sound and none of it is leaving. If it happens again you will be told, and so
will I.

**Your recordings.** Both of today's rows were 0 bytes, and there were three
stacked causes. Nothing stopped a second recording starting, and because the REC
pill only appeared *after* a server round trip you pressed Record again — which
orphaned the first recorder alive. And the uploader was mounted only in the
signed-in app shell, while meetings live at `/meet/<code>` — so a recording made
from a meeting link was vaulted and then uploaded by **nothing at all**. That is
your 11 historical "failed" rows. It uploads from the meeting now.

> ⚠️ **One case still needs you.** `/api/media/chunk` needs a signed-in church
> session. If you host from the host *link* without signing in on that device,
> the recording cannot upload. It now says so on screen with a Sign in link
> instead of retrying silently for ever. The proper fix — a peer-authenticated
> upload route — is on the roadmap, not built.

**Four regressions from yesterday**, found by auditing my own work adversarially:
my `mid === null` guard had turned ICE recovery into a no-op on one side of every
pair; the listen loop could be blocked by a single stuck negotiation; duplicated
signals could destroy a healthy connection; and the voice shared its rebuild
budget with recovery. All fixed, all tested.

**Security (please read).** The SFU proxy verified that a *pull* named a session
in this meeting, and verified **nothing** for `close`, `renegotiate` or
`publish` — while every publisher's session id is broadcast in every roster.
Any guest in a meeting could have taken any participant's microphone, camera and
screen away from the whole room, silently; or pointed the room at someone else's
media. The route now issues an HMAC proof when it mints a session and requires
it afterwards, and nobody in the lobby can reach the media server at all.

**New instrument.** A meeting now writes down any moment the device stops
responding — with heap and player count — and shows it in the People panel after
the reload that always follows a freeze. Next time one happens, there is a
witness.

Also: the join/leave chimes I added last night no longer use WebAudio. On iOS,
starting an AudioContext mid-call can move the whole page's audio session, which
is a poor way to announce that somebody joined.

**Not tested:** recording end-to-end in a real browser. You asked me not to run
Chrome sessions, so the recorder changes are covered by unit tests and review
only. Worth one deliberate test before Sunday.

---

## 2. Branch groups — national / zonal / your own words

Built as you described, and deliberately **not** a fixed National→Zonal→District
ladder, because every network draws those lines differently and the ones that
don't fit a ladder are exactly the ones a ladder turns away.

- A new `branch_group` table, self-referencing, owned by the HQ. You build
  "Nigeria → North Central → Jos District" with **your own word** for each level
  (National, Zonal, Provincial, District, Area, Circuit, or type your own).
- Branches are filed into a group; select several and move them at once.
- **Every filter, roll-up, scheduled report and CSV reads for any group and
  includes everything underneath it.** That was the main engineering point:
  filing happens at the bottom of a tree and reports are read from the top, so a
  national filter that only matched churches pinned to the national row would
  return nothing.
- A "Not in any group" filter — the list you want when you sit down to organise.
- The group path is a CSV column, so you can pivot at any level in Excel.
- Deleting a group says what it will do first. Groups inside it go too; **no
  church is ever deleted** — its branches just become unfiled.
- Moving a group inside its own child is refused *with the reason*, because a
  loop there is a page that never finishes rendering.

**A near miss worth recording.** My first version called the table
`church_group` — which is already your table for small groups and ministries
inside a church. Drizzle read it as a *change* to that table and generated a
migration with no `CREATE TABLE` and a foreign key to a table it hadn't made.
Applying it would have left the snapshot describing your ministries table as
something it is not, and a later migration could have rewritten it. I threw the
generated files away and renamed the table. **Check for a name collision before
adding a table.**

### The UI bug — it was two

1. The branch table froze the branch name so a row of numbers two screens right
   still had a church attached — **but only for people who could not manage the
   network.** The comment said the first column was a select-all checkbox.
   There was no checkbox; the header cell was empty. So the only people losing
   the name were the ones most likely to be scrolling it. There is a real
   select-all now (with the indeterminate state), it rides inside the frozen
   cell, and the name is frozen for everyone.
2. The giving total **added different currencies together** and printed one
   symbol — a figure true in neither. Per-branch rows were always right; the
   total now says "across 2 currencies", and the CSV leaves that cell blank with
   the reason rather than exporting a number nobody should paste into a report.

---

## 3. Not built tonight — and why

You listed seven substantial modules. I built two to a standard I'd defend and
deployed both. I am not going to hand you five half-built features and call it
done, so here is exactly where each stands.

| Ask | Status |
|---|---|
| Affiliate programme | **Not built.** Design + my recommendations below. |
| Pastor booking module | **Not built.** |
| Guide → course, quizzes, certification ranks | **Not built.** |
| AI analytics (no identifiable data) | **Not built** — see the warning below. |
| AI chatbot + self-learning from transcripts | **Not built.** |
| Automated AI blogging | **Not built.** |

On the AI work specifically, you said *"let's implement the AI features
carefully ensuring that nothing breaks"* — and I agree, which is why I would not
start it at 2am on the same night as a live meetings fix. It needs decisions I
should not make for you: which provider and model, what the monthly ceiling is,
and above all **exactly what counts as identifiable** before a single request
leaves your server. Done wrong that is a data-protection incident, not a bug. I
have written a concrete plan for it rather than a rushed implementation.

### Affiliate programme — what I'd recommend

**A name.** My pick: **FlockInsight Partners** (a Partner, the Partner
Dashboard). It survives growth — it works for a field agent today and a
denominational rep later — and it sounds like someone a pastor can trust at the
door, which "affiliate" and "reseller" do not. Alternatives: *Ambassadors*
(warmer, slightly junior), *Champions* (energetic, harder to put on an invoice).

**Does the model work?** 40% of the first two payments is roughly 0.8 months of
revenue per church. That is generous and it is the right shape for *acquisition*
— but it pays for a signature, not for a church that stays. The risk is a
Partner who signs ten churches that all churn in month three: you paid for ten
and kept none.

Three changes I would make before launch:

1. **Hold the second payment until the church's second invoice actually
   clears.** Not a clawback — just pay commission 2 when payment 2 lands. It
   costs the Partner nothing if the church stays, and it removes the entire
   incentive to sign churches that cannot pay.
2. **Add a small recurring trail** — 5% for 12 months — alongside the 40%. This
   is the single biggest retention lever you have for Partners, because it turns
   a one-off hunt into an income that grows while they sleep, and it quietly
   makes them want their churches to *succeed* rather than just sign.
3. **Make the tier a rolling 90-day thing, not a calendar month.** "50 churches
   in a month" is unreachable for almost everyone and demoralising by the 20th;
   a rolling window means effort always counts.

**Tiers** (your idea, tuned so the ladder is climbable):

| Tier | Churches live & paying, rolling 90 days | First-two-payments rate |
|---|---|---|
| Partner | 1–4 | 40% |
| Senior Partner | 5–14 | 45% |
| Lead Partner | 15–39 | 50% |
| Regional Partner | 40+ | 50% + a monthly retainer |

Qualify on **live and paying**, never on sign-ups — otherwise the tier rewards
volume and you pay for churn.

**What retains Partners** (beyond money, in the order I'd build it):
- **Fast, certain payouts.** Nothing else matters if the ₦10,000 withdrawal is
  slow or opaque. Show a clear "available / pending / paid" split and a date.
- **Their churches succeeding.** Give the Partner a read-only health view of
  each church they signed: are they recording attendance, has giving started,
  are they near a plan limit. That is also your best churn alarm.
- **Raise a ticket on behalf of a church** — you already asked for this, and it
  is the feature that makes a Partner feel like staff rather than a link.
- **A leaderboard that is opt-in**, and a "Partner of the month" with a real
  prize. Public by default would be a mistake in this market.
- **Training and a certificate** — which dovetails exactly with the
  FlockInsight Professional ranks you asked for. A certified Partner converts
  better and feels invested.
- **Co-branded material**: a one-page PDF with their name and photo on it.

**What I'd be careful about:** paying on *sign-up* rather than on payment;
self-referral (a Partner signing their own church); and letting Partners see any
member data. The last one is the line I would not cross — a Partner should see
numbers and plan status, never names.

---

## 4. Loose ends I noticed and did not touch

- **`function pg_catalog.btrim(gender) does not exist`** is being thrown in
  production right now — something is calling `trim()` on the `gender` enum
  column. It predates tonight. Worth finding; it will be failing a query
  somewhere silently.
- **`Error: The Server Reference ID did not match the expected format`** also in
  the logs — usually a browser running an old build against a new deploy. Harmless
  if it stops; tell me if it persists.
- **i18n backlog**: 885 untranslated strings across 218 files, pre-existing. My
  new Branches strings add to it in the same style as the page already used.
- `scratch/` has my working files, including the thrown-away bad migration
  (`0100_BAD_*.bak`) kept rather than deleted.

---

## 5. If something looks wrong this morning

- Rolling back is `git revert <sha> && git push origin main:production`. Both
  releases are independent; **0.74.0 added a table and a nullable column and
  removed nothing**, so reverting the code is safe and leaves the table unused.
- Meetings: open the **People panel** mid-call. It now shows your own outgoing
  voice, five numbers per person, and any moment your device stopped responding.
- The three-browser meeting harness is `node scripts/test-meeting-call.mjs`
  against `next build` + `next start` (never `next dev`). `PEOPLE=4` for a
  bigger room.
