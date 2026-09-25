// Keyed, order-independent randomness.
// Every "world" decision is a pure function of (seed, key), so a run is
// reproducible and independent of the order in which agents act.

function hashString(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a: number): number {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform [0,1) derived from seed + key. */
export function rand(seed: number, key: string): number {
  return mulberry32(hashString(key) ^ Math.imul(seed, 0x9e3779b1));
}

export function randInt(seed: number, key: string, min: number, max: number): number {
  return min + Math.floor(rand(seed, key) * (max - min + 1));
}

export function chance(seed: number, key: string, p: number): boolean {
  return rand(seed, key) < p;
}

export function pick<T>(seed: number, key: string, arr: readonly T[]): T {
  return arr[Math.floor(rand(seed, key) * arr.length) % arr.length];
}

/** Stable short hash of any JSON-serialisable value (used to prove replay == live). */
export function stateHash(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
  return hashString(json).toString(16).padStart(8, "0");
}

function flattenKeys(value: unknown, acc: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc[k] = true;
      flattenKeys(v, acc);
    }
  }
  return acc;
}
