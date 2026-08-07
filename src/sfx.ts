// Tiny WebAudio blips. No assets, no loading, unlocked on first tap.

class Sfx {
  private ctx: AudioContext | null = null;
  private ok = false;

  unlock() {
    if (this.ok) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      void this.ctx.resume();
      this.ok = true;
    } catch {
      this.ok = false;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain = 0.05, slideTo?: number) {
    if (!this.ok || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  blip(f = 620) {
    this.tone(f, 0.09, 'square', 0.04);
  }

  cash() {
    this.tone(880, 0.08, 'square', 0.045);
    setTimeout(() => this.tone(1320, 0.13, 'square', 0.04), 70);
  }

  buzz() {
    this.tone(190, 0.22, 'sawtooth', 0.05, 90);
  }

  thud() {
    this.tone(120, 0.12, 'sawtooth', 0.055, 60);
  }
}

export const sfx = new Sfx();
