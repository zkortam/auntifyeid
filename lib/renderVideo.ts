import { findAlphaBounds } from "./removeBg";
import { buildAuntieAudio, type TrackId } from "./auntieMusic";

export type TemplateId = "gold-mosque" | "rose-garden" | "starry-night";
export type AspectRatio = "1:1" | "9:16" | "4:5";
export type { TrackId } from "./auntieMusic";

const FPS = 30;
const DURATION_MS = 15000;
const DURATION_S = DURATION_MS / 1000;

/* ---------- layout per aspect ---------- */

type Layout = {
  W: number;
  H: number;
  titleY: number;
  titleSize: number;
  arabicY: number;
  arabicSize: number;
  heroX: number;
  heroY: number;
  heroHeight: number;
  cloneRadius: number;
  cloneScale: number;
  duaY: number;
  duaSize: number;
  translationY: number;
  translationSize: number;
  watermarkPad: number;
};

const LAYOUTS: Record<AspectRatio, Layout> = {
  "1:1": {
    W: 1080,
    H: 1080,
    titleY: 140,
    titleSize: 116,
    arabicY: 250,
    arabicSize: 64,
    heroX: 540,
    heroY: 600,
    heroHeight: 520,
    cloneRadius: 380,
    cloneScale: 0.32,
    duaY: 940,
    duaSize: 56,
    translationY: 1010,
    translationSize: 24,
    watermarkPad: 22,
  },
  "9:16": {
    W: 1080,
    H: 1920,
    titleY: 230,
    titleSize: 178,
    arabicY: 440,
    arabicSize: 92,
    heroX: 540,
    heroY: 1000,
    heroHeight: 900,
    cloneRadius: 440,
    cloneScale: 0.3,
    duaY: 1700,
    duaSize: 88,
    translationY: 1820,
    translationSize: 36,
    watermarkPad: 32,
  },
  "4:5": {
    W: 1080,
    H: 1350,
    titleY: 170,
    titleSize: 140,
    arabicY: 320,
    arabicSize: 76,
    heroX: 540,
    heroY: 740,
    heroHeight: 660,
    cloneRadius: 400,
    cloneScale: 0.3,
    duaY: 1190,
    duaSize: 64,
    translationY: 1265,
    translationSize: 28,
    watermarkPad: 26,
  },
};

/* ---------- theme palettes ---------- */

type ExtrudedColors = {
  fill1: string;
  fill2: string;
  outline: string;
  side: string;
};

type Theme = {
  id: TemplateId;
  bgPlate: "mosque-sunset" | "rose-garden" | "starry-night";
  extruded: ExtrudedColors;
  petalWeights: [number, number, number];
};

const THEMES: Record<TemplateId, Theme> = {
  "gold-mosque": {
    id: "gold-mosque",
    bgPlate: "mosque-sunset",
    extruded: {
      fill1: "#FFC83A",
      fill2: "#0B3F8F",
      outline: "#1A0500",
      side: "#3B1E00",
    },
    petalWeights: [0.4, 0.5, 0.1],
  },
  "rose-garden": {
    id: "rose-garden",
    bgPlate: "rose-garden",
    extruded: {
      fill1: "#FFB12E",
      fill2: "#7A1742",
      outline: "#2A0814",
      side: "#3B0E22",
    },
    petalWeights: [0.78, 0.18, 0.04],
  },
  "starry-night": {
    id: "starry-night",
    bgPlate: "starry-night",
    extruded: {
      fill1: "#FFE9B0",
      fill2: "#3B5BB0",
      outline: "#000814",
      side: "#0B1A38",
    },
    petalWeights: [0.1, 0.4, 0.5],
  },
};

/* ---------- math helpers ---------- */

const clamp = (v: number, a: number, b: number) =>
  v < a ? a : v > b ? b : v;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function envelope(
  t: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number,
): number {
  if (t < inStart || t > outEnd) return 0;
  if (t < inEnd) return smoothstep(inStart, inEnd, t);
  if (t > outStart) return 1 - smoothstep(outStart, outEnd, t);
  return 1;
}

/* ---------- state ---------- */

type Petal = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  kind: 0 | 1 | 2;
  alpha: number;
};

type Sparkle = {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
};

type SceneState = {
  petals: Petal[];
  sparkles: Sparkle[];
  grain: HTMLCanvasElement;
  stripePattern: HTMLCanvasElement;
};

function weightedPick(w: [number, number, number]): 0 | 1 | 2 {
  const r = Math.random();
  if (r < w[0]) return 0;
  if (r < w[0] + w[1]) return 1;
  return 2;
}

function makePetals(n: number, W: number, H: number, weights: [number, number, number]): Petal[] {
  const out: Petal[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * W,
      y: Math.random() * H - H,
      vx: (Math.random() - 0.5) * 24,
      vy: 50 + Math.random() * 90,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 1.6,
      size: 14 + Math.random() * 28,
      kind: weightedPick(weights),
      alpha: 0.65 + Math.random() * 0.35,
    });
  }
  return out;
}

function makeSparkles(n: number, W: number, H: number): Sparkle[] {
  const out: Sparkle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 2 + Math.random() * 5,
      phase: Math.random() * Math.PI * 2,
      speed: 1.4 + Math.random() * 2.6,
    });
  }
  return out;
}

function makeGrainTexture(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeStripePattern(c1: string, c2: string, stripeW: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = stripeW * 2;
  c.height = 4;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, stripeW, 4);
  ctx.fillStyle = c2;
  ctx.fillRect(stripeW, 0, stripeW, 4);
  return c;
}

/* ---------- font loading ---------- */

async function ensureFonts(layout: Layout): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const tries = [
    `400 ${Math.round(layout.titleSize)}px 'Bowlby One'`,
    `700 ${Math.round(layout.arabicSize)}px 'Amiri'`,
    `400 ${Math.round(layout.duaSize)}px 'Pinyon Script'`,
    `italic 600 ${Math.round(layout.translationSize)}px 'Cinzel'`,
  ];
  try {
    await Promise.all(tries.map((f) => document.fonts.load(f).catch(() => null)));
    await document.fonts.ready;
  } catch {
    /* fallbacks will be used */
  }
}

/* ---------- background plates ---------- */

function drawSky(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  stops: { pos: number; color: string }[],
  horizonAt = 0.78,
) {
  const grad = ctx.createLinearGradient(0, 0, 0, layout.H * horizonAt);
  for (const s of stops) grad.addColorStop(s.pos, s.color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, layout.W, layout.H * horizonAt);
}

function drawSunDisc(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  cx: number,
  cy: number,
  color: string,
  glowColor: string,
) {
  const { W, H } = layout;
  const r = Math.min(W, H) * 0.07;
  const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 5);
  glow.addColorStop(0, glowColor);
  glow.addColorStop(1, glowColor.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloudBands(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  t: number,
  color: string,
  count = 5,
) {
  const { W, H } = layout;
  for (let i = 0; i < count; i++) {
    const baseY = H * (0.18 + i * 0.07);
    const xOffset = (((t * 6 + i * 113) % (W * 2)) - W) * 0.5;
    const grad = ctx.createLinearGradient(0, baseY, W, baseY);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    const alpha = 0.32 - i * 0.04;
    grad.addColorStop(0.5, color.replace("ALPHA", alpha.toFixed(2)));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(xOffset, 0);
    ctx.fillStyle = grad;
    ctx.fillRect(-W, baseY, W * 3, H * 0.022);
    ctx.restore();
  }
}

function drawMosqueSilhouette(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  yBase: number,
  color: string,
) {
  const { W } = layout;
  const s = Math.min(W, layout.H) / 1080;
  const cx = W / 2;

  ctx.fillStyle = color;

  // central onion dome
  ctx.beginPath();
  ctx.moveTo(cx - 110 * s, yBase);
  ctx.bezierCurveTo(
    cx - 110 * s,
    yBase - 140 * s,
    cx + 110 * s,
    yBase - 140 * s,
    cx + 110 * s,
    yBase,
  );
  ctx.closePath();
  ctx.fill();

  // dome base ring
  ctx.fillRect(cx - 122 * s, yBase - 8 * s, 244 * s, 16 * s);

  // body
  ctx.fillRect(cx - 100 * s, yBase, 200 * s, 70 * s);

  // dome spire
  ctx.fillRect(cx - 2 * s, yBase - 170 * s, 4 * s, 36 * s);

  // crescent on top
  ctx.save();
  drawCrescentSilhouette(ctx, cx, yBase - 178 * s, 12 * s, "#F4C068");
  ctx.restore();

  ctx.fillStyle = color;

  // minarets
  for (const dx of [-180, 180]) {
    const x = cx + dx * s;
    ctx.fillRect(x - 9 * s, yBase - 110 * s, 18 * s, 180 * s);
    // top cone
    ctx.beginPath();
    ctx.moveTo(x, yBase - 145 * s);
    ctx.lineTo(x - 12 * s, yBase - 110 * s);
    ctx.lineTo(x + 12 * s, yBase - 110 * s);
    ctx.closePath();
    ctx.fill();
    // small balcony
    ctx.fillRect(x - 14 * s, yBase - 60 * s, 28 * s, 6 * s);
  }

  // flanking small domes
  for (const dx of [-260, 260]) {
    const x = cx + dx * s;
    ctx.beginPath();
    ctx.arc(x, yBase + 18 * s, 32 * s, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 36 * s, yBase + 16 * s, 72 * s, 70 * s);
  }
}

function drawCrescentSilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.moveTo(r * 0.4 + r * 0.92, -r * 0.05);
  ctx.arc(r * 0.4, -r * 0.05, r * 0.92, 0, Math.PI * 2);
  ctx.fill("evenodd");
  ctx.restore();
}

function drawPalmTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  // trunk
  ctx.beginPath();
  ctx.moveTo(-4 * s, 0);
  ctx.lineTo(-7 * s, -120 * s);
  ctx.lineTo(7 * s, -120 * s);
  ctx.lineTo(4 * s, 0);
  ctx.closePath();
  ctx.fill();
  // fronds
  ctx.translate(0, -120 * s);
  for (let i = 0; i < 7; i++) {
    const angle = -Math.PI / 2 + ((i - 3) / 6) * Math.PI * 0.95;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(70 * s, -16 * s, 90 * s, 0);
    ctx.quadraticCurveTo(70 * s, 6 * s, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawMountainRange(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  yBase: number,
  color: string,
  seed: number,
  amp: number,
) {
  const { W } = layout;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, yBase);
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    const noise = Math.sin(i * 1.7 + seed) * 0.6 + Math.sin(i * 0.8 + seed * 0.4) * 0.4;
    const y = yBase - amp * (0.6 + 0.4 * noise);
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(W, layout.H);
  ctx.lineTo(0, layout.H);
  ctx.closePath();
  ctx.fill();
}

function drawSunsetMosquePlate(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  t: number,
) {
  const { W, H } = layout;
  drawSky(ctx, layout, [
    { pos: 0, color: "#1B0A2E" },
    { pos: 0.25, color: "#4B1538" },
    { pos: 0.55, color: "#B53D2C" },
    { pos: 0.78, color: "#E89540" },
    { pos: 1, color: "#F4D078" },
  ]);

  drawSunDisc(
    ctx,
    layout,
    W * 0.5,
    H * 0.65,
    "#FFF6BC",
    "rgba(255, 230, 140, 0.55)",
  );

  drawCloudBands(ctx, layout, t, "rgba(255, 195, 145, ALPHA)");

  // far mountain range
  drawMountainRange(ctx, layout, H * 0.74, "#2D0F2A", 0.5, H * 0.04);
  // near mountain range
  drawMountainRange(ctx, layout, H * 0.78, "#1A0815", 1.7, H * 0.025);

  // mosque
  drawMosqueSilhouette(ctx, layout, H * 0.79, "#10050E");

  // ground
  ctx.fillStyle = "#08030B";
  ctx.fillRect(0, H * 0.86, W, H * 0.14);

  // palm trees
  const s = Math.min(W, H) / 1080;
  drawPalmTree(ctx, W * 0.13, H * 0.84, s * 0.95, "#08030B");
  drawPalmTree(ctx, W * 0.87, H * 0.84, s * 0.95, "#08030B");
}

function drawRoseGardenPlate(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  t: number,
) {
  const { W, H } = layout;
  drawSky(ctx, layout, [
    { pos: 0, color: "#3A0820" },
    { pos: 0.3, color: "#6B1A48" },
    { pos: 0.6, color: "#C2407A" },
    { pos: 0.85, color: "#F698BB" },
    { pos: 1, color: "#FFD4D8" },
  ]);

  drawSunDisc(
    ctx,
    layout,
    W * 0.7,
    H * 0.55,
    "#FFE0EA",
    "rgba(255, 180, 200, 0.5)",
  );

  drawCloudBands(ctx, layout, t, "rgba(255, 200, 220, ALPHA)");

  // distant rolling hills (soft pinks/greens)
  drawMountainRange(ctx, layout, H * 0.7, "#5F1838", 0.7, H * 0.03);
  drawMountainRange(ctx, layout, H * 0.78, "#3E0E26", 2.1, H * 0.025);

  // rose bush silhouettes — clusters of small dark dots at H*0.84
  ctx.fillStyle = "#1F0612";
  ctx.fillRect(0, H * 0.85, W, H * 0.15);

  const s = Math.min(W, H) / 1080;
  for (let cluster = 0; cluster < 5; cluster++) {
    const baseX = W * (0.08 + cluster * 0.21);
    const baseY = H * 0.86;
    // bush silhouette
    ctx.fillStyle = "#0E0309";
    ctx.beginPath();
    ctx.arc(baseX, baseY, 40 * s, 0, Math.PI, true);
    ctx.fill();
    // red rose dots
    for (let r = 0; r < 6; r++) {
      const rx = baseX + (Math.random() - 0.5) * 70 * s;
      const ry = baseY - Math.random() * 30 * s - 5 * s;
      const radius = (4 + Math.random() * 4) * s;
      ctx.fillStyle = `rgba(${180 + Math.random() * 50}, ${20 + Math.random() * 30}, ${40 + Math.random() * 30}, 0.95)`;
      ctx.beginPath();
      ctx.arc(rx, ry, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawStarryNightPlate(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  t: number,
) {
  const { W, H } = layout;
  drawSky(ctx, layout, [
    { pos: 0, color: "#020613" },
    { pos: 0.4, color: "#091533" },
    { pos: 0.75, color: "#162C5A" },
    { pos: 1, color: "#283D7A" },
  ]);

  // star field (lots of small static stars)
  ctx.fillStyle = "rgba(255, 250, 220, 1)";
  // deterministic-ish stars via sine hashing
  const N = 220;
  for (let i = 0; i < N; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    const sx = (Math.abs(x) * W) | 0;
    const sy = (Math.abs(y) * H * 0.7) | 0;
    const r = 0.5 + (Math.abs(Math.sin(i * 9.7)) * 1.8);
    const tw = 0.4 + 0.6 * Math.max(0, Math.sin(t * (1 + (i % 4) * 0.3) + i));
    ctx.fillStyle = `rgba(255, 250, 220, ${0.4 + tw * 0.5})`;
    ctx.beginPath();
    ctx.arc(sx, sy, r * (0.6 + tw * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }

  // crescent moon, top-right
  drawCrescentSilhouette(ctx, W * 0.78, H * 0.18, Math.min(W, H) * 0.06, "#F4F8FF");
  // moon glow
  const moonGlow = ctx.createRadialGradient(
    W * 0.78,
    H * 0.18,
    Math.min(W, H) * 0.04,
    W * 0.78,
    H * 0.18,
    Math.min(W, H) * 0.22,
  );
  moonGlow.addColorStop(0, "rgba(180, 200, 255, 0.35)");
  moonGlow.addColorStop(1, "rgba(180, 200, 255, 0)");
  ctx.fillStyle = moonGlow;
  ctx.fillRect(0, 0, W, H);

  // thin cloud bands
  drawCloudBands(ctx, layout, t, "rgba(120, 140, 200, ALPHA)", 3);

  // distant mountain layers
  drawMountainRange(ctx, layout, H * 0.7, "#0A1838", 0.5, H * 0.05);
  drawMountainRange(ctx, layout, H * 0.76, "#050B22", 1.7, H * 0.04);
  drawMountainRange(ctx, layout, H * 0.82, "#02050F", 3.1, H * 0.025);

  // foreground hill
  ctx.fillStyle = "#000308";
  ctx.fillRect(0, H * 0.86, W, H * 0.14);
}

function drawBackgroundPlate(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  theme: Theme,
  t: number,
) {
  switch (theme.bgPlate) {
    case "mosque-sunset":
      drawSunsetMosquePlate(ctx, layout, t);
      break;
    case "rose-garden":
      drawRoseGardenPlate(ctx, layout, t);
      break;
    case "starry-night":
      drawStarryNightPlate(ctx, layout, t);
      break;
  }
}

/* ---------- camera ---------- */

function applyKenBurns(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  t: number,
) {
  const progress = t / DURATION_S;
  const zoom = 1.0 + 0.06 * progress;
  const panX = Math.sin(t * 0.18) * (layout.W * 0.008);
  const panY = -progress * (layout.H * 0.012);
  const cx = layout.W / 2;
  const cy = layout.H / 2;
  ctx.translate(cx + panX, cy + panY);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);
}

/* ---------- vignette ---------- */

function drawVignette(ctx: CanvasRenderingContext2D, layout: Layout) {
  const { W, H } = layout;
  const cx = W / 2;
  const cy = H / 2;
  const maxR = Math.max(W, H) * 0.78;
  const v = ctx.createRadialGradient(cx, cy, maxR * 0.55, cx, cy, maxR);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- film grain ---------- */

function drawGrain(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  grain: HTMLCanvasElement,
  t: number,
) {
  const tilesX = Math.ceil(layout.W / grain.width) + 1;
  const tilesY = Math.ceil(layout.H / grain.height) + 1;
  const ox = (Math.sin(t * 11.3) * grain.width) % grain.width;
  const oy = (Math.cos(t * 9.7) * grain.height) % grain.height;
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.globalCompositeOperation = "overlay";
  for (let y = -1; y < tilesY; y++) {
    for (let x = -1; x < tilesX; x++) {
      ctx.drawImage(
        grain,
        x * grain.width + ox,
        y * grain.height + oy,
      );
    }
  }
  ctx.restore();
}

/* ---------- petals + sparkles ---------- */

function drawPetalShape(
  ctx: CanvasRenderingContext2D,
  size: number,
  kind: 0 | 1 | 2,
) {
  const colors =
    kind === 0
      ? ["#FF6B7D", "#D63A52", "#FFC2CC"]
      : kind === 1
        ? ["#FFE38A", "#C58F22", "#FFF6C2"]
        : ["#FFFFFF", "#F0D998", "#FFFFFF"];
  ctx.fillStyle = colors[1];
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.42, size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors[0];
  ctx.beginPath();
  ctx.ellipse(-size * 0.05, -size * 0.1, size * 0.34, size * 0.86, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors[2];
  ctx.globalAlpha *= 0.7;
  ctx.beginPath();
  ctx.ellipse(-size * 0.12, -size * 0.32, size * 0.12, size * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha /= 0.7;
}

function drawPetals(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  petals: Petal[],
  dt: number,
  t: number,
) {
  const { W, H } = layout;
  for (const p of petals) {
    p.x += p.vx * dt + Math.sin(t * 1.1 + p.y * 0.012) * 0.6;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    if (p.y > H + 40) {
      p.y = -40;
      p.x = Math.random() * W;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    drawPetalShape(ctx, p.size, p.kind);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawSparkles(
  ctx: CanvasRenderingContext2D,
  sparkles: Sparkle[],
  t: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const s of sparkles) {
    const a = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
    ctx.fillStyle = `rgba(255,250,210,${a})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * (0.6 + 0.5 * a), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,250,210,${a * 0.85})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(s.x - s.r * 2.6, s.y);
    ctx.lineTo(s.x + s.r * 2.6, s.y);
    ctx.moveTo(s.x, s.y - s.r * 2.6);
    ctx.lineTo(s.x, s.y + s.r * 2.6);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- hero face (free-floating) ---------- */

function drawHero(
  ctx: CanvasRenderingContext2D,
  subject: ImageBitmap,
  bounds: { x: number; y: number; w: number; h: number },
  layout: Layout,
  t: number,
  alpha: number,
) {
  const scale = lerp(0.86, 1.0, smoothstep(2.5, 3.5, t));
  const bob = Math.sin(t * 1.25) * 8;

  const targetH = layout.heroHeight * scale;
  const aspect = bounds.w / bounds.h;
  const targetW = targetH * aspect;

  ctx.save();
  ctx.globalAlpha = alpha;

  // double-shadow for depth
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 14;

  ctx.translate(layout.heroX, layout.heroY + bob);
  ctx.drawImage(
    subject,
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h,
    -targetW / 2,
    -targetH / 2,
    targetW,
    targetH,
  );
  ctx.restore();
}

/* ---------- face clones ---------- */

function drawFaceClones(
  ctx: CanvasRenderingContext2D,
  subject: ImageBitmap,
  bounds: { x: number; y: number; w: number; h: number },
  layout: Layout,
  t: number,
  alpha: number,
) {
  const explodeStart = 6.5;
  const explodeEnd = 7.4;
  const radiusProgress = smoothstep(explodeStart, explodeEnd, t);
  const radius = layout.cloneRadius * radiusProgress;

  const N = 6;
  const aspect = bounds.w / bounds.h;
  const cloneH = layout.heroHeight * layout.cloneScale;
  const cloneW = cloneH * aspect;

  for (let i = 0; i < N; i++) {
    const baseAngle = (i / N) * Math.PI * 2 - Math.PI / 2;
    const orbit = t * 0.16;
    const angle = baseAngle + orbit;
    const wobble = Math.sin(t * 1.6 + i * 1.3) * 12;
    const r = radius + wobble;
    const x = layout.heroX + Math.cos(angle) * r;
    const y = layout.heroY + Math.sin(angle) * r * 0.95;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.translate(0, Math.sin(t * 1.5 + i) * 6);
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(
      subject,
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
      -cloneW / 2,
      -cloneH / 2,
      cloneW,
      cloneH,
    );
    ctx.restore();
  }
}

/* ---------- extruded text ---------- */

function drawExtrudedTitle(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  stripePattern: HTMLCanvasElement,
  theme: Theme,
  t: number,
  alpha: number,
) {
  const text = "EID MUBARAK";
  const fontSize = layout.titleSize;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `400 ${fontSize}px 'Bowlby One', 'Impact', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // drop-in from above during fade in
  const dropProgress = smoothstep(0.5, 1.3, t);
  const dropOffset = lerp(-fontSize * 0.6, 0, dropProgress);
  const x = layout.W / 2;
  const y = layout.titleY + dropOffset;

  // 3D extrusion — repeated offset fills behind
  const depth = Math.max(8, Math.round(fontSize * 0.06));
  ctx.fillStyle = theme.extruded.side;
  for (let i = depth; i >= 1; i--) {
    ctx.fillText(text, x + i * 0.85, y + i * 0.85);
  }

  // thick outline
  ctx.lineWidth = fontSize * 0.075;
  ctx.strokeStyle = theme.extruded.outline;
  ctx.strokeText(text, x, y);

  // striped pattern fill
  const pattern = ctx.createPattern(stripePattern, "repeat")!;
  ctx.fillStyle = pattern;
  ctx.fillText(text, x, y);

  // thin highlight
  ctx.lineWidth = fontSize * 0.015;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.strokeText(text, x, y - 1);

  ctx.restore();
}

/* ---------- arabic + dua + translation ---------- */

function drawArabicTitle(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  t: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${layout.arabicSize}px 'Amiri', 'Geeza Pro', serif`;

  const text = "عيد مبارك";
  const y = layout.arabicY + Math.sin(t * 1.4) * 3;

  ctx.lineWidth = layout.arabicSize * 0.07;
  ctx.strokeStyle = "rgba(20,10,0,0.85)";
  ctx.strokeText(text, layout.W / 2, y);

  const grad = ctx.createLinearGradient(
    0,
    y - layout.arabicSize * 0.5,
    0,
    y + layout.arabicSize * 0.5,
  );
  grad.addColorStop(0, "#FFF6C2");
  grad.addColorStop(0.5, "#FFD86A");
  grad.addColorStop(1, "#A0721A");
  ctx.fillStyle = grad;
  ctx.fillText(text, layout.W / 2, y);
  ctx.restore();
}

function drawDuaText(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  t: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const dua = "Taqabbal Allahu Minna wa Minkum";
  const y1 = layout.duaY + Math.sin(t * 1.8 + 1) * 2;
  ctx.font = `400 ${layout.duaSize}px 'Pinyon Script', 'Brush Script MT', cursive`;
  ctx.lineWidth = layout.duaSize * 0.12;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(20,10,0,0.85)";
  ctx.strokeText(dua, layout.W / 2, y1);

  const grad = ctx.createLinearGradient(
    0,
    y1 - layout.duaSize * 0.4,
    0,
    y1 + layout.duaSize * 0.4,
  );
  grad.addColorStop(0, "#FFF1B0");
  grad.addColorStop(1, "#C58F22");
  ctx.fillStyle = grad;
  ctx.fillText(dua, layout.W / 2, y1);

  const y2 = layout.translationY;
  ctx.font = `italic 600 ${layout.translationSize}px 'Cinzel', Georgia, serif`;
  ctx.lineWidth = layout.translationSize * 0.16;
  ctx.strokeStyle = "rgba(20,10,0,0.75)";
  ctx.strokeText("May Allah accept from us and from you", layout.W / 2, y2);
  ctx.fillStyle = "rgba(255,241,176,0.95)";
  ctx.fillText("May Allah accept from us and from you", layout.W / 2, y2);

  ctx.restore();
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `italic ${Math.max(18, layout.W * 0.022)}px 'Cinzel', Georgia, serif`;
  ctx.fillStyle = "rgba(255,241,176,0.6)";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "auntifyeid",
    layout.W - layout.watermarkPad,
    layout.H - layout.watermarkPad,
  );
  ctx.restore();
}

/* ---------- scene composition ---------- */

function drawScene(
  ctx: CanvasRenderingContext2D,
  subject: ImageBitmap,
  bounds: { x: number; y: number; w: number; h: number },
  state: SceneState,
  theme: Theme,
  layout: Layout,
  t: number,
  dt: number,
) {
  // background plate with Ken Burns
  ctx.save();
  applyKenBurns(ctx, layout, t);
  drawBackgroundPlate(ctx, layout, theme, t);
  ctx.restore();

  // soft vignette to focus center
  drawVignette(ctx, layout);

  // atmospheric petals + sparkles (always present)
  drawPetals(ctx, layout, state.petals, dt, t);
  drawSparkles(ctx, state.sparkles, t);

  // big extruded title — fade in 0.5–1.3, hold, fade out 14.0–14.8
  const titleAlpha = envelope(t, 0.5, 1.3, 14.0, 14.8);
  if (titleAlpha > 0) {
    drawExtrudedTitle(ctx, layout, state.stripePattern, theme, t, titleAlpha);
  }

  // arabic line — fade in slightly after title
  const arabicAlpha = envelope(t, 1.6, 2.4, 14.0, 14.8);
  if (arabicAlpha > 0) {
    drawArabicTitle(ctx, layout, t, arabicAlpha);
  }

  // hero face — fade in 2.5–3.5, hold, fade out 14.0–14.9
  const heroAlpha = envelope(t, 2.5, 3.5, 14.0, 14.9);
  if (heroAlpha > 0) {
    drawHero(ctx, subject, bounds, layout, t, heroAlpha);
  }

  // face clones — explode out at 6.5, fade out at end
  const cloneAlpha = envelope(t, 6.5, 7.4, 14.0, 14.8);
  if (cloneAlpha > 0) {
    drawFaceClones(ctx, subject, bounds, layout, t, cloneAlpha);
  }

  // dua text — fade in at 9.5
  const duaAlpha = envelope(t, 9.5, 10.5, 14.2, 14.9);
  if (duaAlpha > 0) {
    drawDuaText(ctx, layout, t, duaAlpha);
  }

  // film grain
  drawGrain(ctx, layout, state.grain, t);

  // watermark — slightly transparent throughout, fades with everything else
  const wmAlpha = envelope(t, 0.5, 1.5, 14.0, 14.8);
  if (wmAlpha > 0) drawWatermark(ctx, layout, wmAlpha);
}

/* ---------- export ---------- */

export type GenerateResult = { blob: Blob; ext: "mp4" | "webm" };

export async function generateAuntieVideo(
  subject: ImageBitmap,
  templateId: TemplateId,
  trackId: TrackId,
  aspect: AspectRatio,
  onProgress?: (pct: number) => void,
): Promise<GenerateResult> {
  const layout = LAYOUTS[aspect];
  const theme = THEMES[templateId];

  await ensureFonts(layout);

  const bounds = findAlphaBounds(subject);

  const canvas = document.createElement("canvas");
  canvas.width = layout.W;
  canvas.height = layout.H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const state: SceneState = {
    petals: makePetals(60, layout.W, layout.H, theme.petalWeights),
    sparkles: makeSparkles(70, layout.W, layout.H),
    grain: makeGrainTexture(),
    stripePattern: makeStripePattern(
      theme.extruded.fill1,
      theme.extruded.fill2,
      Math.max(8, Math.round(layout.titleSize * 0.075)),
    ),
  };

  // seed frame 0
  drawScene(ctx, subject, bounds, state, theme, layout, 0, 1 / FPS);

  const videoStream = canvas.captureStream(FPS);

  const audio = await buildAuntieAudio(trackId, DURATION_S + 0.2);
  const audioTracks = audio.destination.stream.getAudioTracks();
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioTracks,
  ]);

  const mimeCandidates = [
    "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType =
    mimeCandidates.find((m) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported
        ? MediaRecorder.isTypeSupported(m)
        : false,
    ) || "video/webm";

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: aspect === "9:16" ? 12_000_000 : 9_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<GenerateResult>((resolve, reject) => {
    recorder.onerror = (e) => {
      audio.stop();
      reject(e);
    };
    recorder.onstop = () => {
      audio.stop();
      const blob = new Blob(chunks, { type: mimeType });
      const ext: "mp4" | "webm" = mimeType.startsWith("video/mp4")
        ? "mp4"
        : "webm";
      resolve({ blob, ext });
    };

    recorder.start(120);

    const start = performance.now();
    let last = start;

    function frame(now: number) {
      const elapsed = now - start;
      const t = elapsed / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      drawScene(ctx, subject, bounds, state, theme, layout, t, dt);

      if (onProgress) onProgress(Math.min(1, elapsed / DURATION_MS));

      if (elapsed < DURATION_MS) {
        requestAnimationFrame(frame);
      } else {
        try {
          recorder.requestData?.();
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            recorder.stop();
          } catch {
            /* ignore */
          }
        }, 80);
      }
    }
    requestAnimationFrame(frame);
  });
}
