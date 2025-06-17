## Summary

- **Project Name:** BRICK RUNNER  
- **Genre:** 2D Arcade Brick-Breaker  
- **Vision:** A fast-paced, retro-futuristic, cyberpunk-themed brick-breaker game designed for player engagement and replayability, featuring unique power-ups, dynamic scoring, and a highly polished audio-visual presentation.  
- **Current Status:** Feature-complete as of the last stable version; fully playable, highly responsive, and includes a custom soundscape. Key development iterations focused on enhancing player feedback, visual flair, and game mechanics.  
- **Key Accomplishments:**  
  - Sophisticated power-up system  
  - Dynamic scoring (including a skill-based *Roof Bonus* and *Neon Legend* status)  
  - Custom sound engine  
- **Note on Development History:** Faced recurring issues with corrupted/minified JavaScript delivery. The current codebase is a manually verified, stable version prioritizing clean structure and reliability.

## 2. Product Requirements Document (PRD)

This section details all implemented features in the current stable version of BRICK RUNNER.

### 2.1 Core Gameplay
- **Objective:** Classic brick-breaking gameplay.  
- **Mechanics:** Paddle, ball, and a grid of destructible bricks.  
- **Scoring:** Points awarded for breaking bricks; shown in the top-left UI.  
- **Game Over:** Occurs when the ball falls below the paddle.  
- **Victory:** All bricks destroyed.

### 2.2 Power-Up System
- **Types (Emoji representation):**  
  - 🍄 **Expando:** Increases paddle width (stacking duration).  
  - 🐌 **Slow-Mo:** Reduces ball speed (stacking duration).  
  - 🧲 **Mag-Lock:** Sticky paddle for controlled launch (refreshing duration).  
  - 🎯 **Laser Blast:** Fires lasers from paddle (Spacebar action; refreshing duration).  
- **Visuals:**  
  - Emoji indicator above bricks on spawn.  
  - Active power-ups displayed in top-right UI with timer bars and stack counts.  
- **Audio:**  
  - Unique sounds on spawn, activation (pitched “bounce” or “laserFire”), and expiration (pitched “multihit” or “grow_reversed”).

### 2.3 Advanced Gameplay Mechanics

**Multi-Hit Bricks**  
- Require two hits to destroy.  
- Visual: black “notch” disappears on first hit.  
- Audio: “thud” on first hit; “power chord” on second (via pitched multihit).

**Roof Bonus**  
- Activated by hitting the top edge of the play area.  
- Visual: ball glows gold (`.bonus-active`).  
- Effect: Next brick broken yields 1.5× points (15 instead of 10); deactivates on next brick or paddle hit.

**“Neon Legend” Status**  
- Achieved at > 500 points in a single game.  
- Visual: ball emoji changes to 😎.  
- Audio/UI: special notification + “win song.”

### 2.4 Presentation & User Interface (UI/UX)
- **Thematic Design:** Retro-futuristic/cyberpunk neon palette.  
- **Game Title:** “BRICK RUNNER” with glitch animation.  
- **High Score:** Always visible in top-right header (e.g., “High Score: 625”).  
- **Notifications:** Hologram-style stacking pop-ups for power-ups and status updates.  
- **Feedback:** Ball impact and brick-shake animations.

### 2.5 Startup & Game Flow
1. **“Click to Begin” Screen:** Central bouncing emoji; click to proceed.  
2. **Main Start Screen:** Animated title + “Press SPACE to Begin.”  
3. **Game Start Sequence:**  
   - **Press SPACE** → `initGame()` → `ballIsStuck = true` → intro song → `autoLaunchTimeout`.  
   - Brief “get ready” phase with ball stuck to paddle.  
   - Manual launch (Spacebar/Click) before auto-launch.  
4. **End Game Screens:** “Mission Complete!” or “System Failure!”, final score, rating, and “New High Score!” if applicable.

### 2.6 Control Scheme
- **Paddle Movement:** Mouse horizontal tracking.  
- **Spacebar (Unified Action Button):**  
  - Starts game from main menu.  
  - Launches stuck/magnetized ball.  
  - Fires laser (if active).  
  - If multiple actions available, triggers all at once.  
  - Toggles pause/unpause if no other action applies.

## 3. Technical Knowledge Handover

### 3.1 File Structure
- `index.html` – Main game structure  
- `style.css` – Visual styling and animations  
- `script.js` – Game logic and state management (vanilla JS)

### 3.2 Key Global Variables / Modules (`script.js`)
- **DOM refs:** `gameArea`, `scoreDisplay`, `paddle`, `ball`, `bricksContainer`, etc.  
- **`soundManager`:** Web Audio API wrapper (`play()` accepts pitch/volume, handles reversed sounds).  
- **Power-up config:** `POWER_UP_TYPES`, `POWER_UP_SPAWN_CHANCES`.  
- **Audio assets:** `soundsToLoad` (map of names → URLs + reversable flag), `destroySounds`, `catDestroyPitches`.  
- **Ball state:** `ballX`, `ballY`, `ballSpeedX`, `ballSpeedY`.  
- **Bricks:** `let bricks = []` array.  
- **`activePowerUps`:** Tracks timers.  
- **State flags:** `gameOver`, `gameRunning`, `ballIsStuck`, `assetsReady`, `isRoofBonusActive`, `isNeonLegend`.  
- **Timers:** `autoLaunchTimeout`, `emojiCycleInterval`.  
- **Controls:** `paddleX`, `paddleY`, `leftPressed`, `rightPressed`.

### 3.3 Core Game Loop & Update Functions
- **`requestAnimationFrame(gameLoop)`** – Main render loop.  
- **`gameLoop(timestamp)`** – Computes `deltaTime`, calls update/check functions, then `renderGame()`.  
- **`updateBallPosition(dt)`** – Moves ball.  
- **`checkCollisions()`** – Detects ball-brick/paddle collisions.  
- **`renderGame()`** – Updates CSS positions.

### 3.4 Startup Sequence (`setupGame` & `startGame`)
1. **`DOMContentLoaded` → `setupGame()`:** Initialize overlays, load assets, then show main menu.  
2. **`initGame()`:** Called by `setupGame()` and reset button; resets vars, rebuilds bricks.  
3. **`startGame()`:** On Spacebar; runs `initGame()`, sets `ballIsStuck = true`, plays intro, sets `autoLaunchTimeout` for `launchStuckBall`.

### 3.5 Known & Persistent Issues
- **Historical Code Corruption:** Frequent JS minification/corruption; current code is manually verified for stability.  
- **Unimplemented Features:**  
  - **Life System & 1-UP:** Rolled back; would need a `lives` variable, `updateLivesDisplay()`, `resetAfterLifeLost()`, and modify out-of-bounds logic.  
  - **Multi-Ball (“Cat!”):** Requires refactoring single-ball vars into `balls = []` and iterating in all update/collision/render functions.  
- **Refactoring Notes:** Adding multi-ball impacts `checkCollisions()`, `updateBallPosition()`, `renderGame()`, `launchStuckBall()`, and `createOnionSkin()`.
