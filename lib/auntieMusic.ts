// Plays the first N seconds of a chosen audio file and routes it into a
// MediaStream so MediaRecorder can mux it with the canvas video.

export type TrackId = "mere-aaqa" | "mubarak-eid";

export type AuntieAudio = {
  destination: MediaStreamAudioDestinationNode;
  audioCtx: AudioContext;
  stop: () => void;
};

const TRACK_PATHS: Record<TrackId, string> = {
  "mere-aaqa": "/music/mere-aaqa.mp3",
  "mubarak-eid": "/music/mubarak-eid.mp3",
};

// Cache decoded AudioBuffers in-memory so re-renders (style swaps, track swaps)
// don't re-fetch and re-decode the same multi-megabyte mp3.
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

  // If the audio file fails to load for any reason (404 on the deployed
  // version, network hiccup, decode error), we DO NOT block video rendering.
  // The destination stays connected to a silent path; the recorder still gets
  // an audio track, just with no signal. That's far better than throwing.
  let stopSource: (() => void) | null = null;
  try {
    const audioBuf = await loadBuffer(audioCtx, trackId);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuf;

    const gain = audioCtx.createGain();
    const startAt = audioCtx.currentTime + 0.03;
    const fadeIn = 0.12;
    const fadeOut = 0.6;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(1.0, startAt + fadeIn);
    gain.gain.setValueAtTime(1.0, startAt + durationS - fadeOut);
    gain.gain.linearRampToValueAtTime(0, startAt + durationS);

    source.connect(gain).connect(destination);
    source.start(startAt, 0, durationS);

    stopSource = () => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    };
  } catch (e) {
    console.warn(`[auntifyeid] couldn't load track "${trackId}":`, e);
    // Keep an oscillator at 0 gain so the audio track has a steady signal
    const silentOsc = audioCtx.createOscillator();
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    silentOsc.connect(silentGain).connect(destination);
    silentOsc.start();
    stopSource = () => {
      try {
        silentOsc.stop();
      } catch {
        /* ignore */
      }
    };
  }

  const stop = () => {
    if (stopSource) stopSource();
    try {
      audioCtx.close();
    } catch {
      /* ignore */
    }
  };

  return { destination, audioCtx, stop };
}
