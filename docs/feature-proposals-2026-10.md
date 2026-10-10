# What to build next — a shortlist for review

Written 10 October 2026, against v0.73.0. The roadmap queue is empty: 53 items,
all shipped, nothing `todo`. This is a candidate list to fill it, not a plan.

Everything below was checked against the codebase before it was written. Where
I say something does not exist, I grepped for it. Where I say a competitor has
it, I found their page.

---

## The one-paragraph version

FlockInsight is unusually broad — eighteen modules against a field that mostly
sells a member database with giving bolted on. The gaps left are not breadth,
they are **three table-stakes features every serious competitor has and you do
not** (child check-in, volunteer rotas, giving statements), and **two channel
gaps that are costing you specific countries** (WhatsApp, mobile money). After
those, the most valuable thing you can build is not a new module at all — it is
a report that reads data you already have.

My recommendation for what to start with is **#1 (child check-in)** if you want
to win bigger churches, or **#4 (at-risk members)** if you want the cheapest
large win in the list. They are very different bets and the reasoning for each
is below.

---

## Tier 1 — Table stakes you are missing

These three are the features a church comparing you against Planning Center,
Breeze or ChurchSuite will find absent. Each one loses deals you never hear
about.

### 1. Child check-in and safeguarding

**What exists today:** `attendance` has optional per-member check-in records.
`member.guardian_id` links a child to a guardian. There is no allergy field
anywhere in the schema, no pickup code, no authorised-collector list.

**What is missing:** the actual children's-ministry workflow — numbered name
tag matched to a parent receipt, allergy and medical alerts on the room roster,
a list of adults permitted to collect each child, and a printable emergency
roster. Plus a safeguarding record per volunteer: check type, date, expiry, and
a flag when it lapses.

**Why it matters more than it looks.** This is the one feature where absence is
disqualifying rather than disappointing. A UK church cannot adopt a platform
that cannot evidence safeguarding; the 2026 *Working Together* update tightened
what volunteers must record. A Nigerian church with a large children's church
has the same practical problem with a different name. Every competitor in the
comparison pages has this: Planning Center Check-Ins, Breeze, ChurchSuite,
iKnow (built with CCPAS, barcode pickup verification).

**Why you are well placed:** the guardian link and household grouping are
already in the member model. This is mostly new surface over existing data.

**Effort:** large. Two to three weeks. Needs a kiosk-mode screen, label
printing (or a phone-screen fallback — most churches here will not have a label
printer, and that is worth designing for rather than assuming), and a genuinely
offline-tolerant check-in flow, because a children's wing is exactly where the
signal is worst.

**Plan tier:** Growth and above. It is the feature that justifies an upgrade
from Starter.

**Risk to name out loud:** safeguarding data is the most sensitive data in the
platform. A medical note visible to the wrong volunteer is a worse failure than
any bug shipped so far. Permissions must be per-room, not per-module.

---

### 2. Volunteer rotas and scheduling

**What exists today:** nothing. `groups` holds departments and leaders, `roles`
controls access. "Volunteer" appears in the codebase only in comments.

**What is missing:** who is serving this Sunday. Role definitions, availability,
a published schedule, automatic reminders, and self-service swap requests.

**Why it matters:** this is Planning Center's strongest product and the single
most common reason a church stays with them. It is also the thing a church
actually does every week — more often than it runs a report. Published figures
on AI-assisted scheduling claim a 60% drop in no-shows; treat the number
sceptically, but the direction is not in doubt, because the mechanism is just
reminders.

**Why you are well placed:** you already have groups with leaders and titles,
reminders that send themselves on the church's own timezone, and SMS/email. A
rota is mostly an assignment table plus the scheduling you have already built
for service reminders.

**Effort:** large, but less than it looks for that reason. Two weeks.

**Plan tier:** Growth. A church with rotas has enough people to need a plan.

**Honest caveat:** going head-to-head with Planning Center's best feature is the
hardest competitive ground in the list. The winning version is not "as good as
theirs" — it is "good enough, and it is already in the thing that holds your
member list, your attendance and your SMS."

---

### 3. Annual giving statements and tax receipts

**What exists today:** per-gift receipts, giving history, exports. No annual
statement. The UK country page admits in writing that there is no Gift Aid
submission.

**What is missing:** a one-click per-member annual statement, in the church's
currency, as a PDF, emailed in bulk — plus the Gift Aid schedule a UK church
needs to make its claim.

**Why it matters:** for a UK or US church this is an annual legal obligation,
not a nice-to-have, and it arrives on a deadline. It is also the cheapest
credibility feature in the list: a church that has to leave your platform every
January to do its statements elsewhere will eventually leave it in February too.

**Why you are well placed:** the giving data, the PDF pipeline and the embedded
font that can actually draw ₦ and £ all exist. This is assembly, not invention.

**Effort:** small. Three to four days for statements. Gift Aid schedule export
is another two or three; the HMRC submission API itself is a separate decision
and probably not worth it yet.

**Plan tier:** all paid plans. Do not gate a legal obligation.

---

## Tier 2 — The channel gaps costing you countries

### 4. At-risk members — "who has quietly stopped coming"

**Build this one first if you want the best return per day of work.**

**What exists today:** attendance (per-service and optionally per-member),
giving history, follow-up stages, groups, training records. Everything needed.
There is no report that joins them.

**What is missing:** a single screen that answers the question every pastor
actually has — *who was here regularly and is not any more?* Members whose
attendance has dropped against their own baseline, whose giving has stopped,
who have left every group they were in. Ranked, with a reason shown, and a
one-tap route into follow-up.

**Why it matters:** it is the highest-value output of data you are already
collecting and currently only display as totals. It converts FlockInsight from
a record-keeping system into something that tells a pastor something they did
not know. That is a different product in the buyer's mind, and it is the thing
a demo should open with.

**Effort:** small to medium. Four to five days, almost all of it query work and
deciding the thresholds. No new data, no new permissions model, no new screens
beyond one report and one list.

**Plan tier:** Growth. It is a reason to upgrade.

**The trap to avoid:** this must show *why* somebody is flagged, not just a
score. "Attended 3 of the last 12 Sundays, last gave in June, left the choir in
August" is actionable. A number out of 100 is not, and a wrong number out of
100 destroys trust in the whole feature. Same rule as the diagnostics work:
report the raw facts, never a verdict.

---

### 5. WhatsApp Business API messaging

**What exists today:** WhatsApp is a contact field and a share channel. There is
no messaging integration. SMS is Nigeria-only and charged per message; email is
free but less read.

**What is missing:** sending through WhatsApp Business templates — service
reminders, first-timer welcomes, giving receipts, rota reminders.

**Why it matters:** in Nigeria, Ghana and Kenya, WhatsApp *is* the channel. It
is where the church already has its groups. It also routes around your biggest
current limitation — SMS sender IDs are Nigeria-only, which the Kenya, Ghana,
South Africa and Uganda pages all have to admit. WhatsApp works in all of them.

**Effort:** medium, but the hard part is not code. It is Meta Business
verification, template approval, and per-message pricing that differs by country
and conversation category. Budget two weeks of calendar time for approvals you
do not control.

**Plan tier:** charge per message from the existing wallet, exactly like SMS.
The wallet and the delivery-report plumbing already exist.

**Decide before starting:** whether the church brings its own Meta Business
account or sends under yours. Under yours is far easier to onboard and far
harder to keep compliant — one church's spam complaint affects every church's
delivery. I would make it bring-your-own, and say so in the pricing copy.

---

### 6. Mobile money giving — M-Pesa, MoMo, Airtel Money

**What exists today:** own-gateway online giving — card, bank transfer, USSD.
"M-Pesa" appears in the codebase exactly once: in the SEO content I wrote
yesterday, saying we do not support it.

**What is missing:** M-Pesa STK push (Kenya, Tanzania), MTN MoMo (Ghana,
Uganda), Airtel Money. Gift lands, matched to a member, receipt issued, book
entry made.

**Why it matters:** this is the specific thing blocking East Africa. Mobile
money is not an alternative payment method there, it is the default one, and
reported figures put 15–25% of a church's weekly giving as coming from people
not in the building that day. The Kenya page's weakest answer is currently this
exact question.

**Effort:** medium per provider. Safaricom Daraja is well documented; each
additional provider is its own integration and its own set of sandbox
credentials. Do Kenya first, alone, and see whether East Africa actually
converts before building three more.

**Plan tier:** same as existing online giving.

---

## Tier 3 — Worth having, not worth starting with

### 7. A real member app area
Members can already update details via a private link and staff can be given
logins. A member-facing home — my giving history, my groups, my training
badges, register for an event, read the devotional, give — is standard
elsewhere and would reduce admin load. **Medium. Starter and above.**

### 8. Sermon transcription and study notes
Media and audio storage exist. Transcribing an uploaded sermon and generating a
study guide and discussion questions is a well-trodden, genuinely useful
feature. It would also make "AI" an honest word on the site — it is currently
in `FORBIDDEN_CLAIMS` precisely because nothing ships it. **Medium; per-minute
cost, so meter it. Pro.**

### 9. Prayer requests with triage
A request comes in from the public page or a member, gets categorised, assigned
to a care team, and tracked to closure. It is follow-up with a different noun,
and you already have follow-up. **Small. Growth.**

### 10. Giving pledge campaigns with per-member progress
Projects and pledges exist. What is missing is the member seeing their own
pledge progress and being reminded about their own shortfall. **Small. Growth.**

### 11. A fuller website builder
`/c/<handle>` and `/hub/<slug>` cover a lot. A multi-page site with the church's
own domain is what Subsplash and Tithely sell. Real revenue, substantial build,
and a different business. **Large. Pro. Not yet.**

### 12. Denominational hierarchy beyond two levels
Branches roll up to a headquarters. A real denomination is national → state →
zone → area → branch. You will hit this the first time a large denomination
signs. **Medium. Enterprise.**

---

## What I would not build

- **A native mobile app.** The PWA installs to the home screen and the whole
  product is designed around a poor connection. An app store presence costs two
  platforms of maintenance and buys very little your users cannot already get.
- **An AI chatbot on the marketing site.** It answers questions `llms.txt` and
  the FAQ already answer, and it is the single most common thing added in 2026
  that nobody uses twice.
- **A feature-matrix page against competitors.** Tempting for SEO, stale within
  a week, and unfair without meaning to be. The comparison pages make the same
  argument honestly and will age better.

---

## If you want a single answer

**Start with #4, at-risk members.** It is four or five days, needs no new data,
no new permissions and no third party. It is the best demo you will ever have,
and it will tell you something true about your own churches before you have
finished building it.

**Then #3, giving statements** — small, and it removes an annual reason to
leave.

**Then pick a bet:** #1 child check-in if you are chasing bigger and UK
churches, #6 M-Pesa if you are chasing East Africa. They pull in different
directions and doing both at once will do neither well.

---

## One open question

In the message that started this work you said *"we'll build it later, remind
me"* — and the thing itself was not named in anything I can see. It is not on
the roadmap (which is empty) and not in this session's history. Tell me what it
was and I will file it.
