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

const bufferCache = new Map<TrackId, AudioBuffer>();

async function loadBuffer(
  audioCtx: AudioContext,
  trackId: TrackId,
): Promise<AudioBuffer> {
  const cached = bufferCache.get(trackId);
  if (cached) return cached;

  const res = await fetch(TRACK_PATHS[trackId]);
  if (!res.ok) throw new Error(`Couldn't load audio: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  bufferCache.set(trackId, audioBuf);
  return audioBuf;
}

export async function buildAuntieAudio(
  trackId: TrackId,
  durationS: number,
): Promise<AuntieAudio> {
  const AC: typeof AudioContext =
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ?? AudioContext;
  const audioCtx = new AC();
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
        audioCtx.close();
      } catch {
        /* ignore */
      }
    },
  };
}
