import './style.css';
import { City } from './city';
import { Hud } from './hud';
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const city = new City();
const hud = new Hud(city);
new Game(canvas, hud, city);

// Stop iOS Safari pinch-zooming or rubber-banding the game surface, but leave the
// start / game-over screens scrollable on short landscape phones.
document.addEventListener('gesturestart', (e: Event) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e: TouchEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest('.screen')) return;
    e.preventDefault();
  },
  { passive: false }
);
document.addEventListener('dblclick', (e) => e.preventDefault());
