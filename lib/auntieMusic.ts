// Synthesized "Eid Mubarak Mubarak" loop via WebAudio.
// Tinny phone-speaker character (lowpass + bandpass), simple maqam-flavored
// melody, tabla-like beats, sparkle bells, soft drone underneath.
//
// Returns a MediaStreamAudioDestinationNode so the audio track can be
// combined with a canvas captureStream and fed into MediaRecorder.

export type AuntieAudio = {
  destination: MediaStreamAudioDestinationNode;
  audioCtx: AudioContext;
  stop: () => void;
};

const D3 = 146.83;
const D4 = 293.66;
const F4 = 349.23;
const G4 = 392.0;
const A4 = 440.0;
const Bb4 = 466.16;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const F5 = 698.46;

type Note = { t: number; dur: number; f: number; vel?: number };

// The melodic gesture: "Eid... Mu-ba-rak" three syllables descending,
// repeated four times, climbing the scale before resolving down.
function buildMelody(): Note[] {
  return [
    // "Eid Mu-ba-rak" x1 (mid)
    { t: 0.0, dur: 0.42, f: A4, vel: 0.55 },
    { t: 0.5, dur: 0.18, f: G4, vel: 0.5 },
    { t: 0.72, dur: 0.18, f: F4, vel: 0.5 },
    { t: 0.94, dur: 0.4, f: G4, vel: 0.55 },

    // "Eid Mu-ba-rak" x2 (higher)
    { t: 1.55, dur: 0.42, f: C5, vel: 0.6 },
    { t: 2.05, dur: 0.18, f: Bb4, vel: 0.55 },
    { t: 2.27, dur: 0.18, f: A4, vel: 0.55 },
    { t: 2.49, dur: 0.4, f: Bb4, vel: 0.6 },

    // "Eid Mu-ba-rak" x3 (peak)
    { t: 3.1, dur: 0.42, f: D5, vel: 0.65 },
    { t: 3.6, dur: 0.18, f: F5, vel: 0.55 },
    { t: 3.82, dur: 0.18, f: E5, vel: 0.55 },
    { t: 4.04, dur: 0.5, f: D5, vel: 0.65 },

    // "Mu-ba-rak" trailing resolve
    { t: 4.7, dur: 0.3, f: C5, vel: 0.55 },
    { t: 5.02, dur: 0.3, f: Bb4, vel: 0.5 },
    { t: 5.34, dur: 0.66, f: A4, vel: 0.55 },
  ];
}

function buildHarmony(): Note[] {
  // a parallel 4th below the melody for the "phone speaker call to prayer" feel
  return [
    { t: 0.0, dur: 0.42, f: F4, vel: 0.22 },
    { t: 0.94, dur: 0.4, f: D4, vel: 0.2 },

    { t: 1.55, dur: 0.42, f: G4, vel: 0.22 },
    { t: 2.49, dur: 0.4, f: F4, vel: 0.22 },

    { t: 3.1, dur: 0.42, f: A4, vel: 0.24 },
    { t: 4.04, dur: 0.5, f: G4, vel: 0.24 },

    { t: 4.7, dur: 0.3, f: G4, vel: 0.2 },
    { t: 5.34, dur: 0.66, f: F4, vel: 0.22 },
  ];
}

function scheduleVoice(
  audioCtx: AudioContext,
  out: AudioNode,
  notes: Note[],
  startAt: number,
  oscType: OscillatorType = "triangle",
) {
  for (const n of notes) {
    const t0 = startAt + n.t;
    const t1 = t0 + n.dur;

    const osc = audioCtx.createOscillator();
    osc.type = oscType;
    osc.frequency.value = n.f;

    // a quieter octave-up sine for shimmer
    const harm = audioCtx.createOscillator();
    harm.type = "sine";
    harm.frequency.value = n.f * 2;
    const harmGain = audioCtx.createGain();
    harmGain.gain.value = 0.18;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(n.vel ?? 0.5, t0 + 0.025);
    env.gain.setValueAtTime(n.vel ?? 0.5, t1 - 0.06);
    env.gain.exponentialRampToValueAtTime(0.0005, t1);

    osc.connect(env);
    harm.connect(harmGain).connect(env);
    env.connect(out);

    osc.start(t0);
    harm.start(t0);
    osc.stop(t1 + 0.05);
    harm.stop(t1 + 0.05);
  }
}

function scheduleTabla(
  audioCtx: AudioContext,
  out: AudioNode,
  startAt: number,
  durationS: number,
) {
  // tabla-like bandpass-filtered noise burst on 1, 2, 3, 4 of each second
  const beats = Math.floor(durationS * 2);
  for (let i = 0; i < beats; i++) {
    const t = startAt + i * 0.5;
    const len = Math.floor(audioCtx.sampleRate * 0.18);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < len; j++) {
      d[j] = (Math.random() * 2 - 1) * Math.exp((-j / len) * 9);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;

    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    const downbeat = i % 2 === 0;
    bp.frequency.value = downbeat ? 95 : 220;
    bp.Q.value = 7;

    const g = audioCtx.createGain();
    g.gain.value = downbeat ? 0.55 : 0.3;

    src.connect(bp).connect(g).connect(out);
    src.start(t);
  }
}

function scheduleSparkles(
  audioCtx: AudioContext,
  out: AudioNode,
  startAt: number,
  durationS: number,
) {
  // little bell shimmers — fast sine pings in the high register
  const count = 28;
  for (let i = 0; i < count; i++) {
    const t = startAt + Math.random() * (durationS - 0.4);
    const f = 1800 + Math.random() * 2800;
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.08, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + 0.4);
  }
}

function scheduleDrone(
  audioCtx: AudioContext,
  out: AudioNode,
  startAt: number,
  durationS: number,
) {
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = D3;

  const fifth = audioCtx.createOscillator();
  fifth.type = "sine";
  fifth.frequency.value = D3 * 1.5; // perfect 5th

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0, startAt);
  env.gain.linearRampToValueAtTime(0.16, startAt + 0.5);
  env.gain.setValueAtTime(0.16, startAt + durationS - 1.0);
  env.gain.exponentialRampToValueAtTime(0.001, startAt + durationS);

  const fifthGain = audioCtx.createGain();
  fifthGain.gain.value = 0.45;

  osc.connect(env);
  fifth.connect(fifthGain).connect(env);
  env.connect(out);

  osc.start(startAt);
  fifth.start(startAt);
  osc.stop(startAt + durationS + 0.1);
  fifth.stop(startAt + durationS + 0.1);
}

export function buildAuntieAudio(durationS: number): AuntieAudio {
  // Resilient cross-browser AudioContext lookup
  const AC: typeof AudioContext =
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ?? AudioContext;
  const audioCtx = new AC();

  const destination = audioCtx.createMediaStreamDestination();

  // Master chain: master -> tinny lowpass -> destination
  const master = audioCtx.createGain();
  master.gain.value = 0.26;

  const tinny = audioCtx.createBiquadFilter();
  tinny.type = "lowpass";
  tinny.frequency.value = 3600;
  tinny.Q.value = 0.65;

  // gentle highpass to keep it from getting muddy
  const hp = audioCtx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 60;

  master.connect(tinny).connect(hp).connect(destination);

  // Schedule everything starting ~30ms in the future so all setValueAtTime calls
  // land safely in the future relative to audioCtx.currentTime
  const startAt = audioCtx.currentTime + 0.03;

  scheduleDrone(audioCtx, master, startAt, durationS);
  scheduleVoice(audioCtx, master, buildMelody(), startAt, "triangle");
  scheduleVoice(audioCtx, master, buildHarmony(), startAt, "sine");
  scheduleTabla(audioCtx, master, startAt, durationS);
  scheduleSparkles(audioCtx, master, startAt, durationS);

  const stop = () => {
    try {
      audioCtx.close();
    } catch {
      // ignore
    }
  };

  return { destination, audioCtx, stop };
}
