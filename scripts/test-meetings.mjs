/**
 * End-to-end smoke test for the meetings module, against a running server.
 *
 * Two "browsers" join a real meeting through the real HTTP API and exchange
 * real signalling — including the parts a unit test cannot reach: the peer
 * secret, the host link, the long-poll wake-up, the scripture cache and the
 * audit rows each action leaves behind.
 *
 * It does NOT exercise WebRTC itself; that needs two actual browsers. What it
 * proves is that everything around the media path is correct.
 *
 * Usage, against a server started with a trusted origin on 3100:
 *   BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start -- -p 3100
 *   node scripts/test-meetings.mjs
 *
 * SMOKE_BASE overrides the base URL. It writes a throwaway meeting into
 * whatever database DATABASE_URL points at, so run it against a dev database.
 */
import pg from "pg";
import "dotenv/config";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3100";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) process.exitCode = 1;
};

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null, text: text.slice(0, 300) };
  }
};

await client.connect();

const { rows: churches } = await client.query(
  "select id, name from church order by created_at limit 1",
);
if (churches.length === 0) {
  console.log("No church in the local database — nothing to test against.");
  process.exit(0);
}
const church = churches[0];
console.log(`Using church: ${church.name}\n`);

const code = `zzz-test-${Date.now().toString(36).slice(-3)}`.slice(0, 20);
const hostKey = `hk-${Date.now().toString(36)}-smoke`;
const { rows: made } = await client.query(
  `insert into meeting (church_id, code, title, kind, status, access, allow_chat, allow_recording, max_participants, host_key)
   values ($1, $2, 'Smoke test meeting', 'prayer', 'scheduled', 'open', true, true, 12, $3)
   returning id, code`,
  [church.id, code, hostKey],
);
const meeting = made[0];
console.log(`Created meeting ${meeting.code}\n`);

/* ---------------------------------------------------------------- join */

const a = await post(`/api/meet/${meeting.code}/join`, {
  name: "Grace Okoro",
  micOn: true,
  cameraOn: false,
  lowData: false,
  hostKey,
});
ok("the host link makes the holder a host", a.json?.me?.role === "host", a.json?.me?.role);

const wrongKey = await post(`/api/meet/${meeting.code}/join`, {
  name: "Impostor",
  hostKey: "not-the-host-key",
});
ok(
  "a wrong host key does not make anyone a host",
  wrongKey.json?.me?.role === "attendee",
  wrongKey.json?.me?.role,
);
ok("peer A joins", a.json?.ok === true, a.json?.error ?? a.text ?? "");
ok("A gets a peer id and secret", !!a.json?.me?.peerId && !!a.json?.me?.secret);
ok("A gets ICE servers", Array.isArray(a.json?.ice?.iceServers) && a.json.ice.iceServers.length > 0);
ok(
  "TURN is reported honestly",
  typeof a.json?.ice?.hasTurn === "boolean",
  a.json?.ice?.hasTurn ? "TURN configured" : "no TURN configured (expected locally)",
);
ok("meeting went live on the first join", a.json?.meeting?.status === "live");

const b = await post(`/api/meet/${meeting.code}/join`, {
  name: "Samuel Adeyemi",
  micOn: true,
  cameraOn: true,
  lowData: false,
});
ok("peer B joins", b.json?.ok === true, b.json?.error ?? "");

const A = a.json.me;
const B = b.json.me;
ok("peers get different ids", A.peerId !== B.peerId);
ok("B sees A already in the room", (b.json.roster ?? []).length >= 1);

/* ------------------------------------------------------------ security */

const forged = await post(`/api/meet/${meeting.code}/sync`, {
  peer: A.peerId,
  secret: "not-the-real-secret",
  cursor: 0,
  wait: false,
});
ok("a forged peer secret is refused", forged.status === 401, `got ${forged.status}`);

const impersonation = await post(`/api/meet/${meeting.code}/action`, {
  peer: B.peerId,
  secret: B.secret,
  action: "stage.verse",
  reference: "John 3:16",
});
ok(
  "an attendee cannot take over the shared screen",
  impersonation.status === 403,
  `got ${impersonation.status}`,
);

/* --------------------------------------------------------- signalling */

const sent = await post(`/api/meet/${meeting.code}/sync`, {
  peer: A.peerId,
  secret: A.secret,
  cursor: a.json.cursor ?? 0,
  wait: false,
  signals: [
    { to: B.peerId, type: "offer", payload: { sdp: { type: "offer", sdp: "v=0..." } } },
    { to: B.peerId, type: "ice", payload: { candidate: { candidate: "candidate:1 ..." } } },
  ],
});
ok("A can post signalling", sent.json?.ok === true, sent.json?.error ?? "");

const received = await post(`/api/meet/${meeting.code}/sync`, {
  peer: B.peerId,
  secret: B.secret,
  cursor: b.json.cursor ?? 0,
  wait: false,
});
const types = (received.json?.signals ?? []).map((s) => s.type);
ok("B receives the offer and the candidate", types.includes("offer") && types.includes("ice"), types.join(","));
ok("B's roster shows everyone in the room", (received.json?.roster ?? []).length === 3);

// A must never be handed back its own messages.
const echo = await post(`/api/meet/${meeting.code}/sync`, {
  peer: A.peerId,
  secret: A.secret,
  cursor: a.json.cursor ?? 0,
  wait: false,
});
ok(
  "a peer never reads its own signals back",
  (echo.json?.signals ?? []).every((s) => s.fromPeer !== A.peerId),
);

/* --------------------------------------------------- long-poll wake-up */

const started = Date.now();
const waiter = post(`/api/meet/${meeting.code}/sync`, {
  peer: B.peerId,
  secret: B.secret,
  cursor: received.json.cursor,
  wait: true,
});
await new Promise((r) => setTimeout(r, 400));
await post(`/api/meet/${meeting.code}/sync`, {
  peer: A.peerId,
  secret: A.secret,
  cursor: 0,
  wait: false,
  signals: [{ to: B.peerId, type: "ice", payload: { candidate: { candidate: "candidate:2" } } }],
});
const woken = await waiter;
const elapsed = Date.now() - started;
ok(
  "a waiting peer is woken by a write, not by the timer",
  (woken.json?.signals ?? []).length > 0 && elapsed < 5000,
  `${elapsed}ms`,
);

/* --------------------------------------------------------------- chat */

const chat = await post(`/api/meet/${meeting.code}/action`, {
  peer: A.peerId,
  secret: A.secret,
  action: "chat",
  body: "Good evening everyone",
});
ok("chat is accepted", chat.json?.ok === true, chat.json?.error ?? "");

/* -------------------------------------------------------------- stage */

const note = await post(`/api/meet/${meeting.code}/action`, {
  peer: A.peerId,
  secret: A.secret,
  action: "stage.text",
  title: "Hymn",
  body: "Hymn 214 — Great is Thy faithfulness",
});
ok("a host can put a note on the screen", note.json?.ok === true, note.json?.error ?? "");
ok("the stage is versioned", (note.json?.stage?.rev ?? 0) > 0);

const verse = await post(`/api/meet/${meeting.code}/action`, {
  peer: A.peerId,
  secret: A.secret,
  action: "stage.verse",
  reference: "John 3:16",
  translation: "kjv",
});
if (verse.json?.ok) {
  ok("a verse is fetched and put on the screen", verse.json.stage?.body?.length > 20, verse.json.stage?.body?.slice(0, 60));
  const { rows: cached } = await client.query(
    "select reference, translation from scripture_verse where reference = 'John 3:16'",
  );
  ok("the verse is cached for next time", cached.length > 0);
  const again = await post(`/api/meet/${meeting.code}/action`, {
    peer: A.peerId,
    secret: A.secret,
    action: "stage.verse",
    reference: "John 3:16",
    translation: "kjv",
  });
  ok("a cached verse still works", again.json?.ok === true);
} else {
  console.log(`SKIP  verse lookup — ${verse.json?.error ?? "no network"}`);
}

const badVerse = await post(`/api/meet/${meeting.code}/action`, {
  peer: A.peerId,
  secret: A.secret,
  action: "stage.verse",
  reference: "Hezekiah 4:4",
});
ok("a made-up book is refused with a readable message", badVerse.status === 422, badVerse.json?.error ?? "");

const pasted = await post(`/api/meet/${meeting.code}/action`, {
  peer: A.peerId,
  secret: A.secret,
  action: "stage.verse",
  reference: "John 3:16",
  translation: "own",
  text: "Amana Chineke huru uwa n'anya...",
});
ok("a pasted translation works with no network at all", pasted.json?.ok === true, pasted.json?.error ?? "");

/* ------------------------------------------------------ host controls */

const muteAll = await post(`/api/meet/${meeting.code}/action`, {
  peer: A.peerId,
  secret: A.secret,
  action: "mute",
});
ok("a host can mute the room", muteAll.json?.ok === true, `${muteAll.json?.muted ?? 0} muted`);

/* -------------------------------------------------------------- leave */

const left = await post(`/api/meet/${meeting.code}/leave`, {
  peer: B.peerId,
  secret: B.secret,
});
ok("leaving is accepted", left.json?.ok === true);

const after = await post(`/api/meet/${meeting.code}/sync`, {
  peer: A.peerId,
  secret: A.secret,
  cursor: 0,
  wait: false,
});
ok("the roster drops the person who left", (after.json?.roster ?? []).length === 2);

/* --------------------------------------------------------------- end */

const ended = await post(`/api/meet/${meeting.code}/action`, {
  peer: A.peerId,
  secret: A.secret,
  action: "end",
});
ok("a host can end the meeting", ended.json?.ok === true);

const closed = await post(`/api/meet/${meeting.code}/join`, { name: "Latecomer" });
ok("nobody can join an ended meeting", closed.status === 403, closed.json?.error ?? "");

/* ------------------------------------------------------------- pages */

const page = await fetch(`${BASE}/meet/${meeting.code}`);
const html = await page.text();
ok("the public meeting page renders", page.status === 200);
ok("an ended meeting says so rather than opening a room", html.includes("ended"));

const missing = await fetch(`${BASE}/meet/aaa-bbbb-ccc`);
ok("an unknown code gets a real page, not a crash", missing.status === 200);

/* --------------------------------------------------------- audit rows */

const { rows: audits } = await client.query(
  `select action, summary, severity, module from audit_log
   where target_id = $1 order by created_at`,
  [meeting.id],
);
ok("the meeting was audited", audits.length >= 4, `${audits.length} entries`);
ok(
  "audit entries are filed under the meetings module",
  audits.every((r) => r.module === "meetings"),
);
console.log("\n  audit trail for this meeting:");
for (const r of audits) console.log(`   [${r.severity}] ${r.action} — ${r.summary}`);

const { rows: register } = await client.query(
  `select display_name, duration_sec, left_at from meeting_participant where meeting_id = $1 order by joined_at`,
  [meeting.id],
);
ok("the register kept everyone who got in, and nobody who did not", register.length === 3, `${register.length} rows`);
ok("everyone is marked as having left when the meeting ended", register.every((r) => r.left_at !== null));

const { rows: signals } = await client.query(
  "select count(*)::int as n from meeting_signal where meeting_id = $1",
  [meeting.id],
);
console.log(`\n  signalling rows written: ${signals[0].n} (swept by the cron)`);

await client.end();
console.log(`\nDone. Exit code ${process.exitCode ?? 0}`);
