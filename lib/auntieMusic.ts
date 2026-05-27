// Plays the first N seconds of a chosen audio file and routes it into a
// MediaStream so MediaRecorder can mux it with the canvas video.
//
// The source is NOT started until the caller invokes `start()`. This lets the
// caller align audio playback with `MediaRecorder.start()` for tight A/V sync.
//
// iOS Safari refuses to resume an AudioContext if the originating user
// gesture has gone stale across long awaits (e.g. bg-removal). To work around
// that, callers can pre-create + resume() an AudioContext synchronously
// inside the gesture and pass it in as `sharedCtx`; we reuse it across
// renders instead of constructing a fresh one each time.

export type TrackId = "mere-aaqa" | "mubarak-eid";

export type AuntieAudio = {
  destination: MediaStreamAudioDestinationNode;
  audioCtx: AudioContext;
  start: () => void;
  stop: () => void;
  // True when the requested track was successfully fetched + decoded.
  // False when we fell back to a silent path (e.g. 404 on deploy, or iOS
  // refusing to resume an AudioContext).
  hasAudio: boolean;
};

// Optionally point the app at a remote CDN by setting
// NEXT_PUBLIC_AUDIO_BASE_URL at build time (e.g. https://cdn.example.com/eid).
// Falls back to the bundled /music path.
const AUDIO_BASE =
  (typeof process !== "undefined" &&
    process.env?.NEXT_PUBLIC_AUDIO_BASE_URL) ||
  "/music";

const TRACK_PATHS: Record<TrackId, string> = {
  "mere-aaqa": `${AUDIO_BASE}/mere-aaqa.mp3`,
  "mubarak-eid": `${AUDIO_BASE}/mubarak-eid.mp3`,
};

// AudioBuffers are tied to a context but most browsers (including Safari)
// happily reuse a buffer across contexts. We key the cache by the context
// instance to avoid the case where a closed context's buffer is reused on a
// fresh context where the sample rate differs.
const bufferCache = new WeakMap<AudioContext, Map<TrackId, AudioBuffer>>();

async function loadBuffer(
  audioCtx: AudioContext,
  trackId: TrackId,
): Promise<AudioBuffer> {
  let perCtx = bufferCache.get(audioCtx);
  if (!perCtx) {
    perCtx = new Map();
    bufferCache.set(audioCtx, perCtx);
  }
  const cached = perCtx.get(trackId);
  if (cached) return cached;

  const res = await fetch(TRACK_PATHS[trackId]);
  if (!res.ok) throw new Error(`Couldn't load audio: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  perCtx.set(trackId, audioBuf);
  return audioBuf;
}

export async function buildAuntieAudio(
  trackId: TrackId,
  durationS: number,
  sharedCtx?: AudioContext | null,
): Promise<AuntieAudio> {
  // Prefer the page-managed context (already resumed inside a fresh gesture).
  // Fall back to creating our own only if no shared one is passed.
  let audioCtx: AudioContext;
  let ownsCtx = false;
  if (sharedCtx && sharedCtx.state !== "closed") {
    audioCtx = sharedCtx;
  } else {
    const AC: typeof AudioContext =
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ?? AudioContext;
    audioCtx = new AC();
    ownsCtx = true;
  }
  // Best-effort resume. On iOS Safari this only succeeds if the gesture is
  // still fresh — otherwise the context stays suspended. We detect that
  // below and degrade to silent rather than ship a broken audio track.
  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch {
      /* still try to use the context — start() may fail silently */
    }
  }
  const destination = audioCtx.createMediaStreamDestination();

  let started = false;
  let startFn = () => {};
  let stopFn = () => {};
  let hasAudio = false;

  // If iOS refused to resume and the context is still suspended, scheduling
  // source.start() against a stuck clock produces no audio data — and on
  // some Safari versions makes MediaRecorder hang waiting for samples. Skip
  // the music path entirely in that case.
  const contextLive = audioCtx.state === "running";

  try {
    if (!contextLive) {
      throw new Error("audio context not running (gesture likely stale)");
    }
    const audioBuf = await loadBuffer(audioCtx, trackId);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuf;

    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(destination);

    hasAudio = true;

    startFn = () => {
      const startAt = audioCtx.currentTime + 0.005;
      const fadeIn = 0.12;
      const fadeOut = 0.6;
      gain.gain.cancelScheduledValues(0);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(1.0, startAt + fadeIn);
      gain.gain.setValueAtTime(1.0, startAt + durationS - fadeOut);
      gain.gain.linearRampToValueAtTime(0, startAt + durationS);
      source.start(startAt, 0, durationS);
    };

    stopFn = () => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
    };
  } catch (e) {
    console.warn(`[auntifyeid] couldn't set up track "${trackId}":`, e);
    // Silent fallback so the audio track on the recorder stays valid.
    const silentOsc = audioCtx.createOscillator();
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    silentOsc.connect(silentGain).connect(destination);

    startFn = () => {
      try {
        silentOsc.start();
      } catch {
        /* ignore — context may not be running */
      }
    };
    stopFn = () => {
      try {
        silentOsc.stop();
      } catch {
        /* ignore */
      }
      try {
        silentOsc.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  return {
    destination,
    audioCtx,
    hasAudio,
    start: () => {
      if (started) return;
      started = true;
      startFn();
    },
    stop: () => {
      stopFn();
      // Only close the context if WE created it. If the caller passed in a
      // shared one, they own its lifecycle.
      if (ownsCtx) {
        try {
          audioCtx.close();
        } catch {
          /* ignore */
        }
      } else {
        // Disconnect the destination so we don't leak nodes on the shared
        // context across renders.
        try {
          destination.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
