# Hail Chicago

A top-down arcade taxi game set in a Chicago-flavored grid city. Built for a phone browser: landscape, thumb controls, no install, no signup.

**How to play:** drive to the green passenger, slow down to pick them up, follow the arrow to the pink drop-off, and keep the clock alive — every fare buys you more seconds.

## The three rides

| Vehicle | Top speed | Handling | Fare | Hook |
| --- | --- | --- | --- | --- |
| **Yellow Taxi** | fastest | worst | ×1.5 | Chokes when boxed in by traffic |
| **Moped** | mid | best | ×1.05 | Lane-splits down the centreline — traffic barely touches you |
| **Divvy Bike** | slowest | good | ×0.8 | **Must be returned to a Divvy dock after every drop-off** or the fare is lost. Bank it in time and it pays ×2.1 |

The Divvy is the interesting one: the drop-off doesn't end the job. You get a 32-second window and a blue pin on the minimap, so the smart play is picking fares whose destination sits near a dock.

Swap vehicles at any yellow taxi stand, orange moped share, or blue Divvy dock — the **SWAP** button in the top-right lights up when you're on one. You can't abandon a Divvy anywhere but a dock.

## Controls

- **Left thumb** — joystick appears wherever you touch, steers by direction.
- **Right thumb** — big **GAS**, small **BRAKE**.
- **Top-right** — minimap and the vehicle-swap button.
- **Desktop** — arrow keys or WASD, space for gas, shift to brake.

Hitting a pedestrian costs 5 seconds and an apology.

## The city

A 20×20 street grid, Lake Michigan as an impassable slab on the east edge, a dense "Loop" of extruded towers in the middle-east with the elevated line circling it, red-brick low-rises everywhere else. 12 Divvy docks, 4 taxi stands, 3 moped shares, 44 passenger corners. Procedurally laid out from a fixed seed, so the map is the same every run.

## Tech

Vite + TypeScript + Canvas 2D. No game framework, no backend, no assets — everything is drawn from rectangles at runtime, so the whole game is ~30 kB of JS. High score lives in `localStorage`.

```bash
npm install
npm run dev     # local dev server
npm run build   # typecheck + production build to dist/
```
