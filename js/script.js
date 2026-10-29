import { showNotification } from './notifications.js';

// --- Game Constants and DOM Element References ---
const GAME_SCALE = 1.5;
const GAME_WIDTH = 600 * GAME_SCALE;
const GAME_HEIGHT = 400 * GAME_SCALE;
const PADDLE_DEFAULT_WIDTH = 100 * GAME_SCALE;
const PADDLE_HEIGHT = 15 * GAME_SCALE;
const BALL_SIZE = 60;
const BRICK_ROWS = 5;
const BRICK_COLS = 10;
const BRICK_GAP = 2 * GAME_SCALE;
const BRICK_WIDTH = (GAME_WIDTH / BRICK_COLS) - BRICK_GAP;
const BRICK_HEIGHT = 20 * GAME_SCALE;
const PADDLE_BOTTOM_OFFSET = 10 * GAME_SCALE;
const POWER_UP_CHANCE = 0.35;
const POWER_UP_SIZE = 30;
const clearedRows = new Set();
let rowBonusCount = 0;  // always = clearedRows.size


const INITIAL_BALL_SPEED = 200 * GAME_SCALE;
const PADDLE_SPEED = 450 * GAME_SCALE;
const POWER_UP_SPEED = 120 * GAME_SCALE;
const GRAVITY = 10 * GAME_SCALE;
const LASER_SPEED = 500 * GAME_SCALE;
const FIRE_COOLDOWN = 300;
const MAX_NOTIFICATIONS = 3;
let rowBonusLevel = 0;
let isCatMode = false;
let catModeArmed = false;

const gameArea = document.getElementById('game-area');
const scoreDisplay = document.getElementById('score');
const notificationsContainer = document.getElementById('notifications-container');
const statusIndicatorsContainer = document.getElementById('status-indicators');
const ball = document.getElementById('ball');
const paddle = document.getElementById('paddle');
const bricksContainer = document.getElementById('bricks-container');
const gameMessage = document.getElementById('game-message');
const startScreen = document.getElementById('start-screen');
const pauseButton = document.getElementById('pause-button');
const resetButton = document.getElementById('reset-button');
const startPrompt = startScreen.querySelector(".start-prompt");
const clickToStartOverlay = document.getElementById('click-to-start-overlay');
const highScoreDisplay = document.getElementById('high-score-display');
const loadingEmoji = document.getElementById('loading-emoji');


function showBrickScore(x, y, pts) {
  const pop = document.createElement("div");
  pop.className = "score-pop-up";
  pop.textContent = `+${pts}`;
  // position it centered on the brick
  pop.style.left = `${x}px`;
  pop.style.top  = `${y}px`;
  
  gameArea.appendChild(pop);


  // Now center it by shifting left/up via margins:
  const { width, height } = pop.getBoundingClientRect();
  pop.style.marginLeft = `-${width/2}px`;
  pop.style.marginTop  = `-${height}px`;
  // trigger the animation
  requestAnimationFrame(() => pop.classList.add("visible"));

  // remove after it’s done
  setTimeout(() => pop.remove(), 800);
}



// --- Sound Manager ---
const soundManager = {
    context: null,
    sounds: {},
    nowPlaying: {},
    init() {
        if (this.context) return;
        this.context = new (window.AudioContext || window.webkitAudioContext)();
    },
    async loadSound(name, url, reversable = false) {
        if (!this.context) return;
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
            this.sounds[name] = { buffer: audioBuffer, duration: audioBuffer.duration };
            if (reversable) {
                const reversedBuffer = this.createReversedBuffer(audioBuffer);
                this.sounds[`${name}_reversed`] = { buffer: reversedBuffer, duration: reversedBuffer.duration };
            }
        } catch (error) {
            console.error(`Failed to load sound: ${name} from ${url}`, error);
        }
    },
    createReversedBuffer(buffer) {
        const originalChannels = [];
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            originalChannels.push(buffer.getChannelData(i));
        }
        const reversedBuffer = this.context.createBuffer(
            buffer.numberOfChannels,
            buffer.length,
            buffer.sampleRate
        );
        for (let i = 0; i < originalChannels.length; i++) {
            const original = originalChannels[i];
            const reversed = reversedBuffer.getChannelData(i);
            reversed.set(original.slice().reverse());
        }
        return reversedBuffer;
    },
    loadAll(soundMap) {
        const promises = [];
        for (const name in soundMap) {
            promises.push(this.loadSound(name, soundMap[name].url, soundMap[name].reversable));
        }
        return Promise.all(promises);
    },
    play(name, options = {}) {
        if (!this.context || !this.sounds[name]?.buffer) return;
        if (options.loop && this.nowPlaying[name]) {
            this.nowPlaying[name].stop();
        }
        const source = this.context.createBufferSource();
        source.buffer = this.sounds[name].buffer;
        const gainNode = this.context.createGain();
        gainNode.gain.value = options.volume !== undefined ? options.volume : 1.0;
        const slowMoLevel = activePowerUps['slow-mo']?.length || 0;
        const globalPitchMultiplier = (slowMoLevel > 0) ? 0.25 : 1.0;
        source.playbackRate.value = (options.pitch || 1.0) * globalPitchMultiplier;
        source.loop = options.loop || false;
        source.connect(gainNode).connect(this.context.destination);
        source.start(0);
        if (source.loop) {
            this.nowPlaying[name] = source;
        }
    },
    stop(name) {
        if (this.nowPlaying[name]) {
            this.nowPlaying[name].stop();
            delete this.nowPlaying[name];
        }
    },
    stopAll() {
        for (const name in this.nowPlaying) {
            this.stop(name);
        }
    }
};

// --- Game State Variables ---
let score = 0, gameOver = true, gameRunning = false, animationFrameId, emojiSwapTimeout = null, powerUps = [], activePowerUps = {}, paddleSizeLevel = 0, MAX_PADDLE_LEVEL = 3, isStickyPaddle = false, ballIsStuck = false, isLaserActive = false, canFire = true, lasers = [], assetsReady = !1, isRoofBonusActive = false, isNeonLegend = false, autoLaunchTimeout = null, emojiCycleInterval = null;
let lives = 1;
const POWER_UP_TYPES = {
  'wide-paddle': {
    type:        'stacking',
    emoji:       '🪴',
    name:        'EXPANDO',
    description: 'Multiply your score!',
    cssClass:    'wide-paddle',
    duration:    15000
  },
  'slow-mo': {
    type:        'stacking',
    emoji:       '🐌',
    name:        'SLOW-MO',
    description: 'Ball speed reduced',
    cssClass:    'slow-mo',
    duration:    5000
  },
  'sticky-paddle': {
    type:        'refreshing',
    emoji:       '🧲',
    name:        'MAG-LOCK',
    description: 'Catch & launch the ball',
    cssClass:    'sticky-paddle',
    duration:    4000
  },
  'laser-blast': {
    type:        'refreshing',
    emoji:       '🎯',
    name:        'LASER BLAST',
    description: 'Press SPACE to fire!',
    cssClass:    'laser-blast',
    duration:    5000
  },
  'one-up': {
    type:        'instant',
    emoji:       '🧱',
    name:        'Bricked Up!',
    description: 'New bricks incoming!',
    cssClass:    'one-up'
  }
};

const POWER_UP_SPAWN_CHANCES = ['wide-paddle', 'wide-paddle', 'wide-paddle', 'slow-mo', 'slow-mo', 'sticky-paddle', 'laser-blast', 'one-up'];
const soundsToLoad = { 
  'bounce':      { url: "./sounds/paddle-and-wall.mp3" }, 
  'multihit':    { url: "./sounds/multi-hit.mp3" }, 
  'destroy1':    { url: "./sounds/Destroy1.mp3" }, 
  'destroy2':    { url: "./sounds/Destroy2.mp3" }, 
  'destroy3':    { url: "./sounds/Destroy3.mp3" }, 
  'powerUpSpawn':{ url: "./sounds/Drop.mp3" }, 
  'laserFire':   { url: "./sounds/Laser2.mp3" }, 
  'winSong':     { url: "./sounds/theme.wav" }, 
  'loseSong':    { url: "./sounds/LoserSong.mp3" }, 
  'grow':        { url: "./sounds/Grow.mp3", reversable: true }, 
  'magActivate': { url: "./sounds/mag1.mp3" }, 
  'magLaunch':   { url: "./sounds/mag2.mp3" } 
};

const destroySounds = ['destroy1', 'destroy2', 'destroy3'];
let destroySoundIndex = 0;
let paddleX, paddleWidth = PADDLE_DEFAULT_WIDTH, leftPressed = false, rightPressed = false;
let ballX, ballY, ballSpeedX, ballSpeedY;
let BALL_EMOJI = "😊", CHAOTIC_EMOJIS = ["😵","🤪","🤯","😱","🥴","😡","🤢","🫠","💀","😭","🗿","😂","🤣","😏","🙄","😮","🤧","🤮","🤠","🥸","👽","🤖","👺","👻","🤓","🧐","🥺","😠","😲"];
// UPDATED: The 'bricks' array is now declared with 'let' instead of 'const'
let bricks = [];
let lastTime = 0,
    frameCounter = 0;

// --- Helper Functions & Arcade Leaderboard ---
const LEADERBOARD_STORAGE_KEY = "brickRunnerLeaderboard";
const LAST_INITIALS_KEY = "brickRunnerLastInitials";
const MAX_LEADERBOARD_ENTRIES = 5;
// Optional: Paste a Google Apps Script Web App URL or REST endpoint here to sync scores globally across all players
const LEADERBOARD_API_URL = "";

let memoryHighScore = 0;
let memoryLeaderboard = null;
let memoryLastInitials = "TRV";
let awaitingInitials = false;
let pendingEndGameWon = false;
let lastSavedEntryId = null;

function getLastInitials() {
  try {
    return (localStorage.getItem(LAST_INITIALS_KEY) || memoryLastInitials || "TRV").toUpperCase().slice(0, 3);
  } catch (err) {
    return memoryLastInitials;
  }
}

function saveLastInitials(initials) {
  memoryLastInitials = initials;
  try {
    localStorage.setItem(LAST_INITIALS_KEY, initials);
  } catch (err) {
    // Ignore storage errors in sandboxed iframes
  }
}

function getLeaderboard() {
  let list = null;
  try {
    const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (raw) list = JSON.parse(raw);
  } catch (err) {
    list = memoryLeaderboard;
  }
  if (!Array.isArray(list)) {
    list = Array.isArray(memoryLeaderboard) ? [...memoryLeaderboard] : [];
  }
  // Filter out any old phantom legacy-seed entries
  list = list.filter(item => item && item.id !== "legacy-seed");
  list.sort((a, b) => b.score - a.score);
  return list.slice(0, MAX_LEADERBOARD_ENTRIES);
}

function saveLeaderboard(entries) {
  const sorted = [...entries].sort((a, b) => b.score - a.score).slice(0, MAX_LEADERBOARD_ENTRIES);
  memoryLeaderboard = sorted;
  if (sorted.length > 0 && sorted[0].score > memoryHighScore) {
    memoryHighScore = sorted[0].score;
  }
  try {
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(sorted));
    if (sorted.length > 0) {
      localStorage.setItem("brickRunnerHighScore", sorted[0].score);
    }
  } catch (err) {
    // Ignore storage errors in sandboxed iframes
  }
  updateHighScoreDisplay();
  updateStartLeaderboard();
  return sorted;
}

function qualifiesForLeaderboard(newScore) {
  if (newScore <= 0) return false;
  const board = getLeaderboard();
  return board.length < MAX_LEADERBOARD_ENTRIES || newScore > board[board.length - 1].score;
}

function addLeaderboardEntry(rawInitials, newScore, won) {
  const cleanInitials = (rawInitials || "AAA").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "A");
  saveLastInitials(cleanInitials);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    initials: cleanInitials,
    score: newScore,
    rating: getRating(newScore, won),
    won: !!won,
    date: new Date().toISOString().slice(0, 10)
  };
  const board = getLeaderboard();
  board.push(entry);
  saveLeaderboard(board);
  lastSavedEntryId = entry.id;
  postRemoteScore(entry);
  return entry;
}

function renderLeaderboardHTML(highlightId = null) {
  const board = getLeaderboard();
  if (board.length === 0) {
    return `
      <div class="leaderboard-heading">🏆 TOP 5 CYBER-RUNNERS</div>
      <div class="leaderboard-empty">NO RECORDS YET — BE THE FIRST!</div>
    `;
  }
  const rows = board.map((item, idx) => {
    const classes = ["leaderboard-row"];
    if (idx === 0) classes.push("rank-1");
    if (highlightId && item.id === highlightId) classes.push("current-run");
    return `
      <div class="${classes.join(" ")}">
        <span class="lb-pos">#${idx + 1}</span>
        <span class="lb-initials">${item.initials}</span>
        <span class="lb-score">${item.score}</span>
        <span class="lb-tier">${item.rating || getRating(item.score, item.won)}</span>
      </div>
    `;
  }).join("");
  return `
    <div class="leaderboard-heading">🏆 TOP 5 CYBER-RUNNERS</div>
    <div class="leaderboard-list">${rows}</div>
  `;
}

function updateStartLeaderboard() {
  const el = document.getElementById("start-leaderboard");
  if (!el) return;
  el.innerHTML = renderLeaderboardHTML(lastSavedEntryId);
}

// --- Pre-Game Arcade Callsign Keypad ---
const CALLSIGN_PRESETS = ["NEO", "ZAP", "HEX", "CAT", "SYN", "MAX", "ACE", "VEX", "GLX", "NYX", "CYB", "TRV"];
const KEYPAD_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
let activeCallsignSlot = 0;

function isStartScreenOpen() {
  return gameOver && startScreen && startScreen.style.display === "flex" && (!clickToStartOverlay || clickToStartOverlay.style.display === "none");
}

function getCallsignChars() {
  const raw = getLastInitials().padEnd(3, "A").slice(0, 3);
  return [raw[0], raw[1], raw[2]];
}

function renderCallsignBuilder() {
  const container = document.getElementById("callsign-builder");
  if (!container) return;
  const chars = getCallsignChars();

  const slotsHTML = chars.map((ch, idx) => `
    <div class="callsign-slot ${idx === activeCallsignSlot ? "active" : ""}" data-slot="${idx}">
      ${ch}
    </div>
  `).join("");

  const keysHTML = [
    ...KEYPAD_LETTERS.map(letter => `<button type="button" class="keypad-key" data-key="${letter}">${letter}</button>`),
    `<button type="button" class="keypad-key key-special" data-key="RANDOM" title="Random Cyber Callsign">🎲</button>`,
    `<button type="button" class="keypad-key key-special" data-key="BACK" title="Backspace">⌫</button>`
  ].join("");

  container.innerHTML = `
    <div>
      <div class="callsign-heading">🕹️ RUNNER CALLSIGN</div>
      <div class="callsign-slots">${slotsHTML}</div>
      <div class="keypad-grid">${keysHTML}</div>
    </div>
    <div class="callsign-subhint">Pick from keypad or type A–Z &bull; Saved automatically</div>
  `;

  container.querySelectorAll(".callsign-slot").forEach(slotEl => {
    slotEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      activeCallsignSlot = parseInt(slotEl.dataset.slot, 10) || 0;
      soundManager.play("bounce", { pitch: 1.25, volume: 0.3 });
      renderCallsignBuilder();
    });
  });

  container.querySelectorAll(".keypad-key").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const k = btn.dataset.key;
      if (k === "RANDOM") {
        randomizeCallsign();
      } else if (k === "BACK") {
        backspaceCallsign();
      } else if (k && k.length === 1) {
        setCallsignLetter(k);
      }
    });
  });
}

function setCallsignLetter(letter) {
  const clean = letter.toUpperCase().replace(/[^A-Z]/g, "");
  if (!clean) return;
  const chars = getCallsignChars();
  chars[activeCallsignSlot] = clean[0];
  saveLastInitials(chars.join(""));
  soundManager.play("bounce", { pitch: 1.3 + activeCallsignSlot * 0.18, volume: 0.35 });
  activeCallsignSlot = (activeCallsignSlot + 1) % 3;
  updateHighScoreDisplay();
  renderCallsignBuilder();
}

function backspaceCallsign() {
  activeCallsignSlot = (activeCallsignSlot + 2) % 3;
  soundManager.play("multihit", { pitch: 0.9, volume: 0.3 });
  renderCallsignBuilder();
}

function randomizeCallsign() {
  const current = getLastInitials();
  const pool = CALLSIGN_PRESETS.filter(p => p !== current);
  const pick = pool[Math.floor(Math.random() * pool.length)] || "NEO";
  saveLastInitials(pick);
  activeCallsignSlot = 0;
  soundManager.play("powerUpSpawn", { pitch: 1.5, volume: 0.45 });
  updateHighScoreDisplay();
  renderCallsignBuilder();
}

async function syncRemoteLeaderboard() {
  if (!LEADERBOARD_API_URL) return;
  try {
    const res = await fetch(LEADERBOARD_API_URL);
    if (!res.ok) return;
    const remoteEntries = await res.json();
    if (!Array.isArray(remoteEntries)) return;
    const merged = [...getLeaderboard(), ...remoteEntries];
    const seen = new Set();
    const deduped = merged.filter(item => {
      const key = `${item.initials}-${item.score}-${item.date || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    saveLeaderboard(deduped);
  } catch (err) {
    console.warn("Remote leaderboard sync skipped:", err);
  }
}

async function postRemoteScore(entry) {
  if (!LEADERBOARD_API_URL) return;
  try {
    await fetch(LEADERBOARD_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(entry)
    });
    syncRemoteLeaderboard();
  } catch (err) {
    console.warn("Remote leaderboard post skipped:", err);
  }
}

function getHighScore() {
  const board = getLeaderboard();
  if (board.length > 0) return board[0].score;
  try {
    return parseInt(localStorage.getItem("brickRunnerHighScore")) || memoryHighScore || 0;
  } catch (err) {
    return memoryHighScore || 0;
  }
}
function saveHighScore(e) {
  const t = getHighScore();
  if (e > t) {
    memoryHighScore = e;
    try {
      localStorage.setItem("brickRunnerHighScore", e);
    } catch (err) {
      // Ignore storage errors in sandboxed iframes
    }
  }
  updateHighScoreDisplay();
}
function updateHighScoreDisplay() {
  const board = getLeaderboard();
  const runner = getLastInitials();
  if (board.length > 0) {
    highScoreDisplay.textContent = `High Score: ${board[0].score} (${board[0].initials}) • Runner: ${runner}`;
  } else {
    const e = getHighScore();
    highScoreDisplay.textContent = `High Score: ${e} • Runner: ${runner}`;
  }
}

/**
 * Returns a rank string based on the final score and win/loss.
 * Uses the expanded 8-loss + 6-win tier system.
 */
function getRating(score, won) {
  if (!won) {
    // ❌ Loss tiers (8)
    if (score < 200)      return "System Glitch";
    if (score < 400)      return "Code Ghost";
    if (score < 700)      return "Memory Leak";
    if (score < 1000)     return "Burned Out";
    if (score < 1500)     return "Data Janitor";
    if (score < 2000)     return "Pixel Drifter";
    if (score < 2500)     return "Grid Runner";
                         return "Neon Operator";
  } else {
    // ✅ Win tiers (6)
    if (score < 3500)     return "Neon Legend";
    if (score < 4500)     return "Circuit Surfer";
    if (score < 6000)     return "Hologram Hacker";
    if (score < 8000)     return "Beyond the Black Wall";
    if (score < 10000)    return "Synth Overlord";
                         return "You Are The Replaced";
  }
}

// --- Game Core Functions ---
function initGame() {
    isCatMode   = catModeArmed;
    BALL_EMOJI  = isCatMode ? "🐱" : "😊";
    ball.textContent = BALL_EMOJI;  
    score = 0;
    scoreDisplay.textContent = `Score: ${score}`;
    clearedRows.clear();
    rowBonusCount = 0;
    rowBonusLevel = 0;
    isStickyPaddle = false;
    ballIsStuck = false;
    isLaserActive = false;
    canFire = true;
    isRoofBonusActive = false;
    isNeonLegend = false;
    ball.classList.remove('bonus-active');
    lasers.forEach(l => l.element.remove());
    lasers = [];
    paddle.classList.remove('paddle-sticky', 'paddle-armed');
    paddleSizeLevel = 0;
    activePowerUps = {};
    const multBadge = document.getElementById('score-multiplier');
    if (multBadge) multBadge.style.display = 'none';
    powerUps.forEach(p => p.element.remove());
    powerUps = [];
    gameArea.querySelectorAll('.brick.extra').forEach(el => el.remove());
    notificationsContainer.innerHTML = "";
    statusIndicatorsContainer.innerHTML = "";
    paddleX = GAME_WIDTH / 2;
    updatePaddleWidth();
    paddle.style.transform = 'scaleX(1)';
    paddle.style.bottom = `${PADDLE_BOTTOM_OFFSET}px`;
    ballX = (GAME_WIDTH - BALL_SIZE) / 2;
    ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE - 20;
    clearTimeout(emojiSwapTimeout);
    ball.textContent = BALL_EMOJI;
    ballSpeedX = 0;
    ballSpeedY = 0;
    bricksContainer.innerHTML = '';
    bricks = [];
    createBricks();
    gameOver = true;
    gameRunning = false;
    awaitingInitials = false;
    
    startScreen.style.display = 'flex';
    renderCallsignBuilder();
    updateStartLeaderboard();
    updateHighScoreDisplay();
    gameMessage.style.display = 'none';
    scoreDisplay.style.display = 'none';
     statusIndicatorsContainer.style.display = 'none';
    ball.style.display = 'none';
    if (pauseButton) {
      pauseButton.style.display = 'none';
      pauseButton.textContent = 'Pause [P]';
    }
    resetButton.style.display = 'none';
    
    gameArea.classList.remove('hide-cursor');
    lastTime = 0;
    soundManager.stopAll();
    clearTimeout(autoLaunchTimeout);
}

function createBricks() {
  // vertical offset from top
  const offsetY = 50 * GAME_SCALE;
  // center the grid horizontally
  const gridLeft = (GAME_WIDTH 
                  - BRICK_COLS * (BRICK_WIDTH + BRICK_GAP) 
                  + BRICK_GAP) / 2;

  // clear out any old bricks
  bricksContainer.innerHTML = '';
  bricks = [];

  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      // 1) create the DOM element
      const el = document.createElement('div');
      el.classList.add('brick', `brick-row-${row}`);

      // 2) maybe assign a power-up
      let powerUpType = null;
      if (Math.random() < POWER_UP_CHANCE) {
        powerUpType = POWER_UP_SPAWN_CHANCES[
          Math.floor(Math.random() * POWER_UP_SPAWN_CHANCES.length)
        ];
        // show its indicator
        const indicator = document.createElement('span');
        indicator.className = 'power-up-indicator';
        indicator.textContent = POWER_UP_TYPES[powerUpType].emoji;
        el.appendChild(indicator);
      }

      // 3) decide if it's a multi‐hit brick
      let hitsRequired = 1;
      if (Math.random() < 0.25) {
        hitsRequired = 2;
        el.classList.add('multihit');
      }

      // 4) position & size it
      el.style.position = 'absolute';   // ← this line
      const x = gridLeft + col * (BRICK_WIDTH + BRICK_GAP);
      const y = offsetY  + row * (BRICK_HEIGHT + BRICK_GAP);
      el.style.width  = `${BRICK_WIDTH}px`;
      el.style.height = `${BRICK_HEIGHT}px`;
      el.style.left   = `${x}px`;
      el.style.top    = `${y}px`;

      // 5) define its data object — **now with row tagging**!
      const brick = {
        element:      el,
        x, 
        y,
        width:        BRICK_WIDTH,
        height:       BRICK_HEIGHT,
        isBroken:     false,
        hitsRequired,
        hitsTaken:    0,
        powerUpType,
        row           // ← this lets you check row‐clears later
      };

      // 6) append & track
      bricksContainer.appendChild(el);
      bricks.push(brick);
    }
  }
}



let pauseStartTime = null;

function setupGame() {
    updateHighScoreDisplay();
    startScreen.style.display = 'none';
    clickToStartOverlay.style.display = 'flex';

    const allEmojis = [BALL_EMOJI, ...Object.values(POWER_UP_TYPES).map(p => p.emoji)];
    let emojiIndex = 0;
    clearInterval(emojiCycleInterval);
    emojiCycleInterval = setInterval(() => {
        if(loadingEmoji) {
            loadingEmoji.textContent = allEmojis[emojiIndex];
            emojiIndex = (emojiIndex + 1) % allEmojis.length;
        }
    }, 500);

    clickToStartOverlay.addEventListener('click', () => {
        clearInterval(emojiCycleInterval);
        if (loadingEmoji) loadingEmoji.style.display = 'none';
        clickToStartOverlay.style.opacity = '0';
        setTimeout(() => {
            clickToStartOverlay.style.display = 'none';
        }, 500);

        try {
            soundManager.init();
            if (soundManager.context && soundManager.context.state === 'suspended') {
                soundManager.context.resume().catch(() => {});
            }
        } catch (err) {
            console.warn('AudioContext init failed:', err);
        }
        startScreen.style.display = 'flex';
        startPrompt.textContent = "Loading...";
        startPrompt.classList.add('loading');

        const markReady = () => {
            if (assetsReady) return;
            assetsReady = true;
            startPrompt.textContent = "▶ PLAY GAME";
            startPrompt.classList.remove('loading');
        };
        const safetyTimer = setTimeout(markReady, 1500);

        soundManager.loadAll(soundsToLoad).then(() => {
            clearTimeout(safetyTimer);
            markReady();
        }).catch(() => {
            clearTimeout(safetyTimer);
            markReady();
        });
    }, { once: true });
    
    initGame();
    if (startPrompt) {
        startPrompt.addEventListener('click', (e) => {
            e.stopPropagation();
            if (gameOver && assetsReady) startGame();
        });
    }
}

function startGame() {
    if (gameOver && assetsReady) {
        initGame(); 
        score = 0;
        lives = 1;
        gameOver = false;
        rowBonusLevel = 0;
        
        startScreen.style.display = 'none';
        scoreDisplay.style.display = 'block';
        statusIndicatorsContainer.style.display = 'flex';
        ball.style.display = 'block';
        if (pauseButton) {
            pauseButton.style.display = 'block';
            pauseButton.textContent = 'Pause [P]';
        }
        resetButton.style.display = 'block';
        
        ballIsStuck = true;
        soundManager.play('winSong');

        const songDuration = soundManager.sounds['winSong']?.duration || 2;
        autoLaunchTimeout = setTimeout(launchStuckBall, songDuration * 1000);
        
        gameArea.classList.add('hide-cursor');
        gameRunning = true; 
        requestAnimationFrame(gameLoop);
    }
}

function togglePause() {
  if (gameOver || ballIsStuck) return;
  gameRunning = !gameRunning;
  if (gameRunning) {
    if (pauseStartTime !== null) {
      const pausedDuration = Date.now() - pauseStartTime;
      for (const type in activePowerUps) {
        activePowerUps[type].forEach(timer => {
          timer.endTime += pausedDuration;
        });
      }
      pauseStartTime = null;
    }
    if (pauseButton) pauseButton.textContent = "Pause [P]";
    gameMessage.style.display = "none";
    gameArea.classList.add("hide-cursor");
    lastTime = 0;
    requestAnimationFrame(gameLoop);
  } else {
    pauseStartTime = Date.now();
    cancelAnimationFrame(animationFrameId);
    if (pauseButton) pauseButton.textContent = "Resume [P]";
    gameMessage.innerHTML = `<span class="name">PAUSED</span><p class="game-message-prompt">Press P / ESC or Click to Resume</p>`;
    gameMessage.style.display = "block";
    gameArea.classList.remove("hide-cursor");
  }
}
function resetAfterLifeLost(){ballIsStuck=!0,isRoofBonusActive=!1,ball.classList.remove("bonus-active"),activePowerUps={},statusIndicatorsContainer.innerHTML="",paddleSizeLevel=0,updatePaddleWidth(),paddle.classList.remove("paddle-sticky","paddle-armed"),isStickyPaddle=!1,isLaserActive=!1,ballX=paddleX-BALL_SIZE/2,ballY=GAME_HEIGHT-PADDLE_HEIGHT-PADDLE_BOTTOM_OFFSET-BALL_SIZE,ballSpeedX=0,ballSpeedY=0}

function gameLoop(timestamp) {
  // 1) If the game is paused or over, don’t do anything
  if (!gameRunning) return;

  // 2) Compute time delta (in seconds)
  if (!lastTime) lastTime = timestamp;
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  // 3) Update all the moving parts
  updatePaddlePosition(delta);
  updateBallPosition(delta);
  updatePowerUps(delta);
  updateLasers(delta);
  updateStatusIndicators();

  // 4) Handle collisions
  checkCollisions();

  // 5) If the ball is stuck to the paddle (mag-lock or start), lock it to paddleX before rendering
  if (ballIsStuck) {
    ballX = paddleX - BALL_SIZE / 2;
    ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE;
  }

  // 6) Draw everything to the screen
  renderGame();

  // 7) Slow-Mo “onion skin” effect (lighter trail)
  const slowMoLevel = activePowerUps["slow-mo"]?.length || 0;
  if (slowMoLevel > 0) {
    frameCounter++;
    const frequency = 8 + 4 * (slowMoLevel - 1);
    if (frameCounter % frequency === 0) {
      createOnionSkin();
    }
  }

  // 8) Check win / loss conditions
  //    a) Win if all bricks are broken
  if (bricks.every(b => b.isBroken)) {
    endGame(true);
    return;
  }

  //    b) Loss if the ball falls below the bottom (and isn’t stuck)
  if (ballY + BALL_SIZE > GAME_HEIGHT && !ballIsStuck) {
    endGame(false);
    return;
  }

  // 9) Request the next frame
  animationFrameId = requestAnimationFrame(gameLoop);
}


function updatePaddlePosition(dt) {
  const halfPaddle = paddleWidth / 2;
  if (leftPressed) {
    paddleX = Math.max(halfPaddle, paddleX - PADDLE_SPEED * dt);
  }
  if (rightPressed) {
    paddleX = Math.min(GAME_WIDTH - halfPaddle, paddleX + PADDLE_SPEED * dt);
  }
}
function updateBallPosition(e){if(ballIsStuck)return;const t=activePowerUps["slow-mo"]?.length||0,o=Math.pow(.75,t);ballX+=ballSpeedX*o*e,ballY+=ballSpeedY*o*e}
function isColliding(e,t){return!(e.bottom<t.top||e.top>t.bottom||e.right<t.left||e.left>t.right)}


function updatePaddleWidth() {
  // Calculate how big the paddle _should_ be logically
  const scaleFactor = 1 + paddleSizeLevel * 0.35;
  paddleWidth = PADDLE_DEFAULT_WIDTH * scaleFactor;

  // Clamp paddleX immediately so growing near a wall never pushes the paddle past the edge
  if (typeof paddleX === 'number') {
    const halfPaddle = paddleWidth / 2;
    paddleX = Math.max(halfPaddle, Math.min(GAME_WIDTH - halfPaddle, paddleX));
  }

  // Instead only drive the CSS scale
  paddle.style.transform = `scaleX(${scaleFactor})`;

  // Glow classes as before…
  ['paddle-glow-1','paddle-glow-2','paddle-glow-3'].forEach(c => {
    paddle.classList.remove(c);
  });
  if (paddleSizeLevel >= 1 && paddleSizeLevel <= 3) {
    paddle.classList.add(`paddle-glow-${paddleSizeLevel}`);
  }
}



function spawnPowerUp(type, brick) {
  // play the spawn sound
  soundManager.play("powerUpSpawn", { pitch: 2 });

  const def = POWER_UP_TYPES[type];
  if (!def) return;

  // 1) Create the DOM element
  const el = document.createElement("div");
  el.classList.add("power-up", def.cssClass);
  el.textContent = def.emoji;

  // 2) If this is Expando (wide-paddle), tag it with the current grow level
  if (type === "wide-paddle") {
    // how many stacks are active? (1–3)
    const stackLevel = Math.min(
      activePowerUps["wide-paddle"]?.length || 1,
      MAX_PADDLE_LEVEL
    );
    el.classList.add(`grow-level-${stackLevel}`);
  }

  // 3) Compute the initial spawn position (centered on the brick)
  const puX = brick.x + brick.width  / 2 - POWER_UP_SIZE / 2;
  const puY = brick.y + brick.height / 2 - POWER_UP_SIZE / 2;

  // ensure absolute positioning
  el.style.position = "absolute";
  el.style.left     = `${puX}px`;
  el.style.top      = `${puY}px`;
  gameArea.appendChild(el);

  // 4) Push into your powerUps array with all needed physics props
  powerUps.push({
    element:       el,
    type:          type,
    x:             puX,
    y:             puY,
    bounced:       false,
    vx:            0,
    vy:            0,
    originX:       puX,
    swayAmplitude: 25 + 20 * Math.random(),
    swayFrequency: 0.02 + 0.02 * Math.random(),
    swayPhase:     2 * Math.random() * Math.PI
  });
}



function updatePowerUps(dt) {
  // 0) Precompute the on-screen paddle rect once per frame
  const paddleBox = paddle.getBoundingClientRect();
  const areaBox   = gameArea.getBoundingClientRect();
  const padRect   = {
    left:   paddleBox.left   - areaBox.left,
    right:  paddleBox.right  - areaBox.left,
    top:    paddleBox.top    - areaBox.top,
    bottom: paddleBox.bottom - areaBox.top
  };

  // 1) Iterate backwards so we can splice safely
  for (let i = powerUps.length - 1; i >= 0; i--) {
    const pu = powerUps[i];

    // 2) Physics: either initial drop or after first bounce
    if (pu.bounced) {
      pu.vy += GRAVITY * 60 * dt;
      pu.x  += pu.vx * 60 * dt;
      pu.y  += pu.vy * 60 * dt;
    } else {
      pu.y  += POWER_UP_SPEED * dt;
      pu.x   = pu.originX
             + pu.swayAmplitude * Math.sin(pu.y * pu.swayFrequency + pu.swayPhase);
    }

    // 3) Build the power-up’s AABB
    const puRect = {
      left:   pu.x,
      right:  pu.x + POWER_UP_SIZE,
      top:    pu.y,
      bottom: pu.y + POWER_UP_SIZE
    };

    // 4) **Always** check for overlap, not just before first bounce
    if (isColliding(puRect, padRect)) {
      const stack = activePowerUps[pu.type] || [];
      const def   = POWER_UP_TYPES[pu.type];

      // If stacking is full, bounce it out again
      if (def.type === 'stacking' && stack.length >= MAX_PADDLE_LEVEL) {
        pu.bounced = true;
        pu.vy      = -105;
        pu.vx      = 105 * (Math.random() - 0.5);
        showNotification("max-power", { x: paddleX });
      } else {
        // Otherwise, collect it
        activatePowerUp(pu.type);
        pu.element.remove();
        powerUps.splice(i, 1);
      }
      continue;
    }

    // 5) Remove if it falls past the bottom
    if (pu.y > GAME_HEIGHT) {
      pu.element.remove();
      powerUps.splice(i, 1);
      continue;
    }

    // 6) Otherwise, update its on-screen position
    pu.element.style.left = `${pu.x}px`;
    pu.element.style.top  = `${pu.y}px`;
  }
}



function activatePowerUp(type) {
  const def = POWER_UP_TYPES[type];
  if (!def) return;

  // — Instant power-ups (only 'one-up') —
  if (def.type === 'instant') {
    // spawn new bricks
    if (type === 'one-up') {
      spawnDisruptiveBricks(5);
    }
    // 🔑 use the string key, not the object
    showNotification(type, { x: paddleX });
    return;
  }

  // — Stacking / Refreshing power-ups —
  if (!activePowerUps[type]) {
    activePowerUps[type] = [];
  }
  const now = Date.now();
  if (def.type === 'refreshing') {
    // single timer, always slot 0
    activePowerUps[type][0] = { endTime: now + def.duration };
  } else {
    // stacking: chain onto the last timer end
    const lastEnd = activePowerUps[type].slice(-1)[0]?.endTime || now;
    activePowerUps[type].push({ endTime: lastEnd + def.duration });
  }

  // — Apply the effect immediately —
  switch (type) {
    case 'wide-paddle': {
      // grow the paddle
      paddleSizeLevel = Math.min(activePowerUps[type].length, MAX_PADDLE_LEVEL);
      updatePaddleWidth();
      soundManager.play('grow');

      // 🔑 fire the tiered Expando notification
      //    wide-paddle-1, -2, or -3
      const stackLevel = paddleSizeLevel; // 1..3
      showNotification(`wide-paddle-${stackLevel}`, { x: paddleX });
      break;
    }

    case 'slow-mo':
      soundManager.play('bounce', { pitch: 0.8, volume: 0.7 });
      // 🔑 show Slow-Mo banner
      // Stack count for slow-mo
      const lvl = activePowerUps['slow-mo']?.length || 0;
      // Clamp between 1 and 3
      const level = Math.min(Math.max(lvl, 1), 3);
      showNotification(`slow-mo-${level}`, { x: paddleX });
      break;

    case 'sticky-paddle':
      isStickyPaddle = true;
      paddle.classList.add('paddle-sticky');
      soundManager.play('magActivate');
      // 🔑 show Mag-Lock banner
      showNotification(type, { x: paddleX });
      break;

    case 'laser-blast':
      isLaserActive = true;
      paddle.classList.add('paddle-armed');
      soundManager.play('laserFire', { pitch: 1.2 });
      // 🔑 show Laser Blast banner
      showNotification(type, { x: paddleX });
      break;
  }

  // Update the little timer bar below the UI
  createOrUpdateStatusIndicator(type);
}


function updateStatusIndicators() {
  // Iterate over each active power-up type
  for (const type in activePowerUps) {
    const timers = activePowerUps[type];

    // If there are no timers left, remove the indicator and delete the entry
    if (!timers || timers.length === 0) {
      delete activePowerUps[type];
      const stale = document.getElementById(`status-${type}`);
      if (stale) stale.remove();
      continue;
    }

    // Remove any expired timers, play sounds on expire
    let expired = false;
    while (timers.length > 0 && Date.now() >= timers[0].endTime) {
      timers.shift();
      expired = true;
    }
    if (expired) {
      if (soundManager.sounds.grow_reversed) {
        soundManager.play("grow_reversed", { pitch: 1.2, volume: 0.5 });
      } else {
        soundManager.play("multihit", { pitch: 0.7, volume: 0.5 });
      }
      // Run any type-specific cleanup on expiry
      const cleanup = {
        "wide-paddle": () => {
          paddleSizeLevel = timers.length;
          updatePaddleWidth();
        },
        "sticky-paddle": () => {
          isStickyPaddle = false;
          paddle.classList.remove("paddle-sticky");
          if (ballIsStuck) launchStuckBall();
        },
        "laser-blast": () => {
          isLaserActive = false;
          paddle.classList.remove("paddle-armed");
        }
      };
      if (cleanup[type]) cleanup[type]();
    }

    // If after cleanup there are zero timers, remove indicator and entry
    if (timers.length === 0) {
      const gone = document.getElementById(`status-${type}`);
      if (gone) gone.remove();
      delete activePowerUps[type];
      continue;
    }

    // Otherwise update the existing status indicator
    const indicator = document.getElementById(`status-${type}`);
    if (indicator) {
      // Update stack count badge
      const stackEl = indicator.querySelector(".stack-count");
      if (timers.length > 1) {
        stackEl.textContent = `x${timers.length}`;
        stackEl.style.display = "inline-block";
      } else {
        stackEl.style.display = "none";
      }

      // Update timer‐bar width
      const now      = Date.now();
      const first    = timers[0];
      const def      = POWER_UP_TYPES[type];
      const duration = def.duration;
      const elapsed  = now - (first.endTime - duration);
      const pct      = Math.max(0, (duration - elapsed) / duration * 100);
      const bar      = indicator.querySelector(".timer-bar");
      bar.style.width = `${pct}%`;
    }
  }

  // --- NEW: update the score multiplier badge for Expando ---
  const badge = document.getElementById("score-multiplier");
  const expandoStacks = activePowerUps["wide-paddle"]?.length || 0;
  if (expandoStacks > 0) {
    // Multiplier is stacks + 1 (×2, ×3, ×4)
    const mult = expandoStacks + 1;
    badge.textContent = `×${mult}`;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}


function createOrUpdateStatusIndicator(e){if(document.getElementById(`status-${e}`))return;const t=POWER_UP_TYPES[e],o=document.createElement("div");o.id=`status-${e}`,o.className="status-indicator",o.innerHTML=`<span class="emoji">${t.emoji}</span><span class="stack-count"></span><div class="timer-bar-container"><div class="timer-bar ${t.cssClass}"></div></div>`,statusIndicatorsContainer.appendChild(o)}

function createOnionSkin() {
  const skin = document.createElement("div");
  skin.className = "onion-skin";

  // If we’re in cat mode, lock it to the cat emoji
  if (isCatMode) {
    skin.textContent = BALL_EMOJI;  // '🐱'
  } else {
    skin.textContent = ball.textContent;
  }

  skin.style.left = `${ballX}px`;
  skin.style.top  = `${ballY}px`;
  gameArea.appendChild(skin);

  setTimeout(() => skin.remove(), 500);
}


function updateLasers(dt) {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const l = lasers[i];

    // 1) Move the laser bolt upward
    l.y -= LASER_SPEED * dt;
    l.element.style.top = `${l.y}px`;

    // 2) Remove if off‐screen
    if (l.y + l.height < 0) {
      l.element.remove();
      lasers.splice(i, 1);
      continue;
    }

    // 3) **Collision check against every brick**
    //    This is where you need the `if (isColliding(laserRect, brickRect))` block.
    const laserRect = {
      left:   l.x,
      right:  l.x + l.width,
      top:    l.y,
      bottom: l.y + l.height
    };

    for (let j = 0; j < bricks.length; j++) {
      const b = bricks[j];
      if (b.isBroken) continue;

      const brickRect = {
        left:   b.x,
        right:  b.x + b.width,
        top:    b.y,
        bottom: b.y + b.height
      };

      if (isColliding(laserRect, brickRect)) {
        // 1) Play destroy sound
        const soundName = destroySounds[destroySoundIndex];
        soundManager.play(soundName);
        destroySoundIndex = (destroySoundIndex + 1) % destroySounds.length;

        // 2) Compute points with active multipliers
        const basePoints = isRoofBonusActive ? 15 : 10;
        const laserBonus = 3;
        const expandoStacks = (activePowerUps['wide-paddle'] || []).length;
        let points = basePoints + laserBonus;
        if (expandoStacks > 0) {
          points *= (expandoStacks + 1);
        }
        points *= (rowBonusLevel + 1);
        if (isCatMode) {
          points = points - (points % 10) + 9;
        }

        // 3) Add to total and round the total as well
        score += points;
        if (isCatMode) {
          score = score - (score % 10) + 9;
        }
        scoreDisplay.textContent = `Score: ${score}`;

        // 4) Show the floating +N
        const popupX = b.x + b.width / 2;
        const popupY = b.y;
        showBrickScore(popupX, popupY, points);

        // 5) Break the brick, evaluate row clear, spawn any power-up, remove the bolt
        b.isBroken = true;
        b.element.classList.add('broken');
        if (typeof b.row === "number" && !b.isExtraSpawn) {
          evaluateRowClear(b.row);
        }
        if (b.powerUpType) spawnPowerUp(b.powerUpType, b);
        if (score > 500 && !isNeonLegend) {
          isNeonLegend = true;
          showNotification("neon-legend");
          soundManager.play("winSong");
        }
        l.element.remove();
        lasers.splice(i,1);

        break;
      }



    }
  }
}


// Track whether the last physics step included a wall or roof bounce
let justBounced = false;

function checkCollisions() {
  // Don’t run collision logic if the ball is stuck
  if (ballIsStuck) return;

  // Build the ball’s AABB for collision tests
  const ballRect = {
    left:   ballX,
    right:  ballX + BALL_SIZE,
    top:    ballY,
    bottom: ballY + BALL_SIZE
  };

  // --- Wall / Roof Bounces ---
  // Left or right wall
  if ((ballX <= 0 && ballSpeedX < 0) ||
      (ballX + BALL_SIZE >= GAME_WIDTH && ballSpeedX > 0)) {
    ballSpeedX *= -1;
    soundManager.play("bounce");
    justBounced = true;
  }

  // Ceiling
  if (ballY <= 0 && ballSpeedY < 0) {
    ballY = 0;
    ballSpeedY *= -1;
    soundManager.play("bounce", { pitch: 0.8 });
    justBounced = true;

    // Apply roof bonus if not already active
    if (!isRoofBonusActive) {
      isRoofBonusActive = true;
      ball.classList.add("bonus-active");
      soundManager.play("powerUpSpawn", { pitch: 2.5, volume: 0.5 });
    }
  }

 // — Use the DOM to get pixel-perfect paddle bounds —  
// — Paddle Collision (pixel-perfect with CSS scale) —
const paddleBox = paddle.getBoundingClientRect();
const areaBox   = gameArea.getBoundingClientRect();

// convert to game-space
const padRect = {
  left:   paddleBox.left   - areaBox.left,
  right:  paddleBox.right  - areaBox.left,
  top:    paddleBox.top    - areaBox.top,
  bottom: paddleBox.bottom - areaBox.top
};

// only proceed if the ball is coming down
if (isColliding(ballRect, padRect) && ballSpeedY > 0) {
  soundManager.play("bounce");

  // clear any roof bonus
  if (isRoofBonusActive) {
    isRoofBonusActive = false;
    ball.classList.remove("bonus-active");
  }

  if (isStickyPaddle) {
    // stick the ball
    ballIsStuck = true;
    ballSpeedX  = 0;
    ballSpeedY  = 0;
  } else {
    // bounce off the paddle
    // 1) reposition the ball just above the paddle
    ballY = padRect.top - BALL_SIZE;
    // 2) invert Y velocity
    ballSpeedY *= -1;

    // 3) compute X-velocity based on hit position
    const padWidth    = padRect.right - padRect.left;
    const halfPaddle  = padWidth / 2;
    const paddleCenter= padRect.left + halfPaddle;
    const impactPos   = (ballX + BALL_SIZE / 2 - paddleCenter) / halfPaddle;
    ballSpeedX        = impactPos * INITIAL_BALL_SPEED * 1.5;
  }

  // finally, clear your bank-shot flag
  justBounced = false;
}

  // --- Brick Collisions ---
  for (let i = 0; i < bricks.length; i++) {
    const brick = bricks[i];
    if (brick.isBroken) continue;

    const brickRect = {
      left:   brick.x,
      right:  brick.x + brick.width,
      top:    brick.y,
      bottom: brick.y + brick.height
    };

    if (isColliding(ballRect, brickRect)) {
      // Base points
      let points = isRoofBonusActive ? 15 : 10;

      // Wall-bounce bonus
      if (justBounced) {
        points += 2;
      }
      
      // — NEW: Bricked Up! spawn bonus (+6 once) —
      if (brick.isExtraSpawn) {
        points += 6;
        brick.isExtraSpawn = false;
      }
      function checkRowClear(row) {
        if (clearedRows.has(row)) return;
        // find non‐extra bricks in this row
        const rowBricks = bricks.filter(b => b.row === row && !b.isExtraSpawn);
        if (rowBricks.every(b => b.isBroken)) {
          // mark it
          clearedRows.add(row);
          rowBonusCount = clearedRows.size;
          awardRowClearBonus(row);
        }
      }

      function awardRowClearBonus(row) {
        // 1) Flash the row visually
        flashRow(row);
        // 2) Show HUD badge
        showNotification({
          emoji:       "⚡️",
          title:       "Edge Runner",
          name:        `Row ×${rowBonusCount}`,
          description: `Score ×${rowBonusCount+1} now active!`
        });
        createOrUpdateRowBonusIndicator();
      }

      // 4. Expando multiplier (🪴 Multiply your score!)
      //    1 stack → 2×, 2 stacks → 3×, 3 stacks → 4×
      const expandoStacks = (activePowerUps['wide-paddle'] || []).length;
      if (expandoStacks > 0) {
        points *= (expandoStacks + 1);
      }

      // Multi-hit logic
      brick.hitsTaken++;

      // only when the brick actually dies…
      if (brick.hitsTaken >= brick.hitsRequired) {
        const usedRoofBonus = isRoofBonusActive;
        // Consume roof bonus only when a brick is actually broken
        if (isRoofBonusActive) {
          isRoofBonusActive = false;
          ball.classList.remove("bonus-active");
          soundManager.play("powerUpSpawn", { pitch: 3, volume: 0.7 });
        }

        // 1) Play the destroy sound
        const soundName = destroySounds[destroySoundIndex];
        soundManager.play(soundName);
        destroySoundIndex = (destroySoundIndex + 1) % destroySounds.length;

        // 2) Mark the brick as broken
        brick.isBroken = true;
        brick.element.classList.add("broken");

        // 3) Apply row-clear and 2-hit brick multipliers before adding to score
        points *= (rowBonusLevel + 1);
        if (brick.hitsRequired > 1) {
          points = Math.round(points * 1.6);
        }

        let rawPoints = points;

        // Cat Mode: round popup → …9
        if (isCatMode) {
          points = rawPoints - (rawPoints % 10) + 9;
        }

        // Grab the score before adding
        let preScore = score;

        // Add & then round total → …9
        score += points;
        if (isCatMode) {
          score = score - (score % 10) + 9;
        }

        const devBreakdown = {
          basePoints:            usedRoofBonus ? 15 : 10,
          finalPoints:           points,
          wallBounceBonus:       justBounced ? 2 : 0,
          brickedUpBonus:        brick.isExtraSpawn ? 6 : 0,
          expandoStacks:         activePowerUps["wide-paddle"]?.length || 0,
          expandoMultiplier:     (activePowerUps["wide-paddle"]?.length || 0) + 1,
          rowClearLevel:         rowBonusLevel,
          twoHitRequired:        brick.hitsRequired,
          twoHitMultiplier:      brick.hitsRequired > 1 ? 1.6 : 1
          
        };
        console.log("🔍 Brick break details:", devBreakdown);


        // **DEBUG LOG**  
        console.log("🐱 [Brick] CatMode Debug:", {
          rawPoints,
          pointsRounded: points,
          scoreBefore: preScore,
          scoreAfter:  score,
          endsIn9:      (score % 10) === 9
        });

        // 5) Float the +N popup at the brick’s position
        showBrickScore(
          brick.x + brick.width / 2,
          brick.y,
          points
        );

        // 6) Trigger the row-clear check (if applicable)
        if (typeof brick.row === "number" && !brick.isExtraSpawn) {
          evaluateRowClear(brick.row);
        }

        // 7) Spawn a power-up from this brick if it had one
        if (brick.powerUpType) {
          spawnPowerUp(brick.powerUpType, brick);
        }

      } else {
        // First-hit only: play “multihit” sound and show damage, but NO popup
        soundManager.play("multihit", { pitch: 1 });
        setTimeout(() => {
          soundManager.play("multihit", { pitch: 1.5, volume: 0.7 });
        }, 50);
        brick.element.classList.add("damaged");
      }

      // 8) Finally, update the score display
      scoreDisplay.textContent = `Score: ${score}`;

    


      // Neon Legend check
      if (score > 500 && !isNeonLegend) {
        isNeonLegend = true;
        showNotification("neon-legend");
        soundManager.play("winSong");
      }

      // Brick shake & ball impact animation
      brick.element.classList.remove("shake");
      void brick.element.offsetWidth;
      brick.element.classList.add("shake");

      ball.classList.remove("impact-animation");
      void ball.offsetWidth;
      ball.classList.add("impact-animation");

      clearTimeout(emojiSwapTimeout);
      
      console.log('💡 emoji swap:', { isCatMode, isNeonLegend });
      
      if (isCatMode) {
        // never change it off the cat face
        BALL_EMOJI = '🐱'; 
        ball.textContent = BALL_EMOJI;

      } else if (isNeonLegend) {
        ball.textContent = "😎";

      } else {
        // your normal chaotic swap
        const idx = Math.floor(Math.random() * CHAOTIC_EMOJIS.length);
        ball.textContent = CHAOTIC_EMOJIS[idx];
        emojiSwapTimeout = setTimeout(() => {
          ball.textContent = BALL_EMOJI;
        }, 250);
      }


      // Bounce along the shallowest collision axis (side vs top/bottom) and accelerate
      const overlapLeft   = ballRect.right   - brickRect.left;
      const overlapRight  = brickRect.right  - ballRect.left;
      const overlapTop    = ballRect.bottom  - brickRect.top;
      const overlapBottom = brickRect.bottom - ballRect.top;
      const minOverlapX   = Math.min(overlapLeft, overlapRight);
      const minOverlapY   = Math.min(overlapTop, overlapBottom);

      if (minOverlapX < minOverlapY) {
        ballSpeedX *= -1;
        ballX += overlapLeft < overlapRight ? -overlapLeft : overlapRight;
      } else {
        ballSpeedY *= -1;
        ballY += overlapTop < overlapBottom ? -overlapTop : overlapBottom;
      }
      ballSpeedX *= 1.005;
      ballSpeedY *= 1.005;

      // Reset wall-bounce flag after scoring
      justBounced = false;

      // Only handle one brick per frame
      break;
    }
  }
}


function renderGame() {
  // Position the ball
  ball.style.left = `${ballX}px`;
  ball.style.top  = `${ballY}px`;

  // Keep the 150px base element centered on paddleX; scaleX(scaleFactor) expands symmetrically from center
  const left = paddleX - PADDLE_DEFAULT_WIDTH / 2;
  paddle.style.left = `${left}px`;

  const scaleFactor = paddleWidth / PADDLE_DEFAULT_WIDTH;
  paddle.style.transform = `scaleX(${scaleFactor})`;
}



function endGame(won) {
  gameOver = true;
  gameRunning = false;
  pendingEndGameWon = !!won;
  awaitingInitials = false;
  cancelAnimationFrame(animationFrameId);
  soundManager.stopAll();
  notificationsContainer.innerHTML = "";
  if (pauseButton) pauseButton.style.display = "none";
  if (won) {
    soundManager.play("winSong");
    confettiBlast();
  } else {
    soundManager.play("loseSong");
  }

  const prevHigh = getHighScore();
  const isNewHigh = score > prevHigh && score > 0;

  const runnerCallsign = getLastInitials();
  const qualifies = score > 0 && qualifiesForLeaderboard(score);
  const savedEntry = qualifies ? addLeaderboardEntry(runnerCallsign, score, won) : null;
  if (isNewHigh) saveHighScore(score);
  const rating = getRating(score, won);
  const titleText = won ? "Mission Complete!" : "System Failure!";

  const savedBannerHTML = savedEntry
    ? `<div class="record-saved-banner">${isNewHigh ? `★ NEW #1 RECORD SAVED FOR ${savedEntry.initials}!` : `★ TOP 5 RECORD SAVED FOR ${savedEntry.initials}!`}</div>`
    : "";

  gameMessage.innerHTML = `
    <span class="title">${titleText}</span>
    <span class="name rating">${rating}</span>
    <span class="description">Runner: ${runnerCallsign} &bull; Final Score: ${score}</span>
    ${savedBannerHTML}
    <div id="end-leaderboard" class="leaderboard-panel">
      ${renderLeaderboardHTML(savedEntry ? savedEntry.id : lastSavedEntryId)}
    </div>
    <p class="game-message-prompt">Press SPACE to Play Again &bull; <span id="change-callsign-btn" class="change-callsign-link">[C] Callsign</span></p>
  `;
  gameMessage.style.display = "block";
  gameArea.classList.remove("hide-cursor");

  const changeBtn = document.getElementById("change-callsign-btn");
  if (changeBtn) {
    changeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      initGame();
    });
  }
}
function launchStuckBall(){if(ballIsStuck){clearTimeout(autoLaunchTimeout),soundManager.stop("winSong"),ballIsStuck=!1,ballSpeedY=-INITIAL_BALL_SPEED;const e=paddleWidth/2,t=(ballX+BALL_SIZE/2-paddleX)/e*INITIAL_BALL_SPEED*1.5;ballSpeedX=t,soundManager.play("magLaunch")}}
function fireLaser() {
  if (!canFire || !isLaserActive) return;
  canFire = false;
  soundManager.play("laserFire");
  const boltWidth = 6;
  const boltHeight = 22;
  const paddleTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
  const wingOffset = Math.max(18, paddleWidth * 0.38);
  const xPositions = [
    paddleX - wingOffset - boltWidth / 2,
    paddleX + wingOffset - boltWidth / 2
  ];
  xPositions.forEach(bx => {
    const clampedX = Math.max(4, Math.min(GAME_WIDTH - boltWidth - 4, bx));
    const bolt = { x: clampedX, y: paddleTop - boltHeight, width: boltWidth, height: boltHeight };
    const el = document.createElement("div");
    el.className = "laser-bolt";
    el.style.left = `${bolt.x}px`;
    el.style.top = `${bolt.y}px`;
    gameArea.appendChild(el);
    bolt.element = el;
    lasers.push(bolt);
  });
  setTimeout(() => { canFire = true; }, FIRE_COOLDOWN);
}

function spawnDisruptiveBricks(count) {
  // 1) gather empty grid slots as before
  const occupied = new Set();
  bricks.forEach(b => {
    if (!b.isBroken && !b.element.classList.contains('extra')) {
      const gridLeft = (GAME_WIDTH - BRICK_COLS * (BRICK_WIDTH + BRICK_GAP) + BRICK_GAP) / 2;
      const col = Math.round((b.x - gridLeft) / (BRICK_WIDTH + BRICK_GAP));
      const row = Math.round((b.y - 50 * GAME_SCALE) / (BRICK_HEIGHT + BRICK_GAP));
      occupied.add(`${row},${col}`);
    }
  });

  // 2) collect all empty slots, shuffle, etc…
  const candidates = [];
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      if (occupied.has(`${row},${col}`)) continue;
      const y = 50 * GAME_SCALE + row * (BRICK_HEIGHT + BRICK_GAP);
      if (y + BRICK_HEIGHT > GAME_HEIGHT - 100) continue;
      candidates.push({ row, col });
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // 3) spawn them into gameArea
  const gridLeft = (GAME_WIDTH - BRICK_COLS * (BRICK_WIDTH + BRICK_GAP) + BRICK_GAP) / 2;
  const spawnCount = Math.min(count, candidates.length);
  for (let i = 0; i < spawnCount; i++) {
    const { row, col } = candidates[i];
    const x = gridLeft + col * (BRICK_WIDTH + BRICK_GAP);
    const y = 50 * GAME_SCALE + row * (BRICK_HEIGHT + BRICK_GAP);

    const el = document.createElement('div');
    el.classList.add('brick','extra',`brick-row-${row}`);
    el.style.position = 'absolute';
    el.style.left     = `${x}px`;
    el.style.top      = `${y}px`;
    gameArea.appendChild(el);

    bricks.push({
      element:      el,
      x, 
      y,
      width:        BRICK_WIDTH,
      height:       BRICK_HEIGHT,
      isBroken:     false,
      hitsRequired: 1,
      hitsTaken:    0,
      powerUpType:  null,

      // ← Tag it as an extra-spawned brick
      isExtraSpawn: true
    });
  }
}


function evaluateRowClear(row) {
  // bail if row is missing, not a finite number, or already cleared
  if (typeof row !== 'number' || !Number.isFinite(row) || clearedRows.has(row)) {
    return;
  }

  // gather only non-extra bricks in that row
  const inRow = bricks.filter(b => b.row === row && !b.isExtraSpawn);
  if (!inRow.length || !inRow.every(b => b.isBroken)) return;

  clearedRows.add(row);
  rowBonusCount = clearedRows.size;

  // bump level (1..3) for the first 3 cleared rows
  if (rowBonusCount <= 3) {
    rowBonusLevel = rowBonusCount;
    showNotification(`row-clear-${rowBonusLevel}`);
  }
}


if (pauseButton) {
  pauseButton.addEventListener("click", () => {
    if (!gameOver) togglePause();
  });
}
resetButton.addEventListener("click", initGame);
document.addEventListener("keydown", e => {
  const consoleModal = document.getElementById("cyber-console-modal");
  const guideModal = document.getElementById("arcade-guide-modal");
  const isConsoleOpen = consoleModal && consoleModal.style.display === "flex";
  const isGuideOpen = guideModal && guideModal.style.display === "flex";

  if (e.key === "`" || e.key === "~") {
    e.preventDefault();
    toggleCyberConsole();
    return;
  }

  if (isConsoleOpen) {
    if (e.key === "Escape") {
      e.preventDefault();
      toggleCyberConsole(false);
    }
    return;
  }

  if (isGuideOpen) {
    if (e.key === "Escape" || e.key.toLowerCase() === "g" || e.key === "?") {
      e.preventDefault();
      toggleArcadeGuide(false);
    }
    return;
  }

  const t = e.key.toLowerCase();

  // When on the Start Screen, allow typing A-Z or Backspace/Arrows into the Callsign Keypad
  if (isStartScreenOpen()) {
    if (" " === t || "enter" === t) {
      e.preventDefault();
      assetsReady && startGame();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      backspaceCallsign();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      activeCallsignSlot = (activeCallsignSlot + 2) % 3;
      renderCallsignBuilder();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      activeCallsignSlot = (activeCallsignSlot + 1) % 3;
      renderCallsignBuilder();
      return;
    }
    if (/^[a-z]$/.test(t) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setCallsignLetter(t);
      return;
    }
  }

  if (gameOver && gameMessage.style.display === "block" && "c" === t) {
    e.preventDefault();
    initGame();
    return;
  }

  if ("arrowleft" === t || "a" === t) {
    leftPressed = true;
  } else if ("arrowright" === t || "d" === t) {
    rightPressed = true;
  } else if (" " === t) {
    e.preventDefault();
    if (gameOver) {
      assetsReady && startGame();
    } else if (!gameRunning) {
      togglePause();
    } else {
      if (ballIsStuck) launchStuckBall();
      if (isLaserActive) fireLaser();
    }
  } else if ("f" === t) {
    isLaserActive && gameRunning && fireLaser();
  } else if ("p" === t || "escape" === t) {
    !gameOver && togglePause();
  }
});
document.addEventListener("keyup",e=>{const t=e.key.toLowerCase();"arrowleft"===t||"a"===t?leftPressed=!1:"arrowright"===t||"d"===t&&(rightPressed=!1)});
document.addEventListener("mousemove",e=>{if(gameRunning){const t=gameArea.getBoundingClientRect();let o=e.clientX-t.left,r=paddleWidth/2;o<r?o=r:o>GAME_WIDTH-r&&(o=GAME_WIDTH-r),paddleX=o}});

setupGame();
syncRemoteLeaderboard();

window.devSetScore = function(newScore) {
  if (typeof newScore !== 'number' || isNaN(newScore)) {
    console.warn('devSetScore: please pass a Number, e.g. devSetScore(5000)');
    return;
  }

  // 1) Override the internal score
  score = newScore;

  // 2) Refresh the on‐screen score text
  scoreDisplay.textContent = `Score: ${score}`;

  // 3) If you have a multiplier badge or high-score display, refresh those too:
  if (typeof updateMultiplierBadge === 'function') {
    updateMultiplierBadge();
  }
  if (typeof updateHighScoreDisplay === 'function') {
    updateHighScoreDisplay();
  }

  console.log(`🛠️  Dev: score force‐set to ${score}`);
};

// ─── 1) Poop Storm ───
// ─── Enhanced Poop Storm ───
function poopStorm() {
  const drops = [];
  const area   = document.getElementById('game-area');
  const POO_SIZE = 48;      // px
  const BOUNCE_DAMP = 0.7;  // how “bouncy” the poop is

  // 1) Spawn 30 drops with varied start‐heights and start‐velocities
  for (let i = 0; i < 30; i++) {
    const el = document.createElement('div');
    el.textContent = '💩';
    el.className   = 'poop-drop';
    el.style.position = 'absolute';
    el.style.width    = el.style.height = `${POO_SIZE}px`;

    // X anywhere across the width:
    const startX = Math.random() * (GAME_WIDTH - POO_SIZE);
    // Y a bit above the top — between -POO_SIZE and -POO_SIZE*3
    const startY = -POO_SIZE * (1 + Math.random() * 2);

    el.style.left          = `${startX}px`;
    el.style.top           = `${startY}px`;
    el.style.pointerEvents = 'none';
    area.appendChild(el);

    drops.push({
      el,
      x:  startX,
      y:  startY,
      // vary the initial downward speed (50 to 200 px/sec)
      vx: (Math.random() - 0.5) * 100,
      vy: 50 + Math.random() * 150
    });
  }

  // 2) Physics loop
  let lastT = null;
  function step(t) {
    if (!lastT) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;

    // get paddle bounds in game‐space (scale-aware)
    const padBox  = paddle.getBoundingClientRect();
    const areaBox = area.getBoundingClientRect();
    const areaScale = areaBox.width / GAME_WIDTH || 1;
    const padLeft = (padBox.left   - areaBox.left) / areaScale;
    const padTop  = (padBox.top    - areaBox.top)  / areaScale;
    const padRight= (padBox.right  - areaBox.left) / areaScale;

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];

      // apply gravity
      d.vy += GRAVITY * dt;

      // move
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // bounce off paddle?
      if (
        d.y + POO_SIZE >= padTop &&
        d.y < padTop &&
        d.x + POO_SIZE >= padLeft &&
        d.x <= padRight &&
        d.vy > 0
      ) {
        d.vy = -d.vy * BOUNCE_DAMP;
        d.y  = padTop - POO_SIZE;
        soundManager.play("bounce", { pitch: 0.55 + Math.random() * 0.25, volume: 0.35 });
      }

      // remove if below bottom
      if (d.y > GAME_HEIGHT + 50) {
        d.el.remove();
        drops.splice(i, 1);
      } else {
        d.el.style.left = `${d.x}px`;
        d.el.style.top  = `${d.y}px`;
      }
    }

    // continue until none left
    if (drops.length > 0) {
      requestAnimationFrame(step);
    }
  }

  // kick off
  requestAnimationFrame(step);
}

// expose to console if you haven’t already
window.poopStorm = poopStorm;


// expose to console
window.poopStorm = poopStorm;

// ─── 2) Confetti Blast ───
function confettiBlast() {
  const area = document.getElementById('game-area');
  const colors = ['#00FFFF', '#FF00FF', '#00FF00', '#FFD700', '#FF3366', '#FF8C00'];
  for (let i = 0; i < 100; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDuration = `${1.2 + Math.random() * 1.2}s`;
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    c.style.setProperty('--confetti-drift', `${(Math.random() - 0.5) * 160}px`);
    area.appendChild(c);
    setTimeout(() => c.remove(), 2600);
  }
  console.log('🎉 Confetti Blast!');
}
window.confettiBlast = confettiBlast;
window['🎉']         = confettiBlast;

// ─── 3) God Mode ───
function godMode() {
  // super high score
  if (typeof devSetScore === 'function') devSetScore(999999);
  // infinite slow-mo stacks
  activePowerUps['slow-mo'] = Array(10).fill({ endTime: Date.now() + 999999 });
  updateStatusIndicators();
  console.log('🎮 God Mode: score=999999 + infinite Slow-Mo!');
}
window.godMode   = godMode;
window['🎮']     = godMode;

// ─── 4) Cat Mode (Nine Lives!) ───
function catMode() {
  catModeArmed = true;
  isCatMode = true;
  BALL_EMOJI = '🐱';
  ball.textContent = '🐱';
  window.BALL_EMOJI = '🐱';
  soundManager.play("powerUpSpawn", { pitch: 1.8, volume: 0.6 });
  console.log('🐱 Cat Mode: Permanent 9s!');
}
window.catMode = catMode;
window['🐱']   = catMode;

// ─── 5) Max Overdrive (All Power-Ups Armed!) ───
function maxOverdrive() {
  activatePowerUp('wide-paddle');
  activatePowerUp('wide-paddle');
  activatePowerUp('wide-paddle');
  activatePowerUp('laser-blast');
  activatePowerUp('sticky-paddle');
  console.log('⚡ Max Overdrive: 3× Expando + Twin Lasers + Mag-Lock!');
}
window.maxOverdrive = maxOverdrive;

// ─── Pro‐tip HUD Ticker ───
const TIPS = [
  { badge: "⚡ COMBO",      text: "Bounce off the ceiling for ROOF BONUS (15 base pts on your next brick)!" },
  { badge: "🚀 MULTIPLIER", text: "Stack 🪴 EXPANDO up to 3× to widen your paddle & boost score to ×4!" },
  { badge: "🔥 EDGE RUNNER", text: "Clear a full horizontal brick row to unlock ×2 / ×3 / ×4 row bonuses!" },
  { badge: "🎯 TWIN LASER", text: "Grab 🎯 LASER BLAST & press SPACE (or F / Click) to fire twin cannons!" },
  { badge: "🧲 MAG-LOCK",   text: "Catch with 🧲 MAG-LOCK & launch near paddle edges for a sharp angle!" },
  { badge: "🧱 STRATEGY",   text: "Bank-shots off side walls add +2 base points to your next brick smash!" },
  { badge: "💻 HACK DECK",  text: "Click [~] HACK to breach Neon-Corp ICE for 🐱 Cat Mode & 💩 Poop Storm!" }
];

const tipBadgeEl = document.getElementById("tip-badge");
const tipText    = document.getElementById("tip-text");
const tipNextBtn = document.getElementById("tip-next-btn");
let   tipIndex   = 0;

function renderTip(idx) {
  const item = TIPS[idx] || TIPS[0];
  if (tipBadgeEl) tipBadgeEl.textContent = item.badge;
  if (tipText) tipText.textContent = item.text;
}

function advanceTip() {
  tipIndex = (tipIndex + 1) % TIPS.length;
  renderTip(tipIndex);
}

renderTip(tipIndex);

if (tipNextBtn) {
  tipNextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    advanceTip();
  });
}

setInterval(advanceTip, 8000);

document.addEventListener("keydown", (e) => {
  if (consoleModalEl && consoleModalEl.style.display === "flex") return;
  if (e.key === "Escape") {
    const guideModal = document.getElementById("arcade-guide-modal");
    if (guideModal && guideModal.style.display === "flex") {
      e.preventDefault();
      toggleArcadeGuide(false);
      return;
    }
  }
  if (e.key === "?") {
    e.preventDefault();
    toggleArcadeGuide();
    return;
  }
  if (isStartScreenOpen()) return;
  if (e.key.toLowerCase() === "t") {
    advanceTip();
  } else if (e.key.toLowerCase() === "g") {
    e.preventDefault();
    toggleArcadeGuide();
  }
});

// ─── Retro Arcade Advert & Mechanics Glossary Modal ───
const guideModalEl = document.getElementById("arcade-guide-modal");
const guideBtnEl   = document.getElementById("guide-button");
const tipGuideBtn  = document.getElementById("tip-guide-btn");
let pausedByGuide  = false;

function buildArcadeGuideHTML() {
  return `
    <div class="guide-window">
    <div class="advert-header">
      <div>
        <span class="advert-kicker">★ NEON-CORP COIN-OP DIVISION // OPERATOR'S MANUAL ★</span>
        <h2 class="advert-title">SMASH THE GRID. STACK THE JUICE.</h2>
        <p class="advert-subtitle">50 High-Voltage Cyber-Bricks. 5 Experimental Mods. Infinite Multiplier Mayhem.</p>
      </div>
      <button type="button" id="advert-close-btn" class="advert-close-btn">✕ CLOSE [ESC]</button>
    </div>

    <div class="advert-section-title">⚡ EXPERIMENTAL POWER-UP MODS (35% DROP RATE)</div>
    <div class="advert-grid">
      <div class="advert-card" style="--card-accent: #90ff5a;">
        <div class="advert-card-head">
          <span class="advert-card-name">🪴 EXPANDO</span>
          <span class="advert-card-tag">15s • STACKS UP TO 3×</span>
        </div>
        <p class="advert-card-body">Stretches your paddle by <strong>+35% per stack</strong> (Lime ➔ Gold ➔ Orange) AND overclocks your global Score Multiplier to <strong>×2, ×3, and ×4</strong>! Catching a 4th at Max Power bounces it back into the arena!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ff5555;">
        <div class="advert-card-head">
          <span class="advert-card-name">🎯 LASER BLAST</span>
          <span class="advert-card-tag">5s • TWIN CANNONS</span>
        </div>
        <p class="advert-card-body">Bolts twin plasma cannons to your paddle's outer wings! Mash <strong>SPACE</strong> (or <strong>F</strong> / Click) to fire twin bolts every 0.3s. Every laser hit awards <strong>+3 PTS × active multipliers</strong>!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ff00ff;">
        <div class="advert-card-head">
          <span class="advert-card-name">🧲 MAG-LOCK</span>
          <span class="advert-card-tag">4s • CATCH & AIM</span>
        </div>
        <p class="advert-card-body">Electromagnets lock the ball to your deck on impact! Reposition, aim near the paddle's outer edges for a razor-sharp <strong>1.5× vector angle</strong>, and press <strong>SPACE</strong> to launch!</p>
      </div>

      <div class="advert-card" style="--card-accent: #00ffff;">
        <div class="advert-card-head">
          <span class="advert-card-name">🐌 SLOW-MO</span>
          <span class="advert-card-tag">5s • STACKS UP TO 3×</span>
        </div>
        <p class="advert-card-body">Engages bullet-time! Cuts ball speed to <strong>75% / 56% / 42%</strong>, leaves phantom onion-skin trails, and drops all arcade audio into a deep slow-motion bass warp.</p>
      </div>

      <div class="advert-card" style="--card-accent: #ffa500;">
        <div class="advert-card-head">
          <span class="advert-card-name">🧱 BRICKED UP!</span>
          <span class="advert-card-tag">INSTANT • +5 BRICKS (+6 PTS)</span>
        </div>
        <p class="advert-card-body">Drops <strong>5 fresh neon bricks</strong> into empty grid slots—and each re-spawned brick carries a <strong>+6 base point bonus</strong> before multipliers!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ffd700;">
        <div class="advert-card-head">
          <span class="advert-card-name">🛡️ ARMORED BRICKS</span>
          <span class="advert-card-tag">×1.6 PAYOUT • 2 HITS</span>
        </div>
        <p class="advert-card-body">Standard bricks pay <strong>10 base PTS</strong>. Bricks with a <strong>black notched corner</strong> take 2 hits to shatter and multiply the final brick payout by <strong>×1.6</strong>!</p>
      </div>
    </div>

    <div class="advert-section-title">🔥 STUNT MULTIPLIERS & ARENA MILESTONES (THEY STACK TOGETHER!)</div>
    <div class="advert-grid">
      <div class="advert-card" style="--card-accent: #ffd700;">
        <div class="advert-card-head">
          <span class="advert-card-name">👑 ROOF BONUS</span>
          <span class="advert-card-tag">15 BASE PTS (×1.5)</span>
        </div>
        <p class="advert-card-body">Skim the ball off the top ceiling! Your ball ignites with a giant golden aura and boosts base brick value from <strong>10 ➔ 15 PTS</strong> until your next brick break.</p>
      </div>

      <div class="advert-card" style="--card-accent: #00ff00;">
        <div class="advert-card-head">
          <span class="advert-card-name">📐 WALL BANK-SHOT</span>
          <span class="advert-card-tag">+2 BASE PTS</span>
        </div>
        <p class="advert-card-body">Ricochet off the left or right perimeter wall immediately before smashing a brick to add <strong>+2 base points</strong> (which then get multiplied by Expando &amp; Edge Runner)!</p>
      </div>

      <div class="advert-card" style="--card-accent: #00ffff;">
        <div class="advert-card-head">
          <span class="advert-card-name">⚡ EDGE RUNNER</span>
          <span class="advert-card-tag">×2 / ×3 / ×4 ROW BONUS</span>
        </div>
        <p class="advert-card-body">Wipe out an entire horizontal row of original bricks to slam the arena jumbotron and <strong>permanently multiply all brick points by ×2, ×3, or ×4</strong> for the rest of the run!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ff00ff;">
        <div class="advert-card-head">
          <span class="advert-card-name">😎 NEON LEGEND</span>
          <span class="advert-card-tag">UNLOCKS AT 500 PTS</span>
        </div>
        <p class="advert-card-body">Pass <strong>500 points</strong> to trigger the Neon Legend anthem and permanently upgrade your ball to the unflappable <strong>😎 Cyber-Shades</strong> persona!</p>
      </div>
    </div>

    <div class="advert-section-title">🏆 THE 14 CYBER-RUNNER RANKS</div>
    <div class="advert-ranks-box">
      <div class="advert-rank-col">
        <h4>💀 SYSTEM FAILURE (BALL LOST)</h4>
        <ul class="advert-rank-list">
          <li><span>System Glitch</span><span class="advert-rank-score">0–199</span></li>
          <li><span>Code Ghost</span><span class="advert-rank-score">200–399</span></li>
          <li><span>Memory Leak</span><span class="advert-rank-score">400–699</span></li>
          <li><span>Burned Out</span><span class="advert-rank-score">700–999</span></li>
          <li><span>Data Janitor</span><span class="advert-rank-score">1,000–1,499</span></li>
          <li><span>Pixel Drifter</span><span class="advert-rank-score">1,500–1,999</span></li>
          <li><span>Grid Runner</span><span class="advert-rank-score">2,000–2,499</span></li>
          <li><span>Neon Operator</span><span class="advert-rank-score">2,500+</span></li>
        </ul>
      </div>
      <div class="advert-rank-col win-col">
        <h4>👑 MISSION COMPLETE (BOARD CLEARED)</h4>
        <ul class="advert-rank-list">
          <li><span>Neon Legend</span><span class="advert-rank-score">&lt; 3,500</span></li>
          <li><span>Circuit Surfer</span><span class="advert-rank-score">3,500–4,499</span></li>
          <li><span>Hologram Hacker</span><span class="advert-rank-score">4,500–5,999</span></li>
          <li><span>Beyond the Black Wall</span><span class="advert-rank-score">6,000–7,999</span></li>
          <li><span>Synth Overlord</span><span class="advert-rank-score">8,000–9,999</span></li>
          <li><span>You Are The Replaced</span><span class="advert-rank-score">10,000+</span></li>
        </ul>
      </div>
    </div>

    <div class="advert-secret-strip">
      <span>🕵️ <strong>CLASSIFIED DECK HACKS:</strong> Press <code>[~]</code> to open the Cyber-Deck Terminal &amp; breach:</span>
      <div>
        <code>catMode()</code>
        <code>poopStorm()</code>
        <code>confettiBlast()</code>
        <code>godMode()</code>
      </div>
    </div>
    </div>
  `;
}

function toggleArcadeGuide(forceState) {
  if (!guideModalEl) return;
  const isOpen = guideModalEl.style.display === "flex";
  const nextState = typeof forceState === "boolean" ? forceState : !isOpen;

  if (nextState) {
    if (typeof toggleCyberConsole === "function") toggleCyberConsole(false);
    if (!guideModalEl.innerHTML.trim()) {
      guideModalEl.innerHTML = buildArcadeGuideHTML();
      const closeBtn = document.getElementById("advert-close-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          toggleArcadeGuide(false);
        });
      }
    }
    if (!gameOver && gameRunning && !ballIsStuck) {
      togglePause();
      pausedByGuide = true;
    } else {
      pausedByGuide = false;
    }
    guideModalEl.style.display = "flex";
    soundManager.play("bounce", { pitch: 1.4, volume: 0.35 });
  } else {
    guideModalEl.style.display = "none";
    if (pausedByGuide && !gameOver && !gameRunning) {
      pausedByGuide = false;
      togglePause();
    }
  }
}

if (guideBtnEl) {
  guideBtnEl.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleArcadeGuide();
  });
}
if (tipGuideBtn) {
  tipGuideBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleArcadeGuide();
  });
}
if (guideModalEl) {
  guideModalEl.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (ev.target === guideModalEl) toggleArcadeGuide(false);
  });
}

// ─── Cyber-Deck Hacking Console & ICE Breaker Mini-Game ───
const consoleModalEl = document.getElementById("cyber-console-modal");
const consoleBtnEl   = document.getElementById("console-button");
const tipConsoleBtn  = document.getElementById("tip-console-btn");
let pausedByConsole  = false;

const HEX_POOL = ["1C", "55", "E9", "7A", "BD", "FF", "A4", "0F", "C2", "88", "3E", "D1"];
const DAEMONS = [
  {
    id: "cat",
    emoji: "🐱",
    name: "NINE-LIVES",
    cmd: "catMode()",
    aliases: ["cat", "catmode", "catmode()", "9", "meow", "🐱"],
    desc: "Swaps ball to 🐱 & forces every brick score to end in 9!",
    unlocked: false,
    run: () => {
      catMode();
      return "NINE-LIVES PROTOCOL ACTIVE // ALL SCORES ROUNDED TO ...9";
    }
  },
  {
    id: "poop",
    emoji: "💩",
    name: "BIO-STORM",
    cmd: "poopStorm()",
    aliases: ["poop", "poopstorm", "poopstorm()", "poo", "storm", "💩"],
    desc: "Unleashes 30 gravity-driven 💩 projectiles that bounce off your paddle!",
    unlocked: false,
    run: () => {
      poopStorm();
      return "BIO-HAZARD PAYLOAD DEPLOYED // 30 DROPS INBOUND";
    }
  },
  {
    id: "party",
    emoji: "🎉",
    name: "PRISM-BURST",
    cmd: "confettiBlast()",
    aliases: ["party", "confetti", "confettiblast", "confettiblast()", "🎉"],
    desc: "Detonates 100 glowing cyber-confetti shards across the cabinet!",
    unlocked: false,
    run: () => {
      confettiBlast();
      soundManager.play("winSong");
      return "PRISM CANNON FIRED // 100 SHARDS DEPLOYED";
    }
  },
  {
    id: "god",
    emoji: "🎮",
    name: "GOD-OVERCLOCK",
    cmd: "godMode()",
    aliases: ["god", "godmode", "godmode()", "overclock", "🎮"],
    desc: "Sets Score to 999,999 + injects 10× Slow-Mo bullet-time stacks!",
    unlocked: false,
    run: () => {
      godMode();
      return "OVERCLOCK ENGAGED // SCORE=999999 + 10× BULLET-TIME";
    }
  },
  {
    id: "juice",
    emoji: "⚡",
    name: "MAX-OVERDRIVE",
    cmd: "maxOverdrive()",
    aliases: ["juice", "overdrive", "maxoverdrive", "maxoverdrive()", "max", "⚡"],
    desc: "Arms 3× EXPANDO (×4 Multiplier) + Twin Lasers + Mag-Lock at once!",
    unlocked: false,
    run: () => {
      maxOverdrive();
      return "MAX OVERDRIVE ARMED // 3× EXPANDO + TWIN LASERS + MAG-LOCK";
    }
  }
];

let targetedDaemonId = "cat";
let breachSequence = ["E9", "7A", "FF"];
let breachGridBytes = [];
let breachStep = 0;
let consoleLogs = [
  { text: "BLACKWALL DECK-OS v2.4 // CONNECTED TO NEON-CORP MAINFRAME", type: "ok" },
  { text: "5 ENCRYPTED GAME MODES DETECTED BEHIND ICE FIREWALL.", type: "warn" },
  { text: "TIP: Click the 3 matching HEX BYTES in order — or type 'scan' / 'help' below!", type: "" }
];

function addConsoleLog(text, type = "") {
  consoleLogs.push({ text, type });
  if (consoleLogs.length > 18) consoleLogs.shift();
  const logBox = document.getElementById("console-log-box");
  if (logBox) {
    logBox.innerHTML = consoleLogs.map(l => `<div class="console-log-line ${l.type ? `log-${l.type}` : ""}">&gt; ${l.text}</div>`).join("");
    logBox.scrollTop = logBox.scrollHeight;
  }
}

function generateBreachPuzzle() {
  const shuffled = [...HEX_POOL].sort(() => Math.random() - 0.5);
  breachGridBytes = shuffled.slice(0, 12);
  const picks = [...breachGridBytes].sort(() => Math.random() - 0.5).slice(0, 3);
  breachSequence = picks;
  breachStep = 0;
}

function getNextLockedDaemon() {
  return DAEMONS.find(d => !d.unlocked) || null;
}

function renderCyberConsole() {
  if (!consoleModalEl) return;
  const targetDaemon = DAEMONS.find(d => d.id === targetedDaemonId) || getNextLockedDaemon() || DAEMONS[0];

  const seqHTML = breachSequence.map((byte, idx) => `
    <span class="breach-seq-byte ${idx < breachStep ? "matched" : ""}">${byte}</span>
  `).join(`<span>➔</span>`);

  const gridHTML = breachGridBytes.map((byte, idx) => `
    <div class="breach-hex-cell" data-byte="${byte}" data-idx="${idx}">${byte}</div>
  `).join("");

  const daemonsHTML = DAEMONS.map(d => {
    const isTargeted = !d.unlocked && d.id === targetDaemon.id;
    const cardClasses = ["daemon-card"];
    if (d.unlocked) cardClasses.push("unlocked");
    if (isTargeted) cardClasses.push("targeted");

    const cmdPill = d.unlocked
      ? `<span class="daemon-cmd-pill">${d.cmd}</span>`
      : `<span class="daemon-cmd-pill">🔒 ICE-ENCRYPTED</span>`;

    const btnLabel = d.unlocked ? "▶ EXECUTE" : (isTargeted ? "🎯 BREACHING..." : "🔒 TARGET ICE");

    return `
      <div class="${cardClasses.join(" ")}" data-daemon="${d.id}">
        <div class="daemon-info">
          <div class="daemon-title">${d.emoji} ${d.name} ${cmdPill}</div>
          <div class="daemon-desc">${d.desc}</div>
        </div>
        <button type="button" class="daemon-action-btn" data-daemon-btn="${d.id}">${btnLabel}</button>
      </div>
    `;
  }).join("");

  const logsHTML = consoleLogs.map(l => `<div class="console-log-line ${l.type ? `log-${l.type}` : ""}">&gt; ${l.text}</div>`).join("");

  consoleModalEl.innerHTML = `
    <div class="console-window">
      <div class="console-topbar">
        <div class="console-title-wrap">
          <span class="console-kicker">★ NEON-CORP MAINFRAME BREACH // CYBER-DECK TERMINAL ★</span>
          <h2 class="console-title">💻 BLACKWALL HACK CONSOLE</h2>
        </div>
        <button type="button" id="console-close-btn" class="advert-close-btn">✕ EXIT [ESC]</button>
      </div>

      <div class="console-body-grid">
        <div class="console-breach-panel">
          <div>
            <div class="console-panel-header">
              <span>⚡ ICE BREAKER</span>
              <span>TARGET: ${targetDaemon.emoji} ${targetDaemon.name}</span>
            </div>
            <div class="breach-target-bar">
              <span class="breach-target-label">MATCH SEQUENCE:</span>
              <div class="breach-target-seq">${seqHTML}</div>
            </div>
            <div class="breach-hex-grid">${gridHTML}</div>
          </div>
          <div id="console-log-box" class="console-log-box">${logsHTML}</div>
        </div>

        <div class="console-daemons-panel">
          <div class="console-panel-header">
            <span>🔓 DAEMONS (${DAEMONS.filter(d => d.unlocked).length}/${DAEMONS.length} UNLOCKED)</span>
            <span>BREACH OR TYPE CMD</span>
          </div>
          <div class="daemon-list">${daemonsHTML}</div>
        </div>
      </div>

      <form id="console-cli-form" class="console-cli-bar">
        <span class="console-prompt-prefix">root@neon-deck:~#</span>
        <input id="console-cli-input" class="console-cli-input" type="text" placeholder="Type 'scan', 'catMode()', 'poopStorm()', 'godMode()', 'score 5000'..." autocomplete="off" spellcheck="false" />
        <button type="submit" class="console-cli-run">RUN ↵</button>
      </form>
    </div>
  `;

  const logBox = document.getElementById("console-log-box");
  if (logBox) logBox.scrollTop = logBox.scrollHeight;

  const closeBtn = document.getElementById("console-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleCyberConsole(false);
    });
  }

  consoleModalEl.querySelectorAll(".breach-hex-cell").forEach(cell => {
    cell.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const clickedByte = cell.dataset.byte;
      const expectedByte = breachSequence[breachStep];
      if (clickedByte === expectedByte) {
        breachStep++;
        cell.classList.add("cell-hit");
        soundManager.play("bounce", { pitch: 1.2 + breachStep * 0.28, volume: 0.45 });

        if (breachStep >= breachSequence.length) {
          // Sequence cracked!
          const toUnlock = DAEMONS.find(d => d.id === targetedDaemonId && !d.unlocked) || getNextLockedDaemon();
          soundManager.play("powerUpSpawn", { pitch: 1.9, volume: 0.65 });
          if (toUnlock) {
            toUnlock.unlocked = true;
            addConsoleLog(`ICE BREACHED! Unlocked [${toUnlock.emoji} ${toUnlock.name}] -> Click EXECUTE or type ${toUnlock.cmd}`, "ok");
            const nextLocked = getNextLockedDaemon();
            if (nextLocked) targetedDaemonId = nextLocked.id;
          } else {
            addConsoleLog(`ALL DAEMONS UNLOCKED! Firing bonus PRISM-BURST...`, "ok");
            confettiBlast();
          }
          generateBreachPuzzle();
          setTimeout(renderCyberConsole, 140);
        } else {
          renderCyberConsole();
        }
      } else {
        cell.classList.add("cell-err");
        soundManager.play("multihit", { pitch: 0.65, volume: 0.45 });
        addConsoleLog(`FIREWALL RESET // Expected [${expectedByte}], got [${clickedByte}]. Sequence scrambled!`, "err");
        generateBreachPuzzle();
        setTimeout(renderCyberConsole, 220);
      }
    });
  });

  consoleModalEl.querySelectorAll("[data-daemon-btn]").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.daemonBtn;
      const daemon = DAEMONS.find(d => d.id === id);
      if (!daemon) return;
      if (daemon.unlocked) {
        executeDaemon(daemon);
      } else {
        targetedDaemonId = daemon.id;
        generateBreachPuzzle();
        soundManager.play("bounce", { pitch: 1.35, volume: 0.35 });
        addConsoleLog(`TARGET LOCKED: [${daemon.emoji} ${daemon.name}] — Match the 3-byte hex signature to breach!`, "warn");
        renderCyberConsole();
      }
    });
  });

  const cliForm = document.getElementById("console-cli-form");
  const cliInput = document.getElementById("console-cli-input");
  if (cliForm && cliInput) {
    cliForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const raw = cliInput.value.trim();
      if (!raw) return;
      cliInput.value = "";
      handleConsoleCommand(raw);
    });
  }
}

function executeDaemon(daemon) {
  daemon.unlocked = true;
  const msg = daemon.run();
  addConsoleLog(`EXECUTING ${daemon.cmd} ➔ ${msg}`, "ok");
  renderCyberConsole();
  // Close modal smoothly after a brief beat so the player sees the effect in the arena!
  setTimeout(() => {
    toggleCyberConsole(false);
  }, 420);
}

function handleConsoleCommand(rawInput) {
  const clean = rawInput.trim().toLowerCase();
  addConsoleLog(`root@neon-deck:~# ${rawInput}`, "");

  if (clean === "help" || clean === "?") {
    addConsoleLog("COMMANDS: scan | breach | catMode() | poopStorm() | confettiBlast() | godMode() | maxOverdrive() | score <num> | clear", "warn");
    return;
  }
  if (clean === "clear" || clean === "cls") {
    consoleLogs = [];
    addConsoleLog("TERMINAL BUFFER CLEARED.", "ok");
    return;
  }
  if (clean === "scan" || clean === "ls" || clean === "dir") {
    addConsoleLog("SCANNING MAINFRAME... EXPLOIT SIGNATURES FOUND:", "ok");
    DAEMONS.forEach(d => {
      addConsoleLog(`  ${d.emoji} ${d.cmd.padEnd(16, " ")} — ${d.unlocked ? "[UNLOCKED]" : "[LOCKED]"}`, d.unlocked ? "ok" : "warn");
    });
    return;
  }
  if (clean === "breach" || clean === "crack" || clean === "unlock" || clean === "sudo") {
    DAEMONS.forEach(d => { d.unlocked = true; });
    soundManager.play("powerUpSpawn", { pitch: 2.0, volume: 0.7 });
    addConsoleLog("ROOT OVERRIDE ACCEPTED // ALL 5 DAEMONS UNLOCKED!", "ok");
    renderCyberConsole();
    return;
  }

  // Check score command: "score 5000" or "devsetscore(5000)"
  const scoreMatch = clean.match(/^(?:score|devsetscore)\s*\(?(\d+)\)?$/);
  if (scoreMatch) {
    const val = parseInt(scoreMatch[1], 10);
    window.devSetScore(val);
    soundManager.play("powerUpSpawn", { pitch: 1.6, volume: 0.5 });
    addConsoleLog(`SCORE OVERRIDE: Score set to ${val}!`, "ok");
    return;
  }

  // Check if command matches any daemon alias
  const matchedDaemon = DAEMONS.find(d => d.aliases.includes(clean));
  if (matchedDaemon) {
    executeDaemon(matchedDaemon);
    return;
  }

  soundManager.play("multihit", { pitch: 0.7, volume: 0.4 });
  addConsoleLog(`UNKNOWN EXPLOIT '${rawInput}'. Type 'scan' or 'help' for valid payloads.`, "err");
}

function toggleCyberConsole(forceState) {
  if (!consoleModalEl) return;
  const isOpen = consoleModalEl.style.display === "flex";
  const nextState = typeof forceState === "boolean" ? forceState : !isOpen;

  if (nextState) {
    toggleArcadeGuide(false);
    if (!breachGridBytes.length) generateBreachPuzzle();
    if (!gameOver && gameRunning && !ballIsStuck) {
      togglePause();
      pausedByConsole = true;
    } else {
      pausedByConsole = false;
    }
    renderCyberConsole();
    consoleModalEl.style.display = "flex";
    soundManager.play("bounce", { pitch: 1.55, volume: 0.4 });
    setTimeout(() => {
      const inp = document.getElementById("console-cli-input");
      if (inp) inp.focus();
    }, 30);
  } else {
    consoleModalEl.style.display = "none";
    if (pausedByConsole && !gameOver && !gameRunning) {
      pausedByConsole = false;
      togglePause();
    }
  }
}

if (consoleBtnEl) {
  consoleBtnEl.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleCyberConsole();
  });
}
if (tipConsoleBtn) {
  tipConsoleBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleCyberConsole();
  });
}
if (consoleModalEl) {
  consoleModalEl.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (ev.target === consoleModalEl) toggleCyberConsole(false);
  });
}
