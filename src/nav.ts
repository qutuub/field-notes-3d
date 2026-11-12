import { L, T, T3 } from "./field";

export type SceneId = "still" | "moving" | "tracer" | "follow" | "tgrad";

/** Scene order. 1-4 live on the 3D page (switched by #hash); 5 is the 2D probe page. */
const SCENES: { id: SceneId; n: number; label: string; href: string }[] = [
  { id: "still", n: 1, label: "Still", href: "particles.html#1" },
  { id: "moving", n: 2, label: "Moving", href: "particles.html#2" },
  { id: "tracer", n: 3, label: "Tracer", href: "particles.html#3" },
  { id: "follow", n: 4, label: "Follow", href: "particles.html#4" },
  { id: "tgrad", n: 5, label: "∇T probe", href: "./" },
];

function ramp(t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const lo = [59, 94, 190], mid = [245, 243, 235], hi = [196, 52, 44];
  const [a, b, f] = k < 0.5 ? [lo, mid, k * 2] : [mid, hi, (k - 0.5) * 2];
  return `rgb(${[0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f)).join(",")})`;
}

const W = 96, H = 64;

function thumbHeat(g: CanvasRenderingContext2D) {
  const img = g.createImageData(W, H);
  const vals: number[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = T(((i + 0.5) / W) * L, (1 - (j + 0.5) / H) * L); vals.push(v);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  vals.forEach((v, p) => {
    const m = ramp((v - lo) / (hi - lo)).match(/\d+/g)!.map(Number);
    img.data.set([m[0], m[1], m[2], 255], p * 4);
  });
  g.putImageData(img, 0, 0);
  // probe + arrow, echoing the scene
  g.strokeStyle = g.fillStyle = "#111"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(38, 34); g.lineTo(60, 20); g.stroke();
  g.beginPath(); g.moveTo(66, 17); g.lineTo(56, 18); g.lineTo(61, 27); g.fill();
  g.beginPath(); g.arc(38, 34, 4, 0, 7); g.fillStyle = "#fff"; g.fill(); g.stroke();
}

function cube(g: CanvasRenderingContext2D, n: number, spread: number, r: number, alpha: number, streak = false) {
  g.fillStyle = "#0d0d0f"; g.fillRect(0, 0, W, H);
  const c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6);
  const pts: { x: number; y: number; d: number; col: string }[] = [];
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n, y = (j + 0.5) / n, z = (k + 0.5) / n;
    pts.push({
      x: W / 2 + (x - z) * c30 * 34 * spread, y: H * 0.62 + ((x + z) * s30 * 22 - y * 38) * spread - (spread - 1) * 14,
      d: x + z, col: ramp((T3(x * L, y * L, z * L) - 300) / 60),
    });
  }
  pts.sort((a, b) => a.d - b.d);
  g.globalAlpha = alpha;
  for (const p of pts) {
    g.fillStyle = g.strokeStyle = p.col;
    if (streak) { g.lineWidth = 1; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 6, p.y - 3); g.stroke(); }
    g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}
function tracer(g: CanvasRenderingContext2D, scale: number) {
  g.strokeStyle = "#ffd400"; g.lineWidth = 2 * scale;
  g.beginPath(); g.moveTo(20, 52); g.quadraticCurveTo(36, 14, 66, 30); g.stroke();
  g.beginPath(); g.arc(66, 30, 3.8 * scale, 0, 7); g.fillStyle = "#ffd400"; g.fill();
  g.lineWidth = 1; g.strokeStyle = "#111"; g.stroke();
}
const thumbStill = (g: CanvasRenderingContext2D) => cube(g, 8, 1, 1.3, 1);
const thumbMoving = (g: CanvasRenderingContext2D) => cube(g, 8, 1, 1.3, 0.9, true);
const thumbTracer = (g: CanvasRenderingContext2D) => { cube(g, 8, 1, 1.3, 0.28, true); tracer(g, 1); };
const thumbFollow = (g: CanvasRenderingContext2D) => { cube(g, 4, 1.8, 2.6, 0.3); tracer(g, 1.3); };

/** Fill <nav id="scenes"> with a thumbnail strip. Call setCurrent() when the scene changes. */
export function mountNav(current: SceneId) {
  const nav = document.getElementById("scenes");
  if (!nav) return;
  nav.setAttribute("aria-label", "Scenes");
  for (const s of SCENES) {
    const el = document.createElement("a");
    el.className = "thumb"; el.href = s.href; el.dataset.id = s.id;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d")!;
    ({ still: thumbStill, moving: thumbMoving, tracer: thumbTracer, follow: thumbFollow, tgrad: thumbHeat })[s.id](g);
    const lab = document.createElement("span");
    lab.textContent = `${s.n} · ${s.label}`;
    el.append(cv, lab);
    nav.append(el);
  }
  setCurrent(current);
}

export function setCurrent(id: SceneId) {
  document.querySelectorAll<HTMLElement>("#scenes .thumb").forEach((el) => {
    const on = el.dataset.id === id;
    el.classList.toggle("current", on);
    if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
  });
}
