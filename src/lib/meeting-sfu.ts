import {
  audioWireBitrate,
  TRACK_NAMES,
  tuneOpus,
  type AudioProfile,
  type RosterEntry,
} from "@/lib/meetings-shared";

/**
 * The SFU transport — the browser half.
 *
 * Deliberately a separate object from `MeetingClient` rather than a rewrite of
 * it. Everything that makes a meeting a meeting — signalling, the roster, chat,
 * reactions, the stage, recording, presence — is the same whichever way media
 * travels, and all of it already works. Only the media plumbing differs, so
 * only the media plumbing is duplicated, and the mesh path is not touched at
 * all by any of this.
 *
 * TWO CONNECTIONS, and the reason matters. A publisher (sendonly) carries this
 * person's own tracks; a subscriber (recvonly) carries everybody else's. One
 * connection would mean that somebody switching their camera on renegotiates
 * the same connection that is delivering the sermon to them. Two means those
 * two events cannot interfere.
 *
 * NO GUESSING WHICH TRACK IS WHOSE. The mesh path had to infer that from
 * transceiver identity and lost a day to getting it wrong. Here the SFU tells
 * us: every pull returns the `mid` it allocated, so `mid -> (peerId, kind)` is
 * recorded from the answer and `ontrack` is a lookup. There is no fallback,
 * because there is nothing to fall back to.
 *
 * ONE MUTATION AT A TIME. Cloudflare rejects concurrent changes to a session
 * with a 406, and a room where four people join at once is exactly when that
 * happens. Every call goes through `queue`, which is a promise chain, so the
 * ordering is enforced here where the session is owned rather than hoped for.
 */

export type SfuEvents = {
  /** A peer's media changed: new tracks, or a track that stopped. */
  onMedia: (peerId: string, media: { stream: MediaStream; screen: MediaStream }) => void;
  /** A peer left, or stopped publishing entirely. */
  onGone: (peerId: string) => void;
  /** Connection health, for the same pill the mesh drives. */
  onState: (state: RTCPeerConnectionState) => void;
  onError: (message: string) => void;
};

type Api = (action: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Attempts at one track before it is left alone.
 *
 * A track that is not published yet appears within a second or two, which is
 * what the retry is for. One that never will must stop asking, because every
 * attempt renegotiates the session every voice in the room arrives on.
 */
const PULL_ATTEMPTS = 6;

type PulledTrack = { peerId: string; name: string };

/** One person's connection, as the subscriber sees it. */
export type SfuPeerReading = {
  videoInKbps: number;
  framesDecoded: number;
  ice: RTCIceConnectionState;
  audioInKbps: number;
  audioLossPct: number;
  audioConcealedPct: number;
  audioJitterMs: number;
  audioJitterBufferMs: number;
};

/** What we are currently sending, so a change can be compared against it. */
type Published = { mic?: string; cam?: string; screen?: string };

export class SfuTransport {
  private publisher: RTCPeerConnection | null = null;
  private subscriber: RTCPeerConnection | null = null;

  private publisherSession: string | null = null;
  private subscriberSession: string | null = null;
  /** The route's proof that each session was minted for this participant. */
  private publisherProof = "";
  private subscriberProof = "";

  /** Our own sendonly transceivers, by track name. */
  private senders = new Map<string, RTCRtpTransceiver>();
  private published: Published = {};

  /** `mid` -> whose track it is. Filled in from the SFU's own answer. */
  private incoming = new Map<string, PulledTrack>();
  /** What we have already asked for, so a poll does not re-pull every tick. */
  private pulled = new Set<string>();
  /** Failed attempts per track, and when the next one may be made. */
  private pullTries = new Map<string, number>();
  private pullAfter = new Map<string, number>();

  /** Per-peer media, assembled as tracks arrive. */
  private media = new Map<string, { stream: MediaStream; screen: MediaStream }>();

  /** Previous byte totals per peer, for turning them into a rate. */
  private lastVideoBytes = new Map<string, { at: number; bytes: number }>();
  /**
   * Previous audio counters per peer, so loss and concealment can be reported
   * for the window just gone rather than for the whole call.
   */
  private lastAudio = new Map<
    string,
    {
      at: number;
      bytes: number;
      packetsReceived: number;
      packetsLost: number;
      concealedSamples: number;
      totalSamples: number;
    }
  >();
  /** Whether this browser has been found to refuse a jitter buffer hint. */
  private jitterBufferRefused = false;

  /**
   * Whose PICTURES are wanted right now — the people on screen.
   *
   * Voices are pulled from everybody regardless; a meeting where you cannot
   * hear somebody is not a meeting, and audio is 24 kbps. Video is the
   * expensive half, and pulling all of it is what made download grow with the
   * room: 8.7 Mbps at thirty people, 59.7 at two hundred, on connections that
   * have neither.
   *
   * Empty means "not told yet", which is treated as wanting everything — the
   * safe direction, because a room that shows nothing is worse than a room
   * that costs too much for a few seconds.
   */
  private videoInterest: Set<string> | null = null;

  private chain: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly api: Api,
    private readonly iceServers: RTCIceServer[],
    /**
     * The voice settings in force right now, read rather than held.
     *
     * A function because the profile follows the measured link and this object
     * may negotiate at any point after it was built. An SFU room gets the Opus
     * tuning, the sender priority and the jitter buffer; it does not get RED,
     * because toggling that means renegotiating a Cloudflare session over a
     * codec preference and the three it does get are most of the benefit.
     */
    private readonly audio: () => AudioProfile,
    private readonly events: SfuEvents,
  ) {}

  /** The shape this transport negotiates with: never redundant. See above. */
  private audioShape(): AudioProfile {
    return { ...this.audio(), redundancy: false };
  }

  /**
   * Hold some audio back before playing it, and let the voice outrank the
   * pictures on the way out.
   *
   * The same two things the mesh path does, for the same reason — a player
   * with an empty buffer invents every gap in a gusty link, and a camera that
   * is allowed to compete with a microphone for a thin uplink wins. Neither
   * costs any bandwidth. See `tuneAudioReceiver` in meeting-client.ts.
   */
  tuneAudio(): void {
    const target = this.audioShape().jitterBufferMs;

    for (const tr of this.subscriber?.getTransceivers() ?? []) {
      const who = tr.mid ? this.incoming.get(tr.mid) : undefined;
      if (who && who.name !== TRACK_NAMES.mic) continue;
      const r = tr.receiver as RTCRtpReceiver & {
        jitterBufferTarget?: number | null;
        playoutDelayHint?: number | null;
      };
      try {
        if ("jitterBufferTarget" in r) r.jitterBufferTarget = target;
        if ("playoutDelayHint" in r) r.playoutDelayHint = target / 1000;
      } catch (e) {
        if (!this.jitterBufferRefused) {
          this.jitterBufferRefused = true;
          console.warn("[sfu] this browser refused a jitter buffer hint", e);
        }
      }
    }

    const mic = this.senders.get(TRACK_NAMES.mic)?.sender;
    if (!mic) return;
    try {
      const params = mic.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = audioWireBitrate(this.audioShape());
      params.encodings[0].priority = "high";
      params.encodings[0].networkPriority = "high";
      void mic.setParameters(params).catch((e) => {
        console.warn("[sfu] microphone parameters refused", e);
      });
    } catch (e) {
      console.warn("[sfu] microphone parameters could not be read", e);
    }
  }

  /**
   * Serialise every mutation of a session.
   *
   * Cloudflare answers a second concurrent change to one session with a 406,
   * and the moment that happens is a room where several people join together —
   * precisely when a meeting must not break. A promise chain is enough because
   * each session is mutated only from this object.
   */
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    // Keep the chain alive after a failure: one bad pull must not stop every
    // later one from being attempted.
    this.chain = next.catch(() => undefined);
    return next;
  }

  private pc(): RTCPeerConnection {
    return new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
  }

  /**
   * Wait for ICE gathering to finish before handing an SDP to the SFU.
   *
   * Cloudflare's API takes one description rather than a stream of candidates,
   * so a description sent early is a description with no way to connect.
   * Bounded, because a network that never finishes gathering would otherwise
   * hang the join for ever — and a partial candidate list usually still works.
   */
  private async gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      pc.addEventListener("icegatheringstatechange", check);
      setTimeout(done, 3000);
    });
  }

  /* ============================================================
   * Publishing
   * ========================================================== */

  /**
   * Send these tracks, replacing whatever was being sent before.
   *
   * A track that is already published is swapped with `replaceTrack`, which
   * needs no renegotiation at all — so turning a camera on and off in a room
   * of two hundred costs one local operation and nothing on the wire.
   */
  async setLocal(tracks: {
    mic: MediaStreamTrack | null;
    camera: MediaStreamTrack | null;
    screen: MediaStreamTrack | null;
  }): Promise<void> {
    await this.queue(async () => {
      if (this.stopped) return;

      if (!this.publisher) {
        /*
         * The session FIRST, and the connection only if it was granted.
         *
         * This was the other way round, so a Cloudflare hiccup left
         * `this.publisher` set and `publisherSession` null — and because the
         * connection existed, nothing ever tried again. That person was mute
         * for the rest of the meeting and nothing said why.
         */
        const session = await this.session().catch((e: unknown) => {
          console.error("[sfu] no publishing session; will try again", e);
          return null;
        });
        if (!session) {
          this.events.onError?.(
            "We could not reach the media server to send your voice. Trying again.",
          );
          return;
        }
        this.publisherSession = session.id;
        this.publisherProof = session.proof;
        this.publisher = this.pc();
        this.publisher.onconnectionstatechange = () => {
          const pc = this.publisher;
          if (!pc) return;
          this.events.onState(pc.connectionState);
          if (pc.connectionState === "failed") this.resetPublisher();
        };
      }

      const wanted: [keyof Published, string, MediaStreamTrack | null][] = [
        ["mic", TRACK_NAMES.mic, tracks.mic],
        ["cam", TRACK_NAMES.camera, tracks.camera],
        ["screen", TRACK_NAMES.screen, tracks.screen],
      ];

      const fresh: { mid: string; trackName: string }[] = [];

      for (const [key, name, track] of wanted) {
        const existing = this.senders.get(name);
        if (existing) {
          // Already negotiated: a swap, or silence. No SDP either way.
          await existing.sender.replaceTrack(track);
          continue;
        }
        if (!track) continue;

        const tr = this.publisher.addTransceiver(track, { direction: "sendonly" });
        this.senders.set(name, tr);
        this.published[key] = name;
        fresh.push({ mid: "", trackName: name });
      }

      if (fresh.length === 0) return;

      const offer = await this.publisher.createOffer();
      // Our own description is what this end sends with, so the voice is tuned
      // here or not at all.
      if (offer.sdp) offer.sdp = tuneOpus(offer.sdp, this.audioShape());
      await this.publisher.setLocalDescription(offer);
      await this.gathered(this.publisher);

      // Mids only exist after setLocalDescription, which is why they are read
      // here rather than when the transceiver was created.
      const payload = fresh
        .map((f) => ({
          mid: this.senders.get(f.trackName)?.mid ?? "",
          trackName: f.trackName,
        }))
        .filter((f) => f.mid);

      const res = await this.api("publish", {
        session: this.publisherSession,
        proof: this.publisherProof,
        sdp: {
          type: "offer",
          sdp: this.publisher.localDescription?.sdp ?? "",
        },
        tracks: payload,
      });

      const answer = res.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (answer?.sdp) await this.publisher.setRemoteDescription(answer);
      this.tuneAudio();
    });
  }

  /* ============================================================
   * Subscribing
   * ========================================================== */

  /**
   * Pull whatever is new in the roster, and drop whoever has gone.
   *
   * Driven by the same poll that already keeps the roster current, so there is
   * no second source of truth about who is in the room. Only tracks not
   * already pulled are asked for, which is what keeps a four-second poll from
   * renegotiating four times a second.
   */
  /**
   * Say who is on screen. Anyone dropping out of this set has their video
   * closed; anyone entering it has theirs pulled on the next sync.
   *
   * Audio is deliberately not part of this.
   */
  setVideoInterest(peerIds: Iterable<string>): void {
    this.videoInterest = new Set(peerIds);
  }

  /** Is this person's picture wanted? Unset means "we have not been told yet". */
  private wantsVideoFrom(peerId: string): boolean {
    return this.videoInterest === null || this.videoInterest.has(peerId);
  }

  async sync(roster: RosterEntry[], myPeerId: string): Promise<void> {
    await this.queue(async () => {
      if (this.stopped) return;

      const others = roster.filter(
        (r) => r.admitted && r.peerId !== myPeerId && r.sfuSessionId,
      );
      const live = new Set(others.map((r) => r.peerId));

      for (const [peerId] of this.media) {
        if (!live.has(peerId)) {
          this.media.delete(peerId);
          this.events.onGone(peerId);
        }
      }

      // Forget what we pulled from anybody who has gone. Otherwise the same
      // person rejoining — a reload, a dropped connection — finds their tracks
      // already recorded as pulled, against a session that no longer exists,
      // and never appears again.
      for (const key of [...this.pulled]) {
        const peerId = key.slice(0, key.lastIndexOf(":"));
        if (!live.has(peerId)) this.pulled.delete(key);
      }

      /*
       * And HAND BACK what they were arriving on.
       *
       * Forgetting a departed peer locally was not the same as letting go of
       * them, and the difference is what made a long meeting fall over. Every
       * voice is pulled onto the one subscriber session, and nothing here ever
       * closed a microphone — `dropUnwatched` reclaims cameras and skips
       * anybody who has left the room at all. So a peer who left took nothing
       * with them: their transceiver, its decoder and its jitter buffer stayed
       * for the rest of the meeting, pointed at a Cloudflare session that had
       * gone, and every later pull renegotiated a description carrying all of
       * them.
       *
       * That cost grows with CHURN rather than with the size of the room,
       * which is why it never showed in a quick two-person test and did show
       * in a room of eleven people that was joined forty-eight times: a
       * browser holding fifty dead audio decoders and renegotiating a
       * fifty-section description is a browser that hangs, and three of them
       * did. `src/lib/meeting-sfu-churn.test.ts` holds the arithmetic.
       */
      await this.reclaimDeparted(live);

      await this.dropUnwatched(live);

      const wanted: { sessionId: string; trackName: string }[] = [];
      const record: PulledTrack[] = [];

      for (const r of others) {
        /*
         * Only what they have actually published, which the roster states.
         *
         * A track exists on the SFU from the moment it is first turned on, and
         * survives being turned off afterwards — the publisher keeps the
         * transceiver and swaps the track for null. So these flags are the
         * right question to ask: they go true the moment there is something to
         * pull, and a `cam` that is off but was on is still there to be had.
         *
         * Asking for all three unconditionally is what broke this. People join
         * with their camera off, so at that instant only the microphone
         * exists; the other two came back as per-track errors that nothing
         * looked at, were marked done anyway, and were never asked for again.
         * Audio worked and video never appeared.
         */
        const available: string[] = [];
        if (r.micOn || this.pulled.has(`${r.peerId}:${TRACK_NAMES.mic}`)) {
          available.push(TRACK_NAMES.mic);
        }
        // Their picture, only if it is being looked at. This one condition is
        // what turns download from linear in room size into flat.
        if (r.cameraOn && this.wantsVideoFrom(r.peerId)) {
          available.push(TRACK_NAMES.camera);
        }
        // A shared screen is always wanted: somebody sharing is, by
        // definition, the thing the room is looking at.
        if (r.sharing) available.push(TRACK_NAMES.screen);

        for (const name of available) {
          const key = `${r.peerId}:${name}`;
          if (this.pulled.has(key)) continue;
          /*
           * Backed off, because a track that cannot be pulled used to be asked
           * for again on every poll return — not every four seconds, every
           * RETURN, which during a busy room is several times a second. Each
           * attempt renegotiates the subscriber session, so one unpullable
           * track became a permanent renegotiation storm on the connection
           * carrying every voice in the room. That is a device locking up.
           */
          const tries = this.pullTries.get(key) ?? 0;
          if (tries >= PULL_ATTEMPTS) continue;
          const nextAt = this.pullAfter.get(key) ?? 0;
          if (Date.now() < nextAt) continue;
          wanted.push({ sessionId: r.sfuSessionId as string, trackName: name });
          record.push({ peerId: r.peerId, name });
        }
      }

      if (wanted.length === 0) return;

      if (!this.subscriber) {
        const session = await this.session().catch((e: unknown) => {
          console.error("[sfu] no subscribing session; will try again", e);
          return null;
        });
        if (!session) return;
        this.subscriberSession = session.id;
        this.subscriberProof = session.proof;
        this.subscriber = this.pc();
        this.subscriber.ontrack = (e) => this.onTrack(e);
        /*
         * The connection that carries every voice in the room had no state
         * handler at all, so a subscriber that failed went unnoticed: the
         * transport pill said "retrying" while nothing retried, and the person
         * sat in a silent meeting.
         */
        this.subscriber.onconnectionstatechange = () => {
          const pc = this.subscriber;
          if (!pc) return;
          if (pc.connectionState === "failed") this.resetSubscriber();
        };
      }

      let res: Record<string, unknown>;
      try {
        res = await this.api("pull", {
          session: this.subscriberSession,
          proof: this.subscriberProof,
          tracks: wanted,
        });
      } catch {
        // Nothing is marked until it has arrived, so a failed call simply
        // means the next poll tries again. Somebody who has not finished
        // publishing is the common case here, not an error worth shouting
        // about — four seconds later they will have.
        return;
      }

      /*
       * The SFU says which mid each track landed on. This is the whole reason
       * the SFU path cannot suffer the slot confusion the mesh path did: the
       * mapping is stated rather than inferred.
       */
      /*
       * By POSITION, not by name. Every person's camera is called "cam", so
       * matching on the name alone would give three people's video to whoever
       * happened to be first in the list. The response is in the order the
       * tracks were asked for, and `record` was built in that same order.
       */
      const results =
        (res.tracks as {
          mid?: string;
          trackName?: string;
          error?: { errorDescription?: string };
        }[]) ?? [];

      results.forEach((t, i) => {
        const who = record[i];
        if (!who) return;

        /*
         * A per-track failure comes back inside a 200, which is how this
         * managed to look like success. Left unmarked, so the next poll asks
         * again — a track that is not there yet usually is a moment later.
         */
        if (t.error || !t.mid) {
          const key = `${who.peerId}:${who.name}`;
          const tries = (this.pullTries.get(key) ?? 0) + 1;
          this.pullTries.set(key, tries);
          // Doubling, capped: a track that is simply not published yet usually
          // appears within a second or two, and one that never will must stop
          // costing a renegotiation.
          this.pullAfter.set(key, Date.now() + Math.min(2 ** tries, 32) * 1000);
          if (tries === PULL_ATTEMPTS) {
            console.warn(
              `[sfu] giving up on ${who.name} from ${who.peerId} after ` +
                `${tries} attempts: ${t.error?.errorDescription ?? "no reason given"}`,
            );
          }
          return;
        }

        if (t.trackName && t.trackName !== who.name) {
          // Order and names disagreeing means an assumption here is wrong, and
          // silently mis-routing somebody's camera is the expensive outcome.
          console.warn("[sfu] pull result out of order", t.trackName, who.name);
          return;
        }

        // Marked only now, having actually been allocated a mid.
        const key = `${who.peerId}:${who.name}`;
        this.pullTries.delete(key);
        this.pullAfter.delete(key);
        this.pulled.add(key);
        this.incoming.set(t.mid, who);
      });

      const offer = res.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (!offer?.sdp) return;

      await this.subscriber.setRemoteDescription(offer);
      const answer = await this.subscriber.createAnswer();
      if (answer.sdp) answer.sdp = tuneOpus(answer.sdp, this.audioShape());
      await this.subscriber.setLocalDescription(answer);
      await this.gathered(this.subscriber);

      await this.api("renegotiate", {
        session: this.subscriberSession,
        proof: this.subscriberProof,
        sdp: {
          type: "answer",
          sdp: this.subscriber.localDescription?.sdp ?? "",
        },
      });
      this.tuneAudio();
    });
  }

  /**
   * Stop paying for pictures nobody is looking at.
   *
   * Without this half, limiting what we PULL only helps somebody who joins a
   * large room — anyone already in one keeps every stream they ever acquired,
   * and the cost never comes back down when the grid changes page or a
   * spotlight starts.
   *
   * Audio is never dropped here. Only cameras, and only cameras belonging to
   * people who are still in the room but no longer on screen — somebody who
   * has left is handled by the caller, which forgets them entirely.
   */
  /**
   * Give back everything belonging to people who have left the room.
   *
   * Every kind, not just cameras: a microphone is a decoder and a jitter
   * buffer too, and it is the one that is always there. Closing the mid is
   * what lets the media server stop sending, lets the browser release the
   * decoder, and lets the mid be used again — so the description stops
   * carrying the whole history of the meeting.
   *
   * Their media bundle and `pulled` entries have already been struck by the
   * caller, so there is nothing to publish to the interface here; this is
   * purely handing resources back.
   */
  private async reclaimDeparted(live: Set<string>): Promise<void> {
    const mids: string[] = [];
    for (const [mid, who] of this.incoming) {
      if (!live.has(who.peerId)) mids.push(mid);
    }
    for (const mid of await this.closeMids(mids)) this.forget(mid);
  }

  private async dropUnwatched(live: Set<string>): Promise<void> {
    if (this.videoInterest === null) return;

    const mids: string[] = [];
    for (const [mid, who] of this.incoming) {
      if (who.name !== TRACK_NAMES.camera) continue;
      // Departed peers are `reclaimDeparted`'s job, every track of them.
      if (!live.has(who.peerId)) continue;
      if (this.videoInterest.has(who.peerId)) continue;
      mids.push(mid);
    }

    for (const mid of await this.closeMids(mids)) {
      const who = this.incoming.get(mid);
      this.forget(mid);
      if (!who) continue;
      const bundle = this.media.get(who.peerId);
      if (!bundle) continue;
      for (const t of bundle.stream.getVideoTracks()) bundle.stream.removeTrack(t);
      this.events.onMedia(who.peerId, {
        stream: new MediaStream(bundle.stream.getTracks()),
        screen: new MediaStream(bundle.screen.getTracks()),
      });
    }
  }

  /**
   * Stop accounting for one mid.
   *
   * Struck from `pulled` as well as from `incoming`, so the same track coming
   * back — a camera returning to screen, a person rejoining — is asked for
   * again rather than found already recorded as had.
   */
  private forget(mid: string): void {
    const who = this.incoming.get(mid);
    if (!who) return;
    this.incoming.delete(mid);
    const key = `${who.peerId}:${who.name}`;
    this.pulled.delete(key);
    this.pullTries.delete(key);
    this.pullAfter.delete(key);
  }

  /**
   * Tell the media server to stop sending these.
   *
   * Returns the mids it accepted, still present in `incoming` so the caller
   * can read what they were before calling `forget` on each. Striking the
   * bookkeeping is deliberately the caller's step rather than this one's: the
   * camera path needs to know whose picture it was in order to take it off the
   * screen.
   *
   * A failed close is left entirely alone and tried again on the next poll.
   * Failing to close costs bandwidth for a few seconds; forgetting something
   * the server is still sending loses a voice or a picture outright.
   */
  private async closeMids(mids: string[]): Promise<string[]> {
    if (mids.length === 0) return [];
    if (!this.subscriber || !this.subscriberSession) return [];

    try {
      await this.api("close", {
        session: this.subscriberSession,
        proof: this.subscriberProof,
        mids,
      });
    } catch (e) {
      console.warn(
        `[sfu] the media server would not close ${mids.length} track(s); ` +
          `trying again on the next poll`,
        e,
      );
      return [];
    }
    return mids.filter((mid) => this.incoming.has(mid));
  }

  private onTrack(e: RTCTrackEvent): void {
    const mid = e.transceiver.mid;
    const who = mid ? this.incoming.get(mid) : undefined;
    if (!who) {
      // Nothing to guess at. An unmapped track means the answer and the event
      // disagreed, which is a bug worth seeing rather than papering over.
      console.warn("[sfu] a track arrived on an unmapped mid", mid);
      return;
    }

    let bundle = this.media.get(who.peerId);
    if (!bundle) {
      bundle = { stream: new MediaStream(), screen: new MediaStream() };
      this.media.set(who.peerId, bundle);
    }

    const target = who.name === TRACK_NAMES.screen ? bundle.screen : bundle.stream;
    for (const t of target.getTracks()) {
      if (t.kind === e.track.kind && t.id !== e.track.id) target.removeTrack(t);
    }
    if (!target.getTracks().includes(e.track)) target.addTrack(e.track);

    // A fresh MediaStream per change, for the same reason the mesh path needs
    // one: a `<video>` holds srcObject by reference and never notices a stream
    // mutated underneath it.
    this.events.onMedia(who.peerId, {
      stream: new MediaStream(bundle.stream.getTracks()),
      screen: new MediaStream(bundle.screen.getTracks()),
    });

    e.track.onended = () => this.events.onMedia(who.peerId, {
      stream: new MediaStream(bundle.stream.getTracks()),
      screen: new MediaStream(bundle.screen.getTracks()),
    });

    // Before the first packet is played, not after the first gap is heard.
    if (who.name === TRACK_NAMES.mic) this.tuneAudio();
  }

  /**
   * Ask for a session, and keep the proof that it is ours.
   *
   * Session ids are public — everybody's publisher id is in every roster —
   * so the route will not act on one without the proof it issued alongside.
   * See the note at the top of `api/meet/[code]/sfu/route.ts`.
   */
  private async session(): Promise<{ id: string; proof: string }> {
    const res = await this.api("session", {});
    const id = res.sessionId;
    if (typeof id !== "string") throw new Error("The media server gave no session.");
    return { id, proof: typeof res.proof === "string" ? res.proof : "" };
  }

  /**
   * Everything both connections have moved, for the bill.
   *
   * Cumulative since the connection opened, not a rate: the server keeps the
   * larger of what it has and what arrives, so a reconnection that resets
   * these counters cannot make a church's total go backwards.
   */
  /**
   * What OUR OWN microphone is doing: is it hearing anything, and is any of it
   * leaving the machine?
   *
   * Two numbers from two different places, and the pair is the whole point.
   * `media-source` reports the energy the capture device is producing; the
   * outbound report says how many packets have actually gone. Sound going in
   * and nothing going out is a microphone that is working perfectly and is not
   * in the meeting — which is precisely what a host hit after starting a
   * recording, and nothing anywhere could tell them, because the People panel
   * reported this person's outgoing audio as a hardcoded zero on this
   * transport.
   *
   * `totalAudioEnergy` is cumulative and only rises when there is something to
   * hear, so comparing it against itself distinguishes "nobody is talking"
   * from "the microphone has been cut off" — which matters here, because DTX
   * means a silent room legitimately sends almost nothing.
   */
  async outgoingAudio(): Promise<{
    bytesSent: number;
    packetsSent: number;
    audioEnergy: number;
    audioLevel: number;
  } | null> {
    if (!this.publisher) return null;
    const out = { bytesSent: 0, packetsSent: 0, audioEnergy: 0, audioLevel: 0 };
    try {
      const report = await this.publisher.getStats();
      report.forEach((r) => {
        const x = r as unknown as Record<string, number | string>;
        if (x.type === "outbound-rtp" && x.kind === "audio") {
          out.bytesSent += Number(x.bytesSent ?? 0);
          out.packetsSent += Number(x.packetsSent ?? 0);
        }
        if (x.type === "media-source" && x.kind === "audio") {
          out.audioEnergy = Number(x.totalAudioEnergy ?? 0);
          out.audioLevel = Number(x.audioLevel ?? 0);
        }
      });
    } catch {
      // A connection that is closing has nothing to report, which is not a
      // fault and must not be read as a silent microphone.
      return null;
    }
    return out;
  }

  async totals(): Promise<{ received: number; sent: number }> {
    let received = 0;
    let sent = 0;
    for (const pc of [this.publisher, this.subscriber]) {
      if (!pc) continue;
      try {
        const report = await pc.getStats();
        report.forEach((r) => {
          const x = r as unknown as Record<string, number | string>;
          if (x.type === "inbound-rtp") received += Number(x.bytesReceived ?? 0);
          if (x.type === "outbound-rtp") sent += Number(x.bytesSent ?? 0);
        });
      } catch {
        /* a closing connection has nothing to report */
      }
    }
    return { received, sent };
  }

  /**
   * What is arriving from each person, for the People panel.
   *
   * This exists because a panel that goes blank on one transport is worse than
   * no panel at all: the whole reason last week's hunt ended was being able to
   * read bytes, frames and the element side by side, and an SFU room must not
   * lose that.
   *
   * Per receiver rather than per connection. Everybody arrives down ONE
   * subscriber connection here, so connection-level totals would say "video is
   * arriving" while being unable to say from whom — which is precisely the
   * question. `mid` is the join: the SFU told us which mid each person's track
   * landed on when we pulled it.
   */
  async diagnose(): Promise<Map<string, SfuPeerReading>> {
    const out = new Map<string, SfuPeerReading>();
    const sub = this.subscriber;
    if (!sub) return out;

    const now = Date.now();
    const ice = sub.iceConnectionState;

    const blank = (): SfuPeerReading => ({
      videoInKbps: 0,
      framesDecoded: 0,
      ice,
      audioInKbps: 0,
      audioLossPct: 0,
      audioConcealedPct: 0,
      audioJitterMs: 0,
      audioJitterBufferMs: 0,
    });

    for (const tr of sub.getTransceivers()) {
      const who = tr.mid ? this.incoming.get(tr.mid) : undefined;
      if (!who) continue;
      if (who.name !== TRACK_NAMES.camera && who.name !== TRACK_NAMES.mic) continue;

      const row = out.get(who.peerId) ?? blank();

      if (who.name === TRACK_NAMES.camera) {
        let bytes = 0;
        let frames = 0;
        try {
          const report = await tr.receiver.getStats();
          report.forEach((r) => {
            const x = r as unknown as Record<string, number | string>;
            if (x.type !== "inbound-rtp" || x.kind !== "video") return;
            bytes += Number(x.bytesReceived ?? 0);
            frames += Number(x.framesDecoded ?? 0);
          });
        } catch {
          continue;
        }

        const previous = this.lastVideoBytes.get(who.peerId);
        const seconds = previous ? (now - previous.at) / 1000 : 0;
        row.videoInKbps =
          seconds > 0
            ? Math.max(0, Math.round(((bytes - previous!.bytes) * 8) / seconds / 1000))
            : 0;
        row.framesDecoded = frames;
        this.lastVideoBytes.set(who.peerId, { at: now, bytes });
        out.set(who.peerId, row);
        continue;
      }

      /*
       * The voice. Exactly the figures the mesh path reports, so the People
       * panel reads the same on both transports — a diagnostic that works on
       * one and goes blank on the other is how a blind spot gets built, and
       * the SFU rooms are the big ones where somebody not being heard matters
       * most.
       */
      let bytes = 0;
      let packetsReceived = 0;
      let packetsLost = 0;
      let concealed = 0;
      let total = 0;
      let jitterMs = 0;
      let bufferMs = 0;
      try {
        const report = await tr.receiver.getStats();
        report.forEach((r) => {
          const x = r as unknown as Record<string, number | string>;
          if (x.type !== "inbound-rtp" || x.kind !== "audio") return;
          bytes += Number(x.bytesReceived ?? 0);
          packetsReceived += Number(x.packetsReceived ?? 0);
          packetsLost += Number(x.packetsLost ?? 0);
          /*
           * Silence subtracted. DTX means a listener sends nothing at all
           * while nobody speaks, and the player fills that with synthesised
           * silence, which the browser counts as concealment — so a healthy
           * quiet room would otherwise read as almost entirely broken.
           */
          concealed +=
            Number(x.concealedSamples ?? 0) - Number(x.silentConcealedSamples ?? 0);
          total += Number(x.totalSamplesReceived ?? 0);
          jitterMs = Math.max(jitterMs, Number(x.jitter ?? 0) * 1000);
          const delay = Number(x.jitterBufferDelay ?? 0);
          const emitted = Number(x.jitterBufferEmittedCount ?? 0);
          if (emitted > 0) bufferMs = Math.max(bufferMs, (delay / emitted) * 1000);
        });
      } catch {
        continue;
      }

      const was = this.lastAudio.get(who.peerId);
      const seconds = was ? (now - was.at) / 1000 : 0;
      const share = (curr: number, before: number, overCurr: number, overBefore: number) => {
        const top = Math.max(0, curr - before);
        const bottom = Math.max(0, overCurr - overBefore);
        return bottom > 0 ? Math.round((top / bottom) * 1000) / 10 : 0;
      };

      row.audioInKbps =
        seconds > 0
          ? Math.max(0, Math.round(((bytes - was!.bytes) * 8) / seconds / 1000))
          : 0;
      row.audioLossPct = was
        ? share(
            packetsLost,
            was.packetsLost,
            packetsLost + packetsReceived,
            was.packetsLost + was.packetsReceived,
          )
        : 0;
      row.audioConcealedPct = was
        ? share(concealed, was.concealedSamples, total, was.totalSamples)
        : 0;
      row.audioJitterMs = Math.round(jitterMs);
      row.audioJitterBufferMs = Math.round(bufferMs);

      this.lastAudio.set(who.peerId, {
        at: now,
        bytes,
        packetsReceived,
        packetsLost,
        concealedSamples: concealed,
        totalSamples: total,
      });
      out.set(who.peerId, row);
    }

    return out;
  }

  /**
   * Throw the publishing connection away so the next `setLocal` builds it again.
   *
   * Neither connection was ever rebuilt. A publisher that failed left this
   * person permanently mute with the pill saying "retrying", and a subscriber
   * that failed left them in a silent room — in both cases with nothing in the
   * code that could ever repair it.
   */
  private resetPublisher(): void {
    if (this.stopped) return;
    console.warn("[sfu] the publishing connection failed; rebuilding it");
    try {
      this.publisher?.close();
    } catch {
      /* already closed */
    }
    this.publisher = null;
    this.publisherSession = null;
    this.publisherProof = "";
    this.senders.clear();
    this.published = {};
    this.events.onError(
      "Your connection to the meeting dropped. Putting it back together.",
    );
  }

  /**
   * Throw the subscribing connection away, and forget everything pulled on it.
   *
   * The roster drives `sync`, so the next poll pulls the whole room again —
   * which is the right recovery, because the mids it was holding belonged to a
   * session that no longer exists.
   */
  private resetSubscriber(): void {
    if (this.stopped) return;
    console.warn("[sfu] the subscribing connection failed; rebuilding it");
    try {
      this.subscriber?.close();
    } catch {
      /* already closed */
    }
    this.subscriber = null;
    this.subscriberSession = null;
    this.subscriberProof = "";
    for (const [peerId] of this.media) this.events.onGone(peerId);
    this.media.clear();
    this.incoming.clear();
    this.pulled.clear();
    this.pullTries.clear();
    this.pullAfter.clear();
  }

  close(): void {
    this.stopped = true;
    for (const pc of [this.publisher, this.subscriber]) {
      try {
        pc?.close();
      } catch {
        /* already closed */
      }
    }
    this.publisher = null;
    this.subscriber = null;
    this.media.clear();
    this.incoming.clear();
    this.pulled.clear();
    this.pullTries.clear();
    this.pullAfter.clear();
    this.senders.clear();
    this.lastAudio.clear();
    this.lastVideoBytes.clear();
  }
}
