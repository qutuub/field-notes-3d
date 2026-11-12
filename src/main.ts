import { L, T, gradT } from "./field";
import { mountNav } from "./nav";

const canvas = document.getElementById("field") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const $ = (id: string) => document.getElementById(id)!;

const N = 160; // heat-map resolution
const heat = document.createElement("canvas");
heat.width = heat.height = N;

// Normalised probe position in [0,1]^2, y up.
let probe = { x: 0.4, y: 0.5 };
let size = 0;

// Blue -> white -> red colour ramp.
function ramp(t: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, t));
  const lo: [number, number, number] = [59, 94, 190];
  const mid: [number, number, number] = [245, 243, 235];
  const hi: [number, number, number] = [196, 52, 44];
  const [a, b, f] = k < 0.5 ? [lo, mid, k * 2] : [mid, hi, (k - 0.5) * 2];
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * f) as [number, number, number];
}

function buildHeat() {
  const img = new ImageData(N, N);
  let tmin = Infinity, tmax = -Infinity;
  const vals = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const v = T(((i + 0.5) / N) * L, (1 - (j + 0.5) / N) * L);
      vals[j * N + i] = v;
      tmin = Math.min(tmin, v);
      tmax = Math.max(tmax, v);
    }
  for (let p = 0; p < N * N; p++) {
    const [r, g, b] = ramp((vals[p] - tmin) / (tmax - tmin));
    img.data.set([r, g, b, 255], p * 4);
  }
  heat.getContext("2d")!.putImageData(img, 0, 0);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  size = r.width;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heat, 0, 0, size, size);

  const x = probe.x * L, y = probe.y * L;
  const [gx, gy] = gradT(x, y);
  const mag = Math.hypot(gx, gy);
  const px = probe.x * size, py = (1 - probe.y) * size;

  // Arrow length: fixed screen scale with a soft cap, direction exact.
  if (mag > 1e-9) {
    const len = Math.min(size * 0.28, 14 + (size * 0.28 - 14) * (1 - Math.exp(-mag / 800)));
    const dx = gx / mag, dy = -gy / mag; // flip y for screen
    const ex = px + dx * len, ey = py + dy * len;
    ctx.lineWidth = 3; ctx.strokeStyle = ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    const ang = Math.atan2(dy, dx), h = 11;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - h * Math.cos(ang - 0.4), ey - h * Math.sin(ang - 0.4));
    ctx.lineTo(ex - h * Math.cos(ang + 0.4), ey - h * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }
  // Probe dot
  ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "#111"; ctx.stroke();

  $("pos").textContent = `(${(x * 1000).toFixed(1)}, ${(y * 1000).toFixed(1)}) mm`;
  $("temp").textContent = `${T(x, y).toFixed(2)} K`;
  $("grad").textContent = `(${gx.toFixed(0)}, ${gy.toFixed(0)}) K/m`;
  $("mag").textContent = `${mag.toFixed(0)} K/m`;
}

function moveTo(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  probe.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  probe.y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
  draw();
}

canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); moveTo(e); });
canvas.addEventListener("pointermove", (e) => { if (canvas.hasPointerCapture(e.pointerId)) moveTo(e); });
window.addEventListener("resize", resize);

buildHeat();
resize();

mountNav("tgrad");
