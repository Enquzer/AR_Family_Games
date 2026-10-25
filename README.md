# AR Family Games

A camera-driven, hands-free multiplayer game engine for the living room. Point a
laptop camera at the players, connect a TV over HDMI, and use your body as the
controller. Up to four people are tracked at once, each with a procedural 3D
avatar that mirrors their real movement.

Everything runs locally on your LAN. No cloud account, no internet connection
and no game console required.

```
laptop camera ──► pose tracking ──► WebSocket ──► TV display
   (host)          (MediaPipe)         (LAN)       (Three.js simulation)
```

## Games

| Game | Players | How to play |
| --- | --- | --- |
| **Boxing** | 1–2 | Jab with either hand, hold both hands up to block, lean or kick to dodge. Best of three rounds. |
| **Tennis** | 1–2 | Swing an arm across your body to return the ball. Lean left/right to aim. First to 7. |
| **Sprint** | 1–4 | Run on the spot to sprint down the track. Three heats, points for placings. |
| **Hurdles** | 1–4 | Run on the spot and jump when a hurdle reaches your feet. Clip one and you stumble. |
| **Rowing** | 1–4 | Pull both arms back together in a rowing rhythm. Lean to steer across the lake. |
| **Coaster** | 1–4 | A cooperative roller-coaster ride. Lean to steer, raise both arms to boost, crouch under bars. |
| **Dance** | 1–4 | Follow the coach’s arms, lean and knee lifts on the beat. Match the pose, keep your energy up and build combos. |

The TV owns the authoritative simulation and renders the 3D world. The laptop
sends compact pose packets at about 20 Hz and mirrors the live scoreboard.

## Requirements

- Windows 10/11 (macOS and Linux work too, with the same commands)
- **Node.js 20 or newer**
- **Google Chrome or Microsoft Edge** for the laptop controller (camera access
  and MediaPipe WebAssembly)
- A webcam (built-in or USB). A wide-angle camera helps in small rooms.
- A TV connected over HDMI
- The laptop and TV on the same local network (Wi-Fi or Ethernet)

## Install

```powershell
cd D:\my_codes\AR_Family_Games
npm install
```

`npm install` also runs `scripts/vendor.js`, which:

1. Copies Three.js and the MediaPipe runtime into `public/vendor/` so the app is
   self-contained and works without a CDN.
2. Ensures `public/models/pose_landmarker_full.task` exists (about 9 MB).

The pose model is already included in this project. If a fresh install cannot
reach Google Storage, the app still starts; copy
`pose_landmarker_full.task` into `public/models/` manually for fully offline
tracking.

## Run

```powershell
npm start
```

The server prints the local and LAN URLs:

```
All-in-One Console:  http://localhost:3000/
Phone tracker:       http://192.168.1.4:3000/tracker.html
```

1. Open **http://localhost:3000/** (or simply double-click **`Launch AR Family Games`** on your desktop).
2. Press `F11` for a clean, immersive fullscreen view.
3. Stand 2–4 m back so your whole body is in frame.
4. Up to four players are instantly recognized and matched to their persistent player profiles.
5. Raise your hand to reveal the Kinect cursor, browse through the game cards, and hover for 1.3s to start!
6. In any game, hover over **🏠 EXIT TO HOME** to return to the menu, or hover over **🛑 EXIT SYSTEM** to close.

### TV placement

Put the laptop (or its webcam) near the TV, with the camera facing the play area.
For the best AR perspective, the camera should see both the players and the TV
screen. A USB webcam on a small tripod aimed across the room works well. If the
TV cannot be seen by the camera, use the default **Quick setup** calibration:
the games still work, but the perspective is approximate.

## Calibration

Calibration tells the engine where the TV is in the camera image, so the 3D
world can be aligned with the screen and the avatars can be placed on the floor
in front of it.

### Auto-calibrate (recommended)

1. Dim the room lights and avoid reflections on the TV.
2. Make sure the camera is running and the TV display is connected in the same
   room.
3. Click **Auto-calibrate TV**.
4. The TV flashes pure white for a moment. Keep the camera and TV still.
5. The host finds the screen quad and reports the FOV, TV size and match
   confidence. The setting is saved locally and sent to the TV.

If detection fails, dim the room further, keep the whole TV in frame, or use
manual corners.

### Manual corners

1. Click **Pick corners**.
2. Click the four corners of the TV in this order:
   **top-left → top-right → bottom-right → bottom-left**.
3. Right-click or press `Esc` to cancel.

### Other calibration controls

- **TV size** — 43" to 85". Used to estimate the camera-to-screen geometry.
- **Mirror controls** — on by default so raising your right hand moves the
  on-screen avatar the intuitive way. Turn it off if you prefer raw camera
  coordinates.
- **Reset** — returns to the default quick-setup calibration.

### Distance and camera-FOV calibration

The TV calibration aligns the screen; the distance calibration aligns **depth**.
The engine estimates how far each player is from the camera from their apparent
body height:

```
distance = playerHeight / (2 * bodyHeightFraction * tan(cameraFov / 2))
```

A webcam's vertical FOV is often unknown, so the controller can solve it from a
known distance:

1. Stand at a measured spot, e.g. **3 m** from the camera.
2. Make sure your whole body (head to feet) is in frame and you have waved to
   join.
3. Choose that distance in **Stand at** and click **Calibrate FOV**.

The controller computes the camera's vertical FOV and saves it with the TV
calibration. From then on, each player's distance and horizontal angle are shown
under their name, and the TV uses them to:

- blend avatar depth between the TV floor and the player's real distance,
- widen the game camera smoothly when players stand close or spread out,
- keep avatar limb scale stable when legs are partly hidden.

You can repeat the FOV calibration whenever the camera is moved. If you skip it,
the default 55° estimate still works, just with less accurate depth.

## Playing

- **Players are detected automatically.** There are no controllers to hand out.
- **Wave to join & Hand Browsing.** Step into view and wave one hand side to side above your
  shoulder to join. Once your hand is tracked, raise it to reveal the glowing **Kinect hand cursor** on the TV.
- **Browse & start games with gestures.** Move your hand across the room to browse the game cards on the TV. Hover over any game for ~1.3 seconds to fill the circular dwell ring and launch directly from the TV — no need to touch the laptop!
- **Exit to Home from any game.** During any game, raise your hand towards the top-left **🏠 EXIT TO HOME** button. Hover your hand cursor over it for 1.25s to return to the home screen and browse to another game.
- **Exit system with gestures.** On the home screen, hover your hand cursor over the **🛑 EXIT SYSTEM** button for 1.6s to cleanly shut down the server and close the game hands-free.
- **Always-on display & sleep prevention.** The app automatically prevents your computer from sleeping or dimming the screen during gameplay using the Screen Wake Lock API and Windows system power flags.
- **Live tracking preview.** The laptop controller auto-starts the camera and
  shows a Kinect-style overlay: the skeleton, a ring around each hand, a
  **HAND TRACKED** badge when a hand is raised, and a wave meter that fills as
  the gesture registers. The status flips to **WAVE DETECTED** when the join
  succeeds. If the browser blocks the camera, click **Start camera** in the
  preview or the camera button.
- **TV prompts.** If the TV has no controller it shows the controller URL. If
  the controller is connected but its camera is off, the TV asks you to click
  **Start camera** on the laptop. Once the camera is live it switches to
  **Wave at the camera to join**.
- **Names** — edit a player's name in the laptop player list; the TV updates
  immediately.
- **Boxing / Tennis** use the first one or two players. Extra players stay on
  the bench.
- **Sprint / Hurdles / Rowing / Coaster** support up to four players.
- **Back to menu** stops the current game and returns the TV to the attract
  screen.
- **Restart game** starts a fresh round of the selected game.

### Scoring, audio and motion

- **Boxing** rewards clean, fast punches. Each punch is graded from hand
  extension, wrist speed, forward momentum and torso rotation. Hits, misses and
  blocked punches are tracked separately, so doing nothing cannot score. Combos
  and accuracy feed the final result.
- **Dance** compares your live pose with the coach’s target pose on every second
  beat. Hand position relative to the shoulders, lean, knee lift and torso twist
  all count. Standing still cannot score; movement and energy matter. Grades are
  `PERFECT`, `GREAT`, `GOOD` and `MISS`, with combo multipliers and per-player
  groove accuracy.
- **Sprint, hurdles and rowing** use fused body kinematics. Sprint and hurdles
  read leg drive, arm drive, knee lift and hip bob, so running on the spot drives
  the avatar’s legs and arms instead of only sliding it forward.
- **Audio** is synthesised locally with WebAudio: punch impacts, whiffs, blocks,
  footsteps, rowing splashes, dance beats, claps, bass and grade feedback. Click
  the TV page once (or press the sound button) to unlock browser audio.
- **Avatar orientation** follows the 3D shoulder and hip lines, so a player who
  turns their body turns their avatar instead of always facing the TV.

## Demo mode (no camera needed)

Useful for testing the display, checking a projector/TV, or trying the games
without standing up.

- TV: `http://localhost:3000/display.html?demo=1&game=boxing`
- Laptop: `http://localhost:3000/?demo=1`

Valid game IDs: `boxing`, `tennis`, `sprint`, `hurdles`, `boat`, `coaster`,
`dance`.
On the TV, `?demo=1` alone shows the attract screen with simulated players. The
laptop's **Demo players** button does the same thing interactively.

## Optional phone tracker

A phone can act as an extra camera and add more tracked players:

```
http://<laptop-LAN-IP>:3000/tracker.html?room=HOME
```

Open the page on the phone, enter the same room code and click **Start camera**.
Player IDs are namespaced by the sending device, so the phone and laptop can
track different people without collisions.

> **Phone camera limitation:** browsers only allow camera access on secure
> origins (`https://` or `localhost`). On a plain `http://192.168.x.x` LAN
> address, Chrome/Edge may block the camera. The laptop controller works because
> it uses `http://localhost`. Options:
>
> - Use the laptop camera for tracking (recommended).
> - Serve the app over HTTPS with a trusted certificate.
> - For testing only, launch Chrome with
>   `--unsafely-treat-insecure-origin-as-secure=http://192.168.1.4:3000`.

## Troubleshooting

### The camera will not start

- Open the controller at `http://localhost:3000/`, not via the LAN IP. Browsers
  treat `localhost` as a secure origin.
- The TV page (`display.html`) never accesses the camera. Keep the controller
  page open on the laptop; the TV only receives the tracked poses.
- Close other apps that may be using the camera (Teams, Zoom, OBS).
- Allow camera permission in the browser's site settings and reload.
- On Windows, check **Settings → Privacy & security → Camera**.
- If the page is served over HTTPS with a self-signed certificate, accept the
  certificate first.

### The TV is not detected during auto-calibration

- Dim the room and turn off lights that reflect off the screen.
- Keep the entire TV inside the camera frame.
- Make sure the TV display page is open and connected to the same room.
- Try manual corners; it is often faster in a bright room.

### The TV says "NO CONTROLLER" or the laptop says "NO TV"

- Both pages must use the same room code (`?room=HOME` by default).
- Check that the laptop and TV are on the same network and can reach the server.
- Allow Node.js through Windows Firewall on private networks.
- If the TV is a smart-TV browser, use a laptop/PC connected by HDMI instead;
  the display needs WebGL and a modern browser.

### Tracking is laggy or jittery

- Use 5 GHz Wi-Fi or wired Ethernet for the TV.
- Close extra browser tabs and background apps.
- Lower the camera resolution in the host's camera settings if the CPU is busy.
- Keep the play area well lit and avoid strong backlighting.
- Stand far enough back that the whole body is visible; cropped feet break
  running and jumping detection.

### A player does not join when waving

- Raise one hand clearly above shoulder height and sweep it side to side two or
  three times, about 20–30 cm of travel.
- Keep the whole upper body in frame; a hand outside the camera frame cannot be
  tracked.
- Wait about two seconds between attempts; the wave detector has a cooldown.
- If the player row says **WAVE TO JOIN**, the camera sees the person but the
  gesture was not strong enough yet.
- Demo players join automatically; wave detection is bypassed in demo mode.

### The distance readout looks wrong

- Run **Calibrate FOV** from a measured standing distance. The default 55° is
  only an estimate for an unknown webcam.
- Make sure your head and both feet are visible. The estimate uses the
  shoulder-to-ankle and nose-to-ankle spans.
- If the camera was moved, recalibrate both the TV and the FOV.
- The distance is a depth cue, not a measurement tool; small errors are normal
  and the TV smooths them for the view rig.

### No sound

- Browsers require a user gesture before audio can play. Click the TV page once
  or press the sound button.
- Check the TV's input volume and that the HDMI audio device is selected.

### Port 3000 is already in use

```powershell
$env:PORT=3001; npm start
```

Then use `http://localhost:3001/` and `http://localhost:3001/display.html`.

### The pose model fails to load

- Confirm `public/models/pose_landmarker_full.task` exists and is about 9 MB.
- Run `npm install` again to re-copy the runtime files.
- If you are offline, make sure the model file is present; the app otherwise
  falls back to a CDN URL.

## Project layout

```
AR_Family_Games/
├─ server/index.js              HTTP + WebSocket room relay
├─ scripts/vendor.js            Copies Three.js/MediaPipe and the pose model
├─ public/
│  ├─ index.html                Laptop controller
│  ├─ display.html              TV display / attract screen
│  ├─ tracker.html              Optional phone camera
│  ├─ models/                   Local MediaPipe pose model
│  ├─ vendor/                   Local Three.js + MediaPipe runtime
│  ├─ styles/main.css           Shared UI styling
│  └─ src/
│     ├─ app/                   host, display, tracker, pose engine
│     ├─ engine/                renderer, avatars, worlds, effects, audio
│     ├─ games/                 boxing, tennis, track, boat, coaster, dance
│     ├─ vision/                camera, pose tracker, motion, calibration, simulator
│     ├─ shared/                math, pose format, homography, stage mapping
│     └─ net/                   reconnecting WebSocket client
└─ package.json
```

## How it works

1. **Host** captures camera frames and runs MediaPipe Pose Landmarker locally in
   the browser. A multi-person tracker keeps stable IDs and colors.
2. **Motion features** are derived from the landmarks: punches, swings, blocks,
   lean, running cadence, jumps, crouches, arm raises, rowing strokes and the
   wave-to-join gesture. A raised-hand side-to-side wave is filtered out of the
   punch/swing features so joining never throws accidental hits.
3. **Pose packets** (33 landmarks per player, compact arrays, plus a `joined`
   flag) go to the local Node server over WebSocket and are relayed to the
   display.
4. **Display** runs the game simulation and renders procedural 3D worlds with
   Three.js. Avatars are skeleton rigs driven directly by the landmarks.
5. **Calibration** uses the white TV flash to find the screen quad, computes a
   homography, and derives the camera FOV/roll used by the 3D stage. A second
   trig step uses apparent body height at a known distance to solve the camera's
   vertical FOV, which drives the live distance/angle readout.
6. **View rig** blends each player's distance into stage depth and widens the
   game camera when the group is close or spread out, so every player stays
   framed with a plausible room perspective.
7. **State** flows back to the laptop so the controller shows the same scores,
   timer and messages as the TV.

All pose data stays on the local network. Nothing is uploaded to a cloud service.

## Development

```powershell
npm run dev          # restart the server on file changes
$env:LOG_REQUESTS=1; npm start
```

Useful URLs:

- `http://localhost:3000/api/info` — rooms, peers and LAN addresses
- `http://localhost:3000/display.html?debug=1` — exposes a read-only
  `window.__arfg` diagnostics hook in the browser console

The games are modular classes under `public/src/games/`. Each extends
`BaseGame` and implements `buildWorld()`, `update(dt)` and `getHud()`. Add a new
game by creating a class, registering it in `public/src/games/index.js`, and
adding metadata to `public/src/games/catalog.js`.

## Built with

- [Three.js](https://threejs.org/) 0.170 — 3D rendering
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) 0.10.18 —
  pose landmark detection
- [ws](https://github.com/websockets/ws) — WebSocket relay
- Procedural worlds, avatars, particles and synthesized WebAudio

No game assets or model files are required beyond the pose model; all worlds and
characters are generated at runtime.
