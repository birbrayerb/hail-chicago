// Procedural Chicago-ish grid: streets, blocks, a Loop skyscraper cluster, Lake Michigan.

export const BLOCK = 260; // spacing between street centrelines
export const ROAD = 64; // street width
export const HALF = ROAD / 2;
export const N = 20; // 20x20 blocks -> 21 streets per axis

export const CITY_W = N * BLOCK; // last vertical street (our Lake Shore Drive)
export const CITY_H = N * BLOCK;
export const LAKE_X = CITY_W + HALF; // Lake Michigan starts here, impassable
export const LAKE_W = 1500;
export const WORLD_W = LAKE_X + LAKE_W;
export const WORLD_H = CITY_H + HALF;

// The Loop: dense towers, centre-east of the grid.
export const LOOP_I0 = 12;
export const LOOP_I1 = 17;
export const LOOP_J0 = 8;
export const LOOP_J1 = 12;

export type NodeKind = 'dock' | 'stand' | 'moped';

export interface CityNode {
  kind: NodeKind;
  x: number;
  y: number;
}

export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  roof: string;
  tall: boolean;
  park: boolean;
}

export interface Corner {
  x: number;
  y: number;
}

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRICK = ['#8b3a2e', '#a04a34', '#7a3128', '#96422f', '#b05a3c', '#6f2f27'];
const STONE = ['#6e6a66', '#827c75', '#5c5955', '#8f8880'];
const TOWER = ['#3f4753', '#4a5361', '#353c47', '#545e6d', '#2e343d'];

const LIGHT: Record<string, string> = {};
export function lighten(hex: string, amt: number): string {
  const key = hex + amt;
  const cached = LIGHT[key];
  if (cached) return cached;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 255 * amt) | 0;
  const g = Math.min(255, ((n >> 8) & 255) + 255 * amt) | 0;
  const b = Math.min(255, (n & 255) + 255 * amt) | 0;
  const out = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  LIGHT[key] = out;
  return out;
}

export function inLoop(i: number, j: number) {
  return i >= LOOP_I0 && i <= LOOP_I1 && j >= LOOP_J0 && j <= LOOP_J1;
}

/** Distance from a coordinate to the nearest street centreline. */
function distToStreet(v: number) {
  const k = Math.round(v / BLOCK);
  if (k < 0 || k > N) return Infinity;
  return Math.abs(v - k * BLOCK);
}

/** How close you are to the middle of the road (0 = dead centre = the lane-split gap). */
export function laneOffset(x: number, y: number): number {
  return Math.min(distToStreet(x), distToStreet(y));
}

export function isRoad(x: number, y: number): boolean {
  if (x >= LAKE_X) return false; // the lake says no
  if (x < -HALF || y < -HALF || x > CITY_W + HALF || y > CITY_H + HALF) return false;
  return distToStreet(x) <= HALF || distToStreet(y) <= HALF;
}

export class City {
  buildings: Building[] = [];
  /** buildings bucketed per block for cheap culling */
  private blockIndex = new Map<number, Building[]>();
  nodes: CityNode[] = [];
  corners: Corner[] = [];

  constructor(seed = 1871) {
    const rnd = mulberry32(seed);
    this.generateBlocks(rnd);
    this.generateNodes(rnd);
    this.generateCorners(rnd);
  }

  private push(i: number, j: number, b: Building) {
    this.buildings.push(b);
    const key = j * N + i;
    const arr = this.blockIndex.get(key);
    if (arr) arr.push(b);
    else this.blockIndex.set(key, [b]);
  }

  private generateBlocks(rnd: () => number) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x0 = i * BLOCK + HALF;
        const y0 = j * BLOCK + HALF;
        const w = BLOCK - ROAD;
        const h = BLOCK - ROAD;
        const loop = inLoop(i, j);

        // green squares hugging the lakefront (Grant Park energy)
        if (!loop && i >= N - 3 && rnd() < 0.4) {
          this.push(i, j, {
            x: x0 + 3,
            y: y0 + 3,
            w: w - 6,
            h: h - 6,
            color: '#2f5b3a',
            roof: '#3a6b46',
            tall: false,
            park: true,
          });
          continue;
        }

        const cols = rnd() < (loop ? 0.55 : 0.45) ? 1 : 2;
        const rows = rnd() < (loop ? 0.55 : 0.45) ? 1 : 2;
        const cw = w / cols;
        const ch = h / rows;

        for (let a = 0; a < cols; a++) {
          for (let b = 0; b < rows; b++) {
            const pad = loop ? 3 : 4 + rnd() * 6;
            const bw = cw - pad * 2;
            const bh = ch - pad * 2;
            if (bw < 16 || bh < 16) continue;
            const tall = loop && rnd() < 0.85;
            const palette = tall ? TOWER : rnd() < 0.6 ? BRICK : STONE;
            const color = palette[(rnd() * palette.length) | 0];
            this.push(i, j, {
              x: x0 + a * cw + pad,
              y: y0 + b * ch + pad,
              w: bw,
              h: bh,
              color,
              roof: lighten(color, tall ? 0.14 : 0.09),
              tall,
              park: false,
            });
          }
        }
      }
    }
  }

  private generateNodes(rnd: () => number) {
    const place = (kind: NodeKind, count: number, minGap: number) => {
      let placed = 0;
      let guard = 0;
      while (placed < count && guard++ < 6000) {
        const i = 1 + ((rnd() * (N - 1)) | 0);
        const j = 1 + ((rnd() * (N - 1)) | 0);
        const x = i * BLOCK;
        const y = j * BLOCK;
        let ok = true;
        for (const n of this.nodes) {
          if (Math.hypot(n.x - x, n.y - y) < minGap) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        this.nodes.push({ kind, x, y });
        placed++;
      }
    };

    place('dock', 12, BLOCK * 2.1);
    place('stand', 4, BLOCK * 2.6);
    place('moped', 3, BLOCK * 2.6);
  }

  private generateCorners(rnd: () => number) {
    let guard = 0;
    while (this.corners.length < 44 && guard++ < 9000) {
      const i = 1 + ((rnd() * (N - 1)) | 0);
      const j = 1 + ((rnd() * (N - 1)) | 0);
      const x = i * BLOCK;
      const y = j * BLOCK;
      let ok = true;
      for (const c of this.corners) {
        if (Math.hypot(c.x - x, c.y - y) < BLOCK * 1.1) {
          ok = false;
          break;
        }
      }
      if (ok) this.corners.push({ x, y });
    }
  }

  nearestNode(x: number, y: number, kind?: NodeKind): CityNode | null {
    let best: CityNode | null = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      if (kind && n.kind !== kind) continue;
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** Buildings overlapping a world-space rect. */
  visibleBuildings(x0: number, y0: number, x1: number, y1: number, out: Building[]): Building[] {
    out.length = 0;
    const i0 = Math.max(0, Math.floor(x0 / BLOCK) - 1);
    const i1 = Math.min(N - 1, Math.ceil(x1 / BLOCK));
    const j0 = Math.max(0, Math.floor(y0 / BLOCK) - 1);
    const j1 = Math.min(N - 1, Math.ceil(y1 / BLOCK));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const arr = this.blockIndex.get(j * N + i);
        if (arr) for (const b of arr) out.push(b);
      }
    }
    return out;
  }
}
