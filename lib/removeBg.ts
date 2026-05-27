import { removeBackground } from "@imgly/background-removal";
import { prepareImage } from "./imagePrep";

// Hard cap on bg removal — covers a stalled WASM model download on a flaky
// connection (the model is ~10MB and otherwise has no timeout of its own).
const REMOVE_BG_TIMEOUT_MS = 120_000;

export async function cutOutSubject(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ImageBitmap> {
  // Always pre-process: HEIC → JPEG, downscale to a sane resolution. Skipping
  // this is the #1 cause of "stuck at 100% then dies" reports on iPhone,
  // where multi-megapixel HEIC photos blow up canvas/WASM memory.
  const prepared = await prepareImage(file);

  // The library reports progress as discrete per-phase events:
  //   fetch:<file>  current/total   (one stream per model file)
  //   compute:decode|inference|mask|encode  current/4
  // Each phase resets to 0 when the previous one ends, so a naive
  // `onProgress(current/total)` makes the bar flash to 100% then drop to 0
  // — and our UI treats 0% as "indeterminate spin", producing the
  // 100% → spinner → 100% → spinner sequence users see. We aggregate into
  // a single monotonic value: fetch fills 0..0.55, compute fills 0.55..1.0.
  const aggregator = onProgress ? makeProgressAggregator(onProgress) : undefined;

  const bgPromise = removeBackground(prepared, {
    // fp16 model: ~half the download (~20MB vs ~40MB) and half the runtime
    // tensor memory of the default isnet. Quality difference is invisible at
    // our render scale (subject is drawn at ≤900px tall). This is the single
    // most effective lever for "stuck at 57% on iPhone" reports — older
    // devices hit Safari's per-tab memory ceiling with the full-precision
    // model and get killed mid-inference with no surfaced error.
    model: "isnet_fp16",
    output: { format: "image/png", quality: 0.9 },
    progress: aggregator,
  });

  const blob = await withTimeout(
    bgPromise,
    REMOVE_BG_TIMEOUT_MS,
    "Background removal took too long. Check your connection and try again.",
  );

  // createImageBitmap of small-to-moderate PNGs is reliable everywhere; we
  // already capped the prepared image at 1800px on the long edge, so this
  // bitmap stays well under the iOS Safari canvas limit.
  return await createImageBitmap(blob);
}

export function findAlphaBounds(bitmap: ImageBitmap): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  let found = false;
  // adaptive stride: stays under ~250k samples regardless of image size
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / 250000)));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Wraps an onProgress(0..1) callback so:
//   - fetch and compute phases are weighted into one bar (fetch = 0..0.55,
//     compute = 0.55..1.0). Cached runs skip fetch and jump straight into
//     the compute range.
//   - the value is monotonically non-decreasing, so a phase finishing at
//     100% is never followed by a drop back to 0%.
//   - multiple in-flight fetch keys are aggregated by sum(current)/sum(total),
//     so the model's parallel file downloads don't fight each other.
function makeProgressAggregator(
  onProgress: (pct: number) => void,
): (key: string, current: number, total: number) => void {
  const fetchTotals = new Map<string, { current: number; total: number }>();
  let lastReported = 0;
  let computeReached = false;
  // First emit at the very start so the UI leaves its "indeterminate" state
  // (which keys off pct === 0) as soon as bg-removal really begins.
  onProgress(0.01);
  lastReported = 0.01;
  return (key: string, current: number, total: number) => {
    if (!key || total <= 0) return;
    let next = lastReported;
    if (key.startsWith("fetch:") && !computeReached) {
      fetchTotals.set(key, {
        current: Math.min(current, total),
        total,
      });
      let sumCur = 0;
      let sumTot = 0;
      for (const v of fetchTotals.values()) {
        sumCur += v.current;
        sumTot += v.total;
      }
      const fetchFrac = sumTot > 0 ? sumCur / sumTot : 0;
      // Cap fetch at 0.55 so we never hit 100% before compute even starts.
      next = Math.min(0.55, fetchFrac * 0.55);
    } else if (key.startsWith("compute:")) {
      computeReached = true;
      const computeFrac = Math.min(1, current / total);
      next = 0.55 + computeFrac * 0.45;
    }
    if (next > lastReported) {
      lastReported = next;
      onProgress(Math.min(1, lastReported));
    }
  };
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
