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

  const audioBuf = await loadBuffer(audioCtx, trackId);

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuf;

  // Light overall gain ride with fade-in and fade-out so the cut is clean
  const gain = audioCtx.createGain();
  const startAt = audioCtx.currentTime + 0.03;
  const fadeIn = 0.12;
  const fadeOut = 0.6;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(1.0, startAt + fadeIn);
  gain.gain.setValueAtTime(1.0, startAt + durationS - fadeOut);
  gain.gain.linearRampToValueAtTime(0, startAt + durationS);

  source.connect(gain).connect(destination);

  // Play first `durationS` seconds (offset=0, duration=durationS)
  source.start(startAt, 0, durationS);

  const stop = () => {
    try {
      source.stop();
    } catch {
      // already stopped or not yet started — ignore
    }
    try {
      audioCtx.close();
    } catch {
      // ignore
    }
  };

  return { destination, audioCtx, stop };
}
