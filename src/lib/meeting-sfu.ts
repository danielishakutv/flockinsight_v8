import {
  TRACK_NAMES,
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

type PulledTrack = { peerId: string; name: string };

/** What we are currently sending, so a change can be compared against it. */
type Published = { mic?: string; cam?: string; screen?: string };

export class SfuTransport {
  private publisher: RTCPeerConnection | null = null;
  private subscriber: RTCPeerConnection | null = null;

  private publisherSession: string | null = null;
  private subscriberSession: string | null = null;

  /** Our own sendonly transceivers, by track name. */
  private senders = new Map<string, RTCRtpTransceiver>();
  private published: Published = {};

  /** `mid` -> whose track it is. Filled in from the SFU's own answer. */
  private incoming = new Map<string, PulledTrack>();
  /** What we have already asked for, so a poll does not re-pull every tick. */
  private pulled = new Set<string>();

  /** Per-peer media, assembled as tracks arrive. */
  private media = new Map<string, { stream: MediaStream; screen: MediaStream }>();

  /** Previous byte totals per peer, for turning them into a rate. */
  private lastVideoBytes = new Map<string, { at: number; bytes: number }>();

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
    private readonly events: SfuEvents,
  ) {}

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
        this.publisher = this.pc();
        this.publisher.onconnectionstatechange = () => {
          if (this.publisher) this.events.onState(this.publisher.connectionState);
        };
        this.publisherSession = await this.session();
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
        sdp: {
          type: "offer",
          sdp: this.publisher.localDescription?.sdp ?? "",
        },
        tracks: payload,
      });

      const answer = res.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (answer?.sdp) await this.publisher.setRemoteDescription(answer);
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
          wanted.push({ sessionId: r.sfuSessionId as string, trackName: name });
          record.push({ peerId: r.peerId, name });
        }
      }

      if (wanted.length === 0) return;

      if (!this.subscriber) {
        this.subscriber = this.pc();
        this.subscriber.ontrack = (e) => this.onTrack(e);
        this.subscriberSession = await this.session();
      }

      let res: Record<string, unknown>;
      try {
        res = await this.api("pull", {
          session: this.subscriberSession,
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
        if (t.error || !t.mid) return;

        if (t.trackName && t.trackName !== who.name) {
          // Order and names disagreeing means an assumption here is wrong, and
          // silently mis-routing somebody's camera is the expensive outcome.
          console.warn("[sfu] pull result out of order", t.trackName, who.name);
          return;
        }

        // Marked only now, having actually been allocated a mid.
        this.pulled.add(`${who.peerId}:${who.name}`);
        this.incoming.set(t.mid, who);
      });

      const offer = res.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (!offer?.sdp) return;

      await this.subscriber.setRemoteDescription(offer);
      const answer = await this.subscriber.createAnswer();
      await this.subscriber.setLocalDescription(answer);
      await this.gathered(this.subscriber);

      await this.api("renegotiate", {
        session: this.subscriberSession,
        sdp: {
          type: "answer",
          sdp: this.subscriber.localDescription?.sdp ?? "",
        },
      });
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
  private async dropUnwatched(live: Set<string>): Promise<void> {
    if (this.videoInterest === null || !this.subscriber || !this.subscriberSession) {
      return;
    }

    const mids: string[] = [];
    for (const [mid, who] of this.incoming) {
      if (who.name !== TRACK_NAMES.camera) continue;
      if (!live.has(who.peerId)) continue;
      if (this.videoInterest.has(who.peerId)) continue;
      mids.push(mid);
    }
    if (mids.length === 0) return;

    try {
      await this.api("close", { session: this.subscriberSession, mids });
    } catch {
      // Leave everything as it is and try again on the next poll. Failing to
      // close costs bandwidth; getting the bookkeeping wrong loses a picture.
      return;
    }

    for (const mid of mids) {
      const who = this.incoming.get(mid);
      if (!who) continue;
      this.incoming.delete(mid);
      // Forget it, so coming back on screen pulls it again.
      this.pulled.delete(`${who.peerId}:${who.name}`);

      const bundle = this.media.get(who.peerId);
      if (!bundle) continue;
      for (const t of bundle.stream.getVideoTracks()) bundle.stream.removeTrack(t);
      this.events.onMedia(who.peerId, {
        stream: new MediaStream(bundle.stream.getTracks()),
        screen: new MediaStream(bundle.screen.getTracks()),
      });
    }
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
  }

  private async session(): Promise<string> {
    const res = await this.api("session", {});
    const id = res.sessionId;
    if (typeof id !== "string") throw new Error("The media server gave no session.");
    return id;
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
  async diagnose(): Promise<
    Map<string, { videoInKbps: number; framesDecoded: number; ice: RTCIceConnectionState }>
  > {
    const out = new Map<
      string,
      { videoInKbps: number; framesDecoded: number; ice: RTCIceConnectionState }
    >();
    const sub = this.subscriber;
    if (!sub) return out;

    const now = Date.now();
    const ice = sub.iceConnectionState;

    for (const tr of sub.getTransceivers()) {
      const who = tr.mid ? this.incoming.get(tr.mid) : undefined;
      if (!who || who.name !== TRACK_NAMES.camera) continue;

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
      const kbps =
        seconds > 0
          ? Math.max(0, Math.round(((bytes - previous!.bytes) * 8) / seconds / 1000))
          : 0;
      this.lastVideoBytes.set(who.peerId, { at: now, bytes });

      out.set(who.peerId, { videoInKbps: kbps, framesDecoded: frames, ice });
    }

    return out;
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
    this.senders.clear();
  }
}
