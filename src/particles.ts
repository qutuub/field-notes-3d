import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { L, T3, vel } from "./field";
import { mountNav, setCurrent, type SceneId } from "./nav";

const stage = document.getElementById("stage")!;
const $ = (id: string) => document.getElementById(id)!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
stage.appendChild(renderer.domElement);
renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 10);
camera.position.set(0.2, 0.15, 0.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.05, 0.05, 0.05);
const D_MIN = 0.005, D_MAX = 0.6; // metres, camera to target
controls.minDistance = D_MIN; controls.maxDistance = D_MAX;
controls.enableDamping = false; // static scene: render only on change
controls.update();

// Soft round sprite so points are discs, not squares.
const sprite = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "#fff"); grd.addColorStop(0.7, "#fff"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

const material = new THREE.PointsMaterial({
  size: 5, sizeAttenuation: false, vertexColors: true, map: sprite,
  transparent: true, alphaTest: 0.02, depthWrite: true, opacity: 0.25,
});
let points: THREE.Points | null = null;

// --- the followed point: bright marker + trail ---
let showTracer = false;             // scenes 3-4 show the tracer
let currentScene = 0;
let followCam = false;              // camera tracks the followed point
let ti = 0;                         // index of the followed particle
const TRAIL_MAX = 800;
const trailPos = new Float32Array(TRAIL_MAX * 3);
let trailN = 0;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffd400, depthTest: false }));
trail.frustumCulled = false; trail.renderOrder = 10;
scene.add(trail);
const markGeo = new THREE.BufferGeometry();
markGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
const marker = new THREE.Points(markGeo, new THREE.PointsMaterial({
  size: 16, sizeAttenuation: false, color: 0xffd400, map: sprite, transparent: true, alphaTest: 0.3, depthTest: false,
}));
marker.frustumCulled = false; marker.renderOrder = 11;
scene.add(marker);

// --- extra tracers: more particles with their own markers and trails ---
const EXTRA_MAX = 50, EX_TRAIL = 300;
let extraCount = 0;
let order: number[] = [];       // fixed shuffled order of cells, so the same ones are picked each time
let extraIdx: number[] = [];
const exMarkGeo = new THREE.BufferGeometry();
exMarkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(EXTRA_MAX * 3), 3));
exMarkGeo.setDrawRange(0, 0);
const exMarkers = new THREE.Points(exMarkGeo, new THREE.PointsMaterial({
  size: 10, sizeAttenuation: false, color: 0x00e5ff, map: sprite, transparent: true, alphaTest: 0.3, depthTest: false,
}));
exMarkers.frustumCulled = false; exMarkers.renderOrder = 9;
scene.add(exMarkers);
const exTrails = Array.from({ length: EXTRA_MAX }, () => {
  const tp = new Float32Array(EX_TRAIL * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(tp, 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.6, depthTest: false }));
  line.frustumCulled = false; line.renderOrder = 8; line.visible = false;
  scene.add(line);
  return { tp, n: 0, geo, line };
});
function shuffleOrder(count: number) {
  order = Array.from({ length: count }, (_, i) => i);
  let seed = 12345;
  for (let i = count - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
}
function clearExtraTrails() { exTrails.forEach((t) => { t.n = 0; t.geo.setDrawRange(0, 0); }); }
function setExtras(k: number) {
  extraCount = k;
  const prev = extraIdx;
  extraIdx = order.filter((i) => i !== ti).slice(0, k);
  exTrails.forEach((t, j) => {
    if (extraIdx[j] !== prev[j]) { t.n = 0; t.geo.setDrawRange(0, 0); }
    t.line.visible = showTracer && j < k;
  });
}
function updateExtras(push: boolean) {
  const a = exMarkGeo.attributes.position;
  extraIdx.forEach((idx, j) => {
    const q = idx * 3, x = pos[q], y = pos[q + 1], z = pos[q + 2];
    a.setXYZ(j, x, y, z);
    const t = exTrails[j];
    if (push || t.n === 0) {
      if (t.n === EX_TRAIL) { t.tp.copyWithin(0, 3); t.n--; }
      t.tp.set([x, y, z], t.n * 3); t.n++;
      t.geo.setDrawRange(0, t.n);
      t.geo.attributes.position.needsUpdate = true;
    }
  });
  a.needsUpdate = true;
  exMarkGeo.setDrawRange(0, extraIdx.length);
}

let pos0 = new Float32Array(0);   // cell centres (rest state)
let pos = new Float32Array(0);    // current positions
let col = new Float32Array(0);
let tmin = 0, tmax = 1;
let playing = true;
let U = 0.04;                      // m/s peak speed
let last = 0;


// Blue -> white -> red ramp (same as the 2D screen).
function ramp(t: number, out: THREE.Color) {
  const k = Math.min(1, Math.max(0, t));
  const lo = [59, 94, 190], mid = [245, 243, 235], hi = [196, 52, 44];
  const [a, b, f] = k < 0.5 ? [lo, mid, k * 2] : [mid, hi, (k - 0.5) * 2];
  out.setRGB((a[0] + (b[0] - a[0]) * f) / 255, (a[1] + (b[1] - a[1]) * f) / 255, (a[2] + (b[2] - a[2]) * f) / 255, THREE.SRGBColorSpace);
}

function build(n: number) {
  if (points) { scene.remove(points); points.geometry.dispose(); }
  pos = new Float32Array(n ** 3 * 3); col = new Float32Array(n ** 3 * 3);
  const vals = new Float32Array(n ** 3);
  tmin = Infinity; tmax = -Infinity; let p = 0;
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++, p++) {
    // Cell centres: one particle per cell, never moved.
    const x = ((i + 0.5) / n) * L, y = ((j + 0.5) / n) * L, z = ((k + 0.5) / n) * L;
    pos.set([x, y, z], p * 3);
    const v = T3(x, y, z); vals[p] = v;
    tmin = Math.min(tmin, v); tmax = Math.max(tmax, v);
  }
  pos0 = pos.slice();
  recolor();
  // Default followed point: a cell off the centre (the centre is a stagnation point).
  const ci = (f: number) => Math.min(n - 1, Math.floor(f * n));
  ti = ci(0.3) + n * (ci(0.4) + n * ci(0.5));
  shuffleOrder(n ** 3); extraIdx = []; clearExtraTrails(); setExtras(extraCount);
  trailN = 0; trailGeo.setDrawRange(0, 0); updateTracked(true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  points = new THREE.Points(geo, material);
  scene.add(points);
  $("nv").textContent = String(n);
  $("count").textContent = (n ** 3).toLocaleString();
  render();
}

/** Shift camera and orbit target together, so the view offset is kept and the point stays centred. */
function recentre(x: number, y: number, z: number) {
  const dx = x - controls.target.x, dy = y - controls.target.y, dz = z - controls.target.z;
  camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
  controls.target.set(x, y, z);
}

function updateTracked(pushTrail: boolean) {
  const q = ti * 3, x = pos[q], y = pos[q + 1], z = pos[q + 2];
  if (followCam) recentre(x, y, z);
  markGeo.attributes.position.setXYZ(0, x, y, z);
  markGeo.attributes.position.needsUpdate = true;
  if (pushTrail) {
    if (trailN === TRAIL_MAX) { trailPos.copyWithin(0, 3); trailN--; }
    trailPos.set([x, y, z], trailN * 3); trailN++;
    trailGeo.setDrawRange(0, trailN);
    trailGeo.attributes.position.needsUpdate = true;
  }
  const [u, v, w] = vel(x, y, z, U);
  $("tpos").textContent = `(${(x * 1000).toFixed(1)}, ${(y * 1000).toFixed(1)}, ${(z * 1000).toFixed(1)}) mm`;
  $("tvel").textContent = `(${(u * 1000).toFixed(1)}, ${(v * 1000).toFixed(1)}, ${(w * 1000).toFixed(1)}) mm/s`;
  $("tspd").textContent = `${(Math.hypot(u, v, w) * 1000).toFixed(1)} mm/s`;
  $("ttemp").textContent = `${T3(x, y, z).toFixed(2)} K`;
  updateExtras(pushTrail);
}
function follow(idx: number) {
  ti = idx; trailN = 0; trailGeo.setDrawRange(0, 0);
  setExtras(extraCount);
  updateTracked(true); render();
}

const tmpC = new THREE.Color();
function recolor() {
  for (let q = 0; q < pos.length / 3; q++) {
    ramp((T3(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]) - tmin) / (tmax - tmin), tmpC);
    col[q * 3] = tmpC.r; col[q * 3 + 1] = tmpC.g; col[q * 3 + 2] = tmpC.b;
  }
}

/** Advance every particle by dt with midpoint (RK2) integration of dx/dt = u(x). */
function step(dt: number) {
  const clamp = (v: number) => Math.min(L, Math.max(0, v));
  for (let q = 0; q < pos.length; q += 3) {
    const x = pos[q], y = pos[q + 1], z = pos[q + 2];
    const [a, b, c] = vel(x, y, z, U);
    const [d, e, f] = vel(x + 0.5 * dt * a, y + 0.5 * dt * b, z + 0.5 * dt * c, U);
    pos[q] = clamp(x + dt * d); pos[q + 1] = clamp(y + dt * e); pos[q + 2] = clamp(z + dt * f);
  }
  recolor();
  updateTracked(true);
  const g = points!.geometry;
  g.attributes.position.needsUpdate = true;
  g.attributes.color.needsUpdate = true;
}

function frame(t: number) {
  if (!playing) return;
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  step(dt);
  render();
  requestAnimationFrame(frame);
}
function setPlaying(on: boolean) {
  playing = on;
  $("play").textContent = on ? "Pause" : "Play";
  if (on) { last = performance.now(); requestAnimationFrame(frame); }
}
function reset() {
  pos.set(pos0); recolor();
  clearExtraTrails();
  trailN = 0; trailGeo.setDrawRange(0, 0); updateTracked(true);
  points!.geometry.attributes.position.needsUpdate = true;
  points!.geometry.attributes.color.needsUpdate = true;
  setPlaying(false); render();
}

function render() { renderer.render(scene, camera); }
function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  render();
}

// Zoom slider (log scale) <-> camera distance. Pinch/scroll keeps the slider in sync.
function syncZoom() {
  const d = camera.position.distanceTo(controls.target);
  (document.getElementById("z") as HTMLInputElement).value = String((100 * Math.log(d / D_MIN)) / Math.log(D_MAX / D_MIN));
  $("zv").textContent = (d * 1000).toFixed(0);
}
$("z").addEventListener("input", (e) => {
  const f = +(e.target as HTMLInputElement).value / 100;
  const d = D_MIN * Math.pow(D_MAX / D_MIN, f);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, d);
  $("zv").textContent = (d * 1000).toFixed(0);
  render();
});
controls.addEventListener("change", () => { syncZoom(); render(); });

// Tap (not drag) selects the particle nearest the finger/cursor.
let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const v = new THREE.Vector3();
  let best = -1, bd = 28 * 28, bz = Infinity;
  for (let q = 0; q < pos.length / 3; q++) {
    v.set(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]).project(camera);
    if (v.z > 1) continue;
    const dx = (v.x * 0.5 + 0.5) * r.width - px, dy = (-v.y * 0.5 + 0.5) * r.height - py;
    const d = dx * dx + dy * dy;
    if (d < bd - 4 || (d <= bd + 4 && v.z < bz)) { bd = Math.min(bd, d); bz = v.z; best = q; }
  }
  if (best >= 0 && showTracer) follow(best);
});
$("x").addEventListener("input", (e) => {
  const k = +(e.target as HTMLInputElement).value;
  $("xv").textContent = String(k);
  setExtras(k); updateExtras(false); render();
});
$("cam").addEventListener("change", (e) => {
  followCam = (e.target as HTMLInputElement).checked;
  if (followCam) recentre(pos[ti * 3], pos[ti * 3 + 1], pos[ti * 3 + 2]);
  render();
});
$("dim").addEventListener("change", () => { applyLook(); render(); });
window.addEventListener("resize", resize);
$("n").addEventListener("input", (e) => build(+(e.target as HTMLInputElement).value));
$("s").addEventListener("input", (e) => {
  material.size = +(e.target as HTMLInputElement).value;
  $("sv").textContent = String(material.size); render();
});

$("play").addEventListener("click", () => setPlaying(!playing));
$("reset").addEventListener("click", reset);
$("u").addEventListener("input", (e) => {
  U = +(e.target as HTMLInputElement).value / 1000;
  $("uv").textContent = String(+(e.target as HTMLInputElement).value);
});

$("sv").textContent = String(material.size);
$("uv").textContent = String(U * 1000);
build(24);
syncZoom();
resize();

// ---------------- scenes ----------------
const IDS: SceneId[] = ["still", "moving", "tracer", "follow"];
const CAPTIONS = [
  "Every cell holds one particle, standing still. Colour = temperature. Drag to rotate.",
  "The flow switches on: every particle is carried along its local velocity.",
  "One tracer is followed. Its trail shows its path. Tap any particle to follow that one instead.",
  "The camera rides with the tracer. Use the zoom slider to look at what is around it.",
];
const camBox = $("cam") as HTMLInputElement;

function applyLook() {
  const dim = ($("dim") as HTMLInputElement).checked;
  marker.visible = trail.visible = exMarkers.visible = showTracer;
  exTrails.forEach((t, j) => { t.line.visible = showTracer && j < extraCount; });
  material.opacity = showTracer && dim ? 0.25 : 1;
}
function clearTrails() {
  trailN = 0; trailGeo.setDrawRange(0, 0); clearExtraTrails(); updateTracked(true);
}
function overview() {
  followCam = false; camBox.checked = false;
  controls.target.set(L / 2, L / 2, L / 2);
  camera.position.set(0.2, 0.15, 0.2);
  controls.update();
}
function setDistance(d: number) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, d);
  syncZoom();
}

function applyScene(n: number) {
  const prev = currentScene;
  currentScene = n;
  document.querySelectorAll<HTMLElement>("[data-scenes]").forEach((el) => {
    el.hidden = !el.dataset.scenes!.split(" ").includes(String(n));
  });
  $("caption").textContent = CAPTIONS[n - 1];
  setCurrent(IDS[n - 1]);

  // Motion
  if (n === 1) reset();                                  // rest, paused
  else if (n === 2) { reset(); setPlaying(true); }       // start from rest, then move
  else { if (prev <= 1) reset(); setPlaying(true); }     // 3-4 keep moving

  // Tracer: starts a fresh trail when it first appears
  const wasShown = showTracer;
  showTracer = n >= 3;
  if (showTracer && !wasShown) clearTrails();
  applyLook();

  // Camera
  if (n === 4) {
    followCam = true; camBox.checked = true;
    recentre(pos[ti * 3], pos[ti * 3 + 1], pos[ti * 3 + 2]);
    setDistance(0.04);
  } else if (prev === 4 || followCam) {
    overview();
  }
  render();
}
const sceneFromHash = () => {
  const n = parseInt(location.hash.slice(1), 10);
  return n >= 1 && n <= 4 ? n : 1;
};
window.addEventListener("hashchange", () => applyScene(sceneFromHash()));
mountNav("still");
applyScene(sceneFromHash());
