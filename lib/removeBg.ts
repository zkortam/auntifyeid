import { removeBackground } from "@imgly/background-removal";

export async function cutOutSubject(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ImageBitmap> {
  const blob = await removeBackground(file, {
    output: { format: "image/png", quality: 0.9 },
    progress: onProgress
      ? (_key, current, total) => {
          if (total > 0) onProgress(Math.min(1, current / total));
        }
      : undefined,
  });
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
