// The three rides. Numbers here are the whole game feel — tune with care.

export type VehicleKind = 'taxi' | 'moped' | 'bike';

export interface VehicleSpec {
  name: string;
  max: number; // top speed, px/s
  accel: number;
  brakePower: number;
  turn: number; // rad/s at speed
  grip: number; // how fast velocity snaps to heading (low = drifty)
  drag: number;
  len: number;
  wid: number;
  radius: number;
  fareMult: number;
  timeMult: number;
  bumpLoss: number; // fraction of speed kept after clipping traffic
  body: string;
  trim: string;
  /** taxi only: gets choked when boxed in by traffic */
  trafficChoke: number;
  /** moped only: can ride the centreline gap between lanes */
  laneSplit: boolean;
  /** bike only: must be returned to a Divvy dock to bank the fare */
  mustDock: boolean;
  blurb: string;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  taxi: {
    name: 'TAXI',
    max: 335,
    accel: 235,
    brakePower: 520,
    turn: 2.6,
    grip: 5.5,
    drag: 0.55,
    len: 34,
    wid: 17,
    radius: 15,
    fareMult: 1.5,
    timeMult: 1.0,
    bumpLoss: 0.42,
    body: '#f5c518',
    trim: '#2b3038',
    trafficChoke: 0.72,
    laneSplit: false,
    mustDock: false,
    blurb: 'Top speed, fattest fares, handles like a sofa. Traffic strangles it.',
  },
  moped: {
    name: 'MOPED',
    max: 272,
    accel: 430,
    brakePower: 560,
    turn: 4.1,
    grip: 12,
    drag: 0.7,
    len: 24,
    wid: 11,
    radius: 10,
    fareMult: 1.05,
    timeMult: 1.05,
    bumpLoss: 0.6,
    body: '#e8532e',
    trim: '#f2f2f4',
    trafficChoke: 1,
    laneSplit: true,
    mustDock: false,
    blurb: 'Instant acceleration and it lane-splits clean through traffic.',
  },
  bike: {
    name: 'DIVVY',
    max: 182,
    accel: 320,
    brakePower: 430,
    turn: 4.5,
    grip: 18,
    drag: 0.9,
    len: 22,
    wid: 9,
    radius: 9,
    fareMult: 0.8,
    timeMult: 1.15,
    bumpLoss: 0.5,
    body: '#1f7ad4',
    trim: '#d8e6f4',
    trafficChoke: 1,
    laneSplit: false,
    mustDock: true,
    blurb: 'Slow and cheap — but dock it after each drop-off for a fat bonus.',
  },
};

/** Which vehicle a swap node hands you. */
export const NODE_VEHICLE = {
  dock: 'bike',
  stand: 'taxi',
  moped: 'moped',
} as const;

export function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
