// Normalise an uploaded photo before it ever reaches the bg-removal model.
//
// This is the single highest-impact fix for the iPhone failure mode where
// upload progress reaches 100% and then either silently stalls or errors out.
// Two compounding causes:
//
//   1. iPhone photos default to HEIC and are 12–48 megapixels. Some upstream
//      decoders choke on HEIC and even when they don't, allocating full RGBA
//      buffers + the WASM model + multiple offscreen canvases easily exceeds
//      iOS Safari's per-tab memory budget. The tab gets killed and reloads
//      with no surface error.
//   2. createImageBitmap of large or HEIC blobs is patchy across browsers
//      (Safari in particular). Routing through a real <img> element is the
//      one decode path Safari handles reliably for every photo format it
//      supports system-wide.
//
// We always re-encode through canvas so the downstream pipeline only ever
// sees a moderate-size JPEG, regardless of what the user threw at us.

const MAX_EDGE = 1800;
const JPEG_QUALITY = 0.92;
const DECODE_TIMEOUT_MS = 25_000;

export async function prepareImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageWithTimeout(url, DECODE_TIMEOUT_MS);
    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) {
      throw new Error("Couldn't read that image. Try a JPG, PNG, or HEIC.");
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This browser can't process images. Try Safari or Chrome.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // White matte under the photo so JPEG re-encoding of formats with
    // transparency doesn't pick up black backgrounds.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);

    const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
    if (!blob || blob.size === 0) {
      throw new Error("Couldn't read that image. Try a JPG or PNG.");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImageWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("Image took too long to load. Try a smaller photo."));
    }, timeoutMs);
    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      // decode() flushes the decode pipeline so the bitmap is fully ready
      // before we draw it. Safari historically races onload vs. decoded
      // pixels on big HEIC images and ends up drawing a blank.
      if (typeof img.decode === "function") {
        img.decode().then(() => resolve(img)).catch(() => resolve(img));
      } else {
        resolve(img);
      }
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(new Error("Couldn't decode that image. Try a JPG or PNG."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });
}
