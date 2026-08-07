import { City, LAKE_X, WORLD_H, WORLD_W, BLOCK, N } from './city';
import { SPECS, VehicleKind } from './vehicles';

export interface Controls {
  /** normalised joystick vector */
  sx: number;
  sy: number;
  /** 0..1 magnitude */
  mag: number;
  gas: boolean;
  brake: boolean;
}

export interface MiniState {
  px: number;
  py: number;
  heading: number;
  target: { x: number; y: number; kind: 'pickup' | 'dropoff' | 'dock' } | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  controls: Controls = { sx: 0, sy: 0, mag: 0, gas: false, brake: false };

  private hud = $('hud');
  private touch = $('touch');
  private scoreEl = $('score');
  private timerEl = $('timer');
  private vehName = $('veh-name');
  private vehChip = $('veh-chip');
  private objective = $('objective');
  private objText = $('obj-text');
  private swapBtn = $<HTMLButtonElement>('swap-btn');
  private startScreen = $('start');
  private overScreen = $('over');
  private finalScore = $('final-score');
  private finalLines = $('final-lines');
  private bestScore = $('best-score');
  private rotate = $('rotate');
  private stickZone = $('stick-zone');
  private stickBase = $('stick-base');
  private stickNub = $('stick-nub');
  private gasEl = $('gas');
  private brakeEl = $('brake');

  private mini = $<HTMLCanvasElement>('minimap');
  private mctx = this.mini.getContext('2d')!;
  private toasts!: HTMLDivElement;
  private divvy!: HTMLDivElement;
  private divvyFill!: HTMLElement;
  private divvyAmt!: HTMLElement;

  private stickId = -1;
  private stickOx = 0;
  private stickOy = 0;
  private rotateDismissed = false;
  private cityBaked: HTMLCanvasElement | null = null;

  onStart: (v: VehicleKind) => void = () => {};
  onSwap: () => void = () => {};
  onAgain: () => void = () => {};

  constructor(private city: City) {
    this.buildExtras();
    this.wireStick();
    this.wirePedals();
    this.wireScreens();
    this.bakeMinimapCity();

    window.addEventListener('resize', () => this.checkOrientation());
    window.addEventListener('orientationchange', () => setTimeout(() => this.checkOrientation(), 250));
    this.checkOrientation();
  }

  // ---------------------------------------------------------------- extras

  private buildExtras() {
    const app = $('app');

    this.toasts = document.createElement('div');
    this.toasts.id = 'toasts';
    app.appendChild(this.toasts);

    this.divvy = document.createElement('div');
    this.divvy.id = 'divvy';
    this.divvy.className = 'hidden';
    this.divvy.innerHTML =
      '<div class="d-title">🚲 RETURN THE BIKE TO A DIVVY DOCK</div>' +
      '<div class="d-bar"><i id="d-fill"></i></div>' +
      '<div class="d-sub">Unpaid fare: <b id="d-amt">$0</b> — follow the blue pin</div>';
    app.appendChild(this.divvy);
    this.divvyFill = $('d-fill');
    this.divvyAmt = $('d-amt');
  }

  // ---------------------------------------------------------------- input

  private wireStick() {
    const R = 52;
    const zone = this.stickZone;

    const place = (x: number, y: number) => {
      this.stickBase.style.left = `${x}px`;
      this.stickBase.style.top = `${y}px`;
    };

    zone.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        e.preventDefault();
        if (this.stickId !== -1) return;
        this.stickId = e.pointerId;
        try {
          zone.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety; window listeners below are the safety net */
        }
        const r = zone.getBoundingClientRect();
        this.stickOx = e.clientX;
        this.stickOy = e.clientY;
        place(e.clientX - r.left, e.clientY - r.top);
        this.stickBase.classList.add('on');
        this.stickNub.style.transform = 'translate(0px,0px)';
      },
      { passive: false }
    );

    zone.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        if (e.pointerId !== this.stickId) return;
        e.preventDefault();
        let dx = e.clientX - this.stickOx;
        let dy = e.clientY - this.stickOy;
        const d = Math.hypot(dx, dy);
        const m = Math.min(1, d / R);
        if (d > 0.0001) {
          const nx = dx / d;
          const ny = dy / d;
          this.controls.sx = nx;
          this.controls.sy = ny;
          this.controls.mag = m;
          dx = nx * R * m;
          dy = ny * R * m;
        }
        this.stickNub.style.transform = `translate(${dx}px,${dy}px)`;
      },
      { passive: false }
    );

    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.controls.mag = 0;
      this.stickBase.classList.remove('on');
      this.stickNub.style.transform = 'translate(0px,0px)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
    // if the finger lifts somewhere else entirely, don't leave the stick stuck on
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private wirePedals() {
    const bind = (el: HTMLElement, set: (v: boolean) => void) => {
      let id = -1;
      el.addEventListener(
        'pointerdown',
        (e: PointerEvent) => {
          e.preventDefault();
          id = e.pointerId;
          el.classList.add('down');
          set(true);
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* pressing still works without capture — see the window listeners */
          }
        },
        { passive: false }
      );
      const off = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        id = -1;
        el.classList.remove('down');
        set(false);
      };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
      // a finger that slides off the button and lifts elsewhere must still release it
      window.addEventListener('pointerup', off);
      window.addEventListener('pointercancel', off);
    };
    bind(this.gasEl, (v) => (this.controls.gas = v));
    bind(this.brakeEl, (v) => (this.controls.brake = v));

    // keyboard fallback so it's playable on a laptop too
    const keys: Record<string, boolean> = {};
    const apply = () => {
      const kx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
      const ky = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
      const d = Math.hypot(kx, ky);
      if (d > 0) {
        this.controls.sx = kx / d;
        this.controls.sy = ky / d;
        this.controls.mag = 1;
      } else if (this.stickId === -1) {
        this.controls.mag = 0;
      }
      this.controls.gas = !!keys[' '] || d > 0;
      this.controls.brake = !!keys.Shift;
    };
    window.addEventListener('keydown', (e) => {
      keys[e.key] = true;
      apply();
    });
    window.addEventListener('keyup', (e) => {
      keys[e.key] = false;
      apply();
    });
  }

  private wireScreens() {
    document.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      card.addEventListener('click', () => {
        const v = card.dataset.veh as VehicleKind;
        this.onStart(v);
      });
    });
    $('again').addEventListener('click', () => this.onAgain());
    this.swapBtn.addEventListener('click', () => this.onSwap());
    $('rot-dismiss').addEventListener('click', () => {
      this.rotateDismissed = true;
      this.rotate.classList.add('hidden');
    });
  }

  private checkOrientation() {
    const portrait = window.innerHeight > window.innerWidth;
    this.rotate.classList.toggle('hidden', !portrait || this.rotateDismissed);
  }

  // ---------------------------------------------------------------- screens

  showStart(best: number) {
    this.bestScore.textContent = `$${best}`;
    this.startScreen.classList.remove('hidden');
    this.overScreen.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.touch.classList.add('hidden');
  }

  showGame() {
    this.startScreen.classList.add('hidden');
    this.overScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.touch.classList.remove('hidden');
  }

  showOver(score: number, lines: string[]) {
    this.finalScore.textContent = `$${score}`;
    this.finalLines.innerHTML = lines.map((l) => `<span>${l}</span>`).join('');
    this.overScreen.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.touch.classList.add('hidden');
    this.divvy.classList.add('hidden');
  }

  // ---------------------------------------------------------------- hud bits

  setScore(v: number) {
    this.scoreEl.textContent = `$${v}`;
  }

  setTimer(sec: number) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    this.timerEl.textContent = `${m}:${r.toString().padStart(2, '0')}`;
    this.timerEl.classList.toggle('low', s <= 10);
  }

  setVehicle(id: VehicleKind) {
    this.vehName.textContent = SPECS[id].name;
    this.vehChip.className = id;
  }

  setObjective(text: string, alert = false) {
    if (this.objText.textContent !== text) this.objText.textContent = text;
    this.objective.classList.toggle('alert', alert);
  }

  setSwap(label: string | null) {
    if (label) {
      this.swapBtn.textContent = label;
      this.swapBtn.classList.remove('hidden');
    } else {
      this.swapBtn.classList.add('hidden');
    }
  }

  setDivvy(active: boolean, frac = 0, amount = 0) {
    this.divvy.classList.toggle('hidden', !active);
    if (active) {
      this.divvyFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      this.divvyAmt.textContent = `$${amount}`;
    }
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' = 'good') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }

  // ---------------------------------------------------------------- minimap

  private bakeMinimapCity() {
    const S = 240;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d')!;
    const k = S / Math.max(WORLD_W, WORLD_H);

    g.fillStyle = '#171b22';
    g.fillRect(0, 0, S, S);

    // lake
    g.fillStyle = '#12456e';
    g.fillRect(LAKE_X * k, 0, (WORLD_W - LAKE_X) * k, WORLD_H * k);

    // street grid
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= N; i += 2) {
      g.moveTo(i * BLOCK * k, 0);
      g.lineTo(i * BLOCK * k, WORLD_H * k);
      g.moveTo(0, i * BLOCK * k);
      g.lineTo(LAKE_X * k, i * BLOCK * k);
    }
    g.stroke();

    // the Loop
    g.fillStyle = 'rgba(255,255,255,0.09)';
    g.fillRect(12 * BLOCK * k, 8 * BLOCK * k, 6 * BLOCK * k, 5 * BLOCK * k);

    // fixed nodes
    for (const n of this.city.nodes) {
      g.fillStyle = n.kind === 'dock' ? '#3d9bf0' : n.kind === 'stand' ? '#f5c518' : '#e8532e';
      g.beginPath();
      g.arc(n.x * k, n.y * k, n.kind === 'dock' ? 3 : 3.4, 0, Math.PI * 2);
      g.fill();
    }

    this.cityBaked = c;
  }

  drawMinimap(s: MiniState) {
    const S = 240;
    const g = this.mctx;
    const k = S / Math.max(WORLD_W, WORLD_H);
    g.clearRect(0, 0, S, S);
    if (this.cityBaked) g.drawImage(this.cityBaked, 0, 0);

    if (s.target) {
      const tx = s.target.x * k;
      const ty = s.target.y * k;
      g.strokeStyle =
        s.target.kind === 'pickup' ? '#7CFC9A' : s.target.kind === 'dock' ? '#8fcaff' : '#ff8a3d';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(tx, ty, 7, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.beginPath();
      g.arc(tx, ty, 3, 0, Math.PI * 2);
      g.fill();
    }

    // player arrow
    const px = s.px * k;
    const py = s.py * k;
    g.save();
    g.translate(px, py);
    g.rotate(s.heading);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(7, 0);
    g.lineTo(-5, 4.5);
    g.lineTo(-5, -4.5);
    g.closePath();
    g.fill();
    g.restore();
  }
}
