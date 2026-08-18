# Billiard Clash

A Classic 8-Ball Pool

A full-stack, TypeScript implementation of classic 8-ball pool. Play against a friend online in real time, or challenge a computer opponent across four difficulty levels — all rendered on an HTML5 Canvas with a from-scratch 2D physics engine and WPA-based rules.

> **Play now:** [https://billiard-clash.vercel.app/](https://billiard-clash.vercel.app/)
> **Screenshots:** not included — see [Screenshots](#screenshots) for why.

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Demo](#demo)
- [Game Modes](#game-modes)
- [Controls](#controls)
- [8-Ball Rules](#8-ball-rules)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Installation](#installation)
- [Development](#development)
- [Running Locally](#running-locally)
- [Multiplayer Server Setup](#multiplayer-server-setup)
- [Environment Variables](#environment-variables)
- [Build Instructions](#build-instructions)
- [Deployment](#deployment)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)
- [Future Improvements](#future-improvements)
- [Audio](#audio)
- [Credits](#credits)
- [License](#license)

## Features

- **Player vs Player Online** — create a room, share a short room code, and play in real time over Socket.IO, with server-authoritative shot validation and reconnect support.
- **Player vs Computer** — four AI difficulty levels (Easy / Medium / Hard / Insane) that reason about shot angles, obstruction, distance, and power rather than shooting randomly.
- **From-scratch 2D physics** — fixed-timestep integration, elastic ball-to-ball collisions with positional correction (balls never visually overlap), rail reflection, rolling friction, and pocket detection.
- **Authentic WPA 8-ball rules** — break rules, open table, group assignment, the full foul list, ball-in-hand, early/illegal/legal 8-ball resolution.
- **Original dark billiard-hall visual design** — felt green, brass, and dark wood, with a numbered-ball canvas renderer, cue stick, aim line, and a brass-styled power meter.
- **Zero licensed assets** — every sound effect is synthesized at runtime with the Web Audio API (see [Audio](#audio)).
- **Settings persisted locally** (volume, aim-assist line, fullscreen, graphics quality).

## Screenshots

This environment does not have a browser available to drive the running app and capture real screenshots, so none are included here rather than faking them. The [Running Locally](#running-locally) section gets you a live instance in about a minute if you'd like to see it firsthand — happy to add real screenshots to this README once the app has been run in a browser.

## Demo

**Play now:** [https://billiard-clash.vercel.app/](https://billiard-clash.vercel.app/)

The client is deployed on Vercel; the multiplayer server is deployed separately on Render at `https://billiard-clash.onrender.com`. Note: Render's free tier spins down after inactivity, so the very first connection after a period of no traffic may take up to ~30-60 seconds while the server cold-starts.

## Game Modes

- **Player vs Player Online** — Main Menu → Play Online → Create Room (share the `8B-XXXX` code) or Join Room.
- **Player vs Computer** — Main Menu → Play vs Computer → choose a difficulty.

## Controls

```text
Keyboard

W   : Increase shot power
S   : Decrease shot power
ESC : Pause / Return to menu

Mouse

Move       : Aim
Left Click : Shoot
Wheel      : Adjust shot power
```

Touch devices support drag-to-aim and tap-to-shoot.

## 8-Ball Rules

The game's rules are based on the **WPA (World Pool-Billiard Association) 8-Ball rules**. Where different regional rule sets disagree (there are several popular house-rule variants), this project follows WPA as the primary reference.

Implemented:
- Break shot (must pot a ball or send at least one ball to a rail after contact, or it's a foul)
- Open table until a group is legally assigned
- Group assignment: whichever group (solids/stripes) is potted alone on the first legal post-break shot
- Fouls: scratch, no ball contacted, wrong ball contacted first, no rail contact after legal contact
- Ball-in-hand for the incoming player after any foul
- Early 8-ball (pocketed before the shooter's group is cleared) = loss
- Legal 8-ball pocketed with a simultaneous cue-ball scratch = loss
- Legal 8-ball win
- Turn switching (foul or missed shot passes the turn; a legal pot keeps it)

## Tech Stack

- **TypeScript** everywhere (client, server, shared)
- **HTML5 Canvas** (2D context) for rendering — chosen over a framework like Phaser because the project needed a hand-built, deterministic physics engine anyway, and a raw canvas kept the render layer thin and easy to reason about alongside it.
- **Vite** for the client dev server and production bundle
- **Node.js + Express + Socket.IO** for the multiplayer server
- **Vitest** for unit and integration testing
- **npm workspaces** for the monorepo (no extra tooling like Turborepo/Nx — the project is small enough that plain workspaces are sufficient)

## Architecture

The codebase is a monorepo with three packages:

- **`shared`** — pure, environment-agnostic TypeScript: vector math, table/ball constants, the physics engine, the WPA rules engine, the rack builder, and the Socket.IO network protocol types. Both the client and server import this so gameplay logic exists in exactly one place and can't drift between them.
- **`server`** — Express + Socket.IO. Owns authoritative match state per room, applies every shot through the *same* `shared` physics + rules engine the client uses, and validates all incoming messages before trusting them.
- **`client`** — Vite + Canvas. Renders the table/balls, handles input, and either drives a fully local match (`LocalMatchEngine`, vs-computer) or a server-synced match (`OnlineSession`, online multiplayer) behind a single `GameSession` interface so the rendering/input code doesn't need to know which mode it's in.

## Installation

Requires **Node.js 18+** and npm.

```bash
git clone <your-repo-url> billiard-clash
cd billiard-clash
npm install
```

This installs dependencies for all three workspaces (`shared`, `server`, `client`) in one pass.

## Development

Build the shared package first (server and client both depend on its compiled output):

```bash
npm run build:shared
```

Then run the server and client dev servers (in separate terminals, or together with `npm run dev`):

```bash
npm run dev:server   # http://localhost:3001
npm run dev:client   # http://localhost:5173
```

`npm run dev` runs both concurrently.

## Running Locally

1. `npm install`
2. `npm run build:shared`
3. `npm run dev:server`
4. In a second terminal: `npm run dev:client`
5. Open `http://localhost:5173`

For online multiplayer, open the URL in two browser tabs (or two devices on the same network, using the machine's LAN IP instead of `localhost`) and use Create Room / Join Room.

## Multiplayer Server Setup

The server is a standard Express + Socket.IO app (`server/src/index.ts`). It needs no database — all match state lives in memory per room and is discarded when the room empties or the reconnect grace period (60s) expires. For production, run it as a long-lived Node process (not a serverless function) since it holds WebSocket connections and in-memory state.

## Environment Variables

Copy the example files and adjust as needed:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

**`server/.env`**
| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the Express/Socket.IO server listens on |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin for the client |

**`client/.env`**
| Variable | Default | Description |
|---|---|---|
| `VITE_SERVER_URL` | `http://localhost:3001` | URL the client connects Socket.IO to |

No secrets or API keys are used anywhere in this project.

## Build Instructions

```bash
npm run build
```

Builds `shared` (dual CJS + ESM output — CJS for the Node server, ESM for the Vite/Rollup client bundle), then `server` (→ `server/dist`), then `client` (→ `client/dist`, a static site).

## Deployment

Deployed as:
- **Client** (`client/dist`, static): [Vercel](https://billiard-clash.vercel.app/)
- **Server** (stateful, long-running WebSocket process): [Render](https://billiard-clash.onrender.com/)

Steps to reproduce this deployment:
1. Deploy `server/` to Render/Railway/Fly.io. Set `CLIENT_ORIGIN` to your deployed client's URL. Note the server's public URL.
2. Deploy `client/` to Vercel/Netlify. Set `VITE_SERVER_URL` to the server's public URL from step 1. Build command: `npm run build --workspace=shared && npm run build --workspace=client`; output directory: `client/dist`.
3. Confirm the client can reach the server (open the deployed client, try Create Room).

## Testing

```bash
npm run test --workspace=shared
npm run test --workspace=server
npm run test --workspace=client
```

**121 automated tests, all passing:**
- `shared` (51 tests) — physics (no ball overlap ever, momentum transfer, rail containment, pocket detection), WPA rules (every foul type, group assignment, all three 8-ball outcomes, turn switching), the shared shot-velocity formula, and ball-in-hand placement legality (bounds, overlap, pocket mouths, head-string restriction).
- `server` (18 tests) — real Socket.IO integration tests covering room creation/joining, turn-based shot validation, the `shot_started`/`shot_applied` broadcast sequence, and server-side ball-in-hand placement validation (including rejecting an illegal client-supplied position).
- `client` (52 tests) — layout-independent power-key controls, online shot animation/reconciliation, AI ball-in-hand placement, game-over state handling and AI-stops-after-game-over, and full `GameScreen` coverage (cue visibility gating, the end-of-game modal, and interactive ball-in-hand placement) using a stubbed canvas/audio context since no headless browser is available in the environment this was built in.

All three commands were also verified end-to-end against a live running server (real Socket.IO clients creating a room, joining, and exchanging validated, physics-resolved shots).

## Project Structure

```text
billiard-clash/
├── shared/                    # Pure game logic, used by both client and server
│   └── src/
│       ├── physics/           # engine.ts (simulation), rack.ts (rack formation)
│       ├── rules/              # eightBallRules.ts (WPA rules evaluator)
│       ├── constants.ts        # table/ball physical constants, ball colors
│       ├── types.ts            # MatchState, ShotRequest, ShotResult, etc.
│       ├── network.ts          # Socket.IO event contract, room code generation
│       └── vector2.ts
│
├── server/
│   └── src/
│       ├── rooms/              # Room.ts (per-match state), RoomManager.ts
│       ├── sockets/            # handlers.ts (all Socket.IO event wiring)
│       ├── validation/         # validators.ts (never trust the client)
│       └── index.ts            # Express + Socket.IO entrypoint
│
├── client/
│   └── src/
│       ├── game/                # TableRenderer, GameScreen, LocalMatchEngine,
│       │                        # GameSession/VsComputerSession/OnlineSession
│       ├── ai/                  # AIOpponent.ts (4 difficulty levels)
│       ├── multiplayer/         # SocketClient.ts
│       ├── audio/               # SoundManager.ts (synthesized SFX)
│       ├── ui/screens/          # MainMenu, ComputerMenu, OnlineMenu, HowToPlay,
│       │                        # Settings, Credits
│       └── utils/settings.ts    # LocalStorage persistence
│
├── package.json                # npm workspaces root
├── LICENSE
└── README.md
```

## Known Limitations

- **No automated screenshots or browser-based UI tests** — this project was built in a sandboxed environment with no headless browser tool available, so the UI has been verified via successful production builds, a real end-to-end Socket.IO smoke test, and the live deployment itself, but not visually screenshotted or click-tested by an automated agent.
- **Render free-tier cold starts** — the deployed server spins down after inactivity; the first multiplayer connection after idle time can take up to ~30-60 seconds.
- **AI does not currently plan multi-shot position play** at the Easy/Medium tiers (Hard/Insane weight cue-ball position in shot scoring; the lower tiers score purely on pot difficulty).
- **No dedicated mobile touch power slider / shoot button** — touch play uses drag-to-aim + tap-to-shoot with the same power value from the last W/S/wheel adjustment, rather than a separate on-screen slider.
- **No background music**, only sound effects (music volume setting exists in Settings for forward-compatibility but nothing plays through it yet).

## Future Improvements

- Position-aware AI planning at all difficulty tiers (currently only Hard/Insane)
- On-screen mobile power slider and shoot button
- Spectator mode / room observers
- Match history and simple stats
- Background music track (synthesized or licensed, with attribution)

## Audio

All sound effects (cue strike, ball collisions, rail bounces, pocketing, fouls, win/lose, button clicks) are **synthesized at runtime** using the Web Audio API — oscillators and filtered noise bursts, no audio files. See `client/src/audio/SoundManager.ts`. This means there are no third-party audio assets in this project and nothing to license or attribute.

## Credits

Built with TypeScript, HTML5 Canvas, Node.js, Express, and Socket.IO. Rules based on the WPA 8-Ball ruleset.

## License

[MIT](./LICENSE) © 2026 Lujain-ALghamdi
