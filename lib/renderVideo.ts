import { findAlphaBounds } from "./removeBg";
import { buildAuntieAudio } from "./auntieMusic";

const W = 1080;
const H = 1080;
const CX = W / 2;
const CY = 560;
const PHOTO_R = 220;
const DURATION_MS = 6000;
const FPS = 30;

export type TemplateId = "gold-mosque" | "rose-garden" | "starry-night";

type Theme = {
  id: TemplateId;
  sky: [string, string, string, string]; // top, upper-mid, lower-mid, bottom
  spotlight: string; // rgba string
  petalWeights: [number, number, number]; // [rose, gold, white]
  showMosque: boolean;
  showHearts: boolean;
  lantern: { body: [string, string, string]; cap: string };
  ringChrome: [string, string, string];
  moonColor: string;
  starColor: string;
  bigStars: boolean;
};

const THEMES: Record<TemplateId, Theme> = {
  "gold-mosque": {
    id: "gold-mosque",
    sky: ["#0A1822", "#0E3D2C", "#3E6A3F", "#11241F"],
    spotlight: "rgba(255, 200, 90, 0.38)",
    petalWeights: [0.45, 0.45, 0.1],
    showMosque: true,
    showHearts: false,
    lantern: { body: ["#F04A55", "#C81E2C", "#5C0A14"], cap: "#D4AF37" },
    ringChrome: ["#FFEB9B", "#D4AF37", "#6B4F0F"],
    moonColor: "#FFD86A",
    starColor: "#FFE38A",
    bigStars: false,
  },
  "rose-garden": {
    id: "rose-garden",
    sky: ["#2A0B1A", "#5A1336", "#9E2A57", "#3A1428"],
    spotlight: "rgba(255, 150, 180, 0.42)",
    petalWeights: [0.75, 0.18, 0.07],
    showMosque: false,
    showHearts: true,
    lantern: { body: ["#FFB0C8", "#E73C7E", "#7A1742"], cap: "#FFD86A" },
    ringChrome: ["#FFE2EC", "#E73C7E", "#7A1742"],
    moonColor: "#FFB8D1",
    starColor: "#FFE2EC",
    bigStars: false,
  },
  "starry-night": {
    id: "starry-night",
    sky: ["#03070F", "#0A1A3A", "#1A2D5C", "#06091A"],
    spotlight: "rgba(180, 200, 255, 0.32)",
    petalWeights: [0.1, 0.35, 0.55],
    showMosque: false,
    showHearts: false,
    lantern: { body: ["#E6E0FF", "#9B8FE0", "#3A2E78"], cap: "#E0E8FF" },
    ringChrome: ["#FFFFFF", "#C0CFEC", "#5C6EAA"],
    moonColor: "#F4F8FF",
    starColor: "#FFFFFF",
    bigStars: true,
  },
};

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

type Star = {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
};

type Heart = {
  x: number;
  y: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
};

export type GenerateResult = { blob: Blob; ext: "mp4" | "webm" };

function weightedPick(weights: [number, number, number]): 0 | 1 | 2 {
  const r = Math.random();
  if (r < weights[0]) return 0;
  if (r < weights[0] + weights[1]) return 1;
  return 2;
}

function makePetals(n: number, weights: [number, number, number]): Petal[] {
  const out: Petal[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * W,
      y: Math.random() * H - H,
      vx: (Math.random() - 0.5) * 28,
      vy: 55 + Math.random() * 95,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 1.6,
      size: 12 + Math.random() * 26,
      kind: weightedPick(weights),
      alpha: 0.7 + Math.random() * 0.3,
    });
  }
  return out;
}

function makeSparkles(n: number): Sparkle[] {
  const out: Sparkle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 2 + Math.random() * 5,
      phase: Math.random() * Math.PI * 2,
      speed: 1.5 + Math.random() * 3,
    });
  }
  return out;
}

function makeStars(n: number, bigger: boolean): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < n; i++) {
    const base = bigger ? 1.4 : 0.8;
    out.push({
      x: Math.random() * W,
      y: Math.random() * H * (bigger ? 0.95 : 0.55),
      r: base + Math.random() * (bigger ? 2.5 : 1.8),
      phase: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 1.6,
    });
  }
  return out;
}

function makeHearts(n: number): Heart[] {
  const out: Heart[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * W,
      y: Math.random() * H + H * 0.2,
      vy: -(30 + Math.random() * 50),
      size: 14 + Math.random() * 18,
      alpha: 0.55 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return out;
}

async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const tries = [
    "700 132px 'Cinzel'",
    "italic 700 132px 'Cinzel'",
    "italic 26px 'Cinzel'",
    "400 64px 'Pinyon Script'",
    "700 92px 'Amiri'",
  ];
  try {
    await Promise.all(tries.map((f) => document.fonts.load(f).catch(() => null)));
    await document.fonts.ready;
  } catch {
    // fallbacks will be used
  }
}

function drawSky(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  stars: Star[],
  t: number,
) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.sky[0]);
  g.addColorStop(0.32, theme.sky[1]);
  g.addColorStop(0.62, theme.sky[2]);
  g.addColorStop(1, theme.sky[3]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const spot = ctx.createRadialGradient(CX, CY, 60, CX, CY, 620);
  spot.addColorStop(0, theme.spotlight);
  spot.addColorStop(0.6, theme.spotlight.replace(/[\d.]+\)$/, "0.08)"));
  spot.addColorStop(1, theme.spotlight.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);

  for (const s of stars) {
    const tw = 0.3 + 0.7 * Math.max(0, Math.sin(t * s.speed + s.phase));
    ctx.fillStyle = `rgba(255, 248, 220, ${tw * 0.85})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * (0.6 + 0.6 * tw), 0, Math.PI * 2);
    ctx.fill();
    if (theme.bigStars && s.r > 2.2) {
      // 4-point glint
      ctx.strokeStyle = `rgba(255,255,255,${tw * 0.6})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(s.x - s.r * 3, s.y);
      ctx.lineTo(s.x + s.r * 3, s.y);
      ctx.moveTo(s.x, s.y - s.r * 3);
      ctx.lineTo(s.x, s.y + s.r * 3);
      ctx.stroke();
    }
  }
}

function drawLightRays(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(t * 0.035);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.06;
  const rays = 14;
  for (let i = 0; i < rays; i++) {
    ctx.rotate((Math.PI * 2) / rays);
    const grad = ctx.createLinearGradient(0, 0, 0, -780);
    grad.addColorStop(0, "rgba(255,230,140,0)");
    grad.addColorStop(0.6, "rgba(255,230,140,0.55)");
    grad.addColorStop(1, "rgba(255,230,140,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-36, 0);
    ctx.lineTo(36, 0);
    ctx.lineTo(0, -780);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawCrescentMoon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  ctx.save();

  // glow
  const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.8);
  glow.addColorStop(0, "rgba(255, 220, 120, 0.35)");
  glow.addColorStop(1, "rgba(255, 220, 120, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.8, 0, Math.PI * 2);
  ctx.fill();

  // crescent shape via even-odd path fill (no compositing ops, no transparent
  // pixels — safe for video encoding)
  ctx.translate(x, y);
  const moonGrad = ctx.createLinearGradient(-r, -r, r, r);
  moonGrad.addColorStop(0, "#FFFCE0");
  moonGrad.addColorStop(0.5, color);
  moonGrad.addColorStop(1, "#7A5410");
  ctx.fillStyle = moonGrad;
  ctx.beginPath();
  // outer disc
  ctx.moveTo(r, 0);
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  // inner cutter (separate subpath via moveTo)
  const cx = r * 0.38;
  const cy = -r * 0.05;
  const cr = r * 0.92;
  ctx.moveTo(cx + cr, cy);
  ctx.arc(cx, cy, cr, 0, Math.PI * 2);
  ctx.fill("evenodd");

  // hairline rim on the outer arc, for definition
  ctx.strokeStyle = "rgba(255, 240, 180, 0.5)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawStar5(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.55, x, y + s * 0.75, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.75, x + s * 0.5, y + s * 0.55, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.closePath();
}

function drawHearts(
  ctx: CanvasRenderingContext2D,
  hearts: Heart[],
  dt: number,
  t: number,
) {
  for (const h of hearts) {
    h.y += h.vy * dt;
    h.x += Math.sin(t * 1.4 + h.phase) * 0.8;
    if (h.y < -40) {
      h.y = H + 40;
      h.x = Math.random() * W;
    }
    ctx.save();
    ctx.globalAlpha = h.alpha;
    const grad = ctx.createLinearGradient(h.x, h.y, h.x, h.y + h.size);
    grad.addColorStop(0, "#FFB8D1");
    grad.addColorStop(1, "#E73C7E");
    ctx.fillStyle = grad;
    drawHeart(ctx, h.x, h.y, h.size);
    ctx.fill();
    ctx.restore();
  }
}

function drawMosqueSilhouette(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = "rgba(4, 18, 22, 0.85)";

  const ground = 1000;
  ctx.fillRect(0, ground, W, H - ground);

  // left minaret
  ctx.fillRect(96, 760, 28, ground - 760);
  ctx.fillRect(86, 858, 48, 14);
  ctx.fillRect(86, 770, 48, 10);
  ctx.beginPath();
  ctx.moveTo(110, 718);
  ctx.lineTo(90, 768);
  ctx.lineTo(130, 768);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(108, 700, 4, 22);

  // central building + onion dome
  ctx.fillRect(360, 920, 360, ground - 920);
  ctx.beginPath();
  ctx.moveTo(360, 920);
  ctx.bezierCurveTo(360, 760, 720, 760, 720, 920);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(350, 916, 380, 14);
  ctx.fillRect(538, 720, 4, 50);

  // gold crescent atop the dome — same safe even-odd technique
  drawCrescentMoon(ctx, CX, 700, 12, "#FFD86A");

  // flanking small domes
  ctx.beginPath();
  ctx.arc(310, 940, 36, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(280, 938, 60, ground - 938);

  ctx.beginPath();
  ctx.arc(770, 940, 36, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(740, 938, 60, ground - 938);

  // right minaret (mirror)
  ctx.fillRect(956, 760, 28, ground - 760);
  ctx.fillRect(946, 858, 48, 14);
  ctx.fillRect(946, 770, 48, 10);
  ctx.beginPath();
  ctx.moveTo(970, 718);
  ctx.lineTo(950, 768);
  ctx.lineTo(990, 768);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(968, 700, 4, 22);

  ctx.restore();
}

function drawLantern(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sway: number,
  scale: number,
  body: [string, string, string],
  cap: string,
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = "rgba(255,215,90,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -260 * scale);
  ctx.lineTo(0, 0);
  ctx.stroke();

  ctx.rotate(sway);
  ctx.scale(scale, scale);

  // top cap
  const capGrad = ctx.createLinearGradient(0, -16, 0, 2);
  capGrad.addColorStop(0, "#FFE38A");
  capGrad.addColorStop(1, cap);
  ctx.fillStyle = capGrad;
  ctx.fillRect(-30, -16, 60, 8);
  ctx.fillRect(-22, -8, 44, 10);

  // body
  const bodyGrad = ctx.createLinearGradient(0, 2, 0, 110);
  bodyGrad.addColorStop(0, body[0]);
  bodyGrad.addColorStop(0.5, body[1]);
  bodyGrad.addColorStop(1, body[2]);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-46, 4);
  ctx.bezierCurveTo(-60, 32, -60, 82, -32, 110);
  ctx.lineTo(32, 110);
  ctx.bezierCurveTo(60, 82, 60, 32, 46, 4);
  ctx.closePath();
  ctx.fill();

  // glow
  const glow = ctx.createRadialGradient(0, 55, 4, 0, 55, 42);
  glow.addColorStop(0, "rgba(255,235,150,0.95)");
  glow.addColorStop(1, "rgba(255,235,150,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 55, 42, 0, Math.PI * 2);
  ctx.fill();

  // ribs
  ctx.strokeStyle = "rgba(212,175,55,0.7)";
  ctx.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 14, 6);
    ctx.lineTo(i * 14, 108);
    ctx.stroke();
  }

  ctx.fillStyle = cap;
  ctx.fillRect(-22, 108, 44, 10);
  ctx.fillRect(-30, 118, 60, 6);

  ctx.strokeStyle = cap;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 124);
  ctx.lineTo(0, 158);
  ctx.stroke();
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(0, 164, 8, 0, Math.PI * 2);
  ctx.fill();

  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 4, 168);
    ctx.lineTo(i * 4, 180);
    ctx.strokeStyle = "rgba(212,175,55,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function drawFlowerFrame(ctx: CanvasRenderingContext2D, t: number, chrome: [string, string, string]) {
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(t * 0.12);

  const petals = 12;
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate((i / petals) * Math.PI * 2);
    const grad = ctx.createLinearGradient(0, -260, 0, -380);
    grad.addColorStop(0, chrome[0]);
    grad.addColorStop(0.45, chrome[1]);
    grad.addColorStop(1, chrome[2]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -258);
    ctx.bezierCurveTo(-55, -296, -38, -368, 0, -390);
    ctx.bezierCurveTo(38, -368, 55, -296, 0, -258);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(80,50,5,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,250,200,0.32)";
    ctx.beginPath();
    ctx.ellipse(-10, -340, 8, 26, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(-t * 0.18 + 0.3);
  const inner = 16;
  for (let i = 0; i < inner; i++) {
    ctx.save();
    ctx.rotate((i / inner) * Math.PI * 2);
    const grad = ctx.createLinearGradient(0, -252, 0, -280);
    grad.addColorStop(0, chrome[0]);
    grad.addColorStop(1, chrome[2]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -252);
    ctx.bezierCurveTo(-18, -262, -14, -280, 0, -284);
    ctx.bezierCurveTo(14, -280, 18, -262, 0, -252);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // soft annulus tying photo and petals together
  ctx.save();
  ctx.translate(CX, CY);
  const ringGrad = ctx.createRadialGradient(0, 0, PHOTO_R - 4, 0, 0, PHOTO_R + 38);
  ringGrad.addColorStop(0, "rgba(212,175,55,0)");
  ringGrad.addColorStop(0.55, chrome[1]);
  ringGrad.addColorStop(1, "rgba(110,80,10,0)");
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(0, 0, PHOTO_R + 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPhotoCircle(
  ctx: CanvasRenderingContext2D,
  subject: ImageBitmap,
  bounds: { x: number; y: number; w: number; h: number },
  t: number,
  chrome: [string, string, string],
) {
  const R = PHOTO_R;
  ctx.save();
  ctx.translate(CX, CY);

  // drop shadow disc
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(0, 0, R + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // photo
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();

  const bg = ctx.createRadialGradient(0, -30, 20, 0, 0, R);
  bg.addColorStop(0, "#F7E1A7");
  bg.addColorStop(1, "#B98428");
  ctx.fillStyle = bg;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  const bbAspect = bounds.w / bounds.h;
  const target = R * 2.0;
  let drawW: number, drawH: number;
  if (bbAspect > 1) {
    drawH = target;
    drawW = target * bbAspect;
  } else {
    drawW = target;
    drawH = target / bbAspect;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    subject,
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h,
    -drawW / 2,
    -drawH / 2 - R * 0.04,
    drawW,
    drawH,
  );
  ctx.restore();

  // gold ring
  ctx.lineWidth = 12;
  const ringStroke = ctx.createLinearGradient(-R, -R, R, R);
  ringStroke.addColorStop(0, chrome[0]);
  ringStroke.addColorStop(0.5, chrome[1]);
  ringStroke.addColorStop(1, chrome[2]);
  ctx.strokeStyle = ringStroke;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();

  // bead halo
  const beads = 28;
  for (let i = 0; i < beads; i++) {
    const a = (i / beads) * Math.PI * 2 + t * 0.55;
    const px = Math.cos(a) * (R + 15);
    const py = Math.sin(a) * (R + 15);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.8 + i * 0.7);
    ctx.fillStyle = `rgba(255,230,140,${0.55 + 0.45 * pulse})`;
    ctx.beginPath();
    ctx.arc(px, py, 3.5 + pulse * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

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
  petals: Petal[],
  dt: number,
  t: number,
) {
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

function drawArabicTitle(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 92px 'Amiri', 'Geeza Pro', serif";

  const text = "عيد مبارك";
  const y = 110;

  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(20,10,0,0.85)";
  ctx.strokeText(text, CX, y);

  const grad = ctx.createLinearGradient(0, y - 50, 0, y + 50);
  grad.addColorStop(0, "#FFF6C2");
  grad.addColorStop(0.5, "#FFD86A");
  grad.addColorStop(1, "#A0721A");
  ctx.fillStyle = grad;
  ctx.fillText(text, CX, y);
  ctx.restore();
}

function drawTopText(ctx: CanvasRenderingContext2D, t: number) {
  const text = "Eid Mubarak";
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic 700 124px 'Cinzel', Georgia, serif";

  const y = 230 + Math.sin(t * 1.8) * 3;

  ctx.lineWidth = 11;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#231100";
  ctx.strokeText(text, CX, y);

  const grad = ctx.createLinearGradient(0, y - 70, 0, y + 70);
  grad.addColorStop(0, "#FFFCE0");
  grad.addColorStop(0.25, "#FFD86A");
  grad.addColorStop(0.5, "#A0721A");
  grad.addColorStop(0.75, "#FFD86A");
  grad.addColorStop(1, "#FFFCE0");
  ctx.fillStyle = grad;
  ctx.fillText(text, CX, y);

  ctx.save();
  ctx.beginPath();
  const shimmerX = ((t * 280) % (W + 500)) - 250;
  ctx.rect(shimmerX - 48, y - 88, 96, 176);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(text, CX, y);
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText(text, CX, y - 1);

  ctx.restore();
}

function drawBottomText(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const dua = "Taqabbal Allahu Minna wa Minkum";
  const y1 = 870 + Math.sin(t * 1.8 + 1) * 2;
  ctx.font = "400 66px 'Pinyon Script', 'Brush Script MT', cursive";

  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(20,10,0,0.85)";
  ctx.strokeText(dua, CX, y1);

  const grad = ctx.createLinearGradient(0, y1 - 30, 0, y1 + 30);
  grad.addColorStop(0, "#FFF1B0");
  grad.addColorStop(1, "#C58F22");
  ctx.fillStyle = grad;
  ctx.fillText(dua, CX, y1);

  const y2 = 945;
  ctx.font = "italic 600 28px 'Cinzel', Georgia, serif";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(20,10,0,0.7)";
  ctx.strokeText("May Allah accept from us and from you", CX, y2);
  ctx.fillStyle = "rgba(255,241,176,0.95)";
  ctx.fillText("May Allah accept from us and from you", CX, y2);

  ctx.restore();
}

function drawWatermark(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.font = "italic 22px 'Cinzel', Georgia, serif";
  ctx.fillStyle = "rgba(255,241,176,0.55)";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("auntifyeid", W - 26, H - 16);
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D) {
  const v = ctx.createRadialGradient(CX, CY, 400, CX, CY, 820);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

type SceneState = {
  petals: Petal[];
  sparkles: Sparkle[];
  stars: Star[];
  hearts: Heart[];
};

function drawScene(
  ctx: CanvasRenderingContext2D,
  subject: ImageBitmap,
  bounds: { x: number; y: number; w: number; h: number },
  state: SceneState,
  theme: Theme,
  t: number,
  dt: number,
) {
  drawSky(ctx, theme, state.stars, t);
  drawLightRays(ctx, t);

  drawCrescentMoon(ctx, 240, 130, 38, theme.moonColor);
  drawStar5(ctx, 175, 80, 11, theme.starColor);
  drawStar5(ctx, 920, 100, 9, theme.starColor);

  if (theme.showMosque) drawMosqueSilhouette(ctx);
  drawVignette(ctx);

  drawArabicTitle(ctx);

  drawLantern(
    ctx,
    175,
    320,
    Math.sin(t * 1.4) * 0.085,
    0.92,
    theme.lantern.body,
    theme.lantern.cap,
  );
  drawLantern(
    ctx,
    W - 175,
    320,
    Math.sin(t * 1.4 + 1.1) * 0.085,
    0.92,
    theme.lantern.body,
    theme.lantern.cap,
  );

  drawFlowerFrame(ctx, t, theme.ringChrome);
  drawPhotoCircle(ctx, subject, bounds, t, theme.ringChrome);

  if (theme.showHearts) drawHearts(ctx, state.hearts, dt, t);
  drawPetals(ctx, state.petals, dt, t);
  drawSparkles(ctx, state.sparkles, t);

  drawTopText(ctx, t);
  drawBottomText(ctx, t);
  drawWatermark(ctx);
}

export async function generateAuntieVideo(
  subject: ImageBitmap,
  templateId: TemplateId,
  onProgress?: (pct: number) => void,
): Promise<GenerateResult> {
  await ensureFonts();

  const theme = THEMES[templateId];
  const bounds = findAlphaBounds(subject);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  // alpha must stay true — even-odd path fills are safe but globally-opaque
  // canvases can still trip up other compositing flows.
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const state: SceneState = {
    petals: makePetals(56, theme.petalWeights),
    sparkles: makeSparkles(60),
    stars: makeStars(theme.bigStars ? 110 : 80, theme.bigStars),
    hearts: theme.showHearts ? makeHearts(22) : [],
  };

  // seed canvas so captureStream picks up a real frame at t=0
  drawScene(ctx, subject, bounds, state, theme, 0, 1 / FPS);

  const videoStream = canvas.captureStream(FPS);

  // Build audio track and merge into a combined stream
  const audio = buildAuntieAudio(DURATION_MS / 1000 + 0.2);
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
    videoBitsPerSecond: 9_000_000,
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

      drawScene(ctx, subject, bounds, state, theme, t, dt);

      if (onProgress) onProgress(Math.min(1, elapsed / DURATION_MS));

      if (elapsed < DURATION_MS) {
        requestAnimationFrame(frame);
      } else {
        try {
          recorder.requestData?.();
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            recorder.stop();
          } catch {
            // ignore
          }
        }, 80);
      }
    }
    requestAnimationFrame(frame);
  });
}
