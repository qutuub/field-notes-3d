/** Illustrative temperature field on a square domain, L metres a side. */
export const L = 0.1; // m
const blobs = [
  { x: 0.032, y: 0.04, s: 0.018, a: 40 }, // hot
  { x: 0.07, y: 0.065, s: 0.022, a: -25 }, // cold
  { x: 0.06, y: 0.02, s: 0.015, a: 15 },
];
export const T0 = 320; // K

export function T(x: number, y: number): number {
  let t = T0;
  for (const b of blobs) {
    const r2 = (x - b.x) ** 2 + (y - b.y) ** 2;
    t += b.a * Math.exp(-r2 / (2 * b.s * b.s));
  }
  return t;
}

/** Central finite difference, as a solver would compute it. Returns K/m. */
export function gradT(x: number, y: number): [number, number] {
  const h = L / 200;
  return [
    (T(x + h, y) - T(x - h, y)) / (2 * h),
    (T(x, y + h) - T(x, y - h)) / (2 * h),
  ];
}

/** 3D version: same blobs, with a depth coordinate z. */
const blobs3 = [
  { x: 0.032, y: 0.04, z: 0.03, s: 0.018, a: 40 },
  { x: 0.07, y: 0.065, z: 0.07, s: 0.022, a: -25 },
  { x: 0.06, y: 0.02, z: 0.05, s: 0.015, a: 15 },
];
export function T3(x: number, y: number, z: number): number {
  let t = T0;
  for (const b of blobs3) {
    const r2 = (x - b.x) ** 2 + (y - b.y) ** 2 + (z - b.z) ** 2;
    t += b.a * Math.exp(-r2 / (2 * b.s * b.s));
  }
  return t;
}

/**
 * Velocity field (m/s): divergence-free, no flow through the cube's walls,
 * so tracer particles circulate and stay inside. Peak speed ~ U.
 * u = sin x cos y cos z, v = -½ cos x sin y cos z, w = -½ cos x cos y sin z
 * with x,y,z scaled to [0, π] across the domain.
 */
export function vel(x: number, y: number, z: number, U: number): [number, number, number] {
  const k = Math.PI / L;
  const sx = Math.sin(k * x), cx = Math.cos(k * x);
  const sy = Math.sin(k * y), cy = Math.cos(k * y);
  const sz = Math.sin(k * z), cz = Math.cos(k * z);
  return [U * sx * cy * cz, -0.5 * U * cx * sy * cz, -0.5 * U * cx * cy * sz];
}
