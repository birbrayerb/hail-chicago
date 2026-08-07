import {
  BLOCK,
  Building,
  City,
  CityNode,
  HALF,
  LAKE_X,
  LOOP_I0,
  LOOP_I1,
  LOOP_J0,
  LOOP_J1,
  N,
  ROAD,
  WORLD_H,
  isRoad,
  laneOffset,
} from './city';
import { Hud } from './hud';
import { NODE_VEHICLE, SPECS, VehicleKind, VehicleSpec, wrapPi } from './vehicles';
import { sfx } from './sfx';

const VIEW_H = 430; // world px visible vertically — drives the zoom
const START_TIME = 62;
const PICK_R = 58; // pickup / drop-off radius
const NODE_R = 76; // swap + dock radius
const DIVVY_WINDOW = 32; // seconds to dock the bike after a drop-off
const DIVVY_BONUS = 2.1; // multiplier for banking a Divvy fare in time
const SLOW = 110; // speed you must be under to pick up / drop off

type Phase = 'toPickup' | 'toDrop' | 'toDock';

interface Car {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  color: string;
  len: number;
  wid: number;
}

interface Ped {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const CAR_COLORS = ['#d9d9de', '#2f333b', '#8c9199', '#a8332f', '#2b5f8f', '#5c6470', '#e6e9ed', '#3d6b4a'];
const PED_COLORS = ['#f0c9a0', '#d8a679', '#9c6b4a', '#f5e0c8'];
const ASPHALT = '#3c4046';
const SIDEWALK = '#9c9ca1';
const LAKE = '#14507e';

// ---------------------------------------------------------------- skyline
// The Loop, in world coordinates, and the elevated line that rings it.
const LOOP_CX = ((LOOP_I0 + LOOP_I1 + 1) / 2) * BLOCK;
const LOOP_CY = ((LOOP_J0 + LOOP_J1 + 1) / 2) * BLOCK;
const EL = {
  x1: LOOP_I0 * BLOCK,
  x2: (LOOP_I1 + 1) * BLOCK,
  y1: LOOP_J0 * BLOCK,
  y2: (LOOP_J1 + 1) * BLOCK,
};
const EL_PERIM = 2 * (EL.x2 - EL.x1 + EL.y2 - EL.y1);

/** Point on the elevated loop at arc length s, running clockwise. */
function elPoint(s: number) {
  const w = EL.x2 - EL.x1;
  const h = EL.y2 - EL.y1;
  let t = ((s % EL_PERIM) + EL_PERIM) % EL_PERIM;
  if (t < w) return { x: EL.x1 + t, y: EL.y1, a: 0 };
  t -= w;
  if (t < h) return { x: EL.x2, y: EL.y1 + t, a: Math.PI / 2 };
  t -= h;
  if (t < w) return { x: EL.x2 - t, y: EL.y2, a: Math.PI };
  t -= w;
  return { x: EL.x1, y: EL.y2 - t, a: -Math.PI / 2 };
}

/** Fake building height. Towers taper up toward the middle of the Loop. */
function storeys(b: Building): number {
  const jitter = Math.abs((b.x * 13 + b.y * 7) | 0) % 28;
  if (!b.tall) return 14 + (jitter % 16);
  const d = Math.hypot(b.x - LOOP_CX, b.y - LOOP_CY);
  const core = Math.max(0, 1 - d / 780);
  return 46 + core * core * 150 + jitter;
}

/** Painter's order: far from the camera first, so near extrusions win. */
function rank(b: Building, cx: number, cy: number): number {
  return (b.x - cx) ** 2 + (b.y - cy) ** 2;
}

const SHADES = new Map<string, string>();
function shade(hex: string, f: number): string {
  const key = hex + f;
  const hit = SHADES.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const r = (((n >> 16) & 255) * f) | 0;
  const gg = (((n >> 8) & 255) * f) | 0;
  const bb = ((n & 255) * f) | 0;
  const out = `rgb(${r},${gg},${bb})`;
  SHADES.set(key, out);
  return out;
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private zoom = 1;

  // player
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private heading = -Math.PI / 2;
  private speed = 0;
  private kind: VehicleKind = 'taxi';
  private spec: VehicleSpec = SPECS.taxi;

  // camera
  private camx = 0;
  private camy = 0;
  private shake = 0;

  // run
  private running = false;
  private time = START_TIME;
  private score = 0;
  private fares = 0;
  private docked = 0;
  private streak = 0;
  private bestStreak = 0;

  // fare
  private phase: Phase = 'toPickup';
  private pickup = { x: 0, y: 0 };
  private drop = { x: 0, y: 0 };
  private pending = 0;
  private dockLeft = 0;
  private dockNode: CityNode | null = null;

  private traffic: Car[] = [];
  private peds: Ped[] = [];
  private nearNode: CityNode | null = null;
  private bumpCd = 0;
  private last = 0;
  private fps = 60;
  private buf: Building[] = [];
  private now = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private hud: Hud,
    private city: City
  ) {
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('2d context unavailable');
    this.ctx = c;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));

    hud.onStart = (v) => this.start(v);
    hud.onSwap = () => this.swap();
    hud.onAgain = () => hud.showStart(this.best());

    hud.showStart(this.best());
    (window as unknown as { __game: Game }).__game = this;
    requestAnimationFrame((t) => this.frame(t));
  }

  private best() {
    return Number(localStorage.getItem('hail-chicago-best') || 0);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.zoom = Math.max(0.55, Math.min(2.4, h / VIEW_H));
  }

  // ------------------------------------------------------------------ run

  start(kind: VehicleKind) {
    const home = this.city.nodes.find((n) => NODE_VEHICLE[n.kind] === kind) ?? this.city.nodes[0];
    this.px = home.x;
    this.py = home.y;
    this.vx = this.vy = this.speed = 0;
    this.heading = -Math.PI / 2;
    this.camx = this.px;
    this.camy = this.py;

    this.setVehicle(kind);
    this.running = true;
    this.time = START_TIME;
    this.score = 0;
    this.fares = 0;
    this.docked = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.pending = 0;
    this.dockNode = null;
    this.traffic.length = 0;
    this.peds.length = 0;

    this.newPassenger();
    this.hud.setScore(0);
    this.hud.setDivvy(false);
    this.hud.showGame();
    sfx.unlock();
  }

  private setVehicle(k: VehicleKind) {
    this.kind = k;
    this.spec = SPECS[k];
    this.hud.setVehicle(k);
  }

  private end() {
    this.running = false;
    const best = Math.max(this.score, this.best());
    localStorage.setItem('hail-chicago-best', String(best));
    this.hud.setDivvy(false);
    this.hud.setSwap(null);
    const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    this.hud.showOver(this.score, [
      s(this.fares, 'fare'),
      s(this.docked, 'Divvy return'),
      `best streak ×${this.bestStreak || 1}`,
      `personal best $${best}`,
    ]);
  }

  // ------------------------------------------------------------------ fares

  private corner(min: number, max: number) {
    const list = this.city.corners;
    let fallback = list[0];
    for (let i = 0; i < 80; i++) {
      const c = list[(Math.random() * list.length) | 0];
      const d = Math.hypot(c.x - this.px, c.y - this.py);
      if (d > min && d < max) return c;
      if (d > min * 0.5) fallback = c;
    }
    return fallback;
  }

  private newPassenger() {
    const c = this.corner(450, 1600);
    this.pickup = { x: c.x, y: c.y };
    this.phase = 'toPickup';
  }

  private pickUp() {
    const d = this.corner(1000, 2400);
    this.drop = { x: d.x, y: d.y };
    this.phase = 'toDrop';
    this.time += 6;
    this.hud.toast('PASSENGER IN  ·  +6s', 'info');
    sfx.blip(700);
  }

  private dropOff() {
    const dist = Math.hypot(this.drop.x - this.pickup.x, this.drop.y - this.pickup.y);
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const streakMul = 1 + Math.min(4, this.streak - 1) * 0.15;
    const fare = Math.round((10 + dist / 40) * this.spec.fareMult * streakMul);
    const bonus = Math.round(Math.max(12, Math.min(28, 10 + dist / 120)) * this.spec.timeMult);

    this.fares++;
    this.time += bonus;

    if (this.spec.mustDock) {
      this.pending = fare;
      this.dockLeft = DIVVY_WINDOW;
      this.dockNode = this.city.nearestNode(this.px, this.py, 'dock');
      this.phase = 'toDock';
      this.hud.toast(`DROPPED OFF  ·  +${bonus}s`, 'info');
      this.hud.setDivvy(true, 1, fare);
      sfx.blip(540);
    } else {
      this.score += fare;
      this.hud.setScore(this.score);
      this.hud.toast(`+$${fare}   +${bonus}s`, 'good');
      sfx.cash();
      this.newPassenger();
    }
  }

  private bankDivvy() {
    const paid = Math.round(this.pending * DIVVY_BONUS);
    this.score += paid;
    this.docked++;
    this.time += 8;
    this.pending = 0;
    this.hud.setScore(this.score);
    this.hud.setDivvy(false);
    this.hud.toast(`DOCKED!  +$${paid}  +8s`, 'good');
    sfx.cash();
    this.newPassenger();
  }

  private loseDivvy() {
    this.pending = 0;
    this.streak = 0;
    this.hud.setDivvy(false);
    this.hud.toast('NOT DOCKED — FARE LOST', 'bad');
    sfx.buzz();
    this.newPassenger();
  }

  swap() {
    if (!this.running || !this.nearNode || this.phase === 'toDock') return;
    const want = NODE_VEHICLE[this.nearNode.kind] as VehicleKind;
    if (want === this.kind) return;
    this.setVehicle(want);
    this.speed *= 0.25;
    this.vx *= 0.25;
    this.vy *= 0.25;
    this.hud.toast(`NOW RIDING: ${SPECS[want].name}`, 'info');
    sfx.blip(460);
  }

  // ------------------------------------------------------------------ loop

  private frame(ts: number) {
    requestAnimationFrame((t) => this.frame(t));
    if (!this.last) this.last = ts;
    const raw = (ts - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = ts;
    this.now = ts;
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;
    (window as unknown as { __fps: number }).__fps = Math.round(this.fps);

    this.tick(dt);
    this.draw();
  }

  /** One simulation step. Exposed via window.__game so it can be driven in tests. */
  tick(dt: number) {
    if (!this.running) return;
    this.stepPlayer(dt);
    this.stepTraffic(dt);
    this.stepPeds(dt);
    this.stepObjectives(dt);
    this.time -= dt;
    this.hud.setTimer(this.time);
    if (this.time <= 0) {
      this.time = 0;
      this.end();
    }
  }

  private stepPlayer(dt: number) {
    const c = this.hud.controls;
    const s = this.spec;

    // steer: nose swings toward the stick direction
    if (c.mag > 0.18) {
      const target = Math.atan2(c.sy, c.sx);
      const diff = wrapPi(target - this.heading);
      const agility = 0.6 + 0.4 * (1 - Math.min(1, Math.abs(this.speed) / s.max));
      const max = s.turn * agility * dt;
      this.heading += Math.max(-max, Math.min(max, diff));
    }

    // traffic choke: the taxi bogs down when boxed in
    let cap = s.max;
    if (s.trafficChoke < 1) {
      for (const car of this.traffic) {
        const dx = car.x - this.px;
        const dy = car.y - this.py;
        if (dx * dx + dy * dy < 82 * 82 && dx * Math.cos(this.heading) + dy * Math.sin(this.heading) > 0) {
          cap = s.max * s.trafficChoke;
          break;
        }
      }
    }

    const throttle = c.gas ? 1 : c.mag > 0.18 ? 0.9 * c.mag : 0;
    if (throttle > 0) this.speed += s.accel * throttle * dt;
    if (c.brake) this.speed -= s.brakePower * dt;
    if (throttle === 0 && !c.brake) this.speed -= this.speed * s.drag * dt;
    this.speed = Math.max(-cap * 0.32, Math.min(cap, this.speed));

    // velocity chases the heading — low grip means the taxi slides
    const k = 1 - Math.exp(-s.grip * dt);
    this.vx += (Math.cos(this.heading) * this.speed - this.vx) * k;
    this.vy += (Math.sin(this.heading) * this.speed - this.vy) * k;

    const nx = this.px + this.vx * dt;
    const ny = this.py + this.vy * dt;
    let blocked = 0;
    if (isRoad(nx, this.py)) this.px = nx;
    else {
      this.vx *= -0.1;
      blocked++;
    }
    if (isRoad(this.px, ny)) this.py = ny;
    else {
      this.vy *= -0.1;
      blocked++;
    }
    // glancing a wall should let you slide along it; a head-on hit should hurt
    if (blocked === 2) this.speed *= 0.55;
    else if (blocked === 1) this.speed *= 1 - 1.6 * dt;

    this.px = Math.max(-HALF + 5, Math.min(LAKE_X - 5, this.px));
    this.py = Math.max(-HALF + 5, Math.min(WORLD_H - 5, this.py));

    // camera: follow with a little look-ahead
    const lead = Math.min(1, Math.abs(this.speed) / s.max) * 95;
    const tx = this.px + Math.cos(this.heading) * lead;
    const ty = this.py + Math.sin(this.heading) * lead;
    const kc = 1 - Math.pow(0.002, dt);
    this.camx += (tx - this.camx) * kc;
    this.camy += (ty - this.camy) * kc;

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.6);
    if (this.bumpCd > 0) this.bumpCd -= dt;
  }

  // ------------------------------------------------------------------ traffic

  private spawnCar(far: boolean) {
    const vertical = Math.random() < 0.5;
    const line = Math.max(
      0,
      Math.min(N, Math.round((vertical ? this.px : this.py) / BLOCK) + ((Math.random() * 5) | 0) - 2)
    );
    const dir = Math.random() < 0.5 ? 1 : -1;
    const base = vertical ? this.py : this.px;
    const along =
      base +
      (far
        ? (Math.random() < 0.5 ? -1 : 1) * (500 + Math.random() * 800)
        : (Math.random() - 0.5) * 700);
    const lane = ROAD / 4;
    const sp = 65 + Math.random() * 65;
    const car: Car = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
      len: 26 + Math.random() * 12,
      wid: 13,
    };
    if (vertical) {
      car.x = line * BLOCK + (dir > 0 ? -lane : lane);
      car.y = Math.max(0, Math.min(WORLD_H, along));
      car.vy = dir * sp;
      car.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.y = line * BLOCK + (dir > 0 ? lane : -lane);
      car.x = Math.max(0, Math.min(LAKE_X - ROAD, along));
      car.vx = dir * sp;
      car.heading = dir > 0 ? 0 : Math.PI;
    }
    if (!isRoad(car.x, car.y)) return;
    if (Math.hypot(car.x - this.px, car.y - this.py) < 90) return;
    this.traffic.push(car);
  }

  private stepTraffic(dt: number) {
    let guard = 0;
    while (this.traffic.length < 24 && guard++ < 60) this.spawnCar(this.traffic.length > 7);

    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const c = this.traffic[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;

      const dx = c.x - this.px;
      const dy = c.y - this.py;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1500 * 1500 || !isRoad(c.x, c.y)) {
        this.traffic.splice(i, 1);
        continue;
      }

      // oriented box overlap — lets you slip past a car in the next lane
      if (d2 < 90 * 90 && this.bumpCd <= 0) {
        const cs = Math.cos(c.heading);
        const sn = Math.sin(c.heading);
        const along = Math.abs(dx * cs + dy * sn);
        const side = Math.abs(-dx * sn + dy * cs);
        if (along < c.len / 2 + this.spec.len / 2 - 4 && side < c.wid / 2 + this.spec.wid / 2 - 2) {
          let keep = this.spec.bumpLoss;
          const splitting = this.spec.laneSplit && laneOffset(this.px, this.py) < 12;
          if (splitting) keep = 0.93; // threading the gap between lanes
          this.speed *= keep;
          this.vx *= keep;
          this.vy *= keep;
          const d = Math.max(1, Math.sqrt(d2));
          const push = (1 - keep) * 16;
          const nx2 = this.px - (dx / d) * push;
          const ny2 = this.py - (dy / d) * push;
          if (isRoad(nx2, ny2)) {
            this.px = nx2;
            this.py = ny2;
          }
          this.bumpCd = 0.3;
          if (!splitting) {
            this.shake = 0.28 + (1 - keep) * 0.35;
            sfx.thud();
            this.streak = 0;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ pedestrians

  private spawnPed() {
    const i = Math.round(this.px / BLOCK) + ((Math.random() * 5) | 0) - 2;
    const j = Math.round(this.py / BLOCK) + ((Math.random() * 5) | 0) - 2;
    if (i < 0 || i > N || j < 0 || j > N) return;
    const cx = i * BLOCK;
    const cy = j * BLOCK;
    if (cx >= LAKE_X) return;
    if (Math.hypot(cx - this.px, cy - this.py) < 80) return;
    const acrossX = Math.random() < 0.5;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const sp = 26 + Math.random() * 18;
    const off = (Math.random() < 0.5 ? 1 : -1) * (HALF - 4);
    this.peds.push({
      x: acrossX ? cx - dir * (HALF + 8) : cx + off,
      y: acrossX ? cy + off : cy - dir * (HALF + 8),
      vx: acrossX ? dir * sp : 0,
      vy: acrossX ? 0 : dir * sp,
      life: 7,
      color: PED_COLORS[(Math.random() * PED_COLORS.length) | 0],
    });
  }

  private stepPeds(dt: number) {
    if (this.peds.length < 12 && Math.random() < 0.4) this.spawnPed();
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const dx = p.x - this.px;
      const dy = p.y - this.py;
      const d2 = dx * dx + dy * dy;
      if (p.life <= 0 || d2 > 1200 * 1200) {
        this.peds.splice(i, 1);
        continue;
      }
      if (d2 < 14 * 14 && Math.abs(this.speed) > 45) {
        this.peds.splice(i, 1);
        this.time -= 5;
        this.speed *= 0.45;
        this.vx *= 0.45;
        this.vy *= 0.45;
        this.shake = 0.45;
        this.streak = 0;
        this.hud.toast('SORRY!  −5s', 'bad');
        sfx.buzz();
      }
    }
  }

  // ------------------------------------------------------------------ objectives

  private stepObjectives(dt: number) {
    const slow = Math.abs(this.speed) < SLOW;

    if (this.phase === 'toPickup') {
      const d = Math.hypot(this.pickup.x - this.px, this.pickup.y - this.py);
      if (d < PICK_R) {
        if (slow) this.pickUp();
        else this.hud.setObjective('EASE OFF TO PICK UP', true);
      } else {
        this.hud.setObjective(`PICK UP FARE · ${(d / 26) | 0} m`);
      }
    } else if (this.phase === 'toDrop') {
      const d = Math.hypot(this.drop.x - this.px, this.drop.y - this.py);
      if (d < PICK_R) {
        if (slow) this.dropOff();
        else this.hud.setObjective('EASE OFF TO DROP OFF', true);
      } else {
        this.hud.setObjective(`DROP OFF · ${(d / 26) | 0} m`);
      }
    } else {
      this.dockLeft -= dt;
      this.hud.setDivvy(true, this.dockLeft / DIVVY_WINDOW, this.pending);
      if (!this.dockNode) this.dockNode = this.city.nearestNode(this.px, this.py, 'dock');
      const t = this.dockNode;
      if (t) {
        const d = Math.hypot(t.x - this.px, t.y - this.py);
        this.hud.setObjective(`DOCK THE BIKE · ${Math.max(0, this.dockLeft).toFixed(0)}s`, true);
        if (d < NODE_R) this.bankDivvy();
        else if (this.dockLeft <= 0) this.loseDivvy();
      } else if (this.dockLeft <= 0) {
        this.loseDivvy();
      }
    }

    // swap availability
    let near: CityNode | null = null;
    for (const n of this.city.nodes) {
      if (Math.abs(n.x - this.px) < NODE_R && Math.abs(n.y - this.py) < NODE_R) {
        near = n;
        break;
      }
    }
    this.nearNode = near;
    const want = near ? (NODE_VEHICLE[near.kind] as VehicleKind) : null;
    this.hud.setSwap(
      want && want !== this.kind && this.phase !== 'toDock' ? `TAKE ${SPECS[want].name}` : null
    );

    this.hud.drawMinimap({
      px: this.px,
      py: this.py,
      heading: this.heading,
      target:
        this.phase === 'toPickup'
          ? { x: this.pickup.x, y: this.pickup.y, kind: 'pickup' }
          : this.phase === 'toDrop'
            ? { x: this.drop.x, y: this.drop.y, kind: 'dropoff' }
            : this.dockNode
              ? { x: this.dockNode.x, y: this.dockNode.y, kind: 'dock' }
              : null,
    });
  }

  // ------------------------------------------------------------------ render

  private draw() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = ASPHALT;
    g.fillRect(0, 0, this.w, this.h);

    const sh = this.shake;
    const ox = sh > 0 ? (Math.random() - 0.5) * sh * 16 : 0;
    const oy = sh > 0 ? (Math.random() - 0.5) * sh * 16 : 0;

    g.save();
    g.translate(this.w / 2 + ox, this.h / 2 + oy);
    g.scale(this.zoom, this.zoom);
    g.translate(-this.camx, -this.camy);

    const vw = this.w / this.zoom;
    const vh = this.h / this.zoom;
    const x0 = this.camx - vw / 2 - 30;
    const y0 = this.camy - vh / 2 - 30;
    const x1 = this.camx + vw / 2 + 30;
    const y1 = this.camy + vh / 2 + 30;

    this.drawCity(g, x0, y0, x1, y1);
    this.drawNodes(g, x0, y0, x1, y1);
    this.drawObjective(g);
    this.drawActors(g);
    this.drawElevated(g, x0, y0, x1, y1);
    g.restore();

    this.drawPointer(g);
  }

  private drawCity(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    // lake
    if (x1 > LAKE_X) {
      g.fillStyle = LAKE;
      g.fillRect(LAKE_X, y0, x1 - LAKE_X, y1 - y0);
      g.fillStyle = 'rgba(120,190,235,0.22)';
      const step = 52;
      for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
        const k = ((y / step) | 0) % 3;
        g.fillRect(LAKE_X + 20 + k * 26, y + 10, 38, 3);
        g.fillRect(LAKE_X + 120 + k * 34, y + 30, 30, 3);
      }
      g.fillStyle = '#6f6a63';
      g.fillRect(LAKE_X - 7, y0, 7, y1 - y0);
    }

    // outside the city limits
    g.fillStyle = '#22252b';
    if (x0 < -HALF) g.fillRect(x0, y0, -HALF - x0, y1 - y0);
    if (y0 < -HALF) g.fillRect(x0, y0, x1 - x0, -HALF - y0);
    if (y1 > WORLD_H) g.fillRect(x0, WORLD_H, x1 - x0, y1 - WORLD_H);

    const i0 = Math.max(0, Math.floor(x0 / BLOCK) - 1);
    const i1 = Math.min(N - 1, Math.ceil(x1 / BLOCK));
    const j0 = Math.max(0, Math.floor(y0 / BLOCK) - 1);
    const j1 = Math.min(N - 1, Math.ceil(y1 / BLOCK));

    // sidewalks
    g.fillStyle = SIDEWALK;
    const sw = BLOCK - ROAD + 12;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const bx = i * BLOCK + HALF - 6;
        if (bx > LAKE_X) continue;
        g.fillRect(bx, j * BLOCK + HALF - 6, sw, sw);
      }
    }

    // buildings, extruded away from the camera so the Loop reads as a skyline
    const list = this.city.visibleBuildings(x0, y0, x1, y1, this.buf);
    list.sort((a, b) => rank(b, this.camx, this.camy) - rank(a, this.camx, this.camy));

    g.fillStyle = 'rgba(15,17,21,0.3)';
    for (const b of list) if (!b.park) g.fillRect(b.x + 4, b.y + 5, b.w, b.h);

    for (const b of list) {
      if (b.park) {
        g.fillStyle = b.color;
        g.fillRect(b.x, b.y, b.w, b.h);
        g.fillStyle = b.roof;
        g.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
        continue;
      }

      const hgt = storeys(b);
      const px = (b.x + b.w / 2 - this.camx) * hgt * 0.0011;
      const py = (b.y + b.h / 2 - this.camy) * hgt * 0.0011;

      // ground floor
      g.fillStyle = shade(b.color, 0.72);
      g.fillRect(b.x, b.y, b.w, b.h);

      // the two facades you'd actually see from up here
      if (px > 0.4 || px < -0.4) {
        const edge = px > 0 ? b.x + b.w : b.x;
        g.fillStyle = shade(b.color, 0.58);
        g.beginPath();
        g.moveTo(edge, b.y);
        g.lineTo(edge + px, b.y + py);
        g.lineTo(edge + px, b.y + b.h + py);
        g.lineTo(edge, b.y + b.h);
        g.fill();
      }
      if (py > 0.4 || py < -0.4) {
        const edge = py > 0 ? b.y + b.h : b.y;
        g.fillStyle = shade(b.color, py > 0 ? 0.48 : 0.86);
        g.beginPath();
        g.moveTo(b.x, edge);
        g.lineTo(b.x + px, edge + py);
        g.lineTo(b.x + b.w + px, edge + py);
        g.lineTo(b.x + b.w, edge);
        g.fill();
      }

      // roof
      g.fillStyle = b.roof;
      g.fillRect(b.x + px, b.y + py, b.w, b.h);

      if (b.tall && b.w > 26 && b.h > 26) {
        g.fillStyle = 'rgba(180,205,230,0.20)';
        g.fillRect(b.x + px + 7, b.y + py + 7, b.w - 14, 4);
        g.fillRect(b.x + px + 7, b.y + py + b.h - 11, b.w - 14, 4);
        g.fillStyle = 'rgba(12,15,20,0.28)';
        g.fillRect(b.x + px + b.w * 0.34, b.y + py + b.h * 0.34, b.w * 0.32, b.h * 0.32);
        // twin masts on the giants — the Willis silhouette, legally distinct
        if (hgt > 150) {
          g.strokeStyle = 'rgba(228,234,244,0.85)';
          g.lineWidth = 2;
          g.beginPath();
          for (const f of [0.36, 0.64]) {
            g.moveTo(b.x + px + b.w * f, b.y + py + b.h * 0.5);
            g.lineTo(b.x + px * 1.34 + b.w * f, b.y + py * 1.34 + b.h * 0.5);
          }
          g.stroke();
        }
      }
    }

    // centre lines
    g.fillStyle = 'rgba(232,217,138,0.55)';
    const dash = 20;
    const period = 46;
    for (let i = i0; i <= i1 + 1; i++) {
      const x = i * BLOCK;
      if (x < x0 || x > x1 || x > LAKE_X) continue;
      for (let y = Math.floor(y0 / period) * period; y < y1; y += period) g.fillRect(x - 1.5, y, 3, dash);
    }
    for (let j = j0; j <= j1 + 1; j++) {
      const y = j * BLOCK;
      if (y < y0 || y > y1) continue;
      const xe = Math.min(x1, LAKE_X);
      for (let x = Math.floor(x0 / period) * period; x < xe; x += period) g.fillRect(x, y - 1.5, dash, 3);
    }

    // crosswalks
    g.fillStyle = 'rgba(226,231,238,0.6)';
    for (let i = i0; i <= i1 + 1; i++) {
      const cx = i * BLOCK;
      if (cx < x0 || cx > x1 || cx > LAKE_X) continue;
      for (let j = j0; j <= j1 + 1; j++) {
        const cy = j * BLOCK;
        if (cy < y0 || cy > y1) continue;
        for (let s = -1; s <= 1; s += 2) {
          for (let k = -2; k <= 2; k++) {
            g.fillRect(cx + k * 11 - 3, cy + s * (HALF - 5) - 3, 6, 6);
            g.fillRect(cx + s * (HALF - 5) - 3, cy + k * 11 - 3, 6, 6);
          }
        }
      }
    }
  }

  /**
   * The elevated line rings the Loop. It sits above the street, so it draws
   * last — track, columns, shadow, and a train grinding around the circuit.
   */
  private drawElevated(
    g: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) {
    if (x1 < EL.x1 - 60 || x0 > EL.x2 + 60 || y1 < EL.y1 - 60 || y0 > EL.y2 + 60) return;

    const w = 26;
    const sx = 9;
    const sy = 12;
    const spans: [number, number, number, number][] = [
      [EL.x1 - w / 2, EL.y1 - w / 2, EL.x2 - EL.x1 + w, w],
      [EL.x1 - w / 2, EL.y2 - w / 2, EL.x2 - EL.x1 + w, w],
      [EL.x1 - w / 2, EL.y1 - w / 2, w, EL.y2 - EL.y1 + w],
      [EL.x2 - w / 2, EL.y1 - w / 2, w, EL.y2 - EL.y1 + w],
    ];

    g.fillStyle = 'rgba(8,10,14,0.42)';
    for (const [x, y, sw, sh] of spans) g.fillRect(x + sx, y + sy, sw, sh);

    // support columns every half block
    g.fillStyle = '#3a3d43';
    for (let x = EL.x1; x <= EL.x2; x += BLOCK / 2) {
      for (const y of [EL.y1, EL.y2]) g.fillRect(x - 4 + sx, y - 4 + sy, 8, 8);
    }
    for (let y = EL.y1; y <= EL.y2; y += BLOCK / 2) {
      for (const x of [EL.x1, EL.x2]) g.fillRect(x - 4 + sx, y - 4 + sy, 8, 8);
    }

    g.fillStyle = '#2a2d33';
    for (const [x, y, sw, sh] of spans) g.fillRect(x, y, sw, sh);
    g.fillStyle = '#8e949d';
    for (const [x, y, sw, sh] of spans) {
      if (sw > sh) {
        g.fillRect(x, y + 5, sw, 3);
        g.fillRect(x, y + sh - 8, sw, 3);
      } else {
        g.fillRect(x + 5, y, 3, sh);
        g.fillRect(x + sw - 8, y, 3, sh);
      }
    }

    // the train: six cars, nose to tail
    const head = (this.now * 0.055) % EL_PERIM;
    for (let i = 0; i < 6; i++) {
      const p = elPoint(head - i * 38);
      if (p.x < x0 - 80 || p.x > x1 + 80 || p.y < y0 - 80 || p.y > y1 + 80) continue;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.a);
      g.fillStyle = 'rgba(10,12,16,0.35)';
      g.fillRect(-16 + sx, -9 + sy, 32, 18);
      g.fillStyle = '#dfe3e9';
      g.fillRect(-16, -9, 32, 18);
      g.fillStyle = '#1f4f8c';
      g.fillRect(-16, -9, 32, 4);
      g.fillRect(-16, 5, 32, 4);
      g.fillStyle = 'rgba(52,74,104,0.9)';
      g.fillRect(-11, -3, 7, 6);
      g.fillRect(-1, -3, 7, 6);
      g.fillRect(9, -3, 5, 6);
      g.restore();
    }
  }

  private drawNodes(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    for (const n of this.city.nodes) {
      if (n.x < x0 - 40 || n.x > x1 + 40 || n.y < y0 - 40 || n.y > y1 + 40) continue;
      const dock = n.kind === 'dock';
      const color = dock ? '#1f7ad4' : n.kind === 'stand' ? '#f5c518' : '#e8532e';
      const glow = this.phase === 'toDock' && dock ? 0.34 : 0.16;

      g.fillStyle = color;
      g.globalAlpha = glow;
      g.beginPath();
      g.arc(n.x, n.y, NODE_R * 0.62, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;

      // pin
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(n.x + 2, n.y + 3, 12, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(n.x, n.y + 6);
      g.lineTo(n.x - 8, n.y - 8);
      g.lineTo(n.x + 8, n.y - 8);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(n.x, n.y - 15, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = dock ? '#cfe6ff' : n.kind === 'stand' ? '#5a4703' : '#ffd8cc';
      g.beginPath();
      g.arc(n.x, n.y - 15, 5.5, 0, Math.PI * 2);
      g.fill();

      g.font = '700 9px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(dock ? 'DIVVY DOCK' : n.kind === 'stand' ? 'TAXI STAND' : 'MOPEDS', n.x, n.y + 22);
    }
  }

  private drawObjective(g: CanvasRenderingContext2D) {
    if (this.phase === 'toDock') return;
    const pick = this.phase === 'toPickup';
    const p = pick ? this.pickup : this.drop;
    const color = pick ? '#5ce08a' : '#ff5fa2';
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 230);

    g.fillStyle = color;
    g.globalAlpha = 0.15 + 0.12 * pulse;
    g.beginPath();
    g.arc(p.x, p.y, PICK_R * (0.85 + 0.15 * pulse), 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(p.x, p.y, PICK_R * 0.7, 0, Math.PI * 2);
    g.stroke();

    if (pick) {
      // a little person with their arm up
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(p.x, p.y - 11, 5, 0, Math.PI * 2);
      g.fill();
      g.fillRect(p.x - 5, p.y - 5, 10, 15);
      g.fillRect(p.x + 4, p.y - 14, 3, 10);
      g.fillStyle = color;
      g.fillRect(p.x - 2, p.y - 3, 4, 9);
    } else {
      g.fillStyle = '#fff';
      g.fillRect(p.x - 11, p.y - 9, 22, 18);
      g.fillStyle = color;
      g.fillRect(p.x - 7, p.y - 5, 14, 3);
      g.fillRect(p.x - 7, p.y + 1, 9, 3);
    }
  }

  private drawActors(g: CanvasRenderingContext2D) {
    for (const p of this.peds) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.beginPath();
      g.arc(p.x + 1.5, p.y + 2, 4.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, 4.4, 0, Math.PI * 2);
      g.fill();
    }

    for (const c of this.traffic) {
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.heading);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(-c.len / 2 + 2, -c.wid / 2 + 3, c.len, c.wid);
      g.fillStyle = c.color;
      g.fillRect(-c.len / 2, -c.wid / 2, c.len, c.wid);
      g.fillStyle = 'rgba(30,34,40,0.85)';
      g.fillRect(-c.len * 0.12, -c.wid / 2 + 2, c.len * 0.3, c.wid - 4);
      g.restore();
    }

    this.drawPlayer(g);
  }

  private drawPlayer(g: CanvasRenderingContext2D) {
    const s = this.spec;
    const splitting = s.laneSplit && laneOffset(this.px, this.py) < 12 && Math.abs(this.speed) > 60;

    if (splitting) {
      g.strokeStyle = 'rgba(159,232,255,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.px, this.py, 17 + Math.sin(this.now / 70) * 2, 0, Math.PI * 2);
      g.stroke();
    }

    // a soft halo so you never lose yourself in traffic
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath();
    g.arc(this.px, this.py, 26, 0, Math.PI * 2);
    g.fill();

    g.save();
    g.translate(this.px, this.py);
    g.rotate(this.heading);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-s.len / 2 + 2, -s.wid / 2 + 3, s.len, s.wid);
    g.fillStyle = s.body;
    g.fillRect(-s.len / 2, -s.wid / 2, s.len, s.wid);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.5;
    g.strokeRect(-s.len / 2, -s.wid / 2, s.len, s.wid);

    if (this.kind === 'taxi') {
      g.fillStyle = s.trim;
      g.fillRect(-3, -s.wid / 2 + 2, 10, s.wid - 4);
      g.fillRect(-s.len / 2 + 3, -s.wid / 2 + 2, 6, s.wid - 4);
      g.fillStyle = '#fff';
      g.fillRect(-4, -s.wid / 2 - 3, 8, 3);
      g.fillStyle = s.trim;
      for (let i = 0; i < 4; i++) g.fillRect(-s.len / 2 + 5 + i * 7, s.wid / 2 - 3, 3.5, 3);
    } else if (this.kind === 'moped') {
      g.fillStyle = s.trim;
      g.fillRect(s.len / 2 - 6, -s.wid / 2 - 3, 3, s.wid + 6);
      g.fillStyle = '#2b3038';
      g.beginPath();
      g.arc(-1, 0, 4.2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = s.trim;
      g.fillRect(-s.len / 2 + 3, -1.5, s.len - 6, 3);
      g.fillRect(s.len / 2 - 5, -s.wid / 2 - 3, 2.5, s.wid + 6);
      g.fillStyle = '#2b3038';
      g.beginPath();
      g.arc(-1, 0, 3.6, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** Screen-space arrow toward the objective when it's off camera. */
  private drawPointer(g: CanvasRenderingContext2D) {
    if (!this.running) return;
    const t =
      this.phase === 'toPickup' ? this.pickup : this.phase === 'toDrop' ? this.drop : this.dockNode;
    if (!t) return;

    const sx = this.w / 2 + (t.x - this.camx) * this.zoom;
    const sy = this.h / 2 + (t.y - this.camy) * this.zoom;
    const padX = 40;
    const padY = 56;
    if (sx > padX && sx < this.w - padX && sy > padY && sy < this.h - padY) return;

    const cx = this.w / 2;
    const cy = this.h / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const rx = this.w / 2 - padX;
    const ry = this.h / 2 - padY;
    const ca = Math.abs(Math.cos(ang));
    const sa = Math.abs(Math.sin(ang));
    const scale = Math.min(ca < 1e-4 ? Infinity : rx / ca, sa < 1e-4 ? Infinity : ry / sa);

    g.save();
    g.translate(cx + Math.cos(ang) * scale, cy + Math.sin(ang) * scale);
    g.rotate(ang);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.moveTo(20, 0);
    g.lineTo(-12, 12);
    g.lineTo(-12, -12);
    g.closePath();
    g.fill();
    g.fillStyle =
      this.phase === 'toPickup' ? '#5ce08a' : this.phase === 'toDrop' ? '#ff5fa2' : '#8fcaff';
    g.beginPath();
    g.moveTo(16, 0);
    g.lineTo(-10, 9);
    g.lineTo(-10, -9);
    g.closePath();
    g.fill();
    g.restore();
  }
}
