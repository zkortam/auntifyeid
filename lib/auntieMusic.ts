// Plays the first N seconds of a chosen audio file and routes it into a
// MediaStream so MediaRecorder can mux it with the canvas video.
//
// The source is NOT started until the caller invokes `start()`. This lets the
// caller align audio playback with `MediaRecorder.start()` for tight A/V sync.

export type TrackId = "mere-aaqa" | "mubarak-eid";

export type AuntieAudio = {
  destination: MediaStreamAudioDestinationNode;
  audioCtx: AudioContext;
  start: () => void;
  stop: () => void;
  // True when the requested track was successfully fetched + decoded.
  // False when we fell back to a silent path (e.g. 404 on deploy).
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

// Module-singleton context. iOS Safari is strict about AudioContext gestures:
// a context created after several awaits past the user's tap is born in
// "suspended" state and `resume()` rejects silently. We instead create the
// context once, ideally inside the user's upload gesture via `primeAudio()`,
// then reuse it for every render in the session.
let sharedCtx: AudioContext | null = null;
const bufferCache = new Map<TrackId, AudioBuffer>();

function getCtx(): AudioContext {
  if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
  const AC: typeof AudioContext =
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ?? AudioContext;
  sharedCtx = new AC();
  return sharedCtx;
}

// Call this from a click/drop handler so iOS Safari registers the gesture as
// belonging to the AudioContext. Safe to call multiple times.
export function primeAudio(): void {
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") {
      // Fire-and-forget. If we have a live gesture this resolves quickly; if
      // we don't, this rejects silently and we cope with it later.
      void ctx.resume();
    }
  } catch {
    /* best effort */
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function loadBuffer(
  audioCtx: AudioContext,
  trackId: TrackId,
): Promise<AudioBuffer> {
  const cached = bufferCache.get(trackId);
  if (cached) return cached;

  const res = await fetchWithTimeout(TRACK_PATHS[trackId], 30_000);
  if (!res.ok) throw new Error(`Couldn't load audio: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();

  // Safari's decodeAudioData uses callback signature on older versions and
  // has been known to hang on certain MP3 encodings. We race it against a
  // timeout so a bad file can't pin the whole render.
  const audioBuf = await new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Audio decode timed out."));
    }, 15_000);
    const ok = (b: AudioBuffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(b);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      reject(e instanceof Error ? e : new Error("Audio decode failed."));
    };
    try {
      const maybePromise = audioCtx.decodeAudioData(arrayBuf, ok, fail);
      if (maybePromise && typeof (maybePromise as Promise<AudioBuffer>).then === "function") {
        (maybePromise as Promise<AudioBuffer>).then(ok, fail);
      }
    } catch (e) {
      fail(e);
    }
  });

  bufferCache.set(trackId, audioBuf);
  return audioBuf;
}

export async function buildAuntieAudio(
  trackId: TrackId,
  durationS: number,
): Promise<AuntieAudio> {
  const audioCtx = getCtx();
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

  try {
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
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
  } catch (e) {
    console.warn(`[auntifyeid] couldn't load track "${trackId}":`, e);
    // Silent fallback so the audio track on the recorder stays valid.
    const silentOsc = audioCtx.createOscillator();
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    silentOsc.connect(silentGain).connect(destination);

    startFn = () => {
      silentOsc.start();
    };
    stopFn = () => {
      try {
        silentOsc.stop();
      } catch {
        /* ignore */
      }
      try {
        silentOsc.disconnect();
        silentGain.disconnect();
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
      try {
        destination.disconnect();
      } catch {
        /* ignore */
      }
      // Intentionally do NOT close audioCtx — we share it across renders so
      // the iOS user-gesture authorisation we captured at upload time is
      // still valid for the next variant the user picks.
    },
  };
}
