import { removeBackground } from "@imgly/background-removal";

// Modern iPhone photos are 12 MP+ (4032×3024). Pushing that through the
// bg-removal WASM model plus a full-size `getImageData` readback eats
// hundreds of MB of canvas memory — iOS Safari silently truncates or
// crashes the tab on devices with tight memory budgets. We never render the
// subject taller than ~900 px in the final video, so anything above this
// max is wasted pixels.
const MAX_INPUT_DIM = 2048;

// Hard ceiling for the whole bg-removal step (model fetch + inference). The
// first-time download is 40-80 MB; on a slow LTE connection that can take
// 30-60 s. 90 s gives plenty of headroom while still rescuing users from a
// genuinely wedged session instead of leaving them stuck "forever".
const BG_TIMEOUT_MS = 90_000;

async function downscaleIfNeeded(file: File): Promise<File | Blob> {
  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(file);
  } catch {
    // If we can't decode the file for sizing, pass it through — the
    // bg-removal library has its own loader that may still handle it (or
    // fail with a clearer error).
    return file;
  }
  const maxSide = Math.max(probe.width, probe.height);
  if (maxSide <= MAX_INPUT_DIM) {
    probe.close();
    return file;
  }
  const scale = MAX_INPUT_DIM / maxSide;
  const w = Math.round(probe.width * scale);
  const h = Math.round(probe.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    probe.close();
    return file;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(probe, 0, 0, w, h);
  probe.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode downscaled image"))),
      "image/jpeg",
      0.92,
    );
  });
}

export async function cutOutSubject(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ImageBitmap> {
  const input = await downscaleIfNeeded(file);

  // Race the model against a hard timeout so a stuck network or wedged
  // browser tab surfaces as a user-facing error instead of an indefinite
  // "Removing background" spinner.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () =>
        reject(
          new Error(
            "Background removal took too long. Check your connection and try again, or try a smaller photo.",
          ),
        ),
      BG_TIMEOUT_MS,
    );
  });
  const work = removeBackground(input, {
    output: { format: "image/png", quality: 0.9 },
    progress: onProgress
      ? (_key, current, total) => {
          if (total > 0) onProgress(Math.min(1, current / total));
        }
      : undefined,
  });
  let blob: Blob;
  try {
    blob = (await Promise.race([work, timeout])) as Blob;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
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
