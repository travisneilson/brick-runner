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
        if (isCatMode && typeof playCuteCatSound === 'function' && name !== 'winSong' && name !== 'loseSong') {
            playCuteCatSound(name, options);
            return;
        }
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
  'magLaunch':   { url: "./sounds/mag2.mp3" },
  'catMeow':     { url: "./sounds/cat-meow.mp3" }
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

// --- Helper Functions & Dual Arcade Leaderboard (Legit vs. Hacked) ---
const LEADERBOARD_STORAGE_KEY = "brickRunnerLeaderboard";
const HACKED_LEADERBOARD_STORAGE_KEY = "brickRunnerHackedLeaderboard";
const LAST_INITIALS_KEY = "brickRunnerLastInitials";
const MAX_LEADERBOARD_ENTRIES = 5;
// Optional: Paste a Google Apps Script Web App URL or REST endpoint here to sync scores globally across all players
const LEADERBOARD_API_URL = "";

const activeHackModes = new Set();
let primaryHackModeId = null;
let runUsedCheats = false;
const runHackModesUsed = new Set();
let activeLeaderboardTab = "legit"; // "legit" | "hacked"

const HACK_BADGE_EMOJI = {
  cat: "🐱",
  poop: "💩",
  party: "🎉",
  god: "🎮",
  juice: "⚡",
  dev: "🛠️"
};

let memoryHighScore = 0;
let memoryLeaderboard = null;
let memoryHackedLeaderboard = null;
let callsignSlots = ["", "", ""];
let awaitingInitials = false;
let pendingEndGameWon = false;
let lastSavedEntryId = null;

function isCallsignComplete() {
  return callsignSlots.every(ch => /^[A-Z]$/.test(ch));
}

function clearCallsignSlots() {
  callsignSlots = ["", "", ""];
  activeCallsignSlot = 0;
}

function isAnyHackCurrentlyArmed() {
  return activeHackModes.size > 0 || isCatMode || catModeArmed;
}

function getArmedHackEmojis() {
  const icons = [];
  if (isCatMode || catModeArmed || activeHackModes.has("cat")) icons.push("🐱");
  activeHackModes.forEach(id => {
    if (id !== "cat" && HACK_BADGE_EMOJI[id]) icons.push(HACK_BADGE_EMOJI[id]);
  });
  return icons;
}

function getRunHackEmojis() {
  const icons = [];
  runHackModesUsed.forEach(id => {
    const em = HACK_BADGE_EMOJI[id] || id;
    if (!icons.includes(em)) icons.push(em);
  });
  if (icons.length === 0 && isAnyHackCurrentlyArmed()) {
    return getArmedHackEmojis();
  }
  return icons.length > 0 ? icons : ["💻"];
}

function markRunAsHacked(hackId = "dev") {
  runUsedCheats = true;
  if (hackId) runHackModesUsed.add(hackId);
  updateHighScoreDisplay();
  updateStartLeaderboard();
}

function getLastInitials() {
  return isCallsignComplete() ? callsignSlots.join("") : "";
}

function saveLastInitials(initials) {
  const clean = (initials || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  callsignSlots = [clean[0] || "", clean[1] || "", clean[2] || ""];
}

function sanitizeAndMigrateLeaderboards() {
  try {
    const rawLegit = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    const rawHacked = localStorage.getItem(HACKED_LEADERBOARD_STORAGE_KEY);
    let legitList = rawLegit ? JSON.parse(rawLegit) : [];
    let hackedList = rawHacked ? JSON.parse(rawHacked) : [];
    if (!Array.isArray(legitList)) legitList = [];
    if (!Array.isArray(hackedList)) hackedList = [];

    const cleanLegit = [];
    let migrated = false;

    legitList.forEach(item => {
      if (!item || item.id === "legacy-seed") return;
      const isSuspectHacked =
        item.hacked === true ||
        (Array.isArray(item.hacks) && item.hacks.length > 0) ||
        item.score >= 50000;

      if (isSuspectHacked) {
        migrated = true;
        const inferredHacks = Array.isArray(item.hacks) && item.hacks.length > 0
          ? item.hacks
          : (item.score >= 999999 ? ["🎮"] : ["💻"]);
        hackedList.push({
          ...item,
          hacked: true,
          hacks: inferredHacks
        });
      } else {
        cleanLegit.push(item);
      }
    });

    if (migrated) {
      cleanLegit.sort((a, b) => b.score - a.score);
      hackedList.sort((a, b) => b.score - a.score);
      const trimmedLegit = cleanLegit.slice(0, MAX_LEADERBOARD_ENTRIES);
      const trimmedHacked = hackedList.slice(0, MAX_LEADERBOARD_ENTRIES);
      memoryLeaderboard = trimmedLegit;
      memoryHackedLeaderboard = trimmedHacked;
      localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(trimmedLegit));
      localStorage.setItem(HACKED_LEADERBOARD_STORAGE_KEY, JSON.stringify(trimmedHacked));
      localStorage.setItem("brickRunnerHighScore", trimmedLegit.length > 0 ? trimmedLegit[0].score : 0);
    }

    const storedHigh = parseInt(localStorage.getItem("brickRunnerHighScore"), 10) || 0;
    if (storedHigh >= 50000) {
      const topLegit = cleanLegit.length > 0 ? cleanLegit[0].score : 0;
      localStorage.setItem("brickRunnerHighScore", topLegit);
      memoryHighScore = topLegit;
    }
  } catch (err) {
    // Ignore storage errors in sandboxed iframes
  }
}

function getLeaderboard(mode = "legit") {
  const isHacked = mode === "hacked";
  const storageKey = isHacked ? HACKED_LEADERBOARD_STORAGE_KEY : LEADERBOARD_STORAGE_KEY;
  const fallbackMem = isHacked ? memoryHackedLeaderboard : memoryLeaderboard;

  let list = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) list = JSON.parse(raw);
  } catch (err) {
    list = fallbackMem;
  }
  if (!Array.isArray(list)) {
    list = Array.isArray(fallbackMem) ? [...fallbackMem] : [];
  }
  list = list.filter(item => item && item.id !== "legacy-seed");
  list.sort((a, b) => b.score - a.score);
  return list.slice(0, MAX_LEADERBOARD_ENTRIES);
}

function saveLeaderboard(entries, mode = "legit") {
  const isHacked = mode === "hacked";
  const storageKey = isHacked ? HACKED_LEADERBOARD_STORAGE_KEY : LEADERBOARD_STORAGE_KEY;
  const sorted = [...entries].sort((a, b) => b.score - a.score).slice(0, MAX_LEADERBOARD_ENTRIES);

  if (isHacked) {
    memoryHackedLeaderboard = sorted;
  } else {
    memoryLeaderboard = sorted;
    memoryHighScore = sorted.length > 0 ? sorted[0].score : 0;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(sorted));
    if (!isHacked) {
      localStorage.setItem("brickRunnerHighScore", sorted.length > 0 ? sorted[0].score : 0);
    }
  } catch (err) {
    // Ignore storage errors in sandboxed iframes
  }
  updateHighScoreDisplay();
  updateStartLeaderboard();
  return sorted;
}

function qualifiesForLeaderboard(newScore, mode = "legit") {
  if (newScore <= 0) return false;
  const board = getLeaderboard(mode);
  return board.length < MAX_LEADERBOARD_ENTRIES || newScore > board[board.length - 1].score;
}

function addLeaderboardEntry(rawInitials, newScore, won, mode = "legit", hacksUsed = []) {
  const cleanInitials = (rawInitials || "AAA").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "A");
  saveLastInitials(cleanInitials);
  const isHacked = mode === "hacked";
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    initials: cleanInitials,
    score: newScore,
    rating: getRating(newScore, won),
    won: !!won,
    sector: typeof currentSector === "number" ? currentSector : 1,
    level: typeof rogueLevel === "number" ? rogueLevel : 1,
    augments: typeof getActiveAugmentIcons === "function" ? getActiveAugmentIcons() : [],
    hacked: isHacked,
    hacks: isHacked ? (hacksUsed.length > 0 ? hacksUsed : ["💻"]) : [],
    date: new Date().toISOString().slice(0, 10)
  };
  const board = getLeaderboard(mode);
  board.push(entry);
  saveLeaderboard(board, mode);
  lastSavedEntryId = entry.id;
  if (!isHacked) {
    postRemoteScore(entry);
  }
  return entry;
}

function moveEntryToHackedLeaderboard(entryId) {
  const legitBoard = getLeaderboard("legit");
  const target = legitBoard.find(item => item.id === entryId);
  if (!target) return;

  const remainingLegit = legitBoard.filter(item => item.id !== entryId);
  const hackedBoard = getLeaderboard("hacked");
  const inferredHacks = (target.score % 10 === 9) ? ["🐱"] : ["💻"];
  hackedBoard.push({
    ...target,
    hacked: true,
    hacks: Array.isArray(target.hacks) && target.hacks.length > 0 ? target.hacks : inferredHacks
  });

  saveLeaderboard(remainingLegit, "legit");
  saveLeaderboard(hackedBoard, "hacked");
  activeLeaderboardTab = "hacked";
  lastSavedEntryId = target.id;
  updateStartLeaderboard();
  const endLb = document.getElementById("end-leaderboard");
  if (endLb) {
    endLb.innerHTML = renderLeaderboardHTML(lastSavedEntryId, activeLeaderboardTab);
    bindLeaderboardEvents(endLb, lastSavedEntryId);
  }
}

function formatArcadeScore(num) {
  return Number(num || 0).toLocaleString("en-US");
}

function renderLeaderboardHTML(highlightId = null, mode = activeLeaderboardTab) {
  const isHackedTab = mode === "hacked";
  const board = getLeaderboard(mode);
  const legitCount = getLeaderboard("legit").length;
  const hackedCount = getLeaderboard("hacked").length;
  const armedHacks = getArmedHackEmojis();
  const hacksArmedNow = armedHacks.length > 0;

  let statusStripHTML = "";
  if (!isHackedTab) {
    if (hacksArmedNow) {
      statusStripHTML = `
        <div class="leaderboard-mode-strip warn-strip">
          <span>⚠️ HACKS ON (${armedHacks.join("")}) • NEXT RUN GOES TO HACKED</span>
          <button type="button" class="lb-disable-hacks-btn" data-clear-hacks="1">GO LEGIT</button>
        </div>
      `;
    } else {
      statusStripHTML = `
        <div class="leaderboard-mode-strip legit-strip">
          <span>🛡️ 100% CHEAT-FREE • PURE SKILL RECORDS</span>
          <span class="lb-verified-pill">✓ VERIFIED</span>
        </div>
      `;
    }
  } else {
    statusStripHTML = `
      <div class="leaderboard-mode-strip hacked-strip">
        <span>💻 HACK CONSOLE &amp; CHEAT MODE RECORDS</span>
        <span class="lb-hacked-pill">${hacksArmedNow ? `ARMED: ${armedHacks.join("")}` : "HACK BOARD"}</span>
      </div>
    `;
  }

  const slots = [];
  for (let idx = 0; idx < MAX_LEADERBOARD_ENTRIES; idx++) {
    const item = board[idx];
    if (item) {
      const classes = ["leaderboard-row"];
      if (idx === 0) classes.push("rank-1");
      else if (idx === 1) classes.push("rank-2");
      else if (idx === 2) classes.push("rank-3");
      if (isHackedTab) classes.push("hacked-row");
      if (highlightId && item.id === highlightId) classes.push("current-run");

      const posBadge = idx === 0 ? "👑1" : `#${idx + 1}`;
      const sectorLvlTag = (item.sector || item.level)
        ? `<span class="lb-sector-pill" title="Reached Sector ${item.sector || 1} • Level ${item.level || 1}">S${item.sector || 1}•L${item.level || 1}</span>`
        : "";
      const hackIcons = isHackedTab
        ? `<span class="lb-hack-badges" title="Hack Modes Used">${(Array.isArray(item.hacks) && item.hacks.length > 0 ? item.hacks : ["💻"]).join("")}</span>`
        : sectorLvlTag;
      const moveBtn = !isHackedTab
        ? `<button type="button" class="lb-flag-cheat-btn" data-move-to-hacked="${item.id}" title="Used cheats on this run? Move to Hacked Leaderboard">➔💻</button>`
        : "";

      slots.push(`
        <div class="${classes.join(" ")}">
          <span class="lb-pos">${posBadge}</span>
          <span class="lb-initials-wrap">
            <span class="lb-initials">${item.initials}</span>
            ${hackIcons}
          </span>
          <span class="lb-score">${formatArcadeScore(item.score)}</span>
          <span class="lb-tier-wrap">
            <span class="lb-tier">${item.rating || getRating(item.score, item.won)}</span>
            ${moveBtn}
          </span>
        </div>
      `);
    } else {
      slots.push(`
        <div class="leaderboard-row empty-slot">
          <span class="lb-pos">#${idx + 1}</span>
          <span class="lb-initials-wrap"><span class="lb-initials">---</span></span>
          <span class="lb-score">---</span>
          <span class="lb-tier-wrap"><span class="lb-tier">${isHackedTab ? "OPEN HACK SLOT" : "OPEN LEGIT SLOT"}</span></span>
        </div>
      `);
    }
  }

  return `
    <div class="leaderboard-tabs" role="tablist">
      <button type="button" class="lb-tab ${!isHackedTab ? "active-legit" : ""}" data-lb-tab="legit">
        🏆 LEGIT TOP 5 <span class="lb-tab-count">${legitCount}</span>
      </button>
      <button type="button" class="lb-tab ${isHackedTab ? "active-hacked" : ""}" data-lb-tab="hacked">
        💻 HACKED TOP 5 <span class="lb-tab-count">${hackedCount}</span>
      </button>
    </div>
    ${statusStripHTML}
    <div class="leaderboard-list">${slots.join("")}</div>
  `;
}

function bindLeaderboardEvents(containerEl, highlightId = lastSavedEntryId) {
  if (!containerEl) return;

  containerEl.querySelectorAll("[data-lb-tab]").forEach(tabBtn => {
    tabBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const nextTab = tabBtn.dataset.lbTab === "hacked" ? "hacked" : "legit";
      if (activeLeaderboardTab !== nextTab) {
        activeLeaderboardTab = nextTab;
        soundManager.play("bounce", { pitch: nextTab === "legit" ? 1.45 : 1.15, volume: 0.35 });
      }
      updateStartLeaderboard();
      const endLb = document.getElementById("end-leaderboard");
      if (endLb) {
        endLb.innerHTML = renderLeaderboardHTML(highlightId, activeLeaderboardTab);
        bindLeaderboardEvents(endLb, highlightId);
      }
    });
  });

  containerEl.querySelectorAll("[data-clear-hacks]").forEach(clearBtn => {
    clearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (typeof deactivateAllHackModes === "function") {
        deactivateAllHackModes();
      }
      soundManager.play("powerUpSpawn", { pitch: 1.6, volume: 0.45 });
      updateStartLeaderboard();
      const endLb = document.getElementById("end-leaderboard");
      if (endLb) {
        endLb.innerHTML = renderLeaderboardHTML(highlightId, activeLeaderboardTab);
        bindLeaderboardEvents(endLb, highlightId);
      }
    });
  });

  containerEl.querySelectorAll("[data-move-to-hacked]").forEach(flagBtn => {
    flagBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const entryId = flagBtn.dataset.moveToHacked;
      if (flagBtn.dataset.confirming === "1") {
        soundManager.play("multihit", { pitch: 1.1, volume: 0.45 });
        moveEntryToHackedLeaderboard(entryId);
      } else {
        flagBtn.dataset.confirming = "1";
        flagBtn.textContent = "HACKED?";
        flagBtn.classList.add("confirming");
        soundManager.play("bounce", { pitch: 1.2, volume: 0.3 });
        setTimeout(() => {
          if (flagBtn.isConnected) {
            delete flagBtn.dataset.confirming;
            flagBtn.textContent = "➔💻";
            flagBtn.classList.remove("confirming");
          }
        }, 3000);
      }
    });
  });
}

function updateStartLeaderboard() {
  const el = document.getElementById("start-leaderboard");
  if (!el) return;
  el.innerHTML = renderLeaderboardHTML(lastSavedEntryId, activeLeaderboardTab);
  bindLeaderboardEvents(el, lastSavedEntryId);
}

// --- Pre-Game Arcade Callsign Keypad ---
const CALLSIGN_PRESETS = ["NEO", "ZAP", "HEX", "CAT", "SYN", "MAX", "ACE", "VEX", "GLX", "NYX", "CYB", "JET"];
const KEYPAD_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
let activeCallsignSlot = 0;

function isStartScreenOpen() {
  return gameOver && startScreen && startScreen.style.display === "flex" && (!clickToStartOverlay || clickToStartOverlay.style.display === "none");
}

function getCallsignChars() {
  return [callsignSlots[0] || "", callsignSlots[1] || "", callsignSlots[2] || ""];
}

function syncStartPlayButtonState() {
  if (!startPrompt) return;
  if (!assetsReady) {
    startPrompt.textContent = "Loading...";
    startPrompt.classList.add("loading");
    startPrompt.classList.remove("callsign-locked");
    return;
  }
  startPrompt.classList.remove("loading");
  if (isCallsignComplete()) {
    startPrompt.textContent = `PLAY AS ${callsignSlots.join("")}`;
    startPrompt.classList.remove("callsign-locked");
  } else {
    startPrompt.textContent = "CREATE CALLSIGN TO PLAY";
    startPrompt.classList.add("callsign-locked");
  }
}

function promptCallsignRequired() {
  const firstEmpty = callsignSlots.findIndex(ch => !/^[A-Z]$/.test(ch));
  if (firstEmpty !== -1) activeCallsignSlot = firstEmpty;
  renderCallsignBuilder();
  const container = document.getElementById("callsign-builder");
  if (container) {
    container.classList.remove("callsign-required-shake");
    void container.offsetWidth;
    container.classList.add("callsign-required-shake");
  }
  soundManager.play("multihit", { pitch: 0.78, volume: 0.45 });
}

function renderCallsignBuilder() {
  const container = document.getElementById("callsign-builder");
  if (!container) return;
  const chars = getCallsignChars();
  const complete = isCallsignComplete();

  const slotsHTML = chars.map((ch, idx) => `
    <div class="callsign-slot ${idx === activeCallsignSlot ? "active" : ""} ${!ch ? "slot-empty" : "slot-filled"}" data-slot="${idx}">
      ${ch || `<span class="slot-placeholder">_</span>`}
    </div>
  `).join("");

  const keysHTML = [
    ...KEYPAD_LETTERS.map(letter => `<button type="button" class="keypad-key" data-key="${letter}">${letter}</button>`),
    `<button type="button" class="keypad-key key-special" data-key="RANDOM" title="Random Cyber Callsign">🎲</button>`,
    `<button type="button" class="keypad-key key-special" data-key="BACK" title="Backspace / Clear">⌫</button>`
  ].join("");

  const headingText = complete
    ? `🕹️ CALLSIGN LOCKED: ${chars.join("")}`
    : `🕹️ CREATE CALLSIGN TO START`;

  const subhintText = complete
    ? `Ready to roll! Click PLAY AS ${chars.join("")} or press SPACE`
    : `Pick 3 letters (A–Z) or roll 🎲 Random to unlock PLAY`;

  container.innerHTML = `
    <div>
      <div class="callsign-heading ${complete ? "callsign-ready" : ""}">${headingText}</div>
      <div class="callsign-slots">${slotsHTML}</div>
      <div class="keypad-grid">${keysHTML}</div>
    </div>
    <div class="callsign-subhint ${complete ? "subhint-ready" : ""}">${subhintText}</div>
  `;

  syncStartPlayButtonState();

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
  const wasComplete = isCallsignComplete();
  callsignSlots[activeCallsignSlot] = clean[0];

  // Advance to next empty slot if any, otherwise cycle 0->1->2
  const nextEmpty = callsignSlots.findIndex((ch, idx) => idx > activeCallsignSlot && !ch);
  const anyEmpty = callsignSlots.findIndex(ch => !ch);
  if (nextEmpty !== -1) {
    activeCallsignSlot = nextEmpty;
  } else if (anyEmpty !== -1) {
    activeCallsignSlot = anyEmpty;
  } else {
    activeCallsignSlot = (activeCallsignSlot + 1) % 3;
  }

  if (!wasComplete && isCallsignComplete()) {
    soundManager.play("powerUpSpawn", { pitch: 1.65, volume: 0.45 });
  } else {
    soundManager.play("bounce", { pitch: 1.3 + activeCallsignSlot * 0.18, volume: 0.35 });
  }
  updateHighScoreDisplay();
  renderCallsignBuilder();
}

function backspaceCallsign() {
  if (callsignSlots[activeCallsignSlot]) {
    callsignSlots[activeCallsignSlot] = "";
  } else {
    activeCallsignSlot = (activeCallsignSlot + 2) % 3;
    callsignSlots[activeCallsignSlot] = "";
  }
  soundManager.play("multihit", { pitch: 0.9, volume: 0.3 });
  updateHighScoreDisplay();
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
  const board = getLeaderboard("legit");
  if (board.length > 0) return board[0].score;
  try {
    const raw = parseInt(localStorage.getItem("brickRunnerHighScore"), 10) || memoryHighScore || 0;
    return raw >= 50000 ? 0 : raw;
  } catch (err) {
    return memoryHighScore >= 50000 ? 0 : (memoryHighScore || 0);
  }
}
function saveHighScore(e) {
  if (runUsedCheats || isAnyHackCurrentlyArmed()) return;
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
  const board = getLeaderboard("legit");
  const runner = getLastInitials() || "---";
  const modeTag = (runUsedCheats || isAnyHackCurrentlyArmed())
    ? ` • 💻 HACKED (${getArmedHackEmojis().join("") || getRunHackEmojis().join("")})`
    : "";
  if (board.length > 0) {
    highScoreDisplay.textContent = `🏆 Legit High: ${formatArcadeScore(board[0].score)} (${board[0].initials}) • Runner: ${runner}${modeTag}`;
  } else {
    const e = getHighScore();
    highScoreDisplay.textContent = `🏆 Legit High: ${formatArcadeScore(e)} • Runner: ${runner}${modeTag}`;
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
let currentSector = 1;
let sectorsCleared = 0;
let rogueLevel = 1;
let rogueXP = 0;
let rogueXPToNext = 8;
let activeAugments = {};
let isDraftModalOpen = false;
let pendingDraftReasons = [];
let currentDraftChoices = [];
let novaBrickCounter = 0;
let turretFireAccum = 0;
let aegisReady = false;
let aegisCooldownLeft = 0;
let pierceChargesLeft = 0;
let draftResumeGraceTimer = 0;

const ROGUE_AUGMENTS = [
  {
    id: "tesla",
    emoji: "⚡",
    name: "TESLA ARC",
    rarity: "EPIC",
    color: "#00ffff",
    maxRank: 3,
    getDesc: (nextRank) => `Paddle bounces fire <strong>${nextRank} homing chain-lightning bolt${nextRank > 1 ? "s" : ""}</strong> straight into the nearest intact bricks!`
  },
  {
    id: "nova",
    emoji: "🔥",
    name: "PLASMA NOVA",
    rarity: "EPIC",
    color: "#ff6600",
    maxRank: 3,
    getDesc: (nextRank) => {
      const everyN = Math.max(2, 5 - nextRank);
      const targets = nextRank + 1;
      return `Every <strong>${everyN}th brick</strong> you break detonates a fiery Plasma Ring, blasting up to <strong>${targets} adjacent bricks</strong>!`;
    }
  },
  {
    id: "aegis",
    emoji: "🛡️",
    name: "AEGIS BARRIER",
    rarity: "LEGENDARY",
    color: "#00ff88",
    maxRank: 3,
    getDesc: (nextRank) => {
      const cd = [22, 15, 9][nextRank - 1] || 9;
      return `Deploys a bottom <strong>Floor Forcefield</strong> that saves missed balls and recharges every <strong>${cd}s</strong>!`;
    }
  },
  {
    id: "turret",
    emoji: "🎯",
    name: "AUTO-TURRET",
    rarity: "RARE",
    color: "#ff3366",
    maxRank: 3,
    getDesc: (nextRank) => {
      const rate = ["1.8s", "1.2s", "0.75s"][nextRank - 1] || "0.75s";
      return `Mounts permanent autonomous twin wing-cannons that auto-fire plasma bolts every <strong>${rate}</strong>!`;
    }
  },
  {
    id: "magnet",
    emoji: "🧲",
    name: "GRAVITY TRACTOR",
    rarity: "RARE",
    color: "#ff00ff",
    maxRank: 3,
    getDesc: (nextRank) => {
      const bonus = [50, 100, 175][nextRank - 1] || 175;
      return `Magnetically pulls falling power-ups toward your paddle and awards <strong>+${bonus} PTS</strong> on every catch!`;
    }
  },
  {
    id: "titan",
    emoji: "🦖",
    name: "TITAN DECK",
    rarity: "COMMON",
    color: "#90ff5a",
    maxRank: 3,
    getDesc: (nextRank) => {
      const pct = nextRank * 22;
      return `Permanently widens base paddle size by <strong>+${pct}%</strong> and boosts lateral thruster speed by <strong>+${nextRank * 14}%</strong>!`;
    }
  },
  {
    id: "greed",
    emoji: "💎",
    name: "HIGH-ROLLER CORE",
    rarity: "LEGENDARY",
    color: "#ffd700",
    maxRank: 3,
    getDesc: (nextRank) => {
      const mult = ["1.4×", "1.85×", "2.5×"][nextRank - 1] || "2.5×";
      return `Multiplies ALL brick &amp; laser points by <strong>${mult}</strong>, while accelerating ball velocity by <strong>+${nextRank * 10}%</strong>!`;
    }
  },
  {
    id: "pierce",
    emoji: "💥",
    name: "PIERCING OVERCHARGE",
    rarity: "EPIC",
    color: "#c864ff",
    maxRank: 3,
    getDesc: (nextRank) => `Paddle &amp; ceiling bounces charge the ball to <strong>plow through ${nextRank} brick${nextRank > 1 ? "s" : ""}</strong> without bouncing for <strong>2× hit damage</strong>!`
  }
];

function getAugmentRank(id) {
  return activeAugments[id] || 0;
}

function getActiveAugmentIcons() {
  return Object.keys(activeAugments).map(id => {
    const def = ROGUE_AUGMENTS.find(a => a.id === id);
    return def ? `${def.emoji}${activeAugments[id] > 1 ? activeAugments[id] : ""}` : "";
  }).filter(Boolean);
}

function getSectorScoreMultiplier() {
  return 1 + (Math.max(1, currentSector) - 1) * 0.5;
}

function getGreedScoreMultiplier() {
  const r = getAugmentRank("greed");
  if (r <= 0) return 1;
  return [1.4, 1.85, 2.5][Math.min(r, 3) - 1] || 2.5;
}

function initRogueProgression() {
  currentSector = 1;
  sectorsCleared = 0;
  rogueLevel = 1;
  rogueXP = 0;
  rogueXPToNext = 8;
  activeAugments = {};
  isDraftModalOpen = false;
  pendingDraftReasons = [];
  currentDraftChoices = [];
  novaBrickCounter = 0;
  turretFireAccum = 0;
  aegisReady = false;
  aegisCooldownLeft = 0;
  pierceChargesLeft = 0;
  draftResumeGraceTimer = 0;
  const draftModal = document.getElementById("augment-draft-modal");
  if (draftModal) draftModal.style.display = "none";
  const rogueHud = document.getElementById("rogue-hud");
  if (rogueHud) rogueHud.style.display = "none";
  const aegisBar = document.getElementById("aegis-barrier-bar");
  if (aegisBar) aegisBar.style.display = "none";
  ball.classList.remove("ball-piercing");
}

function syncRogueHUD() {
  const rogueHud = document.getElementById("rogue-hud");
  if (!rogueHud) return;
  const sectorBadge = document.getElementById("rogue-sector-badge");
  const levelBadge = document.getElementById("rogue-level-badge");
  const xpFill = document.getElementById("rogue-xp-fill");
  const xpText = document.getElementById("rogue-xp-text");
  const dock = document.getElementById("augment-dock");

  if (sectorBadge) {
    const sMult = getSectorScoreMultiplier();
    sectorBadge.textContent = sMult > 1 ? `SECTOR ${currentSector} (×${sMult.toFixed(1)})` : `SECTOR ${currentSector}`;
  }
  if (levelBadge) {
    levelBadge.textContent = `LVL ${rogueLevel}`;
  }
  if (xpFill) {
    const pct = Math.min(100, Math.round((rogueXP / Math.max(1, rogueXPToNext)) * 100));
    xpFill.style.width = `${pct}%`;
  }
  if (xpText) {
    xpText.textContent = `${rogueXP}/${rogueXPToNext} XP`;
  }
  if (dock) {
    const ids = Object.keys(activeAugments);
    if (ids.length === 0) {
      dock.innerHTML = "";
    } else {
      dock.innerHTML = ids.map(id => {
        const def = ROGUE_AUGMENTS.find(a => a.id === id);
        const rank = activeAugments[id];
        if (!def) return "";
        let extraStatus = "";
        if (id === "aegis") {
          extraStatus = aegisReady ? "•RDY" : `•${Math.ceil(aegisCooldownLeft)}s`;
        } else if (id === "pierce" && pierceChargesLeft > 0) {
          extraStatus = `•×${pierceChargesLeft}`;
        }
        return `
          <span class="augment-chip" style="--aug-color: ${def.color};" title="${def.name} (LVL ${rank})">
            <span>${def.emoji}</span>
            <span class="aug-chip-rank">L${rank}${extraStatus}</span>
          </span>
        `;
      }).join("");
    }
  }

  // Update bottom Aegis Barrier Bar
  const aegisBar = document.getElementById("aegis-barrier-bar");
  if (aegisBar) {
    const aegisRank = getAugmentRank("aegis");
    if (aegisRank <= 0 || gameOver) {
      aegisBar.style.display = "none";
    } else {
      aegisBar.style.display = "flex";
      if (aegisReady) {
        aegisBar.className = "aegis-barrier-bar aegis-charged";
        aegisBar.innerHTML = `<span>🛡️ AEGIS FLOOR FORCEFIELD READY — NEXT MISSED BALL IS SAVED! 🛡️</span>`;
      } else {
        aegisBar.className = "aegis-barrier-bar aegis-recharging";
        aegisBar.innerHTML = `<span>⏳ AEGIS FORCEFIELD RECHARGING (${Math.ceil(aegisCooldownLeft)}s)...</span>`;
      }
    }
  }
}

function awardRogueXP(amount) {
  if (gameOver || attractArenaActive || amount <= 0) return;
  rogueXP += amount;
  while (rogueXP >= rogueXPToNext) {
    rogueXP -= rogueXPToNext;
    rogueLevel++;
    rogueXPToNext = Math.round(rogueXPToNext * 1.35 + 4);
    queueAugmentDraft({
      title: `LEVEL ${rogueLevel} // CYBER-DECK UPGRADE`,
      subtitle: "CHOOSE 1 OF 3 AUGMENTS (CLICK CARD OR PRESS [1] [2] [3])"
    });
  }
  syncRogueHUD();
}

function queueAugmentDraft(reasonObj) {
  if (gameOver || attractArenaActive) return;
  if (isDraftModalOpen) {
    pendingDraftReasons.push(reasonObj);
    return;
  }
  openAugmentDraftModal(reasonObj);
}

function openAugmentDraftModal(reasonObj) {
  const upgradable = ROGUE_AUGMENTS.filter(a => getAugmentRank(a.id) < a.maxRank);
  if (upgradable.length === 0) {
    // All 8 augments are maxed at Rank 3 — award an instant Overclock Score Bonus!
    const bonus = 300 * currentSector;
    score += bonus;
    if (isCatMode) score = score - (score % 10) + 9;
    scoreDisplay.textContent = `Score: ${score}`;
    showNotification({
      title: "ALL AUGMENTS MAXED",
      emoji: "👑",
      name: `+${bonus} PTS`,
      description: "OVERCLOCK BONUS AWARDED!",
      color: "#ffd700",
      mode: "burst"
    }, { x: paddleX });
    syncRogueHUD();
    return;
  }

  // Shuffle upgradable pool and pick up to 3 choices
  const pool = [...upgradable];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  currentDraftChoices = pool.slice(0, 3);

  const modal = document.getElementById("augment-draft-modal");
  if (!modal) return;

  // Ensure inner draft-window DOM exists so the modal can never fail to render
  if (!document.getElementById("draft-cards-grid")) {
    modal.innerHTML = `
      <div class="draft-window">
        <div class="draft-header">
          <span id="draft-reason-pill" class="draft-reason-pill">LEVEL UP // CYBER-DECK UPGRADE</span>
          <h2 id="draft-title" class="draft-title">SELECT A CYBER-AUGMENT</h2>
          <p id="draft-subtext" class="draft-subtext">CHOOSE 1 OF 3 AUGMENTS (CLICK CARD OR PRESS [1] [2] [3])</p>
        </div>
        <div id="draft-cards-grid" class="draft-cards-grid"></div>
      </div>
    `;
  }

  const reasonPill = document.getElementById("draft-reason-pill");
  const subtext = document.getElementById("draft-subtext");
  const grid = document.getElementById("draft-cards-grid");
  if (!grid) return;

  isDraftModalOpen = true;
  if (gameRunning) {
    gameRunning = false;
    pauseStartTime = Date.now();
    cancelAnimationFrame(animationFrameId);
  }
  gameArea.classList.remove("hide-cursor");
  soundManager.play("powerUpSpawn", { pitch: 1.55, volume: 0.85 });

  if (reasonPill && reasonObj?.title) reasonPill.textContent = reasonObj.title;
  if (subtext && reasonObj?.subtitle) subtext.textContent = reasonObj.subtitle;

  grid.innerHTML = currentDraftChoices.map((aug, idx) => {
    const curRank = getAugmentRank(aug.id);
    const nextRank = curRank + 1;
    const rankLabel = curRank === 0
      ? `<span class="draft-rank-badge draft-rank-new">NEW // LVL 1</span>`
      : `<span class="draft-rank-badge draft-rank-up">UPGRADE // LVL ${curRank} ➔ ${nextRank}</span>`;
    return `
      <button type="button" class="draft-card" data-draft-idx="${idx}" style="--card-color: ${aug.color};">
        <div class="draft-card-top">
          <span class="draft-key-hint">[${idx + 1}]</span>
          <span class="draft-rarity-pill">${aug.rarity}</span>
        </div>
        <div class="draft-card-emoji">${aug.emoji}</div>
        <div class="draft-card-name">${aug.name}</div>
        ${rankLabel}
        <p class="draft-card-desc">${aug.getDesc(nextRank)}</p>
        <span class="draft-card-cta">⚡ INSTALL AUGMENT</span>
      </button>
    `;
  }).join("");

  grid.querySelectorAll(".draft-card").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-draft-idx"), 10);
      selectAugmentChoice(idx);
    });
  });

  modal.style.display = "flex";
}

function selectAugmentChoice(idx) {
  if (!isDraftModalOpen) return;
  const chosen = currentDraftChoices[idx];
  if (!chosen) return;

  const newRank = Math.min(chosen.maxRank, getAugmentRank(chosen.id) + 1);
  activeAugments[chosen.id] = newRank;
  soundManager.play("grow", { pitch: 1.35, volume: 0.85 });

  // Apply immediate augment state updates
  if (chosen.id === "titan") {
    updatePaddleWidth();
  } else if (chosen.id === "aegis") {
    aegisReady = true;
    aegisCooldownLeft = 0;
  } else if (chosen.id === "pierce") {
    pierceChargesLeft = newRank;
    ball.classList.add("ball-piercing");
  }

  showNotification({
    title: "AUGMENT INSTALLED",
    emoji: chosen.emoji,
    name: `${chosen.name} L${newRank}`,
    description: "CYBER-DECK UPGRADED!",
    color: chosen.color,
    mode: "burst"
  }, { x: paddleX });

  syncRogueHUD();

  if (pendingDraftReasons.length > 0) {
    const nextReason = pendingDraftReasons.shift();
    openAugmentDraftModal(nextReason);
    return;
  }

  const modal = document.getElementById("augment-draft-modal");
  if (modal) modal.style.display = "none";
  isDraftModalOpen = false;
  currentDraftChoices = [];

  if (!gameOver) {
    if (pauseStartTime !== null) {
      const pausedDuration = Date.now() - pauseStartTime;
      for (const type in activePowerUps) {
        activePowerUps[type].forEach(timer => {
          timer.endTime += pausedDuration;
        });
      }
      pauseStartTime = null;
    }
    draftResumeGraceTimer = 0.75;
    gameArea.classList.add("hide-cursor");
    gameRunning = true;
    lastTime = 0;
    if (ballIsStuck) {
      clearTimeout(autoLaunchTimeout);
      autoLaunchTimeout = setTimeout(() => {
        if (ballIsStuck && gameRunning && !isDraftModalOpen) launchStuckBall();
      }, 950);
    }
    requestAnimationFrame(gameLoop);
  }
}

function damageOrBreakBrickByAugment(brick, damageHits = 1, bonusFlatPts = 5) {
  if (!brick || brick.isBroken) return;
  brick.hitsTaken += damageHits;

  if (brick.hitsTaken >= brick.hitsRequired) {
    const soundName = destroySounds[destroySoundIndex];
    soundManager.play(soundName);
    destroySoundIndex = (destroySoundIndex + 1) % destroySounds.length;

    brick.isBroken = true;
    brick.element.classList.add("broken");
    if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
      triggerCollisionSparklers(brick.x + brick.width / 2, brick.y + brick.height / 2, "brick");
    }

    const expandoStacks = (activePowerUps["wide-paddle"] || []).length;
    let points = (isRoofBonusActive ? 15 : 10) + bonusFlatPts;
    if (expandoStacks > 0) points *= (expandoStacks + 1);
    points *= (rowBonusLevel + 1);
    if (brick.isVaultBrick) {
      points = Math.round(points * 3.0);
    } else if (brick.hitsRequired > 1) {
      points = Math.round(points * 1.6);
    }
    points = Math.round(points * getSectorScoreMultiplier() * getGreedScoreMultiplier());
    if (isCatMode) points = points - (points % 10) + 9;

    score += points;
    if (isCatMode) score = score - (score % 10) + 9;
    scoreDisplay.textContent = `Score: ${score}`;

    showBrickScore(brick.x + brick.width / 2, brick.y, points);

    if (typeof brick.row === "number" && !brick.isExtraSpawn) {
      evaluateRowClear(brick.row);
    }
    if (brick.powerUpType) {
      spawnPowerUp(brick.powerUpType, brick);
    }
    awardRogueXP(brick.isVaultBrick ? 3 : (brick.hitsRequired > 1 ? 2 : 1));
  } else {
    soundManager.play("multihit", { pitch: 1.2, volume: 0.65 });
    brick.element.classList.add("damaged");
    brick.element.classList.remove("shake");
    void brick.element.offsetWidth;
    brick.element.classList.add("shake");
  }
}

function triggerTeslaArcBolts() {
  const rank = getAugmentRank("tesla");
  if (rank <= 0) return;
  const intact = bricks.filter(b => !b.isBroken);
  if (intact.length === 0) return;

  const padTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
  // Sort by distance to paddle center
  const sorted = [...intact].sort((a, b) => {
    const da = Math.hypot((a.x + a.width / 2) - paddleX, (a.y + a.height / 2) - padTop);
    const db = Math.hypot((b.x + b.width / 2) - paddleX, (b.y + b.height / 2) - padTop);
    return da - db;
  });

  const targets = sorted.slice(0, Math.min(rank, sorted.length));
  targets.forEach((target, idx) => {
    const tx = target.x + target.width / 2;
    const ty = target.y + target.height / 2;
    const sx = paddleX + (idx - (targets.length - 1) / 2) * 18;
    const sy = padTop;

    const dx = tx - sx;
    const dy = ty - sy;
    const length = Math.hypot(dx, dy);
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

    const boltEl = document.createElement("div");
    boltEl.className = "tesla-bolt-line";
    boltEl.style.width = `${length}px`;
    boltEl.style.left = `${sx}px`;
    boltEl.style.top = `${sy}px`;
    boltEl.style.transform = `rotate(${angleDeg}deg)`;
    gameArea.appendChild(boltEl);
    setTimeout(() => boltEl.remove(), 260);

    damageOrBreakBrickByAugment(target, 1, 6);
  });
}

function triggerPlasmaNova(originBrick) {
  const rank = getAugmentRank("nova");
  if (rank <= 0 || !originBrick) return;
  novaBrickCounter++;
  const threshold = [5, 4, 3][Math.min(rank, 3) - 1] || 3;
  if (novaBrickCounter < threshold) return;
  novaBrickCounter = 0;

  const cx = originBrick.x + originBrick.width / 2;
  const cy = originBrick.y + originBrick.height / 2;
  const blastRadius = 112 + rank * 14;

  const ring = document.createElement("div");
  ring.className = "plasma-nova-ring";
  ring.style.left = `${cx}px`;
  ring.style.top = `${cy}px`;
  ring.style.setProperty("--nova-size", `${blastRadius * 2}px`);
  gameArea.appendChild(ring);
  setTimeout(() => ring.remove(), 420);

  soundManager.play("laserFire", { pitch: 0.72, volume: 0.85 });

  bricks.forEach(b => {
    if (b.isBroken || b === originBrick) return;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    if (Math.hypot(bx - cx, by - cy) <= blastRadius) {
      damageOrBreakBrickByAugment(b, 1, 8);
    }
  });
}

function handleAegisFloorSave() {
  const rank = getAugmentRank("aegis");
  if (rank <= 0 || !aegisReady) return false;

  aegisReady = false;
  aegisCooldownLeft = [18, 13, 8][Math.min(rank, 3) - 1] || 8;
  ballY = GAME_HEIGHT - BALL_SIZE - 16;
  ballSpeedY = -Math.max(Math.abs(ballSpeedY), INITIAL_BALL_SPEED * 1.15);
  soundManager.play("magActivate", { pitch: 1.25, volume: 0.9 });

  showNotification({
    title: "AEGIS FORCEFIELD SAVE",
    emoji: "🛡️",
    name: "BALL REBOUNDED!",
    description: `RECHARGING IN ${aegisCooldownLeft}S`,
    color: "#39ff14",
    mode: "burst"
  }, { x: ballX + BALL_SIZE / 2 });

  syncRogueHUD();
  return true;
}

function fireAutoTurretVolley() {
  const boltWidth = 6;
  const boltHeight = 20;
  const paddleTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
  const wingOffset = Math.max(16, paddleWidth * 0.34);
  [paddleX - wingOffset - boltWidth / 2, paddleX + wingOffset - boltWidth / 2].forEach(bx => {
    const clampedX = Math.max(4, Math.min(GAME_WIDTH - boltWidth - 4, bx));
    const bolt = { x: clampedX, y: paddleTop - boltHeight, width: boltWidth, height: boltHeight };
    const el = document.createElement("div");
    el.className = "laser-bolt turret-auto-bolt";
    el.style.left = `${bolt.x}px`;
    el.style.top = `${bolt.y}px`;
    gameArea.appendChild(el);
    bolt.element = el;
    lasers.push(bolt);
  });
  soundManager.play("laserFire", { pitch: 1.45, volume: 0.38 });
}

function updateRogueProgressionFrame(dt) {
  if (draftResumeGraceTimer > 0) {
    draftResumeGraceTimer = Math.max(0, draftResumeGraceTimer - dt);
  }

  // Recharge Aegis Floor Barrier
  const aegisRank = getAugmentRank("aegis");
  if (aegisRank > 0 && !aegisReady && aegisCooldownLeft > 0) {
    const prevCeil = Math.ceil(aegisCooldownLeft);
    aegisCooldownLeft = Math.max(0, aegisCooldownLeft - dt);
    if (aegisCooldownLeft <= 0) {
      aegisReady = true;
      soundManager.play("powerUpSpawn", { pitch: 1.9, volume: 0.65 });
      syncRogueHUD();
    } else if (Math.ceil(aegisCooldownLeft) !== prevCeil) {
      syncRogueHUD();
    }
  }

  // Auto-Pulse Turrets
  const turretRank = getAugmentRank("turret");
  if (turretRank > 0 && !ballIsStuck) {
    const interval = [1.8, 1.2, 0.75][Math.min(turretRank, 3) - 1] || 0.75;
    turretFireAccum += dt;
    if (turretFireAccum >= interval) {
      turretFireAccum = 0;
      fireAutoTurretVolley();
    }
  }
}

function advanceToNextSector() {
  sectorsCleared++;
  const clearedSectorNum = currentSector;
  const sectorBonus = 500 * clearedSectorNum;
  score += sectorBonus;
  if (isCatMode) score = score - (score % 10) + 9;
  scoreDisplay.textContent = `Score: ${score}`;

  currentSector++;
  clearedRows.clear();
  rowBonusCount = 0;
  rowBonusLevel = 0;
  isRoofBonusActive = false;
  ball.classList.remove("bonus-active");

  // Clear active lasers & leftover falling capsules before generating new Sector wave
  lasers.forEach(l => l.element.remove());
  lasers = [];
  gameArea.querySelectorAll(".brick.extra").forEach(el => el.remove());
  createBricks();

  // Dock ball to paddle for the start of the new Sector
  ballIsStuck = true;
  ballSpeedX = 0;
  ballSpeedY = 0;
  ballX = paddleX - BALL_SIZE / 2;
  ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE;

  if (getAugmentRank("aegis") > 0) {
    aegisReady = true;
    aegisCooldownLeft = 0;
  }

  soundManager.play("winSong");
  if (typeof spawnConfettiShards === "function") {
    spawnConfettiShards(55);
  }

  showNotification({
    title: `SECTOR ${clearedSectorNum} CLEARED!`,
    emoji: "🚀",
    name: `+${sectorBonus} PTS`,
    description: `WARPING TO SECTOR ${currentSector} (×${getSectorScoreMultiplier().toFixed(1)} SCORE)!`,
    color: "#00ffff",
    mode: "burst"
  }, { x: GAME_WIDTH / 2 });

  syncRogueHUD();

  queueAugmentDraft({
    title: `SECTOR ${clearedSectorNum} CLEARED // +${sectorBonus} PTS`,
    subtitle: `WARPING TO SECTOR ${currentSector} (×${getSectorScoreMultiplier().toFixed(1)} SCORE) — DRAFT A BONUS AUGMENT!`
  });
}

function initGame() {
    initRogueProgression();
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
    const headerLeft = document.querySelector('.header-left');
    if (headerLeft) headerLeft.classList.add('title-page-hidden');
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
  // vertical offset from top (leave clean room for top HUD & XP bar)
  const offsetY = 54 * GAME_SCALE;
  // center the grid horizontally
  const gridLeft = (GAME_WIDTH 
                  - BRICK_COLS * (BRICK_WIDTH + BRICK_GAP) 
                  + BRICK_GAP) / 2;

  // clear out any old bricks
  bricksContainer.innerHTML = '';
  bricks = [];

  const totalRows = currentSector >= 3 ? 6 : BRICK_ROWS;
  const armorChance = Math.min(0.6, 0.25 + (currentSector - 1) * 0.14);
  const vaultChance = currentSector >= 2 ? Math.min(0.28, 0.12 + (currentSector - 2) * 0.08) : 0;

  for (let row = 0; row < totalRows; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      // 1) create the DOM element
      const el = document.createElement('div');
      const colorRow = row % BRICK_ROWS;
      el.classList.add('brick', `brick-row-${colorRow}`);

      // 2) decide brick tier: Standard (1-hit), Armored (2-hit), or Gold Cyber-Vault (3-hit in Sector 2+)
      let hitsRequired = 1;
      let isVaultBrick = false;
      const roll = Math.random();
      if (vaultChance > 0 && roll < vaultChance) {
        hitsRequired = 3;
        isVaultBrick = true;
        el.classList.add('multihit', 'brick-vault');
      } else if (roll < vaultChance + armorChance) {
        hitsRequired = 2;
        el.classList.add('multihit');
      }

      // 3) maybe assign a power-up (Vault bricks always carry a power-up!)
      let powerUpType = null;
      if (isVaultBrick || Math.random() < POWER_UP_CHANCE) {
        powerUpType = POWER_UP_SPAWN_CHANCES[
          Math.floor(Math.random() * POWER_UP_SPAWN_CHANCES.length)
        ];
        const indicator = document.createElement('span');
        indicator.className = 'power-up-indicator';
        indicator.textContent = POWER_UP_TYPES[powerUpType].emoji;
        el.appendChild(indicator);
      }

      // 4) position & size it
      el.style.position = 'absolute';
      const x = gridLeft + col * (BRICK_WIDTH + BRICK_GAP);
      const y = offsetY  + row * (BRICK_HEIGHT + BRICK_GAP);
      el.style.width  = `${BRICK_WIDTH}px`;
      el.style.height = `${BRICK_HEIGHT}px`;
      el.style.left   = `${x}px`;
      el.style.top    = `${y}px`;

      // 5) define its data object
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
        isVaultBrick,
        row
      };

      // 6) append & track
      bricksContainer.appendChild(el);
      bricks.push(brick);
    }
  }
}



let pauseStartTime = null;
let attractArenaActive = false;

function startArenaAttractMode() {
    if (attractArenaActive) return;
    attractArenaActive = true;

    ball.style.display = 'block';
    ballIsStuck = false;
    ballX = GAME_WIDTH / 2 - BALL_SIZE / 2;
    ballY = GAME_HEIGHT - 160;
    ballSpeedX = 240;
    ballSpeedY = -285;
    paddleX = GAME_WIDTH / 2;
    paddle.classList.add('paddle-armed');

    let lastAttractT = null;
    let attractLaserAccum = 0;

    function stepAttract(ts) {
        if (!attractArenaActive) return;
        if (!lastAttractT) lastAttractT = ts;
        const dt = Math.min(0.04, (ts - lastAttractT) / 1000);
        lastAttractT = ts;

        // 1) Move ball
        ballX += ballSpeedX * dt;
        ballY += ballSpeedY * dt;

        // Wall & ceiling bounces
        if (ballX <= 0 && ballSpeedX < 0) {
            ballX = 0;
            ballSpeedX *= -1;
            if (typeof triggerCollisionSparklers === "function") triggerCollisionSparklers(8, ballY + BALL_SIZE / 2, "wall");
        } else if (ballX + BALL_SIZE >= GAME_WIDTH && ballSpeedX > 0) {
            ballX = GAME_WIDTH - BALL_SIZE;
            ballSpeedX *= -1;
            if (typeof triggerCollisionSparklers === "function") triggerCollisionSparklers(GAME_WIDTH - 8, ballY + BALL_SIZE / 2, "wall");
        }
        if (ballY <= 0 && ballSpeedY < 0) {
            ballY = 0;
            ballSpeedY *= -1;
            if (typeof triggerCollisionSparklers === "function") triggerCollisionSparklers(ballX + BALL_SIZE / 2, 8, "ceiling");
        }

        // 2) Smooth AI Paddle tracking
        const targetPadX = ballX + BALL_SIZE / 2 + Math.sin(ts * 0.0022) * 34;
        paddleX += (targetPadX - paddleX) * Math.min(1, dt * 9.5);
        const halfPad = paddleWidth / 2;
        paddleX = Math.max(halfPad, Math.min(GAME_WIDTH - halfPad, paddleX));

        // 3) Paddle bounce
        const padTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
        if (ballSpeedY > 0 && ballY + BALL_SIZE >= padTop) {
            ballY = padTop - BALL_SIZE;
            ballSpeedY = -(275 + Math.random() * 45);
            const hitOffset = ((ballX + BALL_SIZE / 2) - paddleX) / halfPad;
            ballSpeedX = hitOffset * 290 + (Math.random() - 0.5) * 40;
            if (Math.abs(ballSpeedX) < 120) ballSpeedX = (ballSpeedX >= 0 ? 1 : -1) * 165;
            if (typeof triggerCollisionSparklers === "function") {
                triggerCollisionSparklers(ballX + BALL_SIZE / 2, padTop, "paddle");
            }
        }

        // 4) Brick collisions (ball)
        const ballRect = { left: ballX, right: ballX + BALL_SIZE, top: ballY, bottom: ballY + BALL_SIZE };
        for (let i = 0; i < bricks.length; i++) {
            const b = bricks[i];
            if (b.isBroken) continue;
            const bRect = { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
            if (isColliding(ballRect, bRect)) {
                b.isBroken = true;
                b.element.classList.add('broken');
                ballSpeedY *= -1;
                if (typeof triggerCollisionSparklers === "function") {
                    triggerCollisionSparklers(b.x + b.width / 2, b.y + b.height / 2, "brick");
                }
                const idx = Math.floor(Math.random() * CHAOTIC_EMOJIS.length);
                ball.textContent = CHAOTIC_EMOJIS[idx];
                clearTimeout(emojiSwapTimeout);
                emojiSwapTimeout = setTimeout(() => {
                    ball.textContent = BALL_EMOJI;
                }, 250);
                break;
            }
        }

        // 5) Twin Laser Auto-Fire in Attract Mode
        attractLaserAccum += dt;
        if (attractLaserAccum >= 0.85) {
            attractLaserAccum = 0;
            const leftWing = paddleX - paddleWidth / 2 + 10;
            const rightWing = paddleX + paddleWidth / 2 - 16;
            [leftWing, rightWing].forEach(lx => {
                const bolt = document.createElement("div");
                bolt.className = "laser-bolt";
                bolt.style.left = `${lx}px`;
                bolt.style.top = `${padTop - 16}px`;
                gameArea.appendChild(bolt);
                lasers.push({ element: bolt, x: lx, y: padTop - 16, width: 6, height: 20 });
            });
        }

        for (let i = lasers.length - 1; i >= 0; i--) {
            const l = lasers[i];
            l.y -= LASER_SPEED * dt;
            l.element.style.top = `${l.y}px`;
            if (l.y + l.height < 0) {
                l.element.remove();
                lasers.splice(i, 1);
                continue;
            }
            const lRect = { left: l.x, right: l.x + l.width, top: l.y, bottom: l.y + l.height };
            for (let j = 0; j < bricks.length; j++) {
                const b = bricks[j];
                if (b.isBroken) continue;
                const bRect = { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
                if (isColliding(lRect, bRect)) {
                    b.isBroken = true;
                    b.element.classList.add('broken');
                    if (typeof triggerCollisionSparklers === "function") {
                        triggerCollisionSparklers(b.x + b.width / 2, b.y + b.height / 2, "brick");
                    }
                    l.element.remove();
                    lasers.splice(i, 1);
                    break;
                }
            }
        }

        // Respawn bricks when fewer than 14 remain intact
        if (bricks.filter(b => !b.isBroken).length < 14) {
            createBricks();
        }

        renderGame();
        if (typeof updateAndRenderSparklers === "function") {
            updateAndRenderSparklers(dt);
        }

        requestAnimationFrame(stepAttract);
    }

    requestAnimationFrame(stepAttract);
}

function stopArenaAttractMode() {
    if (!attractArenaActive) return;
    attractArenaActive = false;
    lasers.forEach(l => l.element.remove());
    lasers = [];
    paddle.classList.remove('paddle-armed');
    const canvas = document.getElementById("party-sparkler-canvas");
    if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    initGame();
}

function setupGame() {
    sanitizeAndMigrateLeaderboards();
    updateHighScoreDisplay();
    initGame();
    startScreen.style.display = 'none';
    clickToStartOverlay.style.display = 'flex';
    startArenaAttractMode();

    clickToStartOverlay.addEventListener('click', () => {
        clearInterval(emojiCycleInterval);
        stopArenaAttractMode();
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
            syncStartPlayButtonState();
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
    
    if (startPrompt) {
        startPrompt.addEventListener('click', (e) => {
            e.stopPropagation();
            if (gameOver && assetsReady) startGame();
        });
    }
}

function startGame() {
    if (gameOver && assetsReady) {
        if (!isCallsignComplete()) {
            if (!isStartScreenOpen()) {
                initGame();
            }
            promptCallsignRequired();
            return;
        }
        initGame(); 
        score = 0;
        lives = 1;
        gameOver = false;
        rowBonusLevel = 0;

        // Track whether this run started with any Hack/Cheat mode armed
        runUsedCheats = false;
        runHackModesUsed.clear();
        if (isCatMode || catModeArmed) {
            runUsedCheats = true;
            runHackModesUsed.add("cat");
        }
        activeHackModes.forEach(modeId => {
            runUsedCheats = true;
            runHackModesUsed.add(modeId);
        });
        updateHighScoreDisplay();
        
        startScreen.style.display = 'none';
        const headerLeft = document.querySelector('.header-left');
        if (headerLeft) headerLeft.classList.remove('title-page-hidden');
        scoreDisplay.style.display = 'block';
        const rogueHud = document.getElementById('rogue-hud');
        if (rogueHud) rogueHud.style.display = 'flex';
        syncRogueHUD();
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
        if (typeof applyArmedHackModesOnStart === 'function') {
            applyArmedHackModesOnStart();
        }
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
  updateRogueProgressionFrame(delta);
  updatePaddlePosition(delta);
  updateBallPosition(delta);
  updatePowerUps(delta);
  updateLasers(delta);
  updateStatusIndicators();
  if (typeof updateHackModesFrame === "function") {
    updateHackModesFrame(delta);
  }

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

  // 8) Check Sector Clear / loss conditions
  //    a) Advance to the next escalating Sector when all bricks in this Sector are broken!
  if (bricks.length > 0 && bricks.every(b => b.isBroken)) {
    advanceToNextSector();
    return;
  }

  //    b) God Mode Immortal Floor Shield, Aegis Barrier Augment Save, Cat Mode 9-Lives Save, OR Loss if the ball falls below the bottom
  if (typeof isHackModeActive === "function" && isHackModeActive("god") && ballY + BALL_SIZE >= GAME_HEIGHT - 14 && !ballIsStuck && ballSpeedY > 0) {
    ballY = GAME_HEIGHT - BALL_SIZE - 15;
    ballSpeedY = -Math.abs(ballSpeedY);
    soundManager.play("bounce", { pitch: 1.45, volume: 0.65 });
    showNotification("god-shield", { x: ballX + BALL_SIZE / 2 });
    if (typeof triggerDivinePaddleSmite === "function") {
      triggerDivinePaddleSmite(ballX + BALL_SIZE / 2, GAME_HEIGHT - 16);
    }
  } else if (ballY + BALL_SIZE >= GAME_HEIGHT - 12 && !ballIsStuck && ballSpeedY > 0 && handleAegisFloorSave()) {
    // Saved by Aegis Barrier Forcefield Augment!
  } else if (ballY + BALL_SIZE > GAME_HEIGHT && !ballIsStuck) {
    if (typeof isHackModeActive === "function" && isHackModeActive("cat") && typeof handleCatNineLivesSave === "function" && handleCatNineLivesSave()) {
      // Saved by one of the cat's 9 lives!
    } else {
      endGame(sectorsCleared > 0);
      return;
    }
  }

  // 9) Request the next frame if still running (draft modal may have paused gameRunning)
  if (gameRunning) {
    animationFrameId = requestAnimationFrame(gameLoop);
  }
}


function updatePaddlePosition(dt) {
  const halfPaddle = paddleWidth / 2;
  const titanRank = getAugmentRank("titan");
  const titanSpeedMult = 1 + titanRank * 0.14;
  const speedMult = ((typeof isHackModeActive === "function" && isHackModeActive("juice")) ? 1.45 : 1) * titanSpeedMult;
  if (leftPressed) {
    paddleX = Math.max(halfPaddle, paddleX - PADDLE_SPEED * speedMult * dt);
  }
  if (rightPressed) {
    paddleX = Math.min(GAME_WIDTH - halfPaddle, paddleX + PADDLE_SPEED * speedMult * dt);
  }
}
function updateBallPosition(e) {
  if (ballIsStuck) {
    if (!isRoofBonusActive) ball.style.transform = "";
    return;
  }
  const t = activePowerUps["slow-mo"]?.length || 0;
  let o = Math.pow(0.75, t);
  const greedRank = getAugmentRank("greed");
  if (greedRank > 0) {
    o *= (1 + greedRank * 0.10);
  }
  if (draftResumeGraceTimer > 0) {
    // Smoothly ramp ball speed from 45% to 100% right after closing the Augment Draft modal
    const graceRatio = 1 - (draftResumeGraceTimer / 0.75) * 0.55;
    o *= graceRatio;
  }
  if (typeof isHackModeActive === "function" && isHackModeActive("juice") && !isHackModeActive("god")) {
    o *= 1.6;
  }
  if (isCatMode) {
    // Parabolic leaping arc trajectory for Cat Mode!
    const CAT_LEAP_GRAVITY = 680;
    ballSpeedY += CAT_LEAP_GRAVITY * o * e;
    if (Math.abs(ballSpeedX) < 120) {
      ballSpeedX = (ballSpeedX >= 0 ? 1 : -1) * 165;
    }
    if (!isRoofBonusActive) {
      const tilt = Math.max(-28, Math.min(28, (ballSpeedY / 420) * (ballSpeedX >= 0 ? 20 : -20)));
      ball.style.transform = `rotate(${tilt.toFixed(1)}deg)`;
    }
  } else if (!isRoofBonusActive) {
    ball.style.transform = "";
  }
  ballX += ballSpeedX * o * e;
  ballY += ballSpeedY * o * e;
}
function isColliding(e,t){return!(e.bottom<t.top||e.top>t.bottom||e.right<t.left||e.left>t.right)}


function updatePaddleWidth() {
  // Calculate how big the paddle _should_ be logically (Expando stacks + Titan Deck Augment)
  const titanBonus = getAugmentRank("titan") * 0.22;
  const scaleFactor = 1 + paddleSizeLevel * 0.35 + titanBonus;
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
      const magnetRank = getAugmentRank("magnet");
      if (magnetRank > 0) {
        const targetX = paddleX - POWER_UP_SIZE / 2;
        const pullSpeed = (120 + magnetRank * 70) * dt;
        const diff = targetX - pu.originX;
        if (Math.abs(diff) > 1) {
          pu.originX += Math.sign(diff) * Math.min(Math.abs(diff), pullSpeed);
        }
      }
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
        const magnetRank = getAugmentRank("magnet");
        if (magnetRank > 0) {
          const baseMagBonus = [50, 100, 175][Math.min(magnetRank, 3) - 1] || 175;
          let magPts = Math.round(baseMagBonus * getSectorScoreMultiplier() * getGreedScoreMultiplier());
          if (isCatMode) magPts = magPts - (magPts % 10) + 9;
          score += magPts;
          if (isCatMode) score = score - (score % 10) + 9;
          scoreDisplay.textContent = `Score: ${score}`;
          showBrickScore(paddleX, padRect.top - 10, magPts);
        }
        awardRogueXP(2);
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
        if (b.isVaultBrick) {
          points = Math.round(points * 2.5);
        }
        points = Math.round(points * getSectorScoreMultiplier() * getGreedScoreMultiplier());
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
        if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
          triggerCollisionSparklers(b.x + b.width / 2, b.y + b.height / 2, "brick");
        }
        if (typeof isHackModeActive === "function" && isHackModeActive("poop") && typeof spawnBrickPoops === "function") {
          spawnBrickPoops(b.x + b.width / 2, b.y + b.height / 2, 2);
        }
        if (typeof b.row === "number" && !b.isExtraSpawn) {
          evaluateRowClear(b.row);
        }
        if (b.powerUpType) spawnPowerUp(b.powerUpType, b);
        awardRogueXP(b.isVaultBrick ? 3 : 1);
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
    if (isCatMode) {
      // Cat wall-jumps upward in an arc when touching a side wall!
      ballSpeedY = -(INITIAL_BALL_SPEED * 1.36);
    }
    soundManager.play("bounce");
    justBounced = true;
    if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
      triggerCollisionSparklers(ballX <= 0 ? 10 : GAME_WIDTH - 10, ballY + BALL_SIZE / 2, "wall");
    }
  }

  // Ceiling
  if (ballY <= 0 && ballSpeedY < 0) {
    ballY = 0;
    ballSpeedY *= -1;
    soundManager.play("bounce", { pitch: 0.8 });
    justBounced = true;
    if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
      triggerCollisionSparklers(ballX + BALL_SIZE / 2, 10, "ceiling");
    }

    // Apply roof bonus if not already active
    if (!isRoofBonusActive) {
      isRoofBonusActive = true;
      ball.classList.add("bonus-active");
      soundManager.play("powerUpSpawn", { pitch: 2.5, volume: 0.5 });
    }
    if (getAugmentRank("pierce") > 0) {
      pierceChargesLeft = getAugmentRank("pierce");
      ball.classList.add("ball-piercing");
      syncRogueHUD();
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
  if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
    triggerCollisionSparklers(ballX + BALL_SIZE / 2, padRect.top, "paddle");
  }
  if (typeof isHackModeActive === "function" && isHackModeActive("god") && typeof triggerDivinePaddleSmite === "function") {
    triggerDivinePaddleSmite(ballX + BALL_SIZE / 2, padRect.top);
  }
  if (getAugmentRank("tesla") > 0) {
    triggerTeslaArcBolts();
  }
  if (getAugmentRank("pierce") > 0) {
    pierceChargesLeft = getAugmentRank("pierce");
    ball.classList.add("ball-piercing");
    syncRogueHUD();
  }

  // clear any roof bonus
  if (isRoofBonusActive) {
    isRoofBonusActive = false;
    ball.classList.remove("bonus-active");
  }

  if (isStickyPaddle && !(typeof isHackModeActive === "function" && isHackModeActive("juice"))) {
    // stick the ball
    ballIsStuck = true;
    ballSpeedX  = 0;
    ballSpeedY  = 0;
  } else {
    // bounce off the paddle
    // 1) reposition the ball just above the paddle
    ballY = padRect.top - BALL_SIZE;
    // 2) invert Y velocity (high parabolic pounce in Cat Mode!)
    if (isCatMode) {
      ballSpeedY = -(INITIAL_BALL_SPEED * 1.55);
    } else {
      ballSpeedY *= -1;
    }

    // 3) compute X-velocity based on hit position
    const padWidth    = padRect.right - padRect.left;
    const halfPaddle  = padWidth / 2;
    const paddleCenter= padRect.left + halfPaddle;
    const impactPos   = (ballX + BALL_SIZE / 2 - paddleCenter) / halfPaddle;
    ballSpeedX        = impactPos * INITIAL_BALL_SPEED * 1.5;
    if (isCatMode && Math.abs(ballSpeedX) < 135) {
      ballSpeedX = (impactPos >= 0 ? 1 : -1) * 175;
    }
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

      // Multi-hit logic (Piercing Overcharge deals 2x hit damage!)
      const isPiercingHit = pierceChargesLeft > 0;
      brick.hitsTaken += (isPiercingHit ? 2 : 1);
      if (isPiercingHit) {
        pierceChargesLeft = Math.max(0, pierceChargesLeft - 1);
        if (pierceChargesLeft <= 0) {
          ball.classList.remove("ball-piercing");
        }
        syncRogueHUD();
      }

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
        if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
          triggerCollisionSparklers(brick.x + brick.width / 2, brick.y + brick.height / 2, "brick");
        }
        if (typeof isHackModeActive === "function" && isHackModeActive("juice") && typeof triggerOverdriveChainBlast === "function") {
          triggerOverdriveChainBlast(brick);
        }
        if (typeof isHackModeActive === "function" && isHackModeActive("poop") && typeof spawnBrickPoops === "function") {
          spawnBrickPoops(brick.x + brick.width / 2, brick.y + brick.height / 2, 2);
        }

        // 3) Apply row-clear, Armored/Vault brick, Sector, and High-Roller Greed multipliers before adding to score
        points *= (rowBonusLevel + 1);
        if (brick.isVaultBrick) {
          points = Math.round(points * 3.0);
        } else if (brick.hitsRequired > 1) {
          points = Math.round(points * 1.6);
        }
        points = Math.round(points * getSectorScoreMultiplier() * getGreedScoreMultiplier());

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

        // 7b) Trigger Plasma Nova shockwave if owned, then award Rogue XP
        triggerPlasmaNova(brick);
        awardRogueXP(brick.isVaultBrick ? 3 : (brick.hitsRequired > 1 ? 2 : 1));

      } else {
        // First-hit only: play “multihit” sound and show damage, plus +1 XP for cracking armor!
        soundManager.play("multihit", { pitch: 1 });
        setTimeout(() => {
          soundManager.play("multihit", { pitch: 1.5, volume: 0.7 });
        }, 50);
        brick.element.classList.add("damaged");
        awardRogueXP(1);
        if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
          triggerCollisionSparklers(brick.x + brick.width / 2, brick.y + brick.height / 2, "wall");
        }
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

      // Bounce along the shallowest collision axis UNLESS Piercing Overcharge plowed through this broken brick!
      if (!(isPiercingHit && brick.isBroken)) {
        const overlapLeft   = ballRect.right   - brickRect.left;
        const overlapRight  = brickRect.right  - ballRect.left;
        const overlapTop    = ballRect.bottom  - brickRect.top;
        const overlapBottom = brickRect.bottom - ballRect.top;
        const minOverlapX   = Math.min(overlapLeft, overlapRight);
        const minOverlapY   = Math.min(overlapTop, overlapBottom);

        if (minOverlapX < minOverlapY) {
          ballSpeedX *= -1;
          ballX += overlapLeft < overlapRight ? -overlapLeft : overlapRight;
          if (isCatMode) {
            ballSpeedY = -(INITIAL_BALL_SPEED * 1.18);
          }
        } else {
          ballSpeedY *= -1;
          ballY += overlapTop < overlapBottom ? -overlapTop : overlapBottom;
          if (isCatMode && overlapTop < overlapBottom) {
            ballSpeedY = -Math.max(Math.abs(ballSpeedY), INITIAL_BALL_SPEED * 1.22);
          }
        }
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
    spawnConfettiShards(100);
  } else {
    soundManager.play("loseSong");
  }

  const isHackedRun = runUsedCheats || isAnyHackCurrentlyArmed();
  const boardMode = isHackedRun ? "hacked" : "legit";
  activeLeaderboardTab = boardMode;

  const prevLegitHigh = getHighScore();
  const isNewLegitHigh = !isHackedRun && score > prevLegitHigh && score > 0;

  const runnerCallsign = getLastInitials();
  const hacksUsed = isHackedRun ? getRunHackEmojis() : [];
  const qualifies = score > 0 && qualifiesForLeaderboard(score, boardMode);
  const savedEntry = qualifies ? addLeaderboardEntry(runnerCallsign, score, won, boardMode, hacksUsed) : null;
  if (isNewLegitHigh) saveHighScore(score);

  const rating = getRating(score, won);
  const titleText = won ? `Sector ${currentSector} Reached!` : "System Failure!";
  const augSummary = getActiveAugmentIcons().join(" ");

  let savedBannerHTML = "";
  if (isHackedRun) {
    const hackBadgeStr = hacksUsed.join("");
    savedBannerHTML = savedEntry
      ? `<div class="record-saved-banner hacked-banner">💻 ${hackBadgeStr} SAVED TO HACKED TOP 5 &bull; 🏆 LEGIT BOARD PROTECTED!</div>`
      : `<div class="record-saved-banner hacked-banner">💻 ${hackBadgeStr} HACKED RUN &bull; 🏆 LEGIT LEADERBOARD PROTECTED!</div>`;
  } else if (savedEntry) {
    savedBannerHTML = `<div class="record-saved-banner">${
      isNewLegitHigh
        ? `👑 NEW #1 LEGIT HIGH SCORE FOR ${savedEntry.initials}! (100% CHEAT-FREE)`
        : `🏆 LEGIT TOP 5 RECORD SAVED FOR ${savedEntry.initials}! (100% CHEAT-FREE)`
    }</div>`;
  } else {
    const legitBoard = getLeaderboard("legit");
    const minNeeded = legitBoard.length >= MAX_LEADERBOARD_ENTRIES ? (legitBoard[legitBoard.length - 1].score + 1 - score) : 1;
    savedBannerHTML = `<div class="record-saved-banner legit-try-banner">🛡️ 100% LEGIT RUN &bull; ${formatArcadeScore(Math.max(1, minNeeded))} MORE PTS FOR TOP 5!</div>`;
  }

  const highlightId = savedEntry ? savedEntry.id : lastSavedEntryId;

  gameMessage.innerHTML = `
    <span class="title">${titleText}</span>
    <span class="name rating">${rating}</span>
    <span class="description">Runner: ${runnerCallsign} &bull; Sector ${currentSector} &bull; LVL ${rogueLevel}${augSummary ? ` (${augSummary})` : ""} &bull; Score: ${formatArcadeScore(score)} ${isHackedRun ? `<span class="end-run-hack-tag">(${hacksUsed.join("")} HACKED)</span>` : `<span class="end-run-legit-tag">(✓ LEGIT)</span>`}</span>
    ${savedBannerHTML}
    <div id="end-leaderboard" class="leaderboard-panel">
      ${renderLeaderboardHTML(highlightId, activeLeaderboardTab)}
    </div>
    <div class="end-game-actions">
      <button type="button" id="end-play-again-btn" class="end-action-btn end-play-btn">▶ PLAY AGAIN [SPACE]</button>
      <button type="button" id="end-switch-runner-btn" class="end-action-btn end-switch-btn">🕹️ SWITCH RUNNER [C]</button>
    </div>
  `;
  gameMessage.style.display = "block";
  gameArea.classList.remove("hide-cursor");

  const endLb = document.getElementById("end-leaderboard");
  if (endLb) {
    bindLeaderboardEvents(endLb, highlightId);
  }
  const playAgainBtn = document.getElementById("end-play-again-btn");
  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (gameOver && assetsReady) startGame();
    });
  }
  const switchRunnerBtn = document.getElementById("end-switch-runner-btn");
  if (switchRunnerBtn) {
    switchRunnerBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      clearCallsignSlots();
      initGame();
    });
  }
}
function launchStuckBall() {
  if (ballIsStuck) {
    clearTimeout(autoLaunchTimeout);
    soundManager.stop("winSong");
    ballIsStuck = false;
    ballSpeedY = isCatMode ? -(INITIAL_BALL_SPEED * 1.54) : -INITIAL_BALL_SPEED;
    const e = paddleWidth / 2;
    let t = (ballX + BALL_SIZE / 2 - paddleX) / e * INITIAL_BALL_SPEED * 1.5;
    if (isCatMode && Math.abs(t) < 135) {
      t = (Math.random() > 0.5 ? 1 : -1) * 180;
    }
    ballSpeedX = t;
    soundManager.play("magLaunch");
  }
}
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
  awardRogueXP(4);
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

  if (isDraftModalOpen) {
    if (e.key === "1" || e.key === "2" || e.key === "3") {
      e.preventDefault();
      selectAugmentChoice(parseInt(e.key, 10) - 1);
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
    clearCallsignSlots();
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

  // Flag run as hacked whenever score is manually overridden
  markRunAsHacked("dev");

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

  console.log(`🛠️  Dev: score force‐set to ${score} (Hacked Leaderboard Mode)`);
};

// ─── HACK MODES: FRAME, LIGHTING, HUD & GAMEPLAY ENGINE ───
let poopDrops = [];
let poopLoopRunning = false;
let poopRainInterval = null;
let catLives = 9;
let catMeowScaleIdx = 0;
let overdriveAutoFireAccum = 0;
let partyTrailAccum = 0;
let godMusicInterval = null;
let godChordIdx = 0;

// ─── Zero-Allocation 60fps HTML5 Canvas Sparkler & Confetti Engine ───
const MAX_SPARKS = 880;
const sparkPool = Array.from({ length: MAX_SPARKS }, () => ({
  active: false,
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  life: 0,
  maxLife: 1,
  color: "#00ffff",
  size: 2,
  kind: 0, // 0 = white-hot sparkler streak, 1 = spinning confetti ribbon, 2 = crackle star
  angle: 0,
  spin: 0
}));
let sparkCursor = 0;
const SPARK_COLORS = ["#00FFFF", "#FF00FF", "#FFE600", "#00FF66", "#FF2A85", "#FF8C00", "#FFFFFF"];

function emitSparkParticle(x, y, vx, vy, color, maxLife, size, kind = 0) {
  const s = sparkPool[sparkCursor];
  sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
  s.active = true;
  s.x = x;
  s.y = y;
  s.px = x;
  s.py = y;
  s.vx = vx;
  s.vy = vy;
  s.life = 0;
  s.maxLife = maxLife;
  s.color = color;
  s.size = size;
  s.kind = kind;
  s.angle = Math.random() * Math.PI * 2;
  s.spin = (Math.random() - 0.5) * 14;
}

function triggerCollisionSparklers(x, y, hitType = "brick") {
  const burstCount = hitType === "brick" ? 68 : (hitType === "paddle" ? 56 : 44);
  for (let i = 0; i < burstCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (hitType === "brick" ? 90 : 75) + Math.random() * 420;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    if (hitType === "paddle") vy = -Math.abs(vy) - 40;
    if (hitType === "ceiling") vy = Math.abs(vy) + 30;
    const color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
    const kind = i % 4 === 0 ? 1 : (i % 7 === 0 ? 2 : 0);
    const maxLife = 0.28 + Math.random() * 0.55;
    const size = kind === 1 ? (4 + Math.random() * 4) : (1.6 + Math.random() * 2.2);
    emitSparkParticle(x, y, vx, vy, color, maxLife, size, kind);
  }
}

function updateAndRenderSparklers(dt) {
  const canvas = document.getElementById("party-sparkler-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  let anyActive = false;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < MAX_SPARKS; i++) {
    const s = sparkPool[i];
    if (!s.active) continue;
    s.life += dt;
    if (s.life >= s.maxLife) {
      s.active = false;
      continue;
    }
    anyActive = true;
    s.px = s.x;
    s.py = s.y;

    // Air drag + gravity
    s.vx *= Math.pow(0.92, dt * 60);
    s.vy = s.vy * Math.pow(0.94, dt * 60) + 360 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.angle += s.spin * dt;

    // Bounce sparklers lightly off the floor or side walls
    if (s.x < 2 || s.x > GAME_WIDTH - 2) s.vx *= -0.75;

    const alpha = Math.max(0, 1 - s.life / s.maxLife);
    ctx.globalAlpha = alpha;

    if (s.kind === 0) {
      // Glowing sparkler streak + white-hot core tip
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      ctx.moveTo(s.px - s.vx * 0.018, s.py - s.vy * 0.018);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    } else if (s.kind === 1) {
      // Spinning neon confetti ribbon
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.fillStyle = s.color;
      ctx.fillRect(-s.size, -s.size * 0.45, s.size * 2, s.size * 0.9);
      ctx.restore();
    } else {
      // Twinkling crackle star at the tip
      const flicker = (Math.sin(s.life * 55) > 0) ? 1.4 : 0.6;
      const r = s.size * flicker;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(s.x - r * 2.2, s.y);
      ctx.lineTo(s.x + r * 2.2, s.y);
      ctx.moveTo(s.x, s.y - r * 2.2);
      ctx.lineTo(s.x, s.y + r * 2.2);
      ctx.stroke();
    }
  }
  ctx.restore();
  return anyActive;
}

// Always run a lightweight canvas loop when particles are active even if on start/win screen
let standaloneSparkLoop = false;
function kickStandaloneSparkLoop() {
  if (standaloneSparkLoop) return;
  standaloneSparkLoop = true;
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (!gameRunning) {
      const hasMore = updateAndRenderSparklers(dt);
      if (hasMore) {
        requestAnimationFrame(frame);
        return;
      }
    }
    standaloneSparkLoop = false;
  }
  requestAnimationFrame(frame);
}

// ─── Real Recorded Cat Meow Sample Player (with Pitch Variation + Synth Fallback) ───
const CAT_PITCH_STEPS = [0.94, 1.02, 1.10, 1.18, 1.26, 1.34];

function playCuteCatSound(name, options = {}) {
  try {
    soundManager.init();
    const ctx = soundManager.context;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const pitchStep = CAT_PITCH_STEPS[catMeowScaleIdx % CAT_PITCH_STEPS.length];
    catMeowScaleIdx++;

    const meowBuf = soundManager.sounds["catMeow"] && soundManager.sounds["catMeow"].buffer;
    if (meowBuf) {
      const source = ctx.createBufferSource();
      source.buffer = meowBuf;

      const gain = ctx.createGain();
      const baseVol = Math.min(0.95, (options.volume !== undefined ? options.volume : 0.8) * 0.85);

      let rate = pitchStep;
      let playDur = meowBuf.duration;

      if (name === "bounce" || name === "magLaunch") {
        // Playful pounce meow
        rate = pitchStep * (0.98 + Math.random() * 0.08);
        playDur = Math.min(meowBuf.duration, 0.52);
      } else if (name.startsWith("destroy")) {
        // Excited higher-pitched brick-smash meow!
        rate = pitchStep * 1.12;
        playDur = Math.min(meowBuf.duration, 0.68);
      } else {
        // Quick kitten chirp for multihit / laser / powerup
        rate = 1.28 + (catMeowScaleIdx % 3) * 0.08;
        playDur = Math.min(meowBuf.duration, 0.42);
      }

      source.playbackRate.setValueAtTime(rate, now);
      gain.gain.setValueAtTime(baseVol, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + playDur);

      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(now, 0, playDur);
      return;
    }

    // Fallback synth only if buffer is still decoding
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(580 * pitchStep, now);
    osc.frequency.exponentialRampToValueAtTime(920 * pitchStep, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(640 * pitchStep, now + 0.22);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (e) {
    // Ignore audio errors
  }
}

// ─── Cat Mode 9-Lives Save Handler ───
function handleCatNineLivesSave() {
  if (catLives <= 1) {
    catLives = 0;
    syncHackModeVisuals();
    return false;
  }
  catLives--;
  playCuteCatSound("destroy1", { volume: 1.0 });
  setTimeout(() => playCuteCatSound("bounce", { volume: 1.0 }), 110);

  // Place ball back on paddle and launch after a brief beat
  ballIsStuck = true;
  ballSpeedX = 0;
  ballSpeedY = 0;
  ballX = paddleX - BALL_SIZE / 2;
  ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE;

  showNotification({
    title: "NINE-LIVES PAW SAVE",
    emoji: "🐾",
    name: `${catLives} LIVES LEFT!`,
    description: "KITTY REFLEXES CAUGHT THE BALL!",
    color: "#ff2a9d",
    mode: "burst"
  }, { x: paddleX });

  syncHackModeVisuals();
  clearTimeout(autoLaunchTimeout);
  autoLaunchTimeout = setTimeout(() => {
    if (gameRunning && !gameOver && ballIsStuck) {
      launchStuckBall();
    }
  }, 850);
  return true;
}

// ─── God Mode Celestial Choir & Cathedral Organ Synth + Sequential Chain-Smite ───
const GOD_CHORDS = [
  [293.66, 369.99, 440.00, 587.33], // D Major (D4, F#4, A4, D5)
  [220.00, 277.18, 329.63, 440.00], // A Major (A3, C#4, E4, A4)
  [246.94, 293.66, 369.99, 493.88], // B Minor (B3, D4, F#4, B4)
  [196.00, 246.94, 293.66, 369.99]  // G Major 7 (G3, B3, D4, F#4)
];

function playGodChoirMeasure() {
  if (!activeHackModes.has("god")) return;
  try {
    soundManager.init();
    const ctx = soundManager.context;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const chord = GOD_CHORDS[godChordIdx % GOD_CHORDS.length];
    godChordIdx++;

    // Sustained angelic choir pad + celestial harp arpeggio
    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc2.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq * 1.003, now); // warm choir chorus detune

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1350, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.032, now + 0.45);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 2.35);

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc2.start(now);
      osc.stop(now + 2.4);
      osc2.stop(now + 2.4);

      // Golden harp arpeggio note
      const harpOsc = ctx.createOscillator();
      const harpGain = ctx.createGain();
      const noteStart = now + idx * 0.28;
      harpOsc.type = "sine";
      harpOsc.frequency.setValueAtTime(freq * 2, noteStart);
      harpGain.gain.setValueAtTime(0.0001, noteStart);
      harpGain.gain.linearRampToValueAtTime(0.038, noteStart + 0.02);
      harpGain.gain.exponentialRampToValueAtTime(0.0005, noteStart + 0.65);
      harpOsc.connect(harpGain).connect(ctx.destination);
      harpOsc.start(noteStart);
      harpOsc.stop(noteStart + 0.7);
    });
  } catch (e) {
    // Ignore audio errors
  }
}

function startGodMusic() {
  stopGodMusic();
  godChordIdx = 0;
  playGodChoirMeasure();
  godMusicInterval = setInterval(() => {
    if (!activeHackModes.has("god")) {
      stopGodMusic();
      return;
    }
    playGodChoirMeasure();
  }, 2200);
}

function stopGodMusic() {
  if (godMusicInterval) {
    clearInterval(godMusicInterval);
    godMusicInterval = null;
  }
}

function triggerDivinePaddleSmite(hitX, hitY) {
  const area = document.getElementById("game-area");
  if (!area) return;

  // 1) Golden shockwave ring expanding from paddle impact point
  const wave = document.createElement("div");
  wave.className = "divine-paddle-wave";
  wave.style.left = `${hitX}px`;
  wave.style.top = `${hitY}px`;
  area.appendChild(wave);
  setTimeout(() => wave.remove(), 600);

  // 2) Sequential "Boom, Boom, Boom!" Heavenly Lightning Barrage (4 staggered strikes!)
  const totalStrikes = 4;
  for (let sIdx = 0; sIdx < totalStrikes; sIdx++) {
    setTimeout(() => {
      if (gameOver) return;
      const intact = bricks.filter(b => !b.isBroken);
      if (intact.length === 0) return;

      const targetBrick = intact[Math.floor(Math.random() * intact.length)];
      const cx = targetBrick.x + targetBrick.width / 2;
      const cy = targetBrick.y + targetBrick.height / 2;

      // Heavenly Lightning Pillar from the top of the arena
      const beam = document.createElement("div");
      beam.className = "divine-smite-beam";
      beam.style.left = `${cx}px`;
      beam.style.height = `${cy + 18}px`;
      area.appendChild(beam);
      setTimeout(() => beam.remove(), 520);

      // Golden Proximity Explosion Shockwave Ring
      const ring = document.createElement("div");
      ring.className = "divine-chain-shockwave";
      ring.style.left = `${cx}px`;
      ring.style.top = `${cy}px`;
      area.appendChild(ring);
      setTimeout(() => ring.remove(), 480);

      // Thunderous sound effect on each sequential strike ("Boom, boom, boom!")
      const randomDestroy = destroySounds[Math.floor(Math.random() * destroySounds.length)];
      soundManager.play(randomDestroy, { pitch: 0.72 + sIdx * 0.16, volume: 0.85 });

      // Burst golden & white sparklers from the smited brick!
      for (let s = 0; s < 42; s++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 90 + Math.random() * 320;
        emitSparkParticle(
          cx,
          cy,
          Math.cos(ang) * spd,
          Math.sin(ang) * spd,
          s % 2 === 0 ? "#FFD700" : "#FFFFFF",
          0.48,
          2.3,
          s % 4 === 0 ? 2 : 0
        );
      }

      // Break the primary smited brick
      targetBrick.isBroken = true;
      targetBrick.element.classList.add("broken");
      if (typeof targetBrick.row === "number" && !targetBrick.isExtraSpawn) {
        evaluateRowClear(targetBrick.row);
      }
      if (targetBrick.powerUpType) spawnPowerUp(targetBrick.powerUpType, targetBrick);
      if (activeHackModes.has("poop")) {
        spawnBrickPoops(cx, cy, 2);
      }

      const smitePts = isCatMode ? 9999 : 1000;
      score += smitePts;
      if (isCatMode) score = score - (score % 10) + 9;
      scoreDisplay.textContent = `Score: ${score}`;
      showBrickScore(cx, targetBrick.y, smitePts);

      // Chain-detonate adjacent bricks in proximity!
      const maxDistX = BRICK_WIDTH * 1.38;
      const maxDistY = BRICK_HEIGHT * 1.48;
      const neighbors = bricks.filter(nb => {
        if (nb.isBroken || nb === targetBrick) return false;
        const nbx = nb.x + nb.width / 2;
        const nby = nb.y + nb.height / 2;
        return Math.abs(nbx - cx) <= maxDistX && Math.abs(nby - cy) <= maxDistY;
      });

      neighbors.slice(0, 2).forEach(nb => {
        nb.isBroken = true;
        nb.element.classList.add("broken");
        const nbx = nb.x + nb.width / 2;
        const nby = nb.y + nb.height / 2;

        for (let k = 0; k < 18; k++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 60 + Math.random() * 200;
          emitSparkParticle(nbx, nby, Math.cos(ang) * spd, Math.sin(ang) * spd, "#FFD700", 0.35, 1.9, 0);
        }

        const chainPts = isCatMode ? 499 : 500;
        score += chainPts;
        if (isCatMode) score = score - (score % 10) + 9;
        scoreDisplay.textContent = `Score: ${score}`;
        showBrickScore(nbx, nb.y, chainPts);

        if (typeof nb.row === "number" && !nb.isExtraSpawn) {
          evaluateRowClear(nb.row);
        }
        if (nb.powerUpType) spawnPowerUp(nb.powerUpType, nb);
        if (activeHackModes.has("poop")) {
          spawnBrickPoops(nbx, nby, 1);
        }
      });

      if (sIdx === 0) {
        showNotification("god-smite", { x: cx });
      }

      if (bricks.every(b => b.isBroken) && !gameOver) {
        endGame(true);
      }
    }, sIdx * 175);
  }
}

// ─── Max Overdrive: Chain-Detonation Shockwave & Auto-Gatling ───
function triggerOverdriveChainBlast(originBrick) {
  const area = document.getElementById("game-area");
  const cx = originBrick.x + originBrick.width / 2;
  const cy = originBrick.y + originBrick.height / 2;

  if (area) {
    const ring = document.createElement("div");
    ring.className = "overdrive-chain-shockwave";
    ring.style.left = `${cx}px`;
    ring.style.top = `${cy}px`;
    area.appendChild(ring);
    setTimeout(() => ring.remove(), 420);
  }

  // Erupt electric cyan/crimson sparks from the chain blast
  for (let i = 0; i < 32; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 90 + Math.random() * 310;
    emitSparkParticle(cx, cy, Math.cos(ang) * spd, Math.sin(ang) * spd, i % 2 === 0 ? "#00FFFF" : "#FF2A55", 0.35, 2.0, 0);
  }

  // Find adjacent intact bricks within 1.35 brick widths and chain-shatter up to 2 of them!
  const maxDistX = BRICK_WIDTH * 1.35;
  const maxDistY = BRICK_HEIGHT * 1.45;
  const neighbors = bricks.filter(b => {
    if (b.isBroken || b === originBrick) return false;
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    return Math.abs(bx - cx) <= maxDistX && Math.abs(by - cy) <= maxDistY;
  });

  const chainTargets = neighbors.slice(0, 2);
  chainTargets.forEach(nb => {
    nb.isBroken = true;
    nb.element.classList.add("broken");
    const nbx = nb.x + nb.width / 2;
    const nby = nb.y;
    let chainPts = 40 * (rowBonusLevel + 1);
    if (isCatMode) chainPts = chainPts - (chainPts % 10) + 9;
    score += chainPts;
    if (isCatMode) score = score - (score % 10) + 9;
    scoreDisplay.textContent = `Score: ${score}`;
    showBrickScore(nbx, nby, chainPts);
    if (typeof nb.row === "number" && !nb.isExtraSpawn) {
      evaluateRowClear(nb.row);
    }
    if (nb.powerUpType) spawnPowerUp(nb.powerUpType, nb);
    if (activeHackModes.has("poop")) {
      spawnBrickPoops(nbx, nb.y + nb.height / 2, 2);
    }
  });
}

// ─── Per-Frame Hack Modes Update (Sparkler Field + Overdrive Auto-Gatling) ───
function updateHackModesFrame(dt) {
  // 1) If Confetti Blast ('party') is active, emit continuous sparkler fountains from behind the ball & paddle corners!
  if (activeHackModes.has("party")) {
    partyTrailAccum += dt;
    if (partyTrailAccum >= 0.016) {
      partyTrailAccum = 0;
      const bx = ballX + BALL_SIZE / 2;
      const by = ballY + BALL_SIZE / 2;
      // Offset emission point slightly behind the ball's travel direction so it trails behind the avatar
      const spdMag = Math.hypot(ballSpeedX, ballSpeedY) || 1;
      const trailX = bx - (ballSpeedX / spdMag) * 14;
      const trailY = by - (ballSpeedY / spdMag) * 14;
      for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 35 + Math.random() * 140;
        const col = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
        emitSparkParticle(trailX, trailY, Math.cos(ang) * spd, Math.sin(ang) * spd, col, 0.22 + Math.random() * 0.25, 1.8, i === 0 ? 2 : 0);
      }
      // Twin Roman-candle sparkler fountains on the left & right edges of the paddle
      const padTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
      const leftEdge = paddleX - paddleWidth / 2 + 6;
      const rightEdge = paddleX + paddleWidth / 2 - 6;
      const colL = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
      const colR = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
      emitSparkParticle(leftEdge, padTop, (Math.random() - 0.5) * 90, -140 - Math.random() * 150, colL, 0.28, 1.7, 0);
      emitSparkParticle(rightEdge, padTop, (Math.random() - 0.5) * 90, -140 - Math.random() * 150, colR, 0.28, 1.7, 0);
    }
  }

  // 2) If Max Overdrive ('juice') is active, leave a plasma afterburner trail & auto-fire twin gatling bolts!
  if (activeHackModes.has("juice") && !ballIsStuck) {
    const bx = ballX + BALL_SIZE / 2;
    const by = ballY + BALL_SIZE / 2;
    emitSparkParticle(bx, by, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, Math.random() > 0.5 ? "#FF2A55" : "#00FFFF", 0.18, 2.2, 0);

    overdriveAutoFireAccum += dt;
    if (overdriveAutoFireAccum >= 0.28) {
      overdriveAutoFireAccum = 0;
      isLaserActive = true;
      paddle.classList.add("paddle-armed");
      fireLaser();
    }
  }

  // 3) Render active canvas sparklers
  updateAndRenderSparklers(dt);
}

const HACK_MODE_META = {
  cat: {
    id: "cat",
    emoji: "🐱",
    name: "CAT MODE",
    hudTag: "🐱 CAT MODE",
    getHudSub: () => `🐾 ${catLives} LIVES • LEAPING ARC • MEOW SFX`,
    color: "#ff2a9d",
    titleText: "🐱 CAT RUNNER",
    wmTitle: "CAT MODE // NINE LIVES",
    getWmRule: () => `🐾 ${catLives} LIVES LEFT • WALL-JUMP LEAPING ARCS • REAL MEOW SFX`
  },
  poop: {
    id: "poop",
    emoji: "💩",
    name: "POOP STORM",
    hudTag: "💩 POOP STORM",
    getHudSub: () => "BOUNCE 💩 TO SMASH BRICKS!",
    color: "#ffaa00",
    titleText: "💩 POOP RUNNER",
    wmTitle: "POOP STORM // BIO-HAZARD",
    getWmRule: () => "⚠️ BOUNCE 💩 UP INTO BRICKS TO SMASH THEM & ERUPT MORE 💩!"
  },
  party: {
    id: "party",
    emoji: "🎉",
    name: "CONFETTI BLAST",
    hudTag: "🎉 CONFETTI BLAST",
    getHudSub: () => "SPARKLER FIELD ON EVERY HIT",
    color: "#00ffcc",
    titleText: "🎉 PARTY RUNNER",
    wmTitle: "CONFETTI BLAST // SPARKLERS",
    getWmRule: () => "✨ EVERY WALL, PADDLE & BRICK HIT ERUPTS IN SPARKLERS!"
  },
  god: {
    id: "god",
    emoji: "🎮",
    name: "GOD MODE",
    hudTag: "🎮 GOD MODE",
    getHudSub: () => "CHAIN SMITE BARRAGE + HYMN",
    color: "#ffd700",
    titleText: "⚡ GOD RUNNER",
    wmTitle: "GOD MODE // IMMORTAL",
    getWmRule: () => "⚡ PADDLE HITS UNLEASH 4× SEQUENTIAL CHAIN-SMITE LIGHTNING!"
  },
  juice: {
    id: "juice",
    emoji: "⚡",
    name: "MAX OVERDRIVE",
    hudTag: "⚡ MAX OVERDRIVE",
    getHudSub: () => "1.6× TURBO + DISCO STROBE + CHAIN BLAST",
    color: "#ff2a55",
    titleText: "🔥 OVERDRIVE RUNNER",
    wmTitle: "MAX OVERDRIVE // HYPER-SPEED",
    getWmRule: () => "🔥 1.6× TURBO • CYBER-DISCO LIGHTS • AUTO-GATLING • CHAIN BRICKS"
  }
};

function isHackModeActive(id) {
  return activeHackModes.has(id);
}

function syncHackModeVisuals() {
  const area = document.getElementById("game-area");
  const hud = document.getElementById("hack-mode-hud");
  const wm = document.getElementById("hack-floor-watermark");
  const headerTitle = document.querySelector(".game-title-glitch");
  const startTitle = document.querySelector("#start-screen .game-title");

  if (!area) return;

  // 1) Update #game-area frame & lighting theme classes
  ["cat", "poop", "party", "god", "juice"].forEach(m => {
    area.classList.remove(`hack-theme-${m}`);
  });
  if (primaryHackModeId && activeHackModes.has(primaryHackModeId)) {
    area.classList.add(`hack-theme-${primaryHackModeId}`);
  } else if (activeHackModes.size > 0) {
    primaryHackModeId = Array.from(activeHackModes).slice(-1)[0];
    area.classList.add(`hack-theme-${primaryHackModeId}`);
  } else {
    primaryHackModeId = null;
  }

  // 2) Update Header Active Hack Mode Undo Buttons (#hack-mode-hud in .game-header — outside playfield!)
  if (hud) {
    if (activeHackModes.size === 0) {
      hud.innerHTML = "";
    } else {
      const pillsHTML = Array.from(activeHackModes).map(id => {
        const meta = HACK_MODE_META[id];
        if (!meta) return "";
        return `
          <button type="button" class="hack-hud-pill" data-disable-hack="${id}" style="--pill-color: ${meta.color};" title="Click to turn off ${meta.name}">
            <span class="pill-tag">${meta.hudTag}</span>
            <span class="pill-close-badge">✕ OFF</span>
          </button>
        `;
      }).join("");
      const clearAllHTML = activeHackModes.size > 1
        ? `<button type="button" class="hack-hud-clear-all" data-disable-all-hacks="true" title="Turn off all active Hack Modes">✕ OFF ALL</button>`
        : "";
      hud.innerHTML = pillsHTML + clearAllHTML;

      hud.querySelectorAll("[data-disable-hack]").forEach(btn => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const targetId = btn.dataset.disableHack;
          deactivateHackMode(targetId);
        });
      });
      const clearAllBtn = hud.querySelector("[data-disable-all-hacks]");
      if (clearAllBtn) {
        clearAllBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          deactivateAllHackModes();
        });
      }
    }
  }

  // 3) Update Arena Floor Marquee Watermark (#hack-floor-watermark — subtle background emblem only)
  if (wm) {
    const activeMeta = primaryHackModeId ? HACK_MODE_META[primaryHackModeId] : null;
    if (activeMeta) {
      wm.style.setProperty("--wm-color", activeMeta.color);
      wm.innerHTML = `
        <div class="hack-wm-emoji">${activeMeta.emoji}</div>
        <div class="hack-wm-title">${activeMeta.wmTitle}</div>
      `;
      wm.classList.add("visible");
    } else {
      wm.classList.remove("visible");
      wm.innerHTML = "";
    }
  }

  // 4) Update Cabinet Header Title & Start Screen Title
  const activeMeta = primaryHackModeId ? HACK_MODE_META[primaryHackModeId] : null;
  if (headerTitle) {
    if (activeMeta) {
      headerTitle.textContent = activeMeta.titleText;
      headerTitle.setAttribute("data-text", activeMeta.titleText);
      headerTitle.style.setProperty("--hack-title-color", activeMeta.color);
      headerTitle.classList.add("hack-title-active");
      headerTitle.title = `Click to turn off ${activeMeta.name}`;
      headerTitle.onclick = () => deactivateHackMode(activeMeta.id);
    } else {
      headerTitle.textContent = "BRICK RUNNER";
      headerTitle.setAttribute("data-text", "BRICK RUNNER");
      headerTitle.classList.remove("hack-title-active");
      headerTitle.title = "";
      headerTitle.onclick = null;
    }
  }
  if (startTitle) {
    if (activeMeta) {
      startTitle.textContent = activeMeta.titleText;
      startTitle.style.color = activeMeta.color;
      startTitle.style.textShadow = `0 0 10px ${activeMeta.color}, 0 0 24px ${activeMeta.color}`;
    } else {
      startTitle.textContent = "BRICK RUNNER";
      startTitle.style.color = "";
      startTitle.style.textShadow = "";
    }
  }
}

function activateHackMode(id, notify = true) {
  activeHackModes.add(id);
  primaryHackModeId = id;
  markRunAsHacked(id);
  syncHackModeVisuals();
  if (notify) {
    showNotification(`hack-${id}`);
  }
}

function deactivateHackMode(id) {
  activeHackModes.delete(id);
  if (id === "cat") {
    catModeArmed = false;
    isCatMode = false;
    BALL_EMOJI = isNeonLegend ? "😎" : "😊";
    ball.textContent = BALL_EMOJI;
  } else if (id === "poop") {
    if (poopRainInterval) {
      clearInterval(poopRainInterval);
      poopRainInterval = null;
    }
    poopDrops.forEach(d => d.el.remove());
    poopDrops = [];
  } else if (id === "god") {
    stopGodMusic();
    delete activePowerUps["slow-mo"];
    const stale = document.getElementById("status-slow-mo");
    if (stale) stale.remove();
  } else if (id === "juice") {
    if (!activePowerUps["laser-blast"]) {
      isLaserActive = false;
      paddle.classList.remove("paddle-armed");
    }
  }
  if (primaryHackModeId === id) {
    primaryHackModeId = activeHackModes.size > 0 ? Array.from(activeHackModes).slice(-1)[0] : null;
  }
  // If we are on the pre-game/post-game screen and all hacks are now off, clear runUsedCheats for the next run
  if (gameOver && !isAnyHackCurrentlyArmed()) {
    runUsedCheats = false;
    runHackModesUsed.clear();
  }
  syncHackModeVisuals();
  updateHighScoreDisplay();
  updateStartLeaderboard();
  if (consoleModalEl && consoleModalEl.style.display === "flex") {
    renderCyberConsole();
  }
}

function deactivateAllHackModes() {
  Array.from(activeHackModes).forEach(id => deactivateHackMode(id));
  catModeArmed = false;
  isCatMode = false;
  if (gameOver) {
    runUsedCheats = false;
    runHackModesUsed.clear();
    activeLeaderboardTab = "legit";
  }
  syncHackModeVisuals();
  updateHighScoreDisplay();
  updateStartLeaderboard();
}

function applyArmedHackModesOnStart() {
  if (activeHackModes.has("cat")) {
    catModeArmed = true;
    isCatMode = true;
    catLives = 9;
    BALL_EMOJI = "🐱";
    ball.textContent = "🐱";
  }
  if (activeHackModes.has("god")) {
    if (typeof devSetScore === "function") devSetScore(999999);
    activePowerUps["slow-mo"] = Array(10).fill({ endTime: Date.now() + 999999 });
    createOrUpdateStatusIndicator("slow-mo");
    updateStatusIndicators();
    startGodMusic();
  }
  if (activeHackModes.has("juice")) {
    // Arm permanent Auto-Gatling lasers (NO sticky Mag-Lock or Slow-Mo!)
    isStickyPaddle = false;
    paddle.classList.remove("paddle-sticky");
    isLaserActive = true;
    paddle.classList.add("paddle-armed");
  }
  if (activeHackModes.has("poop")) {
    spawnPoopWave(16);
    ensurePoopRainInterval();
  }
  if (activeHackModes.has("party")) {
    spawnConfettiShards(120);
  }
  syncHackModeVisuals();
}

// ─── 1) Poop Storm (Upward Bounced Poops Smash Bricks + Bricks Erupt Poops!) ───
const POO_SIZE = 42;

function startPoopPhysicsLoop() {
  if (poopLoopRunning) return;
  const area = document.getElementById("game-area");
  if (!area) return;

  poopLoopRunning = true;
  let lastT = null;

  function step(t) {
    if (!lastT) lastT = t;
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;

    const padBox = paddle.getBoundingClientRect();
    const areaBox = area.getBoundingClientRect();
    const areaScale = areaBox.width / GAME_WIDTH || 1;
    const padLeft = (padBox.left - areaBox.left) / areaScale;
    const padTop = (padBox.top - areaBox.top) / areaScale;
    const padRight = (padBox.right - areaBox.left) / areaScale;

    for (let i = poopDrops.length - 1; i >= 0; i--) {
      const d = poopDrops[i];
      d.vy += GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // Wall bounce
      if (d.x <= 0 && d.vx < 0) {
        d.x = 0;
        d.vx *= -0.85;
      } else if (d.x + POO_SIZE >= GAME_WIDTH && d.vx > 0) {
        d.x = GAME_WIDTH - POO_SIZE;
        d.vx *= -0.85;
      }

      // Ceiling bounce
      if (d.y <= 0 && d.vy < 0) {
        d.y = 0;
        d.vy *= -0.65;
      }

      // Paddle bounce — launch high upward so it flies up into the brick grid!
      if (
        d.y + POO_SIZE >= padTop &&
        d.y < padTop + 22 &&
        d.x + POO_SIZE >= padLeft &&
        d.x <= padRight &&
        d.vy > 0
      ) {
        // Launch strongly upward toward the bricks!
        d.vy = -(530 + Math.random() * 140);
        const padCenter = (padLeft + padRight) / 2;
        const offsetFromCenter = (d.x + POO_SIZE / 2) - padCenter;
        d.vx = offsetFromCenter * 2.5 + (Math.random() - 0.5) * 110;
        d.y = padTop - POO_SIZE;
        d.canBreakBricks = true;
        d.el.style.filter = "drop-shadow(0 0 10px #ffaa00) drop-shadow(0 0 18px #ff5500)";

        soundManager.play("bounce", { pitch: 0.62 + Math.random() * 0.25, volume: 0.45 });
        if (gameRunning && !gameOver) {
          const pts = isCatMode ? 9 : 5;
          score += pts;
          if (isCatMode) score = score - (score % 10) + 9;
          scoreDisplay.textContent = `Score: ${score}`;
          showBrickScore(d.x + POO_SIZE / 2, padTop - 8, pts);
        }
      }

      // Brick collision: upward-bounced poops (or brick-spawned poops) smash bricks!
      if (d.canBreakBricks && gameRunning && !gameOver) {
        for (let bIdx = 0; bIdx < bricks.length; bIdx++) {
          const b = bricks[bIdx];
          if (b.isBroken) continue;

          if (
            d.x + POO_SIZE * 0.85 > b.x &&
            d.x + POO_SIZE * 0.15 < b.x + b.width &&
            d.y + POO_SIZE * 0.85 > b.y &&
            d.y + POO_SIZE * 0.15 < b.y + b.height
          ) {
            b.isBroken = true;
            b.element.classList.add("broken");

            const bx = b.x + b.width / 2;
            const by = b.y + b.height / 2;
            const randomDestroy = destroySounds[Math.floor(Math.random() * destroySounds.length)];
            soundManager.play(randomDestroy, { pitch: 0.85 + Math.random() * 0.3, volume: 0.6 });

            const brickPts = isCatMode ? 29 : 25;
            score += brickPts;
            if (isCatMode) score = score - (score % 10) + 9;
            scoreDisplay.textContent = `Score: ${score}`;
            showBrickScore(bx, b.y, brickPts);

            if (typeof b.row === "number" && !b.isExtraSpawn) {
              evaluateRowClear(b.row);
            }
            if (b.powerUpType) spawnPowerUp(b.powerUpType, b);

            // Deflect the poop and spawn 2 bonus poops flying out of the smashed brick!
            d.vy *= -0.7;
            d.vx += (Math.random() - 0.5) * 140;
            spawnBrickPoops(bx, by, 2);

            if (bricks.every(br => br.isBroken) && !gameOver) {
              endGame(true);
            }
            break;
          }
        }
      }

      if (d.y > GAME_HEIGHT + 50) {
        d.el.remove();
        poopDrops.splice(i, 1);
      } else {
        d.el.style.left = `${d.x}px`;
        d.el.style.top = `${d.y}px`;
      }
    }

    if (poopDrops.length > 0) {
      requestAnimationFrame(step);
    } else {
      poopLoopRunning = false;
    }
  }

  requestAnimationFrame(step);
}

function spawnBrickPoops(centerX, centerY, count = 2) {
  const area = document.getElementById("game-area");
  if (!area || poopDrops.length >= 42) return;

  for (let i = 0; i < count; i++) {
    if (poopDrops.length >= 42) break;
    const el = document.createElement("div");
    el.textContent = "💩";
    el.className = "poop-drop";
    el.style.position = "absolute";
    el.style.width = el.style.height = `${POO_SIZE}px`;
    const startX = Math.max(0, Math.min(GAME_WIDTH - POO_SIZE, centerX - POO_SIZE / 2));
    const startY = Math.max(0, centerY - POO_SIZE / 2);
    el.style.left = `${startX}px`;
    el.style.top = `${startY}px`;
    el.style.pointerEvents = "none";
    el.style.filter = "drop-shadow(0 0 8px #ffaa00)";
    area.appendChild(el);

    const spreadDir = i % 2 === 0 ? -1 : 1;
    poopDrops.push({
      el,
      x: startX,
      y: startY,
      vx: spreadDir * (75 + Math.random() * 135),
      vy: -(180 + Math.random() * 160),
      canBreakBricks: false // Becomes brick-breaking once bounced off the paddle!
    });
  }

  startPoopPhysicsLoop();
}

function spawnPoopWave(count = 24) {
  const area = document.getElementById("game-area");
  if (!area) return;

  for (let i = 0; i < count; i++) {
    if (poopDrops.length >= 42) break;
    const el = document.createElement("div");
    el.textContent = "💩";
    el.className = "poop-drop";
    el.style.position = "absolute";
    el.style.width = el.style.height = `${POO_SIZE}px`;

    const startX = Math.random() * (GAME_WIDTH - POO_SIZE);
    const startY = -POO_SIZE * (1 + Math.random() * 2.5);

    el.style.left = `${startX}px`;
    el.style.top = `${startY}px`;
    el.style.pointerEvents = "none";
    area.appendChild(el);

    poopDrops.push({
      el,
      x: startX,
      y: startY,
      vx: (Math.random() - 0.5) * 110,
      vy: 55 + Math.random() * 145,
      canBreakBricks: false
    });
  }

  startPoopPhysicsLoop();
}

function ensurePoopRainInterval() {
  if (poopRainInterval) clearInterval(poopRainInterval);
  poopRainInterval = setInterval(() => {
    if (!activeHackModes.has("poop")) {
      clearInterval(poopRainInterval);
      poopRainInterval = null;
      return;
    }
    if (gameRunning && !gameOver && poopDrops.length < 24) {
      spawnPoopWave(3);
    }
  }, 1800);
}

function poopStorm() {
  activateHackMode("poop");
  spawnPoopWave(22);
  ensurePoopRainInterval();
  console.log("💩 Poop Storm Active!");
}
window.poopStorm = poopStorm;

// ─── 2) Confetti Blast (Sparkler Field Mode!) ───
function spawnConfettiShards(count = 140) {
  for (let i = 0; i < count; i++) {
    const x = 60 + Math.random() * (GAME_WIDTH - 120);
    const y = 60 + Math.random() * (GAME_HEIGHT * 0.65);
    const ang = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * 380;
    const col = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
    emitSparkParticle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd - 60, col, 0.5 + Math.random() * 0.7, 2.2, i % 3 === 0 ? 1 : (i % 5 === 0 ? 2 : 0));
  }
  kickStandaloneSparkLoop();
}

function confettiBlast() {
  activateHackMode("party");
  spawnConfettiShards(180);
  console.log("🎉 Confetti Blast Sparkler Field Active!");
}
window.confettiBlast = confettiBlast;
window["🎉"] = confettiBlast;

// ─── 3) God Mode (Celestial Choir + Immortal Floor Shield + Sequential Chain Smite!) ───
function godMode() {
  activateHackMode("god");
  if (typeof devSetScore === "function") devSetScore(999999);
  activePowerUps["slow-mo"] = Array(10).fill({ endTime: Date.now() + 999999 });
  createOrUpdateStatusIndicator("slow-mo");
  updateStatusIndicators();
  startGodMusic();
  console.log("🎮 God Mode Active: Celestial Hymn + 4× Sequential Chain-Smite + Immortal Slow-Mo!");
}
window.godMode = godMode;
window["🎮"] = godMode;

// ─── 4) Cat Mode (9 Lives + Parabolic Leaping Arc + Real Cat Meow SFX + Scores End in 9!) ───
function catMode() {
  catModeArmed = true;
  isCatMode = true;
  catLives = 9;
  BALL_EMOJI = "🐱";
  ball.textContent = "🐱";
  window.BALL_EMOJI = "🐱";
  activateHackMode("cat");
  playCuteCatSound("destroy1", { volume: 1.0 });
  console.log("🐱 Cat Mode Active: 9 Lives + Parabolic Leaping Arc + Real Meow SFX + Permanent 9s!");
}
window.catMode = catMode;
window["🐱"] = catMode;

// ─── 5) Max Overdrive (1.6× Hyper-Speed + Cyber-Disco Lights + Full-Auto Gatling + Chain-Detonation Bricks!) ───
function maxOverdrive() {
  // Remove any conflicting slow-mo or sticky Mag-Lock so Overdrive feels fast & explosive!
  delete activePowerUps["slow-mo"];
  const staleSlow = document.getElementById("status-slow-mo");
  if (staleSlow) staleSlow.remove();
  delete activePowerUps["sticky-paddle"];
  const staleMag = document.getElementById("status-sticky-paddle");
  if (staleMag) staleMag.remove();
  isStickyPaddle = false;
  paddle.classList.remove("paddle-sticky");
  if (ballIsStuck && gameRunning && !gameOver) {
    launchStuckBall();
  }

  isLaserActive = true;
  paddle.classList.add("paddle-armed");
  activateHackMode("juice");
  soundManager.play("laserFire", { pitch: 1.35 });
  console.log("⚡ Max Overdrive Active: 1.6× Hyper-Speed + Cyber-Disco Lights + Full-Auto Gatling + Explosive Chain Bricks!");
}
window.maxOverdrive = maxOverdrive;

// ─── Global Keyboard Shortcuts for Arcade Guide & Console ───
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
  if (e.key.toLowerCase() === "g") {
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
    name: "CAT MODE",
    cmd: "catMode()",
    aliases: ["cat", "catmode", "catmode()", "9", "meow", "🐱"],
    desc: "🐾 9 Lives + parabolic leaping arcs & wall-jumps + real cat meow SFX + scores end in 9!",
    unlocked: false,
    run: () => {
      catMode();
      return "CAT MODE ACTIVE // 9 LIVES + LEAPING ARCS + REAL MEOW SFX";
    }
  },
  {
    id: "poop",
    emoji: "💩",
    name: "POOP STORM",
    cmd: "poopStorm()",
    aliases: ["poop", "poopstorm", "poopstorm()", "poo", "storm", "💩"],
    desc: "Bounce 💩 off your paddle to smash bricks overhead — broken bricks erupt more 💩!",
    unlocked: false,
    run: () => {
      poopStorm();
      return "POOP STORM DEPLOYED // BOUNCE 💩 UP INTO BRICKS TO SMASH THEM!";
    }
  },
  {
    id: "party",
    emoji: "🎉",
    name: "CONFETTI BLAST",
    cmd: "confettiBlast()",
    aliases: ["party", "confetti", "confettiblast", "confettiblast()", "🎉"],
    desc: "Chaotic sparkler field! Every wall, paddle & brick hit erupts in sparklers!",
    unlocked: false,
    run: () => {
      confettiBlast();
      soundManager.play("winSong");
      return "CONFETTI BLAST ACTIVE // SPARKLER FIELD ERUPTS ON EVERY HIT";
    }
  },
  {
    id: "god",
    emoji: "🎮",
    name: "GOD MODE",
    cmd: "godMode()",
    aliases: ["god", "godmode", "godmode()", "overclock", "🎮"],
    desc: "4× Sequential Chain-Smite lightning barrage on paddle hit + Celestial Hymn + Immortal!",
    unlocked: false,
    run: () => {
      godMode();
      return "GOD MODE ACTIVE // 4× SEQUENTIAL CHAIN-SMITE + CELESTIAL HYMN";
    }
  },
  {
    id: "juice",
    emoji: "⚡",
    name: "MAX OVERDRIVE",
    cmd: "maxOverdrive()",
    aliases: ["juice", "overdrive", "maxoverdrive", "maxoverdrive()", "max", "⚡"],
    desc: "1.6× Hyper-Speed + Cyber-Disco strobe lights + Full-Auto Gatling + Chain-Blast bricks!",
    unlocked: false,
    run: () => {
      maxOverdrive();
      return "MAX OVERDRIVE ARMED // 1.6× TURBO + CYBER-DISCO + CHAIN BLASTS";
    }
  }
];

let targetedDaemonId = "cat";
let breachSequence = ["E9", "7A", "FF"];
let breachGridBytes = [];
let breachStep = 0;
let consoleLogs = [
  { text: "BLACKWALL DECK-OS v2.4 // CONNECTED TO NEON-CORP MAINFRAME", type: "ok" },
  { text: "BREACH ANY MODE BELOW TO UNLOCK & DEPLOY IT IMMEDIATELY!", type: "warn" },
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
    const isActive = activeHackModes.has(d.id);
    const cardClasses = ["daemon-card"];
    if (d.unlocked) cardClasses.push("unlocked");
    if (isActive) cardClasses.push("active-mode");
    if (isTargeted) cardClasses.push("targeted");

    const cmdPill = isActive
      ? `<span class="daemon-cmd-pill" style="color:#00ff88;">🟢 ACTIVE IN ARENA</span>`
      : (d.unlocked
        ? `<span class="daemon-cmd-pill">${d.cmd}</span>`
        : `<span class="daemon-cmd-pill">🔒 ICE-ENCRYPTED</span>`);

    const btnLabel = isActive
      ? "🟢 ACTIVE [RE-FIRE]"
      : (d.unlocked ? "▶ ACTIVATE" : (isTargeted ? "🎯 BREACHING..." : "🔒 TARGET ICE"));

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
            <span>🔓 HACK MODES (${DAEMONS.filter(d => d.unlocked).length}/${DAEMONS.length} UNLOCKED)</span>
            <span>BREACH TO AUTO-DEPLOY</span>
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
          // Sequence cracked! Unlock AND immediately deploy the breached mode!
          const toUnlock = DAEMONS.find(d => d.id === targetedDaemonId && !d.unlocked) || getNextLockedDaemon() || targetDaemon;
          soundManager.play("powerUpSpawn", { pitch: 1.9, volume: 0.65 });
          generateBreachPuzzle();
          if (toUnlock) {
            toUnlock.unlocked = true;
            const nextLocked = getNextLockedDaemon();
            if (nextLocked) targetedDaemonId = nextLocked.id;
            addConsoleLog(`ICE BREACHED! Deploying [${toUnlock.emoji} ${toUnlock.name}] into arena...`, "ok");
            executeDaemon(toUnlock);
          } else {
            confettiBlast();
            setTimeout(renderCyberConsole, 140);
          }
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
        addConsoleLog(`TARGET LOCKED: [${daemon.emoji} ${daemon.name}] — Match the 3-byte hex signature to breach & deploy!`, "warn");
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
  // Close modal smoothly after a brief beat so the player sees the frame, lighting, HUD & jumbotron in the arena!
  setTimeout(() => {
    toggleCyberConsole(false);
  }, 460);
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
