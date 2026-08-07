# 🚕 Hail Chicago

A mobile-first, top-down arcade taxi game set in a procedural Chicago. Pick up a fare, get them
across the grid, beat the clock. Built as a game jam — placeholder art, no backend, no signup.

**Play:** landscape on a phone. Left thumb steers, right thumb is gas and brake.

## The hook: three very different rides

| Ride | Speed | Handling | Fare | Catch |
| --- | --- | --- | --- | --- |
| 🚕 **Yellow Taxi** | Fastest | Drifty, slow to turn | ×1.5 | Traffic chokes it — clipping a car costs most of your speed |
| 🛵 **Moped** | Middle | Sharpest | ×1.05 | Can **lane-split** the centreline gap and shrug off traffic |
| 🚲 **Divvy Bike** | Slowest | Sharp | ×0.8 | Must be **returned to a Divvy dock** within 32s of drop-off or the fare is lost — dock it in time and it pays **2.1×** |

The Divvy bike is the interesting one: the fare isn't banked at drop-off, it's banked at the dock.
Slow ride, small base fare, biggest payout if you plan the route around the blue pins.

Swap vehicles only at a taxi stand, a moped zone, or a Divvy dock.

## The city

A 20×20 procedural street grid: Lake Michigan as an impassable wall of blue on the east edge, a
dense cluster of Loop towers in the middle, red brick and greystone elsewhere, lakefront parks.
12 Divvy docks, 4 taxi stands, 3 moped zones, 44 fare corners, ~24 AI cars doing lane-following,
and pedestrians at the crosswalks — hit one and it's `SORRY!` and −5 seconds.

Nothing here uses a real logo or trademark; it's all rectangles and a palette.

## Scoring

Fares stack a streak multiplier (up to ×1.6) as long as you don't hit traffic, hit a pedestrian, or
lose a Divvy fare. Drop-offs add time. Game ends at 0:00. High score lives in `localStorage`.

## Tech

Vanilla TypeScript + Canvas 2D + Vite. No game engine, no dependencies at runtime — the whole
bundle is ~28 KB (10 KB gzipped), which is what keeps it at a locked frame rate on a phone.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

### Layout

- `src/city.ts` — procedural grid, blocks, docks/stands/zones, road lookup
- `src/vehicles.ts` — the three specs; this file is the game feel
- `src/game.ts` — simulation + canvas renderer
- `src/hud.ts` — DOM HUD, virtual joystick, pedals, minimap
- `src/sfx.ts` — tiny WebAudio blips

`window.__game` is exposed for poking at the simulation from the console (`__game.tick(1/60)`).
