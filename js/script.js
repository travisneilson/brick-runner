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
  pop.textContent = `+${Number(pts).toLocaleString("en-US")}`;
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
const VOLUME_STORAGE_KEY = "brickRunnerMasterVolume_v1";
const MUTE_STORAGE_KEY   = "brickRunnerMuted_v1";

const soundManager = {
    context: null,
    masterGain: null,
    masterVolume: 0.75,
    isMuted: false,
    sounds: {},
    nowPlaying: {},
    loadSettings() {
        try {
            const savedVol = localStorage.getItem(VOLUME_STORAGE_KEY);
            if (savedVol !== null) {
                const parsed = parseFloat(savedVol);
                if (!Number.isNaN(parsed)) {
                    this.masterVolume = Math.max(0, Math.min(1, parsed));
                }
            }
            const savedMute = localStorage.getItem(MUTE_STORAGE_KEY);
            if (savedMute !== null) {
                this.isMuted = savedMute === "1" || savedMute === "true";
            }
        } catch (err) {
            // Ignore storage errors in sandboxed iframes
        }
    },
    saveSettings() {
        try {
            localStorage.setItem(VOLUME_STORAGE_KEY, String(this.masterVolume));
            localStorage.setItem(MUTE_STORAGE_KEY, this.isMuted ? "1" : "0");
        } catch (err) {
            // Ignore storage errors
        }
    },
    init() {
        this.loadSettings();
        if (this.context) {
            this.applyMasterGain();
            return;
        }
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);
        this.applyMasterGain();
    },
    getDestination() {
        if (!this.context) this.init();
        return this.masterGain || this.context.destination;
    },
    applyMasterGain() {
        if (!this.masterGain || !this.context) return;
        const effective = this.isMuted ? 0 : this.masterVolume;
        this.masterGain.gain.setValueAtTime(effective, this.context.currentTime);
    },
    setVolume(vol) {
        this.masterVolume = Math.max(0, Math.min(1, Number(vol) || 0));
        if (this.masterVolume > 0 && this.isMuted) {
            this.isMuted = false;
        }
        if (this.masterVolume === 0) {
            this.isMuted = true;
        }
        this.saveSettings();
        this.applyMasterGain();
        syncVolumeControlUI();
    },
    toggleMute() {
        this.isMuted = !this.isMuted;
        if (!this.isMuted && this.masterVolume === 0) {
            this.masterVolume = 0.5;
        }
        this.saveSettings();
        this.applyMasterGain();
        syncVolumeControlUI();
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
        if (this.isMuted) return;
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
        source.connect(gainNode).connect(this.getDestination());
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

function syncVolumeControlUI() {
    const muteBtn = document.getElementById("volume-mute-btn");
    const downBtn = document.getElementById("volume-down-btn");
    const upBtn = document.getElementById("volume-up-btn");
    const pctLabel = document.getElementById("volume-pct-label");
    const widget = document.getElementById("volume-control-widget");
    const effective = soundManager.isMuted ? 0 : soundManager.masterVolume;
    const pct = Math.round(effective * 100);

    if (widget) {
        widget.classList.toggle("is-muted", soundManager.isMuted || pct === 0);
    }
    if (muteBtn) {
        if (soundManager.isMuted || pct === 0) {
            muteBtn.textContent = "🔇";
        } else if (pct <= 35) {
            muteBtn.textContent = "🔈";
        } else if (pct <= 75) {
            muteBtn.textContent = "🔉";
        } else {
            muteBtn.textContent = "🔊";
        }
    }
    if (downBtn) {
        downBtn.disabled = soundManager.isMuted || pct === 0;
    }
    if (upBtn) {
        upBtn.disabled = !soundManager.isMuted && pct >= 100;
    }
    if (pctLabel) {
        pctLabel.textContent = (soundManager.isMuted || pct === 0) ? "MUTE" : `${pct}%`;
    }
    document.querySelectorAll(".vol-bar-btn").forEach(btn => {
        const barVol = parseFloat(btn.dataset.vol || btn.dataset.volStep || "0");
        const isActive = !soundManager.isMuted && effective >= barVol - 0.05;
        btn.classList.toggle("active", isActive);
    });
}

// --- Game State Variables ---
let score = 0, gameOver = true, gameRunning = false, animationFrameId, emojiSwapTimeout = null, powerUps = [], activePowerUps = {}, paddleSizeLevel = 0, MAX_PADDLE_LEVEL = 3, isStickyPaddle = false, ballIsStuck = false, isLaserActive = false, canFire = true, lasers = [], assetsReady = !1, isRoofBonusActive = false, isNeonLegend = false, autoLaunchTimeout = null, emojiCycleInterval = null;
let lives = 1;
let prevPaddleX = 0;
let paddleVelocityX = 0;
let magSlingshotCharges = 0;
let caughtByMagLock = false;
let laserAutoFireAccum = 0;
let unbrokenBrickStreak = 0;
let catBounceCombo = 0;
let highRollerDiceMultiplier = 1.10;
let highRollerLastRoll = null;
let highRollerBustShrink = false;
let highRollerBankCurveActive = false;
let highRollerMayhemCounter = 0;
let guardianAegisBeamCounter = 0;
let demolisherNovaArmed = false;
let totalBricksBrokenInRun = 0;
let isLevelIntermissionOpen = false;
let frenzyMeter = 0;
let frenzyReady = false;
let frenzyTimerLeft = 0;
let frenzyMaxDuration = 2.0;
let rallyBounceCount = 0;
let runUnbankedCreds = 0;
let lastRunRawScoreBeforePenalty = 0;
let lastRunPenaltyAmount = 0;
let lastRunCredsEarned = 0;
let lastRunCredsLost = 0;
let activeBreachContracts = [];
let currentContractOffers = [];

const POWER_UP_TYPES = {
  'wide-paddle': {
    type:        'stacking',
    emoji:       '🪴',
    name:        'EXPANDO',
    description: '+35% Paddle & ×2/×3/×4 PTS!',
    cssClass:    'wide-paddle',
    duration:    15000
  },
  'slow-mo': {
    type:        'stacking',
    emoji:       '🐌',
    name:        'SLOW-MO',
    description: 'Bullet-Time & ×1.5–×2.0 PTS!',
    cssClass:    'slow-mo',
    duration:    5500
  },
  'sticky-paddle': {
    type:        'refreshing',
    emoji:       '🧲',
    name:        'MAG-LOCK',
    description: 'Flick-Aim & ×1.5 Slingshot PTS',
    cssClass:    'sticky-paddle',
    duration:    5000
  },
  'laser-blast': {
    type:        'stacking',
    emoji:       '🎯',
    name:        'LASER BLAST',
    description: 'Auto-Fire Tiers 1–3 & ×1.25–×2 PTS!',
    cssClass:    'laser-blast',
    duration:    6500
  },
  'one-up': {
    type:        'instant',
    emoji:       '🧱',
    name:        'Bricked Up!',
    description: '+150×LVL PTS & Grid Refill!',
    cssClass:    'one-up'
  }
};

const POWER_UP_SPAWN_CHANCES = ['wide-paddle', 'wide-paddle', 'slow-mo', 'slow-mo', 'sticky-paddle', 'one-up'];
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
        item.score >= 950000;

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
    if (storedHigh >= 950000) {
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
  const classDef = typeof getSelectedClassDef === "function" ? getSelectedClassDef() : { id: "striker", emoji: "⚡", name: "STRIKER" };
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    initials: cleanInitials,
    score: newScore,
    rating: getRating(newScore, won),
    won: !!won,
    sector: typeof currentSector === "number" ? currentSector : 1,
    level: typeof rogueLevel === "number" ? rogueLevel : 1,
    classId: classDef.id,
    classEmoji: classDef.emoji,
    className: classDef.name,
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
  if (!isHackedTab && hacksArmedNow) {
    statusStripHTML = `
      <div class="leaderboard-mode-strip warn-strip">
        <span>💻 HACKS ACTIVE (${armedHacks.join("")}) • SAVES TO HACKED TOP 5</span>
        <button type="button" class="lb-disable-hacks-btn" data-clear-hacks="1">TURN OFF</button>
      </div>
    `;
  } else {
    statusStripHTML = `
      <div class="leaderboard-col-headers">
        <span>RANK</span>
        <span>RUNNER // ARCHIVE &amp; BUILD</span>
        <span class="lb-col-right">SCORE &amp; RATING</span>
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
      const classEmoji = item.classEmoji || "⚡";
      const sectorLvlTag = (item.sector || item.level)
        ? `<span class="lb-sector-pill" title="Tier L${item.level || 1} • Stage ${item.sector || 1}">${classEmoji} L${item.level || 1}${item.sector > 1 ? `•STG${item.sector}` : ""}</span>`
        : "";
      const hackIcons = isHackedTab
        ? `<span class="lb-hack-badges" title="Hack Modes Used">${(Array.isArray(item.hacks) && item.hacks.length > 0 ? item.hacks : ["💻"]).join("")}</span>`
        : sectorLvlTag;

      const lore = typeof getCallsignLore === "function" ? getCallsignLore(item.initials) : null;
      const loreSub = lore
        ? `${lore.title} <span class="lb-lore-origin">• ${lore.origin}</span>`
        : `Registered Cyber-Runner // Stage ${item.sector || 1}`;

      slots.push(`
        <div class="${classes.join(" ")}">
          <span class="lb-pos">${posBadge}</span>
          <div class="lb-runner-col">
            <div class="lb-initials-wrap">
              <span class="lb-initials">${item.initials}</span>
              ${hackIcons}
            </div>
            <div class="lb-runner-lore">${loreSub}</div>
          </div>
          <div class="lb-score-col">
            <span class="lb-score">${formatArcadeScore(item.score)}</span>
            <span class="lb-tier">${item.rating || getRating(item.score, item.won)}</span>
          </div>
        </div>
      `);
    } else {
      slots.push(`
        <div class="leaderboard-row empty-slot">
          <span class="lb-pos">#${idx + 1}</span>
          <div class="lb-runner-col">
            <div class="lb-initials-wrap"><span class="lb-initials">---</span></div>
            <div class="lb-runner-lore">Awaiting Challenger Record</div>
          </div>
          <div class="lb-score-col">
            <span class="lb-score">---</span>
            <span class="lb-tier">${isHackedTab ? "OPEN HACK SLOT" : "OPEN SLOT"}</span>
          </div>
        </div>
      `);
    }
  }

  return `
    <div class="leaderboard-tabs" role="tablist">
      <button type="button" class="lb-tab ${!isHackedTab ? "active-legit" : ""}" data-lb-tab="legit">
        <span>🏆 TOP 5 RUNNERS</span> <span class="lb-tab-count">${legitCount}</span>
      </button>
      <button type="button" class="lb-tab ${isHackedTab ? "active-hacked" : ""}" data-lb-tab="hacked">
        <span>💻 HACKED TOP 5</span> <span class="lb-tab-count">${hackedCount}</span>
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

// --- Pre-Game Sci-Fi & Cyberpunk Callsign Database & Runner Class Selector ---
const CALLSIGN_LORE_DB = {
  NEO: { title: "Thomas 'Neo' Anderson", origin: "The Matrix (1999)" },
  TRN: { title: "Tron // Security Program", origin: "TRON (1982)" },
  FLY: { title: "Kevin Flynn // Grid Creator", origin: "TRON: Legacy" },
  CLU: { title: "Codified Likeness Utility", origin: "TRON (1982)" },
  QRA: { title: "Quorra // Last ISO", origin: "TRON: Legacy" },
  KUS: { title: "Major Motoko Kusanagi", origin: "Ghost in the Shell" },
  BAT: { title: "Batou // Section 9 Ranger", origin: "Ghost in the Shell" },
  ROY: { title: "Roy Batty // Nexus-6", origin: "Blade Runner (1982)" },
  DEK: { title: "Rick Deckard // Blade Runner", origin: "Blade Runner" },
  RCH: { title: "Rachael // Tyrell Replicant", origin: "Blade Runner" },
  JOI: { title: "Joi // Wallace Holo-AI", origin: "Blade Runner 2049" },
  KND: { title: "Shotaro Kaneda // Capsule Gang", origin: "Akira (1988)" },
  TET: { title: "Tetsuo Shima // Esper #41", origin: "Akira (1988)" },
  AKR: { title: "Subject Akira // Neo-Tokyo", origin: "Akira (1988)" },
  CAS: { title: "Henry Dorsett Case // Cowboy", origin: "Neuromancer" },
  MOL: { title: "Molly Millions // Street Samurai", origin: "Neuromancer" },
  WNT: { title: "Wintermute // Tessier-Ashpool AI", origin: "Neuromancer" },
  HRO: { title: "Hiro Protagonist // Deliverator", origin: "Snow Crash" },
  YTK: { title: "Y.T. // Kourier Thrasher", origin: "Snow Crash" },
  LUC: { title: "Lucy Kushinada // Netrunner", origin: "Cyberpunk: Edgerunners" },
  DAV: { title: "David Martinez // Sandevistan", origin: "Cyberpunk: Edgerunners" },
  REB: { title: "Rebecca // Edgerunner Solo", origin: "Cyberpunk: Edgerunners" },
  SLV: { title: "Johnny Silverhand // Rockerboy", origin: "Cyberpunk 2077" },
  ALT: { title: "Alt Cunningham // Soulkiller", origin: "Cyberpunk 2077" },
  VEX: { title: "V // Night City Mercenary", origin: "Cyberpunk 2077" },
  HAL: { title: "HAL 9000 // Heuristically Programmed", origin: "2001: A Space Odyssey" },
  RPL: { title: "Ellen Ripley // Warrant Officer", origin: "Alien (1979)" },
  ash: { title: "Ash // Hyperdyne 120-A/2", origin: "Alien (1979)" },
  BSH: { title: "Bishop // Lance Corporal Synth", origin: "Aliens (1986)" },
  HUD: { title: "Private Hudson // Colonial Marines", origin: "Aliens (1986)" },
  MUR: { title: "Alex Murphy // OCP Cyborg", origin: "RoboCop (1987)" },
  EDX: { title: "ED-209 // Enforcement Droid", origin: "RoboCop (1987)" },
  T80: { title: "T-800 // Cyberdyne Model 101", origin: "The Terminator" },
  SKY: { title: "Skynet // Strategic Defense AI", origin: "Terminator 2" },
  SAR: { title: "Sarah Connor // Resistance", origin: "Terminator 2" },
  SPK: { title: "Spike Spiegel // Bebop Hunter", origin: "Cowboy Bebop" },
  FAY: { title: "Faye Valentine // Red Tail", origin: "Cowboy Bebop" },
  JET: { title: "Jet Black // Hammerhead", origin: "Cowboy Bebop" },
  EDW: { title: "Radical Edward // Net Diver", origin: "Cowboy Bebop" },
  EVA: { title: "Evangelion Unit-01", origin: "Neon Genesis Evangelion" },
  REI: { title: "Rei Ayanami // First Child", origin: "Neon Genesis Evangelion" },
  ASK: { title: "Asuka Langley // Unit-02", origin: "Neon Genesis Evangelion" },
  ATR: { title: "Paul 'Muad'Dib' Atreides", origin: "Dune" },
  CHA: { title: "Chani // Fremen Fedaykin", origin: "Dune" },
  SHD: { title: "SHODAN // Citadel Station AI", origin: "System Shock" },
  GLD: { title: "GLaDOS // Genetic Lifeform OS", origin: "Portal" },
  CHL: { title: "Chell // Aperture Test Subject", origin: "Portal" },
  FRE: { title: "Gordon Freeman // Black Mesa", origin: "Half-Life" },
  ALX: { title: "Alyx Vance // Resistance Hacker", origin: "Half-Life 2" },
  JCX: { title: "JC Denton // UNATCO Nano-Agent", origin: "Deus Ex" },
  JNS: { title: "Adam Jensen // Sarif Security", origin: "Deus Ex: Human Revolution" },
  SAM: { title: "Samus Aran // Galactic Hunter", origin: "Metroid" },
  260: { title: "VCS 2600 // Heavy Sixer", origin: "Atari (1977)" },
  FOX: { title: "Fox McCloud // Arwing Ace", origin: "Star Fox" },
  FAL: { title: "Falco Lombardi // Wingman", origin: "Star Fox" },
  CHF: { title: "Master Chief // Spartan-117", origin: "Halo" },
  CRT: { title: "Cortana // UNSC Smart AI", origin: "Halo" },
  SHP: { title: "Commander Shepard // N7", origin: "Mass Effect" },
  GAR: { title: "Garrus Vakarian // Archangel", origin: "Mass Effect" },
  LIA: { title: "Liara T'Soni // Shadow Broker", origin: "Mass Effect" },
  KOR: { title: "Korben Dallas // Multipass", origin: "The Fifth Element" },
  LOU: { title: "Leeloo // Supreme Being", origin: "The Fifth Element" },
  ZRG: { title: "Jean-Baptiste Emanuel Zorg", origin: "The Fifth Element" },
  PAR: { title: "Parzival // Wade Watts", origin: "Ready Player One" },
  ART: { title: "Art3mis // Samantha Cook", origin: "Ready Player One" },
  ach: { title: "Aech // Helen Harris", origin: "Ready Player One" },
  SOL: { title: "Sol // Solar Sailor Program", origin: "TRON (1982)" },
  HAN: { title: "Han Solo // Millennium Falcon", origin: "Star Wars" },
  LEI: { title: "General Leia Organa", origin: "Star Wars" },
  LUK: { title: "Luke Skywalker // Red Five", origin: "Star Wars" },
  VDR: { title: "Darth Vader // Dark Lord", origin: "Star Wars" },
  BOB: { title: "Boba Fett // Slave I", origin: "Star Wars" },
  MND: { title: "Din Djarin // The Mandalorian", origin: "The Mandalorian" },
  ahs: { title: "Ahsoka Tano // Fulcrum", origin: "Star Wars" },
  AND: { title: "Cassian Andor // Rebel Spy", origin: "Andor" },
  K2S: { title: "K-2SO // Reprogrammed Droid", origin: "Rogue One" },
  SPK: { title: "Commander Spock // USS Enterprise", origin: "Star Trek" },
  KRK: { title: "Capt. James T. Kirk", origin: "Star Trek" },
  PIC: { title: "Capt. Jean-Luc Picard", origin: "Star Trek: TNG" },
  DAT: { title: "Lt. Cmdr. Data // Positronic", origin: "Star Trek: TNG" },
  SEV: { title: "Seven of Nine // Borg Adjunct", origin: "Star Trek: Voyager" },
  DRW: { title: "The Doctor // TARDIS", origin: "Doctor Who" },
  MAL: { title: "Capt. Malcolm Reynolds", origin: "Firefly / Serenity" },
  RVR: { title: "River Tam // Miranda Subject", origin: "Firefly / Serenity" },
  STR: { title: "Starbuck // Kara Thrace", origin: "Battlestar Galactica" },
  ADM: { title: "Admiral William Adama", origin: "Battlestar Galactica" },
  CYL: { title: "Cylon Centurion // Raider", origin: "Battlestar Galactica" },
  HLD: { title: "James Holden // Rocinante", origin: "The Expanse" },
  AMO: { title: "Amos Burton // Mechanic", origin: "The Expanse" },
  AVS: { title: "Chrisjen Avasarala // UN", origin: "The Expanse" },
  POE: { title: "Poe // Hendrix Hotel AI", origin: "Altered Carbon" },
  KOV: { title: "Takeshi Kovacs // Last Envoy", origin: "Altered Carbon" },
  MAE: { title: "Maeve Millay // Delos Host", origin: "Westworld" },
  DOL: { title: "Dolores Abernathy // Wyatt", origin: "Westworld" },
   Ava: { title: "Ava // Turing Test Android", origin: "Ex Machina" },
  SAM: { title: "Samantha // OS1 Consciousness", origin: "Her (2013)" },
  MAX: { title: "Max Rockatansky // Road Warrior", origin: "Mad Max" },
  FUR: { title: "Imperator Furiosa // War Rig", origin: "Mad Max: Fury Road" },
  DRD: { title: "Judge Joseph Dredd // Mega-City", origin: "Judge Dredd" },
  SNK: { title: "Snake Plissken // Escape NY", origin: "Escape from New York" },
  QAD: { title: "Douglas Quaid // Rekall Agent", origin: "Total Recall" },
   END: { title: "Ender Wiggin // Dragon Army", origin: "Ender's Game" },
   Cooper: { title: "Joseph Cooper // Lazarus", origin: "Interstellar" },
  TAR: { title: "TARS // USMC Tactical Robot", origin: "Interstellar" },
  WLE: { title: "WALL-E // Waste Allocation", origin: "WALL-E" },
  EVE: { title: "EVE // Extraterrestrial Probe", origin: "WALL-E" },
  B79: { title: "Unit 79 // Cybernetic Scout", origin: "Neon Grid Lore" },
  NYX: { title: "Nyx // Blackwall Shadow", origin: "Neon Grid Lore" },
  SYN: { title: "Synth-Zero // Chrome Runner", origin: "Neon Grid Lore" },
  HEX: { title: "Hexadecimal // Virus Queen", origin: "ReBoot (1994)" },
  BOB: { title: "Guardian Bob // Glitch Tool", origin: "ReBoot (1994)" },
  ZAP: { title: "Zapp Brannigan // Nimbus", origin: "Futurama" },
  FRY: { title: "Philip J. Fry // Delivery Boy", origin: "Futurama" },
  BND: { title: "Bender Bending Rodriguez", origin: "Futurama" },
  LAA: { title: "Turanga Leela // Planet Express", origin: "Futurama" },
  RCK: { title: "Rick Sanchez // C-137", origin: "Rick and Morty" },
  cat: { title: "Stray Cyber-Cat // B-12 Drone", origin: "Stray (2022)" },
  KAI: { title: "Kai // Last Brunnen-G", origin: "Lexx" },
  ZEN: { title: "Zen // Liberator Master AI", origin: "Blake's 7" }
};

// Normalize all keys in CALLSIGN_LORE_DB to 3-letter uppercase A-Z codes
const NORMALIZED_LORE_DB = {};
Object.entries(CALLSIGN_LORE_DB).forEach(([rawKey, val]) => {
  const code = rawKey.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  if (code.length === 3 && !NORMALIZED_LORE_DB[code]) {
    NORMALIZED_LORE_DB[code] = val;
  }
});

const CALLSIGN_PRESETS = Object.keys(NORMALIZED_LORE_DB);
const KEYPAD_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
let activeCallsignSlot = 0;
let selectedRunnerClass = "striker";

const MAX_LEVELS = 5;
window.MAX_LEVELS = MAX_LEVELS;

const RUNNER_CLASSES = {
  striker: {
    id: "striker",
    emoji: "⚡",
    name: "STRIKER",
    color: "#00ffff",
    tagline: "Tesla Arcs & Rail Bolts",
    paddleStyleName: "Twin-Coil Cyan Rail Deck",
    shortBuff: "Tesla Arcs + Center Rail Bolts",
    shortHandicap: "-12% Width • +10% Ball Speed",
    buff: "Every bounce zaps bricks with Cyan Tesla Lightning + Center Sweet-Spot fires Twin Rail Bolts + ×1.12–×1.40 Velocity Streak!",
    handicap: "-12% Narrower Precision Paddle & +10% Faster Ball",
    tiers: [
      {
        level: 1,
        label: "Tesla Arc I",
        short: "Every bounce zaps 1 brick",
        detail: "Every paddle bounce fires 1 homing chain-lightning bolt into the nearest brick (+10 base PTS) + builds Velocity Streak (up to ×1.40 PTS)!",
        augments: { tesla: 1 }
      },
      {
        level: 2,
        label: "Sweet-Spot Rail I",
        short: "Center bounce fires Twin Rail Bolts",
        detail: "Catching the ball on the center of your paddle fires Twin Cyan Rail Bolts straight up (+8 base PTS/hit)!",
        augments: { tesla: 1, turret: 1 }
      },
      {
        level: 3,
        label: "Tesla Arc II",
        short: "Every bounce zaps 2 bricks",
        detail: "Upgrades every paddle bounce discharge to 2 simultaneous homing lightning bolts!",
        augments: { tesla: 2, turret: 1 }
      },
      {
        level: 4,
        label: "Rail Barrage II",
        short: "Every bounce fires Twin Rail Bolts",
        detail: "Every paddle bounce now launches Twin Cyan Rail Bolts alongside your 2× Homing Tesla Arcs!",
        augments: { tesla: 2, turret: 2 }
      },
      {
        level: 5,
        label: "Storm Core MAX",
        short: "3× Tesla Arcs + Overcharged Rails",
        detail: "MAX OVERLOAD: Every paddle bounce zaps 3 bricks with Homing Tesla Lightning AND fires Overcharged Twin Rail Bolts!",
        augments: { tesla: 3, turret: 3 }
      }
    ]
  },
  guardian: {
    id: "guardian",
    emoji: "🛡️",
    name: "GUARDIAN",
    color: "#39ff14",
    tagline: "Mortar, Parry & Aegis Shield",
    paddleStyleName: "Armored Emerald Bastion Deck",
    shortBuff: "+22% Width + Mortar & Parry",
    shortHandicap: "-10% Slower Ball Velocity",
    buff: "Every bounce fires Emerald Mortar Bolts! Center Sweet-Spot catches trigger a PERFECT PARRY (2× Armor Dmg + Emerald Splash) + ×1.20–×1.40 Fortress Intact PTS!",
    handicap: "-10% Slower Ball Velocity (Fortress Bonus pauses while shield recharges)",
    tiers: [
      {
        level: 1,
        label: "Bastion Mortar I",
        short: "+22% paddle + Mortar & Perfect Parry!",
        detail: "Widens paddle +22% (×1.20 PTS) AND every paddle bounce fires an Emerald Mortar Bolt! Catching the ball on the center Sweet-Spot triggers a 🛡️ PERFECT PARRY (2× Armor Dmg & Splash Ring)!",
        augments: { titan: 1 }
      },
      {
        level: 2,
        label: "Aegis Shield I",
        short: "Floor shield + Counter-Zap Save",
        detail: "Deploys a bottom Floor Forcefield (16s recharge, ×1.30 PTS while charged) that rebounds missed balls and Counter-Zaps 2 bricks!",
        augments: { titan: 1, aegis: 1 }
      },
      {
        level: 3,
        label: "Twin Bastion II",
        short: "+44% paddle + Twin Mortar Volley!",
        detail: "Expands armored bastion deck to +44% width and upgrades every paddle bounce to fire Twin Emerald Mortar Bolts (with a wider Perfect Parry Sweet-Spot)!",
        augments: { titan: 2, aegis: 1 }
      },
      {
        level: 4,
        label: "Aegis Beam II",
        short: "10s shield + Parry fires Homing Beam",
        detail: "Cuts Aegis Floor Forcefield recharge to 10s (×1.35 PTS) AND every Perfect Parry fires a Homing Emerald Aegis Beam from the floor shield!",
        augments: { titan: 2, aegis: 2 }
      },
      {
        level: 5,
        label: "Citadel Overlord MAX",
        short: "+66% deck + 3× Mortar + Shockwave Parry!",
        detail: "CITADEL OVERLORD: +66% colossal paddle, 7s Aegis recharge (×1.40 PTS), 3-Bolt Bastion Mortar Volley on every bounce, and Perfect Parries unleash a huge Emerald Shockwave + Homing Aegis Beam!",
        augments: { titan: 3, aegis: 3 }
      }
    ]
  },
  demolisher: {
    id: "demolisher",
    emoji: "💥",
    name: "DEMOLISHER",
    color: "#ff7b00",
    tagline: "Siege Pierce & Plasma Nova",
    paddleStyleName: "Hazard-Orange Siege Ram",
    shortBuff: "2× Armor Pierce + Plasma Nova",
    shortHandicap: "-15% Timed Power-Up Duration",
    buff: "Every bounce primes Piercing Siege Charges (2× Armor Dmg) & arms a Plasma Nova detonation on the next brick hit! (×1.15–×1.25 Base + ×1.35 Armored/Vault PTS)",
    handicap: "-15% Shorter Timed Power-Up Durations",
    tiers: [
      {
        level: 1,
        label: "Armor Pierce I",
        short: "Bounce charges 1× Siege Pierce (2× Dmg)",
        detail: "Paddle & ceiling bounces supercharge the ball to deal 2× armor damage and plow straight through 1 brick (+14 Pierce PTS)!",
        augments: { pierce: 1 }
      },
      {
        level: 2,
        label: "Plasma Nova I",
        short: "Bounce arms a Plasma Nova on next hit",
        detail: "Every paddle bounce arms a Plasma Nova charge on the ball — the first brick you hit detonates an orange Plasma Ring blasting adjacent bricks!",
        augments: { pierce: 1, nova: 1 }
      },
      {
        level: 3,
        label: "Armor Pierce II",
        short: "Bounce charges 2× Siege Pierce",
        detail: "Upgrades supercharged ball to plow straight through 2 consecutive bricks without deflecting!",
        augments: { pierce: 2, nova: 1 }
      },
      {
        level: 4,
        label: "Plasma Nova II",
        short: "Wider 150px Bounce-Primed Nova Ring",
        detail: "Expands your bounce-primed Plasma Nova shockwave blast radius to 150px!",
        augments: { pierce: 2, nova: 2 }
      },
      {
        level: 5,
        label: "Supernova MAX",
        short: "Pierces 3 bricks + Huge Supernova Ring",
        detail: "MAX CATACLYSM: Every paddle bounce charges 3× Piercing Hits AND primes a colossal 180px Supernova explosion!",
        augments: { pierce: 3, nova: 3 }
      }
    ]
  },
  highroller: {
    id: "highroller",
    emoji: "🎲",
    name: "HIGH-ROLLER",
    color: "#ffd700",
    tagline: "1D6 Chaos Dice & Piñata Bricks",
    paddleStyleName: "Gold Casino Marquee Deck",
    shortBuff: "1D6 Chaos Die + Piñata Bricks",
    shortHandicap: "Roll [1]: -20% Width & ×0.75",
    buff: "Every bounce rolls 1D6 Gameplay Chaos (Ricochet Sparks, Pierce, Piñata Bricks & +45% Frenzy Jackpots) + Wild Card Power-Up Roulette!",
    handicap: "Snake Eyes Bust (Roll 1): -20% Paddle Shrink, ×0.75 PTS & Joker Brick Curses",
    tiers: [
      {
        level: 1,
        label: "Mystery Die I",
        short: "1D6 bounce: Sparks, Pierce or Bust",
        detail: "Every paddle bounce rolls 1D6 Gameplay Chaos: [1] Snake Eyes Bust (-20% paddle & ×0.75 PTS), [2–3] Bank Curve (+6 bank PTS & ×1.08), [4–5] Ricochet Spark Bolt (×1.18), [6] Hot Hand (1 Pierce + ×1.30 PTS + +35% Frenzy Charge)!",
        augments: { magnet: 1, greed: 1 }
      },
      {
        level: 2,
        label: "Wild Card Roulette",
        short: "Power-Ups draw Holo-Cards (2x or Curse)",
        detail: "Gravity Magnet pulls power-ups! Catching any power-up draws a Holo-Card: 50% bonus random power-up burst (4s), 30% Double-Stack upgrade, or 20% Joker Curse (+2 extra bricks)!",
        augments: { magnet: 2, greed: 1 }
      },
      {
        level: 3,
        label: "Piñata Jackpot",
        short: "Rolling 4–6 mutates a 🎁 Piñata Brick!",
        detail: "Rolling 4, 5, or 6 on your paddle bounce mutates an intact brick into a glowing 🎁 Golden Piñata Brick (guaranteed power-up + +15¢)!",
        augments: { magnet: 2, greed: 2 }
      },
      {
        level: 4,
        label: "777 Frenzy Surge",
        short: "Roll 6 charges 100% 🚨 Frenzy Ready!",
        detail: "Rolling a 6 (777 Jackpot) on your paddle bounce immediately charges 100% 🚨 FRENZY READY (press [F] or [SPACE] to unleash) + Mag-Lock Slingshot!",
        augments: { magnet: 3, greed: 2 }
      },
      {
        level: 5,
        label: "All-In Chaos MAX",
        short: "Loaded Die (No Roll 1!) + 3-Way Sparks",
        detail: "MAX HIGH-ROLLER: Loaded Cyber-Die never rolls Snake Eyes [1], upgrades Roll 4–6 to a 3-Way Ricochet Spark Fan (×1.35 PTS), and maximizes Power-Up Magnet!",
        augments: { magnet: 3, greed: 3 }
      }
    ]
  }
};

const RUNNER_CLASS_ORDER = ["striker", "guardian", "demolisher", "highroller"];

// ─── Persistent Callsign RPG Profiles (1 Callsign = 1 Bound Class, Permanent Rank & Loadout) ───
const CALLSIGN_PROFILES_STORAGE_KEY = "brickRunnerCallsignProfilesV1";
let memoryCallsignProfiles = {};

const CLASS_RANK_UPGRADE_COSTS = {
  2: 80,
  3: 180,
  4: 320,
  5: 500
};

const LOADOUT_CAPSULE_SHOP = [
  { id: "wide-paddle",   emoji: "🪴", name: "EXPANDO",     cost: 0,   short: "+35% Width & ×2–×4 PTS" },
  { id: "slow-mo",       emoji: "🐌", name: "SLOW-MO",     cost: 0,   short: "Bullet-Time & ×1.5–×2 PTS" },
  { id: "sticky-paddle", emoji: "🧲", name: "MAG-LOCK",    cost: 90,  short: "Catch & Flick ×1.5 Slingshot" },
  { id: "one-up",        emoji: "🧱", name: "BRICKED UP!", cost: 130, short: "+5 Bricks & +150×PTS Bonus" }
];

// ─── Infinite Sector Breach Contracts (1 Explicit Buff + 1 Explicit Nerf) ───
const BREACH_CONTRACTS = [
  {
    id: "overclock_servos",
    emoji: "⚡",
    name: "OVERCLOCKED SERVOS",
    color: "#00ffff",
    buffText: "×1.35 All Brick Score & +20% Paddle Thruster Speed",
    nerfText: "+15% Faster Ball Velocity",
    scoreMult: 1.35,
    paddleSpeedBonus: 0.20,
    ballSpeedMod: 0.15
  },
  {
    id: "vault_heist",
    emoji: "🏦",
    name: "BLACKWALL VAULT HEIST",
    color: "#ffd700",
    buffText: "+18% Gold Vault Bricks (×3.0 PTS & +12¢ each) & ×1.25 Score",
    nerfText: "+22% More 2-Hit Armored Bricks",
    scoreMult: 1.25,
    vaultChanceBonus: 0.18,
    armorChanceBonus: 0.22
  },
  {
    id: "glass_cannon",
    emoji: "🔨",
    name: "GLASS CANNON PROTOCOL",
    color: "#ff5577",
    buffText: "Ball & Bolts deal +1 Bonus Armor Damage & ×1.30 Score",
    nerfText: "-16% Narrower Paddle Width",
    scoreMult: 1.30,
    bonusHitDamage: 1,
    paddleWidthMod: -0.16
  },
  {
    id: "hyper_frenzy",
    emoji: "🚨",
    name: "HYPER-FRENZY CAPACITOR",
    color: "#ff2a55",
    buffText: "Skill Rally Frenzy charges +55% faster & ×1.30 All Brick Score",
    nerfText: "+12% Faster Ball Velocity",
    scoreMult: 1.30,
    frenzyChargeMult: 1.55,
    ballSpeedMod: 0.12
  },
  {
    id: "high_bounty",
    emoji: "💎",
    name: "HIGH-STAKES BOUNTY",
    color: "#39ff14",
    buffText: "+60% Cyber-Cred (¢) Drops & ×1.30 All Brick Score",
    nerfText: "-10% Narrower Paddle & +10% Ball Velocity",
    scoreMult: 1.30,
    credMult: 1.60,
    paddleWidthMod: -0.10,
    ballSpeedMod: 0.10
  },
  {
    id: "blood_pact",
    emoji: "🔥",
    name: "BLOOD PACT OVERDRIVE",
    color: "#ff7b00",
    buffText: "×1.50 All Brick Score & +25% Frenzy Charge Speed",
    nerfText: "+18% Ball Velocity & +15% Armored Bricks",
    scoreMult: 1.50,
    frenzyChargeMult: 1.25,
    ballSpeedMod: 0.18,
    armorChanceBonus: 0.15
  }
];

function loadAllCallsignProfiles() {
  try {
    const raw = localStorage.getItem(CALLSIGN_PROFILES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        memoryCallsignProfiles = parsed;
        return parsed;
      }
    }
  } catch (err) {
    // Fallback to in-memory map
  }
  return memoryCallsignProfiles;
}

function saveAllCallsignProfiles(map) {
  memoryCallsignProfiles = map || {};
  try {
    localStorage.setItem(CALLSIGN_PROFILES_STORAGE_KEY, JSON.stringify(memoryCallsignProfiles));
  } catch (err) {
    // Ignore storage errors in sandboxed iframes
  }
}

function getCallsignProfile(code3) {
  const allPowerUps = ["wide-paddle", "slow-mo", "sticky-paddle", "one-up"];
  const clean = (code3 || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length !== 3) {
    return {
      boundClass: null,
      classRank: 1,
      credits: 0,
      unlockedMods: [...allPowerUps],
      equippedMods: [...allPowerUps],
      bestSector: 0,
      extractions: 0,
      savedRun: null,
      lastPlayedAt: 0
    };
  }
  const all = loadAllCallsignProfiles();
  if (!all[clean]) {
    all[clean] = {
      boundClass: null,
      classRank: 1,
      credits: 0,
      unlockedMods: [...allPowerUps],
      equippedMods: [...allPowerUps],
      bestSector: 0,
      extractions: 0,
      savedRun: null,
      lastPlayedAt: 0
    };
    saveAllCallsignProfiles(all);
  }
  const p = all[clean];
  p.unlockedMods = [...allPowerUps];
  p.equippedMods = [...allPowerUps];
  if (typeof p.classRank !== "number" || p.classRank < 1) p.classRank = 1;
  if (p.classRank > 5) p.classRank = 5;
  if (typeof p.creds === "number" && p.creds > 0) {
    p.credits = (typeof p.credits === "number" ? p.credits : 0) + p.creds;
    delete p.creds;
    saveAllCallsignProfiles(all);
  }
  if (typeof p.credits !== "number" || p.credits < 0) p.credits = 0;
  if (!p.savedRun || typeof p.savedRun !== "object" || typeof p.savedRun.stage !== "number" || p.savedRun.stage < 1) {
    p.savedRun = null;
  }
  return p;
}

function getSavedRunnerList() {
  const all = loadAllCallsignProfiles();
  // Also backfill any callsigns from the local leaderboards so past characters always show up
  try {
    const lbEntries = [...(typeof getLeaderboard === "function" ? getLeaderboard("legit") : []), ...(typeof getLeaderboard === "function" ? getLeaderboard("hacked") : [])];
    lbEntries.forEach(item => {
      const code = (item && item.initials ? String(item.initials) : "").toUpperCase().replace(/[^A-Z]/g, "");
      if (code.length === 3 && !all[code]) {
        all[code] = {
          boundClass: item.runnerClass && RUNNER_CLASSES[item.runnerClass] ? item.runnerClass : "striker",
          classRank: typeof item.classRank === "number" ? Math.min(5, Math.max(1, item.classRank)) : 1,
          credits: 0,
          bestSector: typeof item.sector === "number" ? item.sector : 1,
          extractions: item.won ? 1 : 0,
          savedRun: null,
          lastPlayedAt: 1
        };
      }
    });
  } catch (err) {
    // Ignore leaderboard backfill errors
  }

  const activeCode = isCallsignComplete() ? callsignSlots.join("") : "";
  const entries = [];
  for (const code of Object.keys(all)) {
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const p = all[code];
    if (!p) continue;
    if (p.boundClass || (p.credits && p.credits > 0) || (p.bestSector && p.bestSector > 0) || p.savedRun || code === activeCode) {
      entries.push({
        code,
        boundClass: p.boundClass || (code === activeCode ? selectedRunnerClass : null),
        classRank: p.classRank || 1,
        credits: p.credits || 0,
        bestSector: p.bestSector || 0,
        savedRun: p.savedRun || null,
        lastPlayedAt: p.lastPlayedAt || 0
      });
    }
  }
  entries.sort((a, b) => {
    const aHasRun = a.savedRun && a.savedRun.stage > 1 ? 1 : 0;
    const bHasRun = b.savedRun && b.savedRun.stage > 1 ? 1 : 0;
    if (aHasRun !== bHasRun) return bHasRun - aHasRun;
    if ((b.lastPlayedAt || 0) !== (a.lastPlayedAt || 0)) return (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0);
    if (b.classRank !== a.classRank) return b.classRank - a.classRank;
    if (b.credits !== a.credits) return b.credits - a.credits;
    return a.code.localeCompare(b.code);
  });
  return entries.slice(0, 8);
}

function saveCallsignProfile(code3, profile) {
  const clean = (code3 || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length !== 3) return;
  const all = loadAllCallsignProfiles();
  all[clean] = profile;
  saveAllCallsignProfiles(all);
}

function bindCallsignToClass(code3, classId) {
  const clean = (code3 || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length !== 3 || !RUNNER_CLASSES[classId]) return;
  const profile = getCallsignProfile(clean);
  if (!profile.boundClass) {
    profile.boundClass = classId;
    saveCallsignProfile(clean, profile);
  }
  selectedRunnerClass = profile.boundClass;
  rogueLevel = profile.classRank || 1;
}

function syncActiveCallsignClassBinding() {
  if (!isCallsignComplete()) return;
  const code = getLastInitials();
  const profile = getCallsignProfile(code);
  if (profile.boundClass && RUNNER_CLASSES[profile.boundClass]) {
    selectedRunnerClass = profile.boundClass;
  }
  rogueLevel = profile.classRank || 1;
}

function getEquippedLoadoutPool() {
  // All 4 falling power-ups drop naturally from bricks for every class without any purchase or class restriction
  return POWER_UP_SPAWN_CHANCES;
}

function getSelectedClassDef() {
  return RUNNER_CLASSES[selectedRunnerClass] || RUNNER_CLASSES.striker;
}

function syncPaddleClassVisual() {
  if (!paddle) return;
  const cDef = getSelectedClassDef();
  paddle.setAttribute("data-runner-class", cDef.id);
}

function setRunnerClass(classId) {
  if (!RUNNER_CLASSES[classId]) return;
  if (isCallsignComplete()) {
    const code = getLastInitials();
    const profile = getCallsignProfile(code);
    if (profile.boundClass && profile.boundClass !== classId) {
      soundManager.play("multihit", { pitch: 0.78, volume: 0.45 });
      return;
    }
  }
  selectedRunnerClass = classId;
  syncPaddleClassVisual();
  soundManager.play("powerUpSpawn", { pitch: 1.45, volume: 0.45 });
  renderCallsignBuilder();
  updateHighScoreDisplay();
}

function getCallsignLore(code3) {
  if (!code3 || code3.length !== 3) return null;
  return NORMALIZED_LORE_DB[code3.toUpperCase()] || null;
}

// --- Floating Cyberpunk Hover Popover for Class Tiers, Classes & Callsigns ---
let hoverPopoverEl = null;

function ensureHoverPopover() {
  if (hoverPopoverEl && document.body.contains(hoverPopoverEl)) return hoverPopoverEl;
  hoverPopoverEl = document.createElement("div");
  hoverPopoverEl.id = "cyber-hover-popover";
  hoverPopoverEl.className = "cyber-hover-popover";
  hoverPopoverEl.style.display = "none";
  document.body.appendChild(hoverPopoverEl);
  return hoverPopoverEl;
}

function showCyberPopover(htmlContent, anchorEl, accentColor = "#00ffff") {
  const pop = ensureHoverPopover();
  pop.style.setProperty("--pop-accent", accentColor);
  pop.innerHTML = htmlContent;
  pop.style.display = "block";
  pop.classList.add("visible");

  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  let top = rect.top - popRect.height - 10;

  if (top < 8) {
    top = rect.bottom + 10;
  }
  left = Math.max(10, Math.min(window.innerWidth - popRect.width - 10, left));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function hideCyberPopover() {
  if (hoverPopoverEl) {
    hoverPopoverEl.classList.remove("visible");
    hoverPopoverEl.style.display = "none";
  }
}

function bindHoverPopoverEvents(rootEl) {
  if (!rootEl) return;
  const profileRank = isCallsignComplete() ? (getCallsignProfile(getLastInitials()).classRank || 1) : 1;

  rootEl.querySelectorAll("[data-popover-tier]").forEach(el => {
    el.addEventListener("mouseenter", () => {
      const clsId = el.getAttribute("data-popover-class") || selectedRunnerClass;
      const lvl = parseInt(el.getAttribute("data-popover-tier"), 10) || 1;
      const cls = RUNNER_CLASSES[clsId] || getSelectedClassDef();
      const tier = cls.tiers.find(t => t.level === lvl) || cls.tiers[0];
      const activeRank = gameOver ? profileRank : rogueLevel;
      const isUnlocked = lvl <= activeRank;
      const cost = CLASS_RANK_UPGRADE_COSTS[lvl] || 0;
      const statusBadge = isUnlocked
        ? `<span class="pop-status-pill pop-unlocked">✓ PERMANENTLY UNLOCKED (L${lvl})</span>`
        : `<span class="pop-status-pill">LOCKED • UPGRADE FOR ${cost}¢</span>`;

      const html = `
        <div class="pop-head">
          <span class="pop-title">${cls.emoji} ${cls.name} • L${tier.level} ${tier.label}</span>
          ${statusBadge}
        </div>
        <div class="pop-body">${tier.detail || tier.short}</div>
        <div class="pop-tradeoffs">
          <div class="pop-buff">▲ CLASS BUFF: ${cls.buff}</div>
          <div class="pop-nerf">▼ HANDICAP: ${cls.handicap}</div>
        </div>
      `;
      showCyberPopover(html, el, cls.color);
    });
    el.addEventListener("mouseleave", hideCyberPopover);
  });

  rootEl.querySelectorAll("[data-popover-class-card]").forEach(el => {
    el.addEventListener("mouseenter", () => {
      const clsId = el.getAttribute("data-popover-class-card");
      const cls = RUNNER_CLASSES[clsId];
      if (!cls) return;
      const html = `
        <div class="pop-head">
          <span class="pop-title">${cls.emoji} ${cls.name} CLASS</span>
          <span class="pop-status-pill">PADDLE: ${cls.paddleStyleName}</span>
        </div>
        <div class="pop-body">${cls.tagline} — Each Callsign binds permanently to <strong>1 Class</strong> and upgrades L1–L5 with banked Cyber-Creds (¢)!</div>
        <div class="pop-tradeoffs">
          <div class="pop-buff">▲ BUFF: ${cls.buff}</div>
          <div class="pop-nerf">▼ HANDICAP: ${cls.handicap}</div>
        </div>
      `;
      showCyberPopover(html, el, cls.color);
    });
    el.addEventListener("mouseleave", hideCyberPopover);
  });

  rootEl.querySelectorAll("[data-popover-contract]").forEach(el => {
    el.addEventListener("mouseenter", () => {
      const cId = el.getAttribute("data-popover-contract");
      const c = BREACH_CONTRACTS.find(item => item.id === cId);
      if (!c) return;
      const html = `
        <div class="pop-head">
          <span class="pop-title">${c.emoji} STAGE MODIFIER // ${c.name}</span>
          <span class="pop-status-pill pop-unlocked">ACTIVE STAGE MODIFIER</span>
        </div>
        <div class="pop-tradeoffs" style="margin-top: 2px; border-top: none;">
          <div class="pop-buff">▲ BUFF: ${c.buffText}</div>
          <div class="pop-nerf">▼ NERF: ${c.nerfText}</div>
        </div>
      `;
      showCyberPopover(html, el, c.color);
    });
    el.addEventListener("mouseleave", hideCyberPopover);
  });

  rootEl.querySelectorAll("[data-popover-callsign]").forEach(el => {
    el.addEventListener("mouseenter", () => {
      const code = getLastInitials();
      const lore = getCallsignLore(code);
      if (!lore) return;
      const html = `
        <div class="pop-head">
          <span class="pop-title">🕹️ CALLSIGN ARCHIVE // ${code}</span>
          <span class="pop-status-pill pop-unlocked">${lore.origin}</span>
        </div>
        <div class="pop-body"><strong>${lore.title}</strong> — Each Callsign saves its own bound Class, Rank (L1–L5), Cyber-Creds (¢), and Loadout!</div>
      `;
      showCyberPopover(html, el, "#ff00ff");
    });
    el.addEventListener("mouseleave", hideCyberPopover);
  });
}

function isStartScreenOpen() {
  return gameOver && startScreen && startScreen.style.display === "flex" && (!clickToStartOverlay || clickToStartOverlay.style.display === "none");
}

function getCallsignChars() {
  return [callsignSlots[0] || "", callsignSlots[1] || "", callsignSlots[2] || ""];
}

let isSafehouseMode = false;
let safehouseLeaderboardOpen = false;
let safehouseUpgradesRemaining = 0;
let isCallsignKeypadOpen = true;

function syncSafehouseAndStartScreenUI() {
  const startDeck = startScreen ? startScreen.querySelector(".start-deck") : null;
  const builderPanel = document.getElementById("callsign-builder");
  const lbPanel = document.getElementById("start-leaderboard");
  const topbarEl = document.getElementById("safehouse-topbar");
  const topbarTitleEl = document.getElementById("safehouse-topbar-title");
  const topRecordPill = document.getElementById("start-top-record-pill");
  const lbBtn = document.getElementById("safehouse-lb-toggle-btn");
  const code = isCallsignComplete() ? callsignSlots.join("") : "ARMORY";

  if (startScreen) {
    startScreen.classList.toggle("safehouse-mode", isSafehouseMode);
  }
  if (topbarEl) {
    topbarEl.style.display = "flex";
  }
  if (topbarTitleEl) {
    if (safehouseLeaderboardOpen) {
      topbarTitleEl.textContent = "🏆 HALL OF FAME // HIGH SCORES";
    } else if (isSafehouseMode) {
      topbarTitleEl.textContent = `🏠 SAFEHOUSE // ${code}`;
    } else {
      topbarTitleEl.textContent = "SELECT RUNNER & CLASS";
    }
  }
  if (topRecordPill) {
    const board = typeof getLeaderboard === "function" ? getLeaderboard("legit") : [];
    if (board.length > 0) {
      topRecordPill.textContent = `👑 #1: ${formatArcadeScore(board[0].score)} (${board[0].initials})`;
      topRecordPill.style.display = safehouseLeaderboardOpen ? "none" : "inline-flex";
    } else {
      topRecordPill.style.display = "none";
    }
  }
  if (lbBtn) {
    lbBtn.textContent = safehouseLeaderboardOpen ? "← BACK TO RUNNER" : "🏆 HIGH SCORES";
    lbBtn.classList.toggle("active-mode", safehouseLeaderboardOpen);
  }
  if (builderPanel) {
    builderPanel.style.display = safehouseLeaderboardOpen ? "none" : "flex";
  }
  if (lbPanel) {
    lbPanel.style.display = safehouseLeaderboardOpen ? "flex" : "none";
  }
  if (startDeck) {
    startDeck.classList.add("deck-single-col");
  }
}

function syncStartPlayButtonState() {
  if (!startPrompt) return;
  if (!assetsReady) {
    startPrompt.textContent = "LOADING...";
    startPrompt.classList.add("loading");
    startPrompt.classList.remove("callsign-locked");
    return;
  }
  startPrompt.classList.remove("loading");
  startPrompt.textContent = "START";
  startPrompt.classList.toggle("callsign-locked", !isCallsignComplete());
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
  syncActiveCallsignClassBinding();
  const chars = getCallsignChars();
  const complete = isCallsignComplete();
  const codeStr = chars.join("");
  const profile = complete ? getCallsignProfile(codeStr) : getCallsignProfile("");
  const activeClass = getSelectedClassDef();
  const boundClassId = complete ? profile.boundClass : null;
  syncPaddleClassVisual();

  const savedRunners = getSavedRunnerList();
  const savedRunnersHTML = savedRunners.length > 0
    ? savedRunners.map(r => {
        const isCurrentRunner = complete && r.code === codeStr;
        const rCls = r.boundClass && RUNNER_CLASSES[r.boundClass] ? RUNNER_CLASSES[r.boundClass] : null;
        const clsEmoji = rCls ? rCls.emoji : "🕹️";
        const rankStr = rCls ? `L${r.classRank}` : "NEW";
        const stageTag = (r.savedRun && r.savedRun.stage > 1)
          ? `<span class="runner-chip-stage">▶STG ${r.savedRun.stage}</span>`
          : (r.credits > 0 ? `<span class="runner-chip-creds">${r.credits}¢</span>` : (r.bestSector > 0 ? `<span class="runner-chip-creds">STG ${r.bestSector}</span>` : ""));
        return `
          <button type="button" class="runner-roster-chip ${isCurrentRunner ? "active" : ""} ${r.savedRun && r.savedRun.stage > 1 ? "has-saved-run" : ""}" data-select-runner="${r.code}" style="--chip-color: ${rCls ? rCls.color : "#00ffff"};" title="Switch to ${r.code}${rCls ? ` (${rCls.name} L${r.classRank})` : ""}${r.savedRun && r.savedRun.stage > 1 ? ` — Resume Stage ${r.savedRun.stage}` : ""}">
            <span class="runner-chip-main">${clsEmoji} <strong>${r.code}</strong> ${rankStr}</span>
            ${stageTag}
          </button>
        `;
      }).join("") + `<button type="button" class="runner-roster-chip runner-chip-new ${!complete ? "active" : ""}" id="new-runner-chip-btn" title="Create New 3-Letter Callsign">＋ NEW</button>`
    : `<span class="no-saved-runners-hint">Type A–Z or click 🎲 to create your first Runner — characters save automatically!</span>`;

  const slotsHTML = chars.map((ch, idx) => `
    <div class="callsign-slot ${idx === activeCallsignSlot ? "active" : ""} ${!ch ? "slot-empty" : "slot-filled"}" data-slot="${idx}" data-popover-callsign="1" title="Type A–Z on keyboard or click to cycle letters">
      ${ch || `<span class="slot-placeholder">_</span>`}
    </div>
  `).join("");

  const CLASS_SUMMARIES = {
    striker: "Every bounce zaps bricks with Cyan Tesla Lightning; center catches fire Twin Rail Bolts.",
    guardian: "Wide armored deck fires Emerald Mortar Bolts; center catches trigger a 2× Damage Parry.",
    demolisher: "Supercharges the ball to plow straight through bricks (2× Dmg) & detonate Plasma Novas.",
    highroller: "Every bounce rolls a 1D6 Chaos Die for Ricochet Sparks, Golden Piñata Bricks & Jackpots."
  };

  const classCardsHTML = Object.values(RUNNER_CLASSES).map(cls => {
    const isSel = cls.id === activeClass.id;
    const isLockedOther = Boolean(boundClassId && boundClassId !== cls.id);
    const clsRank = (complete && (!boundClassId || boundClassId === cls.id)) ? (profile.classRank || 1) : 1;
    const activeTier = cls.tiers[Math.min(cls.tiers.length - 1, clsRank - 1)] || cls.tiers[0];
    const pipsHTML = [1, 2, 3, 4, 5].map(lvl =>
      `<span class="cls-lvl-pip ${lvl <= clsRank ? "pip-on" : "pip-off"}"></span>`
    ).join("");
    const summaryText = clsRank > 1
      ? `<strong>L${clsRank} ${activeTier.label}:</strong> ${activeTier.short} — ${CLASS_SUMMARIES[cls.id] || cls.tagline}`
      : (CLASS_SUMMARIES[cls.id] || cls.buff);

    return `
      <button type="button" class="class-card class-select-btn ${isSel ? "active" : ""} ${isLockedOther ? "class-locked-other" : ""}" data-runner-class="${cls.id}" data-popover-class-card="${cls.id}" style="--cls-color: ${cls.color};" ${isLockedOther ? `title="Callsign ${codeStr} is bound to ${activeClass.name}. Click Re-Spec to change class."` : ""}>
        <div class="cls-card-top">
          <span class="cls-card-identity">
            <span class="cls-btn-emoji">${isLockedOther ? "🔒" : cls.emoji}</span>
            <span class="cls-btn-name">${cls.name}</span>
          </span>
          <span class="cls-card-pips" title="Class Rank L${clsRank}/5">
            <span class="cls-pips-row">${pipsHTML}</span>
            <span class="cls-pip-lvl">LVL ${clsRank}</span>
          </span>
        </div>
        <p class="cls-card-summary">${summaryText}</p>
        <div class="cls-card-traits">
          <span class="cls-trait-pill trait-buff">▲ ${cls.shortBuff}</span>
          <span class="cls-trait-pill trait-nerf">▼ ${cls.shortHandicap}</span>
        </div>
      </button>
    `;
  }).join("");

  const safehouseTabsHTML = Object.values(RUNNER_CLASSES).map(cls => {
    const isSel = cls.id === activeClass.id;
    const isLockedOther = Boolean(boundClassId && boundClassId !== cls.id);
    return `
      <button type="button" class="class-select-btn ${isSel ? "active" : ""} ${isLockedOther ? "class-locked-other" : ""}" data-runner-class="${cls.id}" data-popover-class-card="${cls.id}" style="--cls-color: ${cls.color};" ${isLockedOther ? `title="Callsign ${codeStr} is bound to ${activeClass.name}. Click Re-Spec to change class."` : ""}>
        <span class="cls-btn-emoji">${isLockedOther ? "🔒" : cls.emoji}</span>
        <span class="cls-btn-name">${cls.name}</span>
      </button>
    `;
  }).join("");

  const pathStepsHTML = activeClass.tiers.map(t => {
    const isUnlocked = t.level <= profile.classRank;
    const isCurrent = t.level === profile.classRank;
    const tierCost = CLASS_RANK_UPGRADE_COSTS[t.level] || 0;
    const statusTag = isCurrent ? "ACTIVE" : (isUnlocked ? "OWNED" : `${tierCost}¢`);
    return `
      <div class="class-path-step ${isUnlocked ? "step-unlocked" : "step-locked"} ${isCurrent ? "step-current" : ""}" data-popover-class="${activeClass.id}" data-popover-tier="${t.level}">
        <div class="class-path-top">
          <span class="class-path-lvl">${isUnlocked ? "✓" : "🔒"} L${t.level}</span>
          <span class="class-path-cost">${statusTag}</span>
        </div>
        <span class="class-path-name">${t.label}</span>
        <span class="class-path-desc">${t.short}</span>
      </div>
    `;
  }).join("");

  const nextRank = profile.classRank + 1;
  const upgradeCost = CLASS_RANK_UPGRADE_COSTS[nextRank] || 0;
  const canAffordRank = complete && nextRank <= 5 && profile.credits >= upgradeCost;

  let upgradeBtnHTML = "";
  if (!complete) {
    upgradeBtnHTML = `<span class="safehouse-hint-pill">ENTER CALLSIGN</span>`;
  } else if (profile.classRank >= 5) {
    upgradeBtnHTML = `<span class="safehouse-max-pill">👑 L5 MAX</span>`;
  } else if (!isSafehouseMode) {
    upgradeBtnHTML = `<span class="safehouse-hint-pill">🔒 STG 5 SAFEHOUSE • L${nextRank}: ${upgradeCost}¢</span>`;
  } else if (safehouseUpgradesRemaining <= 0) {
    upgradeBtnHTML = `<span class="safehouse-used-pill">✅ 1/1 UPGRADE DONE</span>`;
  } else {
    upgradeBtnHTML = `<button type="button" id="safehouse-upgrade-rank-btn" class="safehouse-upgrade-btn ${canAffordRank ? "can-afford" : "locked-afford"}">
      ⬆️ UPGRADE TO L${nextRank} (${upgradeCost}¢)
    </button>`;
  }

  const lore = complete ? getCallsignLore(codeStr) : null;
  const loreOriginText = complete
    ? (lore ? `ARCHIVE // ${lore.origin.toUpperCase()}` : `CUSTOM RUNNER ID // ${codeStr}`)
    : `TYPE [A–Z] ON KEYBOARD OR CLICK 🎲`;
  const loreTitleText = complete
    ? (lore ? lore.title : `Unregistered Grid Operator (${codeStr})`)
    : `Enter any 3-letter callsign or roll a Sci-Fi Legend`;

  const boundStatusHTML = !complete
    ? `<span class="deck-sec-badge badge-cyan">PICK CLASS [1–4]</span>`
    : (boundClassId
        ? `<div class="bound-class-actions">
             <span class="deck-sec-badge badge-bound">🔒 ${codeStr}: ${activeClass.name} L${profile.classRank}</span>
             <button type="button" id="respec-callsign-btn" class="respec-mini-btn" title="Reset Callsign Class Binding">♻️ RE-SPEC</button>
           </div>`
        : `<span class="deck-sec-badge badge-cyan">BINDS ON START</span>`);

  const hasSavedCheckpoint = Boolean(complete && profile.savedRun && profile.savedRun.stage > 1);
  const savedRunBannerHTML = hasSavedCheckpoint
    ? `
      <div class="saved-run-resume-strip">
        <span class="saved-run-info">🟢 <strong>STAGE ${profile.savedRun.stage} READY</strong> • ${formatArcadeScore(profile.savedRun.score || 0)} PTS${profile.savedRun.unbankedCreds ? ` • +${formatArcadeScore(profile.savedRun.unbankedCreds)}¢ AT RISK` : ""}</span>
        <button type="button" id="abandon-saved-run-btn" class="respec-mini-btn" title="Reset this character back to Stage 1">↺ RESET TO STG 1</button>
      </div>
    `
    : "";

  const topSectionHTML = isSafehouseMode
    ? `
      <div class="callsign-top-section safehouse-vault-section">
        <div class="deck-section-header">
          <span class="deck-sec-title"><span class="sec-num">01</span> SAFEHOUSE VAULT // ${codeStr}</span>
          <button type="button" id="safehouse-exit-start-btn" class="respec-mini-btn">🕹️ SWITCH RUNNER</button>
        </div>
        <div class="saved-runners-bar">
          <span class="saved-runners-lbl">ROSTER:</span>
          <div class="saved-runners-scroll">${savedRunnersHTML}</div>
        </div>
        <div class="callsign-identity-dock" data-popover-callsign="1">
          <div class="callsign-slots">${slotsHTML}</div>
          <div class="callsign-lore-readout is-complete">
            <span class="lore-origin-tag">${loreOriginText}</span>
            <span class="lore-char-title">${loreTitleText}</span>
          </div>
        </div>
        ${savedRunBannerHTML}
        <div class="safehouse-vault-grid">
          <div class="safehouse-vault-card">
            <span class="sv-label">BANKED CYBER-CREDS</span>
            <strong class="sv-val sv-green">💰 ${formatArcadeScore(profile.credits)}¢</strong>
          </div>
          <div class="safehouse-vault-card">
            <span class="sv-label">UPGRADE ALLOWANCE</span>
            <strong class="sv-val ${safehouseUpgradesRemaining > 0 ? "sv-gold" : "sv-muted"}">${profile.classRank >= 5 ? "👑 L5 MAX" : (safehouseUpgradesRemaining > 0 ? "⚡ 1 / 1 READY" : "✅ 0 / 1 (USED)")}</strong>
          </div>
          <div class="safehouse-vault-card">
            <span class="sv-label">EXTRACTION RECORD</span>
            <strong class="sv-val sv-cyan">🏆 STG ${profile.bestSector || 5} (${profile.extractions || 1}×)</strong>
          </div>
        </div>
      </div>
    `
    : `
      <div class="callsign-top-section">
        <div class="deck-section-header">
          <span class="deck-sec-title"><span class="sec-num">01</span> RUNNER CALLSIGN</span>
          <span class="deck-sec-badge">💰 ${formatArcadeScore(profile.credits)}¢ BANKED${profile.bestSector > 0 ? ` • 🏆 STG ${profile.bestSector}` : ""}</span>
        </div>
        <div class="callsign-identity-dock" data-popover-callsign="1">
          <div class="callsign-slots">${slotsHTML}</div>
          <div class="callsign-lore-readout ${complete ? "is-complete" : "is-incomplete"}">
            <span class="lore-origin-tag">${loreOriginText}</span>
            <span class="lore-char-title">${loreTitleText}</span>
          </div>
          <div class="callsign-action-btns">
            <button type="button" class="callsign-action-btn btn-random" id="quick-random-callsign-btn" title="Roll Random Sci-Fi Callsign">🎲 RANDOM</button>
            <button type="button" class="callsign-action-btn btn-clear" id="quick-clear-callsign-btn" title="Clear Letter [Backspace]">⌫</button>
          </div>
        </div>
        <div class="saved-runners-bar">
          <span class="saved-runners-lbl">SAVED:</span>
          <div class="saved-runners-scroll">${savedRunnersHTML}</div>
        </div>
        ${savedRunBannerHTML}
      </div>
    `;

  const bottomSectionHTML = isSafehouseMode
    ? `
      <div class="class-picker-box" style="--cls-color: ${activeClass.color};">
        <div class="deck-section-header">
          <span class="deck-sec-title"><span class="sec-num">02</span> SAFEHOUSE ARMORY (MAX 1 UPGRADE)</span>
          ${boundStatusHTML}
        </div>
        <div class="class-picker-grid">${safehouseTabsHTML}</div>
        <div class="class-linear-preview">
          <div class="class-spec-head" data-popover-class-card="${activeClass.id}">
            <span class="class-spec-main">${activeClass.emoji} <strong>${activeClass.name} L${profile.classRank}</strong> <span class="class-spec-sub">— ${activeClass.tagline}</span></span>
            ${upgradeBtnHTML}
          </div>
          <div class="class-tradeoff-stack" data-popover-class-card="${activeClass.id}">
            <div class="tradeoff-row buff-pill"><span class="tradeoff-tag">▲ BUFF</span> <span class="tradeoff-text">${activeClass.buff}</span></div>
            <div class="tradeoff-row nerf-pill"><span class="tradeoff-tag">▼ NERF</span> <span class="tradeoff-text">${activeClass.handicap}</span></div>
          </div>
          <div class="class-path-track">${pathStepsHTML}</div>
        </div>
      </div>
    `
    : `
      <div class="class-picker-box class-cards-container" style="--cls-color: ${activeClass.color};">
        <div class="deck-section-header">
          <span class="deck-sec-title"><span class="sec-num">02</span> COMBAT CLASS</span>
          ${boundStatusHTML}
        </div>
        <div class="class-cards-grid">${classCardsHTML}</div>
      </div>
    `;

  container.innerHTML = `
    ${topSectionHTML}
    ${bottomSectionHTML}
  `;

  syncStartPlayButtonState();
  syncSafehouseAndStartScreenUI();
  bindHoverPopoverEvents(container);

  container.querySelectorAll("[data-select-runner]").forEach(chipBtn => {
    chipBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const targetCode = chipBtn.getAttribute("data-select-runner");
      if (targetCode && /^[A-Z]{3}$/.test(targetCode)) {
        saveLastInitials(targetCode);
        activeCallsignSlot = 0;
        isCallsignKeypadOpen = false;
        const p = getCallsignProfile(targetCode);
        if (p.boundClass && RUNNER_CLASSES[p.boundClass]) {
          selectedRunnerClass = p.boundClass;
        }
        if (isSafehouseMode) {
          safehouseUpgradesRemaining = (p.savedRun && p.savedRun.safehouseUpgradesLeft > 0) ? p.savedRun.safehouseUpgradesLeft : 0;
        }
        soundManager.play("powerUpSpawn", { pitch: 1.5, volume: 0.45 });
        updateHighScoreDisplay();
        renderCallsignBuilder();
      }
    });
  });

  const newRunnerBtn = container.querySelector("#new-runner-chip-btn");
  if (newRunnerBtn) {
    newRunnerBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      isSafehouseMode = false;
      safehouseUpgradesRemaining = 0;
      isCallsignKeypadOpen = true;
      clearCallsignSlots();
      soundManager.play("bounce", { pitch: 1.35, volume: 0.4 });
      renderCallsignBuilder();
    });
  }

  const quickRandBtn = container.querySelector("#quick-random-callsign-btn");
  if (quickRandBtn) {
    quickRandBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      randomizeCallsign();
    });
  }

  const quickClearBtn = container.querySelector("#quick-clear-callsign-btn");
  if (quickClearBtn) {
    quickClearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      backspaceCallsign();
    });
  }

  const abandonRunBtn = container.querySelector("#abandon-saved-run-btn");
  if (abandonRunBtn && complete) {
    abandonRunBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const p = getCallsignProfile(codeStr);
      p.savedRun = null;
      saveCallsignProfile(codeStr, p);
      soundManager.play("multihit", { pitch: 0.95, volume: 0.45 });
      renderCallsignBuilder();
    });
  }

  container.querySelectorAll(".callsign-slot").forEach(slotEl => {
    slotEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const clickedIdx = parseInt(slotEl.dataset.slot, 10) || 0;
      if (clickedIdx === activeCallsignSlot) {
        const curChar = callsignSlots[clickedIdx] || "";
        const curPos = KEYPAD_LETTERS.indexOf(curChar);
        const nextChar = KEYPAD_LETTERS[(curPos + 1) % KEYPAD_LETTERS.length];
        callsignSlots[clickedIdx] = nextChar;
        soundManager.play("bounce", { pitch: 1.3 + clickedIdx * 0.15, volume: 0.35 });
        updateHighScoreDisplay();
      } else {
        activeCallsignSlot = clickedIdx;
        soundManager.play("bounce", { pitch: 1.25, volume: 0.3 });
      }
      renderCallsignBuilder();
    });
  });

  container.querySelectorAll("[data-runner-class]").forEach(clsBtn => {
    clsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const nextId = clsBtn.dataset.runnerClass;
      setRunnerClass(nextId);
    });
  });

  const exitStartBtn = container.querySelector("#safehouse-exit-start-btn");
  if (exitStartBtn) {
    exitStartBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      isSafehouseMode = false;
      safehouseUpgradesRemaining = 0;
      isCallsignKeypadOpen = false;
      soundManager.play("bounce", { pitch: 1.15, volume: 0.4 });
      renderCallsignBuilder();
    });
  }

  const upgradeBtn = container.querySelector("#safehouse-upgrade-rank-btn");
  if (upgradeBtn && complete) {
    upgradeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!isSafehouseMode || safehouseUpgradesRemaining <= 0) {
        soundManager.play("multihit", { pitch: 0.8, volume: 0.45 });
        return;
      }
      const p = getCallsignProfile(codeStr);
      const nextLvl = p.classRank + 1;
      const cost = CLASS_RANK_UPGRADE_COSTS[nextLvl] || 9999;
      if (nextLvl <= 5 && p.credits >= cost) {
        p.credits -= cost;
        p.classRank = nextLvl;
        if (!p.boundClass) p.boundClass = selectedRunnerClass;
        safehouseUpgradesRemaining = Math.max(0, safehouseUpgradesRemaining - 1);
        if (p.savedRun) {
          p.savedRun.safehouseUpgradesLeft = safehouseUpgradesRemaining;
        }
        saveCallsignProfile(codeStr, p);
        rogueLevel = p.classRank;
        soundManager.play("grow", { pitch: 1.45, volume: 0.85 });
        renderCallsignBuilder();
      } else {
        soundManager.play("multihit", { pitch: 0.8, volume: 0.45 });
      }
    });
  }

  const respecBtn = container.querySelector("#respec-callsign-btn");
  if (respecBtn && complete) {
    respecBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (respecBtn.dataset.confirm === "1") {
        const p = getCallsignProfile(codeStr);
        p.boundClass = null;
        p.classRank = 1;
        p.savedRun = null;
        saveCallsignProfile(codeStr, p);
        soundManager.play("multihit", { pitch: 1.15, volume: 0.55 });
        renderCallsignBuilder();
      } else {
        respecBtn.dataset.confirm = "1";
        respecBtn.textContent = "CONFIRM RE-SPEC?";
        soundManager.play("bounce", { pitch: 1.2, volume: 0.35 });
      }
    });
  }
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
    return raw >= 950000 ? 0 : raw;
  } catch (err) {
    return memoryHighScore >= 950000 ? 0 : (memoryHighScore || 0);
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
    highScoreDisplay.textContent = `🏆 High Score: ${formatArcadeScore(board[0].score)} (${board[0].initials}) • Runner: ${runner}${modeTag}`;
  } else {
    const e = getHighScore();
    highScoreDisplay.textContent = `🏆 High Score: ${formatArcadeScore(e)} • Runner: ${runner}${modeTag}`;
  }
}

/**
 * Returns a rank string based on the final score and win/loss.
 * Calibrated for the 5-Level Board Replenishment & Multiplier curve!
 */
function getRating(score, won) {
  if (!won) {
    // ❌ Loss tiers (8) — scaled across Levels 1 to 5
    if (score < 1500)     return "System Glitch";
    if (score < 4000)     return "Code Ghost";
    if (score < 8500)     return "Memory Leak";
    if (score < 16000)    return "Burned Out";
    if (score < 28000)    return "Data Janitor";
    if (score < 48000)    return "Pixel Drifter";
    if (score < 80000)    return "Grid Runner";
                         return "Neon Operator";
  } else {
    // ✅ Win tiers (6) — All 5 Levels Cleared!
    if (score < 55000)    return "Neon Legend";
    if (score < 95000)    return "Circuit Surfer";
    if (score < 140000)   return "Hologram Hacker";
    if (score < 190000)   return "Beyond the Black Wall";
    if (score < 250000)   return "Synth Overlord";
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
      const bonus = [25, 40, 55][nextRank - 1] || 55;
      return `Magnetically pulls falling power-ups toward your paddle and triggers <strong>Wild Card Power-Up Roulette (+${bonus}×STG PTS)</strong>!`;
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
    emoji: "🎲",
    name: "CHAOS DIE CORE",
    rarity: "LEGENDARY",
    color: "#ffd700",
    maxRank: 3,
    getDesc: (nextRank) => {
      return `Rolls <strong>1D6 Gameplay Chaos</strong> on every bounce (Sparks, Pierce, 777 Frenzy, or Snake-Eyes Bust) + spins <strong>Wheel of Mayhem</strong> (Rank ${nextRank})!`;
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

function getContractScoreMultiplier() {
  if (!activeBreachContracts.length) return 1.0;
  let m = 1.0;
  activeBreachContracts.forEach(c => {
    if (c.scoreMult) m *= c.scoreMult;
  });
  return Math.round(m * 100) / 100;
}

function getContractBallSpeedMod() {
  let mod = 0;
  activeBreachContracts.forEach(c => {
    if (c.ballSpeedMod) mod += c.ballSpeedMod;
  });
  return mod;
}

function getContractPaddleWidthMod() {
  let mod = 0;
  activeBreachContracts.forEach(c => {
    if (c.paddleWidthMod) mod += c.paddleWidthMod;
  });
  return mod;
}

function getContractPaddleSpeedMod() {
  let mod = 0;
  activeBreachContracts.forEach(c => {
    if (c.paddleSpeedBonus) mod += c.paddleSpeedBonus;
  });
  return mod;
}

function getContractBonusDamage() {
  let bonus = 0;
  activeBreachContracts.forEach(c => {
    if (c.bonusHitDamage) bonus += c.bonusHitDamage;
  });
  return bonus;
}

function getContractCredMultiplier() {
  let mult = 1.0;
  activeBreachContracts.forEach(c => {
    if (c.credMult) mult *= c.credMult;
  });
  return mult;
}

function getContractFrenzyChargeMult() {
  let mult = 1.0;
  activeBreachContracts.forEach(c => {
    if (c.frenzyChargeMult) mult *= c.frenzyChargeMult;
  });
  return mult;
}

function getContractFrenzyBonusDuration() {
  let bonus = 0;
  activeBreachContracts.forEach(c => {
    if (c.frenzyDurationBonus) bonus += c.frenzyDurationBonus;
  });
  return bonus;
}

function getContractVaultChanceBonus() {
  let bonus = 0;
  activeBreachContracts.forEach(c => {
    if (c.vaultChanceBonus) bonus += c.vaultChanceBonus;
  });
  return bonus;
}

function getContractArmorChanceBonus() {
  let bonus = 0;
  activeBreachContracts.forEach(c => {
    if (c.armorChanceBonus) bonus += c.armorChanceBonus;
  });
  return bonus;
}

function getSectorScoreMultiplier() {
  return Math.round(Math.max(1, currentSector) * getContractScoreMultiplier() * 100) / 100;
}

function getBoardDifficultySpeedMultiplier() {
  let mult = 1 + (Math.max(1, currentSector) - 1) * 0.12 + getContractBallSpeedMod();
  // Class speed buffs & handicaps:
  if (selectedRunnerClass === "striker") {
    mult *= 1.10; // Striker Buff: +10% faster aggressive ball
  } else if (selectedRunnerClass === "guardian") {
    mult *= 0.90; // Guardian Handicap: -10% slower ball velocity
  } else if (selectedRunnerClass === "highroller") {
    mult *= 1.10; // High-Roller Handicap: +10% high-stakes speed
  }
  if (isNeonLegend) {
    mult *= 1.08; // Neon Legend Overdrive: +8% overdrive speed
  }
  return mult;
}

function getSlowMoScoreMultiplier() {
  const slowStacks = activePowerUps["slow-mo"]?.length || 0;
  if (slowStacks <= 0) return 1;
  return [1.5, 1.75, 2.0][Math.min(slowStacks, 3) - 1] || 2.0;
}

function getNeonLegendMultiplier() {
  return isNeonLegend ? 1.5 : 1.0;
}

function getStrikerStreakMultiplier() {
  if (selectedRunnerClass !== "striker") return 1.0;
  const maxCap = rogueLevel >= 4 ? 1.40 : 1.35;
  const bonus = 1.12 + Math.min(unbrokenBrickStreak, 8) * 0.035;
  return Math.min(maxCap, Math.round(bonus * 100) / 100);
}

function getGuardianFortressMultiplier() {
  if (selectedRunnerClass !== "guardian") return 1.0;
  const aegisRank = getAugmentRank("aegis");
  if (aegisRank > 0) {
    if (!aegisReady) return 1.0;
    return [1.30, 1.35, 1.40][Math.min(aegisRank, 3) - 1] || 1.30;
  }
  return getAugmentRank("titan") > 0 ? 1.20 : 1.0;
}

function getDemolisherBaseMultiplier() {
  if (selectedRunnerClass !== "demolisher") return 1.0;
  return [1.15, 1.18, 1.20, 1.22, 1.25][Math.min(Math.max(rogueLevel, 1), 5) - 1] || 1.15;
}

function getGreedScoreMultiplier() {
  if (selectedRunnerClass === "highroller") {
    return highRollerDiceMultiplier || 1.10;
  }
  const r = getAugmentRank("greed");
  if (r <= 0) return 1;
  return [1.15, 1.22, 1.30][Math.min(r, 3) - 1] || 1.30;
}

function getClassSkillScoreMultiplier() {
  if (selectedRunnerClass === "striker") return getStrikerStreakMultiplier();
  if (selectedRunnerClass === "guardian") return getGuardianFortressMultiplier();
  if (selectedRunnerClass === "demolisher") return getDemolisherBaseMultiplier();
  if (selectedRunnerClass === "highroller") return getGreedScoreMultiplier();
  return 1.0;
}

function getTotalActiveScoreMultiplier() {
  const expandoStacks = activePowerUps["wide-paddle"]?.length || 0;
  const boardMult = getSectorScoreMultiplier();
  const slowMult = getSlowMoScoreMultiplier();
  const legendMult = getNeonLegendMultiplier();
  const classMult = getClassSkillScoreMultiplier();
  return boardMult * (expandoStacks + 1) * slowMult * legendMult * classMult;
}

function updateMultiplierBadge() {
  const badge = document.getElementById("score-multiplier");
  if (!badge) return;
  const totalMult = getTotalActiveScoreMultiplier();
  if (totalMult > 1.04 && !gameOver) {
    const formatted = Number.isInteger(Math.round(totalMult * 10) / 10)
      ? Math.round(totalMult)
      : totalMult.toFixed(1);
    badge.textContent = `${isNeonLegend ? "😎" : ""}×${formatted}`;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

// ─── Skill Rally Meter ➔ ⚡ FRENZY READY! ➔ 🚨 LASER FRENZY! (2.0s Overdrive) ───
function triggerLaserFrenzy(customDurationSec = 0) {
  const baseDur = customDurationSec > 0 ? customDurationSec : 2.0;
  frenzyMaxDuration = baseDur;
  frenzyTimerLeft = Math.max(frenzyTimerLeft, baseDur);
  frenzyMeter = 100;
  frenzyReady = false;
  isLaserActive = true;
  paddle.classList.add("paddle-armed", "laser-tier-3");
  if (gameArea) gameArea.classList.add("laser-frenzy-arena");

  soundManager.play("laserFire", { pitch: 1.48, volume: 0.9 });
  playVictoryFanfareSynth(false);

  showNotification({
    title: "🚨 LASER FRENZY ACTIVATED! 🚨",
    emoji: "🚨",
    name: `LASER FRENZY! (${baseDur.toFixed(1)}S)`,
    description: "TWIN RAPID-FIRE GATLING CANNONS UNLEASHED!",
    color: "#ff2a55",
    mode: "burst",
    duration: 1450
  }, { x: paddleX });

  syncRogueHUD();
}

function activateReadyLaserFrenzy() {
  if (gameOver || !gameRunning || isLevelIntermissionOpen) return false;
  if (!frenzyReady || frenzyTimerLeft > 0) return false;
  triggerLaserFrenzy();
  return true;
}

function addSkillRallyFrenzyCharge(baseAmount = 10, isPaddleBounce = false) {
  if (gameOver || attractArenaActive) return;
  if (isPaddleBounce) {
    rallyBounceCount++;
  }
  if (frenzyTimerLeft > 0 || frenzyReady) {
    syncRogueHUD();
    return;
  }
  const gain = baseAmount * getContractFrenzyChargeMult();
  frenzyMeter = Math.min(100, frenzyMeter + gain);
  if (frenzyMeter >= 100) {
    frenzyMeter = 100;
    frenzyReady = true;
    soundManager.play("powerUpSpawn", { pitch: 1.85, volume: 0.95 });
    playVictoryFanfareSynth(false);
    showNotification({
      title: "⚡ SKILL RALLY 100% CHARGED! ⚡",
      emoji: "🚨",
      name: "FRENZY READY!",
      description: "PRESS [F] OR [SPACE] TO UNLEASH LASERS!",
      color: "#ffd700",
      mode: "jumbotron",
      duration: 2400
    });
    showNotification({
      title: "⚡ PRESS [F] OR [SPACE] ⚡",
      emoji: "🚨",
      name: "FRENZY READY!",
      description: "HIT [F] OR [SPACE] ANYTIME!",
      color: "#ffd700",
      mode: "burst",
      duration: 1850
    }, { x: paddleX });
  }
  syncRogueHUD();
}

function awardRunCredsForBrick(brick) {
  if (gameOver || attractArenaActive) return;
  let baseCreds = 2;
  if (brick && brick.isPinataBrick) baseCreds = 15;
  else if (brick && brick.isVaultBrick) baseCreds = 12;
  else if (brick && brick.hitsRequired > 1) baseCreds = 5;
  const gained = Math.max(1, Math.round(baseCreds * getContractCredMultiplier()));
  runUnbankedCreds += gained;
  syncRogueHUD();
}

function fireHighRollerSparkFan(boltCount = 1) {
  const boltWidth = 8;
  const boltHeight = 18;
  const paddleTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
  const spreadVx = boltCount >= 3 ? [-210, 0, 210] : [((Math.random() < 0.5 ? -1 : 1) * (95 + Math.random() * 85))];

  spreadVx.forEach((vx, idx) => {
    const offsetX = boltCount >= 3 ? (idx - 1) * 18 : 0;
    const clampedX = Math.max(6, Math.min(GAME_WIDTH - boltWidth - 6, paddleX + offsetX - boltWidth / 2));
    const bolt = {
      x: clampedX,
      y: paddleTop - boltHeight - 2,
      vx,
      speed: LASER_SPEED * 1.08,
      width: boltWidth,
      height: boltHeight,
      damage: 1 + getContractBonusDamage(),
      bonusPts: 8,
      laserMult: 1.0,
      source: "highroller-spark"
    };
    const el = document.createElement("div");
    el.className = "laser-bolt highroller-spark-bolt";
    el.style.left = `${bolt.x}px`;
    el.style.top = `${bolt.y}px`;
    gameArea.appendChild(el);
    bolt.element = el;
    lasers.push(bolt);
  });
  soundManager.play("laserFire", { pitch: boltCount >= 3 ? 1.65 : 1.42, volume: 0.55 });
}

function mutateRandomBrickIntoPinata() {
  const intact = bricks.filter(b => !b.isBroken && !b.isPinataBrick);
  if (intact.length === 0) return false;
  const pool = getEquippedLoadoutPool();
  const pickMod = pool[Math.floor(Math.random() * pool.length)] || "wide-paddle";
  const target = intact[Math.floor(Math.random() * intact.length)];
  target.powerUpType = pickMod;
  target.isPinataBrick = true;
  if (target.element) {
    target.element.classList.add("pinata-brick");
  }
  return true;
}

function triggerWheelOfMayhem() {
  // Legacy no-op: High-Roller Piñata mutations now trigger directly on paddle bounce rolls!
}

function rollHighRollerCyberDice() {
  if (selectedRunnerClass !== "highroller" || gameOver) return;
  let d = Math.floor(Math.random() * 6) + 1;
  // L5 Loaded Die: Never rolls a 1!
  if (rogueLevel >= 5 && d === 1) {
    d = 6;
  }
  highRollerLastRoll = d;

  if (d === 1) {
    // [1] Snake Eyes Bust: -20% temporary paddle shrink & ×0.75 brick points!
    highRollerDiceMultiplier = 0.75;
    highRollerBustShrink = true;
    highRollerBankCurveActive = false;
    updatePaddleWidth();
    showNotification({
      title: "🎲 CHAOS DIE: ROLLED [1]",
      emoji: "🐍",
      name: `SNAKE EYES BUST ×${highRollerDiceMultiplier}`,
      description: "-20% PADDLE SHRINK THIS VOLLEY!",
      color: "#ff5577",
      mode: "burst"
    }, { x: paddleX });
  } else if (d <= 3) {
    // [2–3] Bank-Shot English: +6 bank bonus pts & ×1.08 brick points
    highRollerDiceMultiplier = 1.08;
    highRollerBustShrink = false;
    highRollerBankCurveActive = true;
    updatePaddleWidth();
    showNotification({
      title: `🎲 CHAOS DIE: ROLLED [${d}]`,
      emoji: "🎱",
      name: "BANK-SHOT ENGLISH!",
      description: "+6 BANK BONUS PTS • ×1.08 VOLLEY!",
      color: "#00ffff",
      mode: "burst"
    }, { x: paddleX });
  } else if (d <= 5) {
    // [4–5] Trick-Shot Spark (+ L3 Piñata Brick mutation!)
    highRollerDiceMultiplier = 1.18;
    highRollerBustShrink = false;
    highRollerBankCurveActive = false;
    updatePaddleWidth();
    fireHighRollerSparkFan(rogueLevel >= 5 ? 3 : 1);
    const madePinata = rogueLevel >= 3 ? mutateRandomBrickIntoPinata() : false;
    showNotification({
      title: `🎲 CHAOS DIE: ROLLED [${d}]`,
      emoji: madePinata ? "🎁" : "✨",
      name: madePinata ? "SPARK + 🎁 PIÑATA BRICK!" : "TRICK-SHOT SPARK!",
      description: madePinata ? "RICOCHET SPARK & MUTATED A +15¢ PIÑATA!" : "RICOCHET SPARK BOLT • ×1.18 VOLLEY!",
      color: "#ffd700",
      mode: "burst"
    }, { x: paddleX });
  } else {
    // [6] 777 JACKPOT: 1 Pierce + Spark Fan + +35% Frenzy Charge (or instant 3.5s Laser Frenzy at L4+!)
    highRollerDiceMultiplier = rogueLevel >= 5 ? 1.35 : 1.30;
    highRollerBustShrink = false;
    highRollerBankCurveActive = true;
    updatePaddleWidth();

    pierceChargesLeft = Math.max(pierceChargesLeft, 1);
    ball.classList.add("ball-piercing");
    fireHighRollerSparkFan(rogueLevel >= 5 ? 3 : 1);
    if (rogueLevel >= 3) mutateRandomBrickIntoPinata();

    if (rogueLevel >= 4) {
      magSlingshotCharges = Math.max(magSlingshotCharges, 1);
      ball.classList.add("ball-slingshot");
      if (frenzyTimerLeft > 0) {
        triggerLaserFrenzy(3.5);
      } else {
        addSkillRallyFrenzyCharge(100, false);
      }
    } else {
      addSkillRallyFrenzyCharge(35, false);
      soundManager.play("powerUpSpawn", { pitch: 1.65, volume: 0.65 });
      showNotification({
        title: "🎲 CHAOS DIE: ROLLED [6]!",
        emoji: "🔥",
        name: `HOT HAND ×${highRollerDiceMultiplier}!`,
        description: "1× PIERCE + SPARK + +35% FRENZY CHARGE!",
        color: "#ffd700",
        mode: "burst"
      }, { x: paddleX });
    }
  }
  syncRogueHUD();
}

function recordBrickBrokenStreak(brick = null) {
  totalBricksBrokenInRun++;
  unbrokenBrickStreak++;
  awardRunCredsForBrick(brick);
  addSkillRallyFrenzyCharge(3.5, false);
  if (!isNeonLegend && (unbrokenBrickStreak >= 10 || score >= 5000)) {
    isNeonLegend = true;
    if (!isCatMode) {
      BALL_EMOJI = "😎";
      ball.textContent = "😎";
    }
    ball.classList.add("neon-legend-active");
    showNotification("neon-legend");
    soundManager.play("winSong");
  }
  updateMultiplierBadge();
}

function resetBrickStreakOnMiss() {
  unbrokenBrickStreak = 0;
  catBounceCombo = 0;
  rallyBounceCount = 0;
  if (frenzyTimerLeft <= 0 && !frenzyReady) {
    frenzyMeter = 0;
  }
  if (isNeonLegend) {
    isNeonLegend = false;
    ball.classList.remove("neon-legend-active");
    if (!isCatMode) {
      BALL_EMOJI = "😊";
      ball.textContent = "😊";
    }
  }
  syncRogueHUD();
  updateMultiplierBadge();
}

const BOARD_LEVEL_THEMES = {
  1: { name: "NEON GRID",         emoji: "🌐", color: "#00ffff", sub: "STANDARD GRID ONLINE" },
  2: { name: "DEEP ULTRAVIOLET",  emoji: "🔮", color: "#b84dff", sub: "SYNTH GRID • ESCALATING STAKES" },
  3: { name: "CRIMSON BREACH",    emoji: "🔥", color: "#ff2a55", sub: "FIREWALL ALERT • HIGH VOLTAGE" },
  4: { name: "SOLAR OVERLOAD",    emoji: "⚠️", color: "#ff9900", sub: "CORE MELTDOWN • HEAVY ARMOR" },
  5: { name: "BLACKWALL ABYSS",   emoji: "👑", color: "#ffd700", sub: "DEEP NET CORE • EXTREME PAYOUT" },
  6: { name: "QUANTUM SINGULARITY", emoji: "🌀", color: "#00ff88", sub: "OVERCLOCKED MATRIX • INFINITE TIER" },
  7: { name: "NEURAL ECLIPSE",    emoji: "👁️", color: "#ff00ff", sub: "ROGUE AI TERRITORY • INFINITE TIER" },
  8: { name: "OMEGA CITADEL",     emoji: "⚡", color: "#00e5ff", sub: "APEX GRID • INFINITE TIER" }
};

function getSectorTheme(sectorNum = 1) {
  if (BOARD_LEVEL_THEMES[sectorNum]) return BOARD_LEVEL_THEMES[sectorNum];
  const cycleIdx = ((sectorNum - 1) % 8) + 1;
  const base = BOARD_LEVEL_THEMES[cycleIdx] || BOARD_LEVEL_THEMES[5];
  return {
    ...base,
    name: `${base.name} MK-${Math.ceil(sectorNum / 8)}`
  };
}

function syncBoardLevelAtmosphere() {
  const lvl = (((Math.max(1, currentSector || 1) - 1) % 5) + 1);
  if (gameArea) {
    gameArea.setAttribute("data-board-level", String(lvl));
  }
  if (document.body) {
    document.body.setAttribute("data-board-level", String(lvl));
  }
}

function initRogueProgression() {
  currentSector = 1;
  sectorsCleared = 0;
  syncActiveCallsignClassBinding();
  const profile = isCallsignComplete() ? getCallsignProfile(getLastInitials()) : getCallsignProfile("");
  rogueLevel = profile.classRank || 1;
  rogueXP = 0;
  rogueXPToNext = 12;
  activeAugments = {};
  isDraftModalOpen = false;
  isLevelIntermissionOpen = false;
  pendingDraftReasons = [];
  currentDraftChoices = [];
  novaBrickCounter = 0;
  turretFireAccum = 0;
  laserAutoFireAccum = 0;
  aegisReady = false;
  aegisCooldownLeft = 0;
  pierceChargesLeft = 0;
  magSlingshotCharges = 0;
  caughtByMagLock = false;
  unbrokenBrickStreak = 0;
  catBounceCombo = 0;
  highRollerDiceMultiplier = 1.10;
  highRollerLastRoll = null;
  highRollerBustShrink = false;
  highRollerBankCurveActive = false;
  highRollerMayhemCounter = 0;
  guardianAegisBeamCounter = 0;
  demolisherNovaArmed = false;
  totalBricksBrokenInRun = 0;
  frenzyMeter = 0;
  frenzyReady = false;
  frenzyTimerLeft = 0;
  frenzyMaxDuration = 4.5;
  rallyBounceCount = 0;
  runUnbankedCreds = 0;
  lastRunRawScoreBeforePenalty = 0;
  lastRunPenaltyAmount = 0;
  lastRunCredsEarned = 0;
  lastRunCredsLost = 0;
  activeBreachContracts = [];
  currentContractOffers = [];
  draftResumeGraceTimer = 0;
  const rogueHud = document.getElementById("rogue-hud");
  if (rogueHud) rogueHud.style.display = "none";
  const aegisBar = document.getElementById("aegis-barrier-bar");
  if (aegisBar) aegisBar.style.display = "none";
  if (gameArea) gameArea.classList.remove("laser-frenzy-arena");
  ball.classList.remove("ball-piercing", "ball-slingshot", "neon-legend-active");
  syncPaddleClassVisual();
  syncBoardLevelAtmosphere();
}

function applyRunnerClassTier() {
  syncActiveCallsignClassBinding();
  const cDef = getSelectedClassDef();
  const tierIndex = Math.max(0, Math.min(cDef.tiers.length - 1, rogueLevel - 1));
  const tier = cDef.tiers[tierIndex];
  const prevAegis = getAugmentRank("aegis");

  activeAugments = { ...(tier ? tier.augments : {}) };
  syncPaddleClassVisual();
  updatePaddleWidth();

  const newAegis = getAugmentRank("aegis");
  if (newAegis > 0 && prevAegis === 0) {
    aegisReady = true;
    aegisCooldownLeft = 0;
  }

  const pierceRank = getAugmentRank("pierce");
  if (pierceRank > 0 && ballIsStuck) {
    pierceChargesLeft = pierceRank;
    ball.classList.add("ball-piercing");
  }

  syncRogueHUD();
  return tier;
}

function syncRogueHUD() {
  const rogueHud = document.getElementById("rogue-hud");
  if (!rogueHud) return;
  const classBadge = document.getElementById("rogue-class-badge");
  const xpFill = document.getElementById("rogue-xp-fill");
  const xpText = document.getElementById("rogue-xp-text");
  const nextPerk = document.getElementById("rogue-next-perk");

  const cDef = getSelectedClassDef();
  rogueHud.style.setProperty("--class-color", frenzyTimerLeft > 0 ? "#ff2a55" : cDef.color);

  if (classBadge) {
    const boardMult = getSectorScoreMultiplier();
    const extraTag = selectedRunnerClass === "highroller" && highRollerLastRoll
      ? ` • 🎲[${highRollerLastRoll}]`
      : "";
    classBadge.textContent = `${cDef.emoji} ${cDef.name} L${rogueLevel} • STAGE ${currentSector} (×${boardMult}${extraTag}) • 💰 +${formatArcadeScore(runUnbankedCreds)}¢`;
  }
  syncBoardLevelAtmosphere();
  updateMultiplierBadge();

  const frenzyTrack = document.getElementById("frenzy-meter-bar");
  const frenzyActionPill = document.getElementById("frenzy-bar-action-pill");

  if (frenzyTrack) {
    frenzyTrack.classList.toggle("frenzy-track-active", frenzyTimerLeft > 0);
    frenzyTrack.classList.toggle("frenzy-track-ready", frenzyTimerLeft <= 0 && (frenzyReady || frenzyMeter >= 100));
  }

  if (xpFill) {
    if (frenzyTimerLeft > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((frenzyTimerLeft / Math.max(0.5, frenzyMaxDuration)) * 100)));
      xpFill.style.width = `${pct}%`;
      xpFill.classList.add("frenzy-active-fill");
      xpFill.classList.remove("frenzy-ready-fill");
    } else if (frenzyReady || frenzyMeter >= 100) {
      xpFill.style.width = "100%";
      xpFill.classList.remove("frenzy-active-fill");
      xpFill.classList.add("frenzy-ready-fill");
    } else {
      const pct = Math.max(0, Math.min(100, Math.round(frenzyMeter)));
      xpFill.style.width = `${pct}%`;
      xpFill.classList.remove("frenzy-active-fill", "frenzy-ready-fill");
    }
  }
  if (xpText) {
    if (frenzyTimerLeft > 0) {
      xpText.textContent = `🚨 LASER FRENZY OVERDRIVE! ${frenzyTimerLeft.toFixed(1)}S REMAINING 🚨`;
    } else if (frenzyReady || frenzyMeter >= 100) {
      xpText.textContent = `⚡ FRENZY 100% READY! — PRESS [F] OR [SPACE] TO FIRE! ⚡`;
    } else {
      xpText.textContent = `SKILL RALLY CHARGE: ${Math.round(frenzyMeter)}% (×${rallyBounceCount} BOUNCES)`;
    }
  }
  if (frenzyActionPill) {
    if (frenzyTimerLeft > 0) {
      frenzyActionPill.textContent = `🔥 ${frenzyTimerLeft.toFixed(1)}S`;
    } else if (frenzyReady || frenzyMeter >= 100) {
      frenzyActionPill.textContent = `🚀 FIRE [F / SPACE]`;
    } else {
      frenzyActionPill.textContent = `${Math.round(frenzyMeter)}%`;
    }
  }
  const frenzyBanner = document.getElementById("frenzy-ready-banner");
  const showFrenzyPrompt = Boolean((frenzyReady || frenzyMeter >= 100) && frenzyTimerLeft <= 0 && !gameOver && !isLevelIntermissionOpen);
  if (frenzyBanner) {
    frenzyBanner.style.display = showFrenzyPrompt ? "flex" : "none";
  }
  if (paddle) {
    paddle.classList.toggle("paddle-frenzy-ready", showFrenzyPrompt);
  }
  if (nextPerk) {
    const activeTier = cDef.tiers[Math.min(cDef.tiers.length - 1, rogueLevel - 1)] || cDef.tiers[0];
    const classPillHTML = `<span class="hud-tier-pill tier-active" data-popover-class="${cDef.id}" data-popover-tier="${activeTier.level}"><strong>L${rogueLevel}</strong> ${activeTier.label}</span>`;
    const contractPillsHTML = activeBreachContracts.map(c =>
      `<span class="hud-tier-pill contract-active-pill" data-popover-contract="${c.id}" style="--contract-color: ${c.color};">${c.emoji} ${c.name}</span>`
    ).join("");
    const nextSafehouseStg = Math.ceil(Math.max(1, currentSector) / 5) * 5;
    const safehousePillHTML = `<span class="hud-tier-pill tier-unlocked">🏠 SAFEHOUSE: STG ${currentSector}/${nextSafehouseStg}</span>`;
    nextPerk.innerHTML = classPillHTML + contractPillsHTML + safehousePillHTML;
    bindHoverPopoverEvents(nextPerk);
  }

  // Update bottom Aegis Barrier Bar (Guardian Class)
  const aegisBar = document.getElementById("aegis-barrier-bar");
  if (aegisBar) {
    const aegisRank = getAugmentRank("aegis");
    if (aegisRank <= 0 || gameOver) {
      aegisBar.style.display = "none";
    } else {
      aegisBar.style.display = "flex";
      const fortMult = getGuardianFortressMultiplier();
      if (aegisReady) {
        aegisBar.className = "aegis-barrier-bar aegis-charged";
        aegisBar.innerHTML = `<span>🛡️ AEGIS FORCEFIELD READY (×${fortMult.toFixed(2).replace(/0$/, "")} FORTRESS PTS${aegisRank >= 2 ? " • PARRY FIRES HOMING AEGIS BEAM!" : " • REBOUNDS + 2× COUNTER-ZAP!"}) 🛡️</span>`;
      } else {
        aegisBar.className = "aegis-barrier-bar aegis-recharging";
        aegisBar.innerHTML = `<span>⏳ AEGIS FORCEFIELD RECHARGING (${Math.ceil(aegisCooldownLeft)}s)...</span>`;
      }
    }
  }
}

function awardRogueXP() {
  // Permanent Class Progression is now upgraded with Cyber-Creds (¢) in your Callsign Safehouse!
  syncRogueHUD();
}

function damageOrBreakBrickByAugment(brick, damageHits = 1, bonusFlatPts = 10) {
  if (!brick || brick.isBroken) return;
  brick.hitsTaken += (damageHits + getContractBonusDamage());

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
    if (justBounced) {
      points += (selectedRunnerClass === "highroller" && highRollerBankCurveActive) ? 6 : 2;
    }
    if (expandoStacks > 0) points *= (expandoStacks + 1);
    points *= (rowBonusLevel + 1);
    const siegeMult = selectedRunnerClass === "demolisher" ? 1.35 : 1.0;
    if (brick.isVaultBrick) {
      points = Math.round(points * 3.0 * siegeMult);
    } else if (brick.hitsRequired > 1) {
      points = Math.round(points * 1.6 * siegeMult);
    }
    points = Math.round(
      points *
      getSectorScoreMultiplier() *
      getClassSkillScoreMultiplier() *
      getSlowMoScoreMultiplier() *
      getNeonLegendMultiplier()
    );
    if (isCatMode) points = points - (points % 10) + 9;

    score += points;
    if (isCatMode) score = score - (score % 10) + 9;
    scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;

    showBrickScore(brick.x + brick.width / 2, brick.y, points);

    if (typeof brick.row === "number" && !brick.isExtraSpawn) {
      evaluateRowClear(brick.row);
    }
    if (brick.powerUpType) {
      spawnPowerUp(brick.powerUpType, brick);
    }
    recordBrickBrokenStreak(brick);
  } else {
    soundManager.play("multihit", { pitch: 1.2, volume: 0.65 });
    brick.element.classList.add("damaged");
    brick.element.classList.remove("shake");
    void brick.element.offsetWidth;
    brick.element.classList.add("shake");
  }
}

function triggerTeslaArcBolts(overrideCount = 0) {
  const rank = overrideCount > 0 ? overrideCount : getAugmentRank("tesla");
  if (rank <= 0) return;
  const intact = bricks.filter(b => !b.isBroken);
  if (intact.length === 0) return;

  const padTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
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

    damageOrBreakBrickByAugment(target, 1, 10);
  });
}

function triggerPlasmaNova(originBrick) {
  const rank = getAugmentRank("nova");
  if (rank <= 0 || !originBrick || !demolisherNovaArmed) return;
  demolisherNovaArmed = false;

  const cx = originBrick.x + originBrick.width / 2;
  const cy = originBrick.y + originBrick.height / 2;
  const blastRadius = 115 + rank * 22;

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
      damageOrBreakBrickByAugment(b, 1, 14);
    }
  });
}

function fireGuardianBastionMortar(absImpactPos = 0.5) {
  if (selectedRunnerClass !== "guardian") return;
  const titanRank = Math.max(1, getAugmentRank("titan"));
  const parryWindow = titanRank >= 3 ? 0.48 : (titanRank === 2 ? 0.43 : 0.38);
  const isPerfectParry = absImpactPos <= parryWindow;

  const paddleTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
  const count = Math.min(3, titanRank);
  const wingSpread = Math.max(16, paddleWidth * 0.27);
  const offsets = count === 1
    ? [0]
    : (count === 2 ? [-wingSpread * 0.65, wingSpread * 0.65] : [-wingSpread, 0, wingSpread]);

  const w = isPerfectParry ? 10 : 7;
  const h = isPerfectParry ? 24 : 18;
  const splashRadius = isPerfectParry ? (titanRank >= 3 ? 98 : 74) : 0;

  offsets.forEach(dx => {
    const bx = Math.max(6, Math.min(GAME_WIDTH - w - 6, paddleX + dx - w / 2));
    const el = document.createElement("div");
    el.className = isPerfectParry
      ? "laser-bolt guardian-mortar-bolt guardian-parry-bolt"
      : "laser-bolt guardian-mortar-bolt";
    el.style.left = `${bx}px`;
    el.style.top = `${paddleTop - h}px`;
    gameArea.appendChild(el);
    lasers.push({
      element: el,
      x: bx,
      y: paddleTop - h,
      width: w,
      height: h,
      damage: (isPerfectParry ? 2 : 1) + getContractBonusDamage(),
      bonusPts: isPerfectParry ? 10 : 5,
      laserMult: 1.0,
      speed: LASER_SPEED * (isPerfectParry ? 1.12 : 0.96),
      splashRadius,
      source: "guardian-mortar"
    });
  });

  if (isPerfectParry) {
    paddle.classList.remove("guardian-parry-flash");
    void paddle.offsetWidth;
    paddle.classList.add("guardian-parry-flash");
    soundManager.play("laserFire", { pitch: 1.32, volume: 0.52 });

    // At Guardian L4+ (aegisRank >= 2), every Perfect Parry also fires a Homing Emerald Aegis Beam from the floor shield!
    if (getAugmentRank("aegis") >= 2 && aegisReady) {
      triggerGuardianAegisBeamFromParry();
    }

    showNotification({
      title: "🛡️ PERFECT PARRY!",
      emoji: "🛡️",
      name: count > 1 ? `${count}× OVERCHARGED MORTARS` : "OVERCHARGED MORTAR",
      description: "CENTER CATCH: 2× ARMOR DMG + EMERALD SPLASH!",
      color: "#39ff14",
      mode: "burst",
      duration: 900
    }, { x: paddleX });
  } else {
    soundManager.play("laserFire", { pitch: 0.98, volume: 0.34 });
  }
}

function triggerGuardianAegisBeamFromParry() {
  if (selectedRunnerClass !== "guardian") return;
  const aegisRank = getAugmentRank("aegis");
  if (aegisRank <= 0 || !aegisReady) return;

  const candidates = bricks
    .filter(b => !b.isBroken)
    .sort((a, b) => (b.y - a.y) || (Math.abs((a.x + a.width / 2) - paddleX) - Math.abs((b.x + b.width / 2) - paddleX)));
  if (candidates.length === 0) return;

  const target = candidates[0];
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const startX = Math.max(40, Math.min(GAME_WIDTH - 40, paddleX));
  const startY = GAME_HEIGHT - 10;

  const dx = tx - startX;
  const dy = ty - startY;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const beamEl = document.createElement("div");
  beamEl.className = "tesla-arc-bolt guardian-aegis-beam";
  beamEl.style.left = `${startX}px`;
  beamEl.style.top = `${startY}px`;
  beamEl.style.width = `${length}px`;
  beamEl.style.transform = `rotate(${angle}deg)`;
  gameArea.appendChild(beamEl);
  setTimeout(() => beamEl.remove(), 300);

  soundManager.play("laserFire", { pitch: 1.5, volume: 0.55 });
  damageOrBreakBrickByAugment(target, aegisRank >= 3 ? 2 : 1, 10);
}

function triggerGuardianAegisBeam() {
  // Replaced by paddle-bounce Perfect Parry Aegis Beam for 1-to-1 player cause & effect!
}

function handleAegisFloorSave() {
  const rank = getAugmentRank("aegis");
  if (rank <= 0 || !aegisReady) return false;

  aegisReady = false;
  aegisCooldownLeft = [16, 10, 7][Math.min(rank, 3) - 1] || 7;
  resetBrickStreakOnMiss();
  ballY = GAME_HEIGHT - BALL_SIZE - 16;
  ballSpeedY = -Math.max(Math.abs(ballSpeedY), INITIAL_BALL_SPEED * 1.15);
  soundManager.play("magActivate", { pitch: 1.25, volume: 0.9 });

  const counterTargets = bricks
    .filter(b => !b.isBroken)
    .sort((a, b) => b.y - a.y)
    .slice(0, 2);
  const startX = ballX + BALL_SIZE / 2;
  const startY = GAME_HEIGHT - 12;
  counterTargets.forEach(target => {
    const tx = target.x + target.width / 2;
    const ty = target.y + target.height / 2;
    const dx = tx - startX;
    const dy = ty - startY;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const beamEl = document.createElement("div");
    beamEl.className = "tesla-arc-bolt guardian-aegis-beam";
    beamEl.style.left = `${startX}px`;
    beamEl.style.top = `${startY}px`;
    beamEl.style.width = `${length}px`;
    beamEl.style.transform = `rotate(${angle}deg)`;
    gameArea.appendChild(beamEl);
    setTimeout(() => beamEl.remove(), 320);
    damageOrBreakBrickByAugment(target, 1, 12);
  });

  showNotification({
    title: "🛡️ AEGIS COUNTER-ZAP SAVE!",
    emoji: "🛡️",
    name: "REBOUND + 2× AEGIS ZAP!",
    description: `RECHARGING IN ${aegisCooldownLeft}S`,
    color: "#39ff14",
    mode: "burst"
  }, { x: ballX + BALL_SIZE / 2 });

  syncRogueHUD();
  return true;
}

function fireAutoTurretVolley() {
  const turretRank = Math.max(1, getAugmentRank("turret"));
  const boltWidth = turretRank >= 3 ? 7 : 5;
  const boltHeight = turretRank >= 3 ? 22 : 18;
  const paddleTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
  const wingOffset = Math.max(16, paddleWidth * 0.34);
  [paddleX - wingOffset - boltWidth / 2, paddleX + wingOffset - boltWidth / 2].forEach(bx => {
    const clampedX = Math.max(4, Math.min(GAME_WIDTH - boltWidth - 4, bx));
    const bolt = {
      x: clampedX,
      y: paddleTop - boltHeight,
      width: boltWidth,
      height: boltHeight,
      damage: (turretRank >= 3 ? 2 : 1) + getContractBonusDamage(),
      bonusPts: 8,
      laserMult: 1.0,
      source: "turret"
    };
    const el = document.createElement("div");
    el.className = "laser-bolt turret-auto-bolt";
    el.style.left = `${bolt.x}px`;
    el.style.top = `${bolt.y}px`;
    gameArea.appendChild(el);
    bolt.element = el;
    lasers.push(bolt);
  });
  soundManager.play("laserFire", { pitch: 1.55, volume: 0.38 });
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

  // 🚨 LASER FRENZY Overdrive Countdown & Rapid Dual-Cannon Auto-Fire!
  if (frenzyTimerLeft > 0 && !ballIsStuck) {
    frenzyTimerLeft = Math.max(0, frenzyTimerLeft - dt);
    laserAutoFireAccum += dt;
    if (laserAutoFireAccum >= 0.18) {
      laserAutoFireAccum = 0;
      spawnLaserVolley(2, true);
    }
    if (frenzyTimerLeft <= 0) {
      frenzyMeter = 0;
      frenzyReady = false;
      if (gameArea) gameArea.classList.remove("laser-frenzy-arena");
      if (!(typeof isHackModeActive === "function" && isHackModeActive("juice"))) {
        isLaserActive = false;
        paddle.classList.remove("paddle-armed", "laser-tier-1", "laser-tier-2", "laser-tier-3");
      }
    }
    syncRogueHUD();
  } else if (typeof isHackModeActive === "function" && isHackModeActive("juice") && !ballIsStuck) {
    laserAutoFireAccum += dt;
    if (laserAutoFireAccum >= 0.22) {
      laserAutoFireAccum = 0;
      spawnLaserVolley(2, true);
    }
  }
}

// ─── Anti-Mash Modal Input Lock & Victory Fanfare Synth ───
let modalInputUnlockTime = 0;
let levelStartLaunchGuardUntil = 0;
let isSpaceHeldDown = false;
let spaceReleasedSinceModalOpen = true;
let isFinalLevelIntermission = false;
let modalGuardTimer = null;

function armModalInputGuard(lockMs = 1150, btnId = "intermission-extract-btn") {
  modalInputUnlockTime = performance.now() + lockMs;
  spaceReleasedSinceModalOpen = !isSpaceHeldDown;
  if (modalGuardTimer) clearTimeout(modalGuardTimer);

  const btn = document.getElementById(btnId);
  if (btn) {
    btn.classList.add("btn-arming-guard");
    btn.style.setProperty("--guard-ms", `${lockMs}ms`);
  }
  modalGuardTimer = setTimeout(() => {
    const targetBtn = document.getElementById(btnId);
    if (targetBtn) {
      targetBtn.classList.remove("btn-arming-guard");
    }
  }, lockMs);
}

function isModalInputReady(fromKeyboard = false) {
  if (performance.now() < modalInputUnlockTime) return false;
  if (fromKeyboard && !spaceReleasedSinceModalOpen) return false;
  return true;
}

function playVictoryFanfareSynth(isGrandFinale = false) {
  if (soundManager.isMuted) return;
  try {
    soundManager.init();
    const ctx = soundManager.context;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const notes = isGrandFinale
      ? [
          { f: 523.25, t: 0.00, d: 0.16 }, // C5
          { f: 659.25, t: 0.14, d: 0.16 }, // E5
          { f: 783.99, t: 0.28, d: 0.16 }, // G5
          { f: 1046.50, t: 0.42, d: 0.32 }, // C6
          { f: 783.99, t: 0.76, d: 0.16 }, // G5
          { f: 1046.50, t: 0.94, d: 0.65 }, // C6
          { f: 1318.51, t: 0.94, d: 0.65 }  // E6 harmony
        ]
      : [
          { f: 440.00, t: 0.00, d: 0.13 }, // A4
          { f: 554.37, t: 0.12, d: 0.13 }, // C#5
          { f: 659.25, t: 0.24, d: 0.15 }, // E5
          { f: 880.00, t: 0.38, d: 0.45 }  // A5
        ];

    notes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isGrandFinale ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(n.f, now + n.t);
      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.linearRampToValueAtTime(isGrandFinale ? 0.09 : 0.11, now + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + n.t + n.d);
      osc.connect(gain).connect(soundManager.getDestination());
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    });
  } catch (e) {
    // Ignore audio context errors
  }
}

function spawnVictoryDOMConfetti(count = 28) {
  if (!gameArea) return;
  const colors = ["#ffd700", "#00ffff", "#ff00ff", "#39ff14", "#ff8c00", "#ffffff"];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = `${Math.round(24 + Math.random() * (GAME_WIDTH - 48))}px`;
    piece.style.color = colors[i % colors.length];
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty("--confetti-drift", `${Math.round((Math.random() - 0.5) * 140)}px`);
    piece.style.animationDelay = `${(Math.random() * 0.45).toFixed(2)}s`;
    gameArea.appendChild(piece);
    setTimeout(() => piece.remove(), 2300);
  }
}

function resetStageForNewLevel() {
  clearTimeout(autoLaunchTimeout);
  pauseStartTime = null;

  // 1) Remove all falling power-up capsules & active lasers/trails/rings
  powerUps.forEach(p => p.element.remove());
  powerUps = [];
  lasers.forEach(l => l.element.remove());
  lasers = [];
  if (gameArea) {
    gameArea.classList.remove("laser-frenzy-arena");
    gameArea.querySelectorAll(".brick.extra, .onion-skin, .tesla-bolt-line, .plasma-nova-ring").forEach(el => el.remove());
  }

  // 2) Clear all active timed power-up buffs & status timer bars
  activePowerUps = {};
  if (statusIndicatorsContainer) statusIndicatorsContainer.innerHTML = "";
  if (notificationsContainer) notificationsContainer.innerHTML = "";
  paddleSizeLevel = 0;
  isStickyPaddle = false;
  isLaserActive = false;
  frenzyTimerLeft = 0;
  frenzyReady = false;
  frenzyMeter = 0;
  canFire = true;
  paddle.classList.remove("paddle-sticky", "paddle-armed", "laser-tier-1", "laser-tier-2", "laser-tier-3");

  // 3) Reset temporary volley / bounce states so the new level starts on a clean slate
  isRoofBonusActive = false;
  justBounced = false;
  magSlingshotCharges = 0;
  caughtByMagLock = false;
  laserAutoFireAccum = 0;
  turretFireAccum = 0;
  novaBrickCounter = 0;
  guardianAegisBeamCounter = 0;
  demolisherNovaArmed = getAugmentRank("nova") > 0;
  highRollerBustShrink = false;
  highRollerBankCurveActive = false;
  highRollerDiceMultiplier = 1.10;
  highRollerLastRoll = null;

  ball.classList.remove("bonus-active", "ball-slingshot", "ball-piercing");
  ball.style.transform = "";
  const pierceRank = getAugmentRank("pierce");
  if (pierceRank > 0) {
    pierceChargesLeft = pierceRank;
    ball.classList.add("ball-piercing");
  } else {
    pierceChargesLeft = 0;
  }

  if (getAugmentRank("aegis") > 0) {
    aegisReady = true;
    aegisCooldownLeft = 0;
  }

  // Re-apply permanent Hack Mode buffs if the player is on a Hacked run (God / Overdrive)
  if (typeof applyArmedHackModesOnStart === "function" && activeHackModes.size > 0) {
    applyArmedHackModesOnStart();
  }

  // 4) Center paddle, recalculate clean base width, and dock the ball on the paddle
  updatePaddleWidth();
  paddleX = GAME_WIDTH / 2;
  prevPaddleX = paddleX;
  paddleVelocityX = 0;
  ballIsStuck = true;
  ballSpeedX = 0;
  ballSpeedY = 0;
  ballX = paddleX - BALL_SIZE / 2;
  ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE;
  syncRogueHUD();
  updateMultiplierBadge();
  renderGame();
}

function dealBreachContractOffers(count = 3) {
  const pool = [...BREACH_CONTRACTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function canExtractAtCurrentIntermission() {
  return sectorsCleared >= 5 && sectorsCleared % 5 === 0;
}

function jumpOutToRunnerRoster(fromKeyboard = false) {
  if (!isLevelIntermissionOpen) return;
  if (!isModalInputReady(fromKeyboard)) return;
  const code = getLastInitials();
  const nextStage = currentSector + 1;
  if (code && code.length === 3) {
    const prof = getCallsignProfile(code);
    prof.savedRun = {
      stage: nextStage,
      sectorsCleared,
      score,
      unbankedCreds: runUnbankedCreds,
      safehouseUpgradesLeft: canExtractAtCurrentIntermission() ? 1 : 0
    };
    prof.lastPlayedAt = Date.now();
    if (sectorsCleared > (prof.bestSector || 0)) {
      prof.bestSector = sectorsCleared;
    }
    saveCallsignProfile(code, prof);
  }
  isLevelIntermissionOpen = false;
  isFinalLevelIntermission = false;
  isCallsignKeypadOpen = false;
  soundManager.play("bounce", { pitch: 1.2, volume: 0.5 });
  initGame(false);
}

function extractFromSector(fromKeyboard = false) {
  if (!isLevelIntermissionOpen) return;
  if (!canExtractAtCurrentIntermission()) return;
  if (!isModalInputReady(fromKeyboard)) return;
  isLevelIntermissionOpen = false;
  isFinalLevelIntermission = false;

  const runnerCallsign = getLastInitials();
  const isHackedRun = runUsedCheats || isAnyHackCurrentlyArmed();
  const boardMode = isHackedRun ? "hacked" : "legit";
  const hacksUsed = isHackedRun ? getRunHackEmojis() : [];

  if (score > 0 && qualifiesForLeaderboard(score, boardMode)) {
    addLeaderboardEntry(runnerCallsign, score, true, boardMode, hacksUsed);
  }
  if (!isHackedRun && score > getHighScore() && score > 0) {
    saveHighScore(score);
  }

  const csProfile = getCallsignProfile(runnerCallsign);
  if (csProfile) {
    csProfile.credits = (csProfile.credits || 0) + runUnbankedCreds;
    csProfile.extractions = (csProfile.extractions || 0) + 1;
    if (sectorsCleared > (csProfile.bestSector || 0)) {
      csProfile.bestSector = sectorsCleared;
    }
    csProfile.savedRun = {
      stage: currentSector + 1,
      sectorsCleared,
      score,
      unbankedCreds: 0,
      safehouseUpgradesLeft: 1
    };
    csProfile.lastPlayedAt = Date.now();
    saveCallsignProfile(runnerCallsign, csProfile);
  }
  runUnbankedCreds = 0;
  safehouseUpgradesRemaining = 1;
  safehouseLeaderboardOpen = false;
  isCallsignKeypadOpen = false;
  gameMessage.classList.remove("end-overlay-mode", "victory-celebration", "level-intermission-mode");
  gameMessage.style.display = "none";
  gameMessage.innerHTML = "";
  soundManager.play("grow", { pitch: 1.35, volume: 0.85 });
  initGame(true);
}

function signBreachContractAndAdvance(contractId, fromKeyboard = false) {
  if (!isLevelIntermissionOpen) return;
  if (!isModalInputReady(fromKeyboard)) return;

  const chosen = currentContractOffers.find(c => c.id === contractId) || currentContractOffers[0];
  // Replace active Stage Modifier (never stack previous stage modifiers onto the new stage!)
  activeBreachContracts = chosen ? [chosen] : [];

  isLevelIntermissionOpen = false;
  isFinalLevelIntermission = false;
  currentSector++;
  clearedRows.clear();
  rowBonusCount = 0;
  rowBonusLevel = 0;

  // Save checkpoint for the stage being entered
  const code = getLastInitials();
  if (code && code.length === 3) {
    const prof = getCallsignProfile(code);
    prof.savedRun = {
      stage: currentSector,
      sectorsCleared,
      score,
      unbankedCreds: runUnbankedCreds,
      safehouseUpgradesLeft: 0
    };
    prof.lastPlayedAt = Date.now();
    saveCallsignProfile(code, prof);
  }

  createBricks();
  resetStageForNewLevel();

  gameMessage.classList.remove("level-intermission-mode");
  gameMessage.style.display = "none";
  gameArea.classList.add("hide-cursor");
  levelStartLaunchGuardUntil = performance.now() + 220;

  const theme = getSectorTheme(currentSector);
  showNotification({
    title: `${chosen ? `${chosen.emoji} ${chosen.name} ACTIVE!` : `${theme.emoji} STAGE ${currentSector}`}`,
    emoji: "🚀",
    name: `STAGE ${currentSector}: ${theme.name}`,
    description: "65% AT RISK ON FLATLINE • CLICK OR SPACE TO SERVE!",
    color: chosen ? chosen.color : theme.color,
    mode: "burst"
  }, { x: paddleX });

  gameRunning = true;
  lastTime = 0;
  requestAnimationFrame(gameLoop);
}

function resumeFromLevelIntermission(fromKeyboard = false) {
  if (!isLevelIntermissionOpen) return;
  if (canExtractAtCurrentIntermission()) {
    extractFromSector(fromKeyboard);
  } else if (currentContractOffers.length > 0) {
    signBreachContractAndAdvance(currentContractOffers[0].id, fromKeyboard);
  }
}

function advanceToNextSector() {
  sectorsCleared++;
  const clearedSectorNum = currentSector;
  const clearedTheme = getSectorTheme(clearedSectorNum);
  const sectorBonus = 500 * clearedSectorNum;
  const sectorCredBonus = Math.round(35 * clearedSectorNum * getContractCredMultiplier());
  score += sectorBonus;
  if (isCatMode) score = score - (score % 10) + 9;
  runUnbankedCreds += sectorCredBonus;
  scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;

  // Pause gameplay & clear all falling/active power-ups and projectiles immediately!
  clearTimeout(autoLaunchTimeout);
  isLevelIntermissionOpen = true;
  gameRunning = false;
  gameArea.classList.remove("hide-cursor");
  resetStageForNewLevel();
  syncRogueHUD();

  soundManager.play("winSong");
  playVictoryFanfareSynth(clearedSectorNum >= 5 && clearedSectorNum % 5 === 0);
  spawnVictoryDOMConfetti(26);
  if (typeof spawnConfettiShards === "function") {
    spawnConfettiShards(130);
  }
  if (typeof triggerCollisionSparklers === "function") {
    triggerCollisionSparklers(GAME_WIDTH / 2, 220, "brick");
  }

  const nextSectorNum = clearedSectorNum + 1;
  const nextTheme = getSectorTheme(nextSectorNum);
  currentContractOffers = dealBreachContractOffers(3);
  const flatlinePenaltyScore = Math.round(score * 0.65);
  const isSafehouseCheckpoint = canExtractAtCurrentIntermission();
  const nextSafehouseStage = Math.ceil(clearedSectorNum / 5) * 5;
  const stagesLeftToSafehouse = nextSafehouseStage - clearedSectorNum;

  // Auto-save character progress at the start of every between-stage intermission
  const activeCode = getLastInitials();
  if (activeCode && activeCode.length === 3) {
    const prof = getCallsignProfile(activeCode);
    prof.savedRun = {
      stage: nextSectorNum,
      sectorsCleared,
      score,
      unbankedCreds: runUnbankedCreds,
      safehouseUpgradesLeft: isSafehouseCheckpoint ? 1 : 0
    };
    prof.lastPlayedAt = Date.now();
    if (sectorsCleared > (prof.bestSector || 0)) {
      prof.bestSector = sectorsCleared;
    }
    saveCallsignProfile(activeCode, prof);
  }

  const contractsHTML = currentContractOffers.map((c, idx) => `
    <button type="button" class="breach-contract-card" data-contract-id="${c.id}" style="--contract-color: ${c.color};">
      <div class="contract-card-top">
        <span class="contract-card-name">${c.emoji} ${c.name}</span>
        <span class="contract-card-key">[${idx + 1}]</span>
      </div>
      <div class="contract-buff-line">▲ ${c.buffText}</div>
      <div class="contract-nerf-line">▼ ${c.nerfText}</div>
      <div class="contract-cta-pill">🔴 ENTER STAGE ${nextSectorNum} [${idx + 1}]</div>
    </button>
  `).join("");

  const safehouseActionHTML = isSafehouseCheckpoint
    ? `
      <div class="intermission-Checkpoint-actions">
        <button type="button" id="intermission-extract-btn" class="intermission-continue-btn intermission-extract-btn">
          🏠 HEAD TO SAFEHOUSE — BANK 100% (+${formatArcadeScore(runUnbankedCreds)}¢) &amp; UNLOCK 1 UPGRADE [E]
        </button>
        <button type="button" id="intermission-jump-out-btn" class="intermission-jump-out-btn">
          ⏸️ JUMP OUT &amp; SWITCH CHARACTER (SAVES STAGE ${nextSectorNum}) [J]
        </button>
      </div>
    `
    : `
      <div class="intermission-between-stage-bar">
        <div class="intermission-safehouse-locked-pill">
          🔒 SAFEHOUSE LOCKED (${clearedSectorNum % 5}/5 STAGES) — CLEAR ${stagesLeftToSafehouse} MORE (STAGE ${nextSafehouseStage}) TO UPGRADE
        </div>
        <button type="button" id="intermission-jump-out-btn" class="intermission-jump-out-btn">
          ⏸️ JUMP OUT / SWITCH CHARACTER (SAVES STAGE ${nextSectorNum}) [J]
        </button>
      </div>
    `;

  const modifierHeaderText = isSafehouseCheckpoint
    ? `🔴 OR KEEP PLAYING INTO ${nextTheme.emoji} STAGE ${nextSectorNum} (65% AT RISK): PICK 1 STAGE MODIFIER`
    : `⚡ CONTINUE TO ${nextTheme.emoji} STAGE ${nextSectorNum} (SAFEHOUSE AT STAGE ${nextSafehouseStage}): PICK 1 STAGE MODIFIER`;

  gameMessage.classList.remove("end-overlay-mode", "victory-celebration");
  gameMessage.classList.add("level-intermission-mode");
  gameMessage.style.setProperty("--sector-accent", nextTheme.color);
  gameMessage.innerHTML = `
    <div class="level-intermission-card extraction-intermission-card" style="--sector-accent: ${nextTheme.color};">
      <div class="intermission-kicker">🎉 STAGE ${clearedSectorNum} CLEARED // ${clearedTheme.name} (+${formatArcadeScore(sectorBonus)} PTS &amp; +${sectorCredBonus}¢) 🎉</div>
      <h2 class="intermission-title">STAGE ${clearedSectorNum} COMPLETE!</h2>
      <div class="intermission-reward-grid">
        <div class="intermission-reward-box">
          <span class="reward-lbl">CURRENT RUN SCORE</span>
          <strong class="reward-val">${formatArcadeScore(score)}</strong>
        </div>
        <div class="intermission-reward-box">
          <span class="reward-lbl">UNBANKED CYBER-CREDS</span>
          <strong class="reward-val" style="color: #39ff14;">💰 +${formatArcadeScore(runUnbankedCreds)}¢</strong>
        </div>
        <div class="intermission-reward-box">
          <span class="reward-lbl">65% FLATLINE RISK</span>
          <strong class="reward-val" style="color: #ff5577;">-${formatArcadeScore(flatlinePenaltyScore)} PTS IF LOST</strong>
        </div>
      </div>

      ${safehouseActionHTML}

      <div class="breach-contracts-section">
        <div class="breach-section-header">
          <span>${modifierHeaderText}</span>
          <span>KEYS [1] [2] [3]</span>
        </div>
        <div class="breach-contracts-grid">${contractsHTML}</div>
      </div>
    </div>
  `;
  gameMessage.style.display = "block";
  armModalInputGuard(isSafehouseCheckpoint ? 850 : 550, "intermission-extract-btn");

  const extractBtn = document.getElementById("intermission-extract-btn");
  if (extractBtn && isSafehouseCheckpoint) {
    extractBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      extractFromSector(false);
    });
  }

  const jumpOutBtn = document.getElementById("intermission-jump-out-btn");
  if (jumpOutBtn) {
    jumpOutBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      jumpOutToRunnerRoster(false);
    });
  }

  gameMessage.querySelectorAll("[data-contract-id]").forEach(cardBtn => {
    cardBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      signBreachContractAndAdvance(cardBtn.dataset.contractId, false);
    });
  });
}

function initGame(enterSafehouse = false) {
    const openSafehouse = enterSafehouse === true && safehouseUpgradesRemaining > 0;
    isSafehouseMode = openSafehouse;
    safehouseLeaderboardOpen = false;
    if (!openSafehouse) {
      safehouseUpgradesRemaining = 0;
    }
    initRogueProgression();
    isCatMode   = catModeArmed;
    BALL_EMOJI  = isCatMode ? "🐱" : "😊";
    ball.textContent = BALL_EMOJI;  
    score = 0;
    scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
    clearedRows.clear();
    rowBonusCount = 0;
    rowBonusLevel = 0;
    isStickyPaddle = false;
    ballIsStuck = false;
    isLaserActive = false;
    canFire = true;
    isRoofBonusActive = false;
    isNeonLegend = false;
    isLevelIntermissionOpen = false;
    isFinalLevelIntermission = false;
    hideCyberPopover();
    ball.classList.remove('bonus-active', 'ball-piercing', 'ball-slingshot', 'neon-legend-active');
    lasers.forEach(l => l.element.remove());
    lasers = [];
    const frenzyBanner = document.getElementById("frenzy-ready-banner");
    if (frenzyBanner) frenzyBanner.style.display = "none";
    paddle.classList.remove('paddle-sticky', 'paddle-armed', 'paddle-frenzy-ready', 'laser-tier-1', 'laser-tier-2', 'laser-tier-3');
    syncPaddleClassVisual();
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
    prevPaddleX = paddleX;
    paddleVelocityX = 0;
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
    if (headerLeft) headerLeft.classList.remove('title-page-hidden');
    renderCallsignBuilder();
    updateStartLeaderboard();
    updateHighScoreDisplay();
    stopVictoryCelebrationShow();
    gameMessage.classList.remove('end-overlay-mode', 'victory-celebration', 'level-intermission-mode');
    gameMessage.style.display = 'none';
    scoreDisplay.style.display = 'none';
     statusIndicatorsContainer.style.display = 'none';
    ball.style.display = 'none';
    if (pauseButton) {
      pauseButton.style.display = 'none';
      pauseButton.textContent = '⏸ PAUSE [P]';
    }
    resetButton.style.display = 'none';
    
    gameArea.classList.remove('hide-cursor', 'laser-frenzy-arena');
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

  // Stage 1 through 5 escalate in architectural formation, row depth (5 -> 6 rows), Armored Bastions, and Gold Cyber-Vaults!
  const stageInCycle = ((Math.max(1, currentSector) - 1) % 5) + 1;
  const cycleTier = Math.floor((Math.max(1, currentSector) - 1) / 5);
  const totalRows = stageInCycle >= 3 ? 6 : 5;
  const contractArmorBonus = getContractArmorChanceBonus();
  const contractVaultBonus = getContractVaultChanceBonus();
  const equippedPool = getEquippedLoadoutPool();

  for (let row = 0; row < totalRows; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      // Deterministic Stage 1-5 Architectural Patterns + Stage Modifier escalation (100% full grid — never missing bricks at stage start!):
      // tier: 1 = standard (1-hit), 2 = armored (2-hit), 3 = gold cyber-vault (3-hit + guaranteed power-up)
      let tier = 1;
      const isEdgeCol = col === 0 || col === BRICK_COLS - 1;
      const isCenterCol = col === 4 || col === 5;

      if (stageInCycle === 1) {
        // STAGE 1 (Neon Grid): Complete 5x10 Grid — Armored top row & center core, standard 1-hit bricks elsewhere
        if (row === 0 && (col >= 1 && col <= 8)) {
          tier = 2;
        } else if (row === 2 && isCenterCol) {
          tier = 2;
        }
      } else if (stageInCycle === 2) {
        // STAGE 2 (Ultraviolet Bastions): Complete 5x10 Grid — Twin Vault Citadels at (row 1, col 2 & 7) surrounded by Armored shields
        if (row === 1 && (col === 2 || col === 7)) {
          tier = 3;
        } else if (row === 0 || (row === 2 && (col <= 3 || col >= 6)) || (row === 4 && isCenterCol)) {
          tier = 2;
        }
      } else if (stageInCycle === 3) {
        // STAGE 3 (Crimson Chevron Firewall): Complete 6x10 Fortress with 4 Gold Vaults and Armored Chevron ribs
        if ((row === 0 && (col === 3 || col === 6)) || (row === 2 && isCenterCol)) {
          tier = 3;
        } else if (row === 0 || row === 1 || (Math.abs(col - 4.5) <= row + 0.5 && row <= 3)) {
          tier = 2;
        }
      } else if (stageInCycle === 4) {
        // STAGE 4 (Solar Reactor Core): Complete 6x10 Reactor Chamber with 6 Gold Vaults in the core & Armored blast walls
        if ((row === 1 || row === 2) && (col === 3 || col === 4 || col === 5 || col === 6)) {
          tier = (row === 1 || (col === 3 || col === 6)) ? 3 : 2;
        } else if (row === 0 || row === 4 || isEdgeCol) {
          tier = 2;
        }
      } else {
        // STAGE 5 (Blackwall Fortress — Safehouse Boss Stage): Complete 6x10 Citadel with 10 Gold Vaults and heavy Armor!
        if ((row === 0 && col >= 2 && col <= 7) || (row === 2 && (col === 1 || col === 4 || col === 5 || col === 8))) {
          tier = 3;
        } else if (row <= 4) {
          tier = 2;
        }
      }

      // Apply Stage Modifier (Breach Contract) & Endless Cycle (Stage 6+) upgrades
      const extraRoll = Math.random();
      if (tier === 1 && (contractVaultBonus > 0 || cycleTier > 0) && extraRoll < (contractVaultBonus + cycleTier * 0.08)) {
        tier = 3;
      } else if (tier === 1 && (contractArmorBonus > 0 || cycleTier > 0) && extraRoll < (contractArmorBonus + cycleTier * 0.18)) {
        tier = 2;
      } else if (tier === 2 && contractVaultBonus > 0 && extraRoll < contractVaultBonus) {
        tier = 3;
      }

      // 1) create the DOM element
      const el = document.createElement('div');
      const colorRow = row % BRICK_ROWS;
      el.classList.add('brick', `brick-row-${colorRow}`);

      // 2) set brick tier: Standard (1-hit), Armored (2-hit), or Gold Cyber-Vault (3-hit)
      let hitsRequired = tier;
      let isVaultBrick = tier === 3;
      if (isVaultBrick) {
        el.classList.add('multihit', 'brick-vault');
      } else if (hitsRequired === 2) {
        el.classList.add('multihit');
      }

      // 3) maybe assign a power-up (Vault bricks ALWAYS drop a falling power-up!)
      let powerUpType = null;
      if ((isVaultBrick || Math.random() < POWER_UP_CHANCE) && equippedPool.length > 0) {
        powerUpType = equippedPool[
          Math.floor(Math.random() * equippedPool.length)
        ];
        if (POWER_UP_TYPES[powerUpType]) {
          const indicator = document.createElement('span');
          indicator.className = 'power-up-indicator';
          indicator.textContent = POWER_UP_TYPES[powerUpType].emoji;
          el.appendChild(indicator);
        }
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
    const safehouseLbBtn = document.getElementById("safehouse-lb-toggle-btn");
    if (safehouseLbBtn) {
        safehouseLbBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            safehouseLeaderboardOpen = !safehouseLeaderboardOpen;
            soundManager.play("bounce", { pitch: safehouseLeaderboardOpen ? 1.4 : 1.05, volume: 0.38 });
            syncSafehouseAndStartScreenUI();
        });
    }
    const frenzyBanner = document.getElementById("frenzy-ready-banner");
    if (frenzyBanner) {
        frenzyBanner.addEventListener("click", (e) => {
            e.stopPropagation();
            activateReadyLaserFrenzy();
        });
    }
    const rogueXpTrack = document.querySelector(".rogue-xp-track");
    if (rogueXpTrack) {
        rogueXpTrack.addEventListener("click", (e) => {
            e.stopPropagation();
            activateReadyLaserFrenzy();
        });
    }

    // Initialize Volume Control UI and event listeners
    soundManager.loadSettings();
    syncVolumeControlUI();
    const volMuteBtn = document.getElementById("volume-mute-btn");
    if (volMuteBtn) {
        volMuteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            soundManager.init();
            soundManager.toggleMute();
            if (!soundManager.isMuted) {
                soundManager.play("bounce", { pitch: 1.35, volume: 0.45 });
            }
        });
    }
    const volDownBtn = document.getElementById("volume-down-btn");
    if (volDownBtn) {
        volDownBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            soundManager.init();
            const currentEff = soundManager.isMuted ? 0 : soundManager.masterVolume;
            const nextVol = Math.max(0, Math.round((currentEff - 0.25) * 4) / 4);
            soundManager.setVolume(nextVol);
            if (!soundManager.isMuted && nextVol > 0) {
                soundManager.play("bounce", { pitch: 0.95 + nextVol * 0.4, volume: 0.45 });
            }
        });
    }
    const volUpBtn = document.getElementById("volume-up-btn");
    if (volUpBtn) {
        volUpBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            soundManager.init();
            const currentEff = soundManager.isMuted ? 0 : soundManager.masterVolume;
            const nextVol = Math.min(1, Math.round((currentEff + 0.25) * 4) / 4);
            soundManager.setVolume(nextVol);
            soundManager.play("bounce", { pitch: 0.95 + nextVol * 0.45, volume: 0.45 });
        });
    }
    document.querySelectorAll(".vol-bar-btn").forEach(barBtn => {
        barBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const targetVol = parseFloat(barBtn.dataset.vol || barBtn.dataset.volStep || "0.75");
            soundManager.init();
            soundManager.setVolume(targetVol);
            soundManager.play("bounce", { pitch: 1.0 + targetVol * 0.45, volume: 0.45 });
        });
    });
    const volPctLabel = document.getElementById("volume-pct-label");
    if (volPctLabel) {
        volPctLabel.addEventListener("click", (e) => {
            e.stopPropagation();
            soundManager.init();
            soundManager.toggleMute();
            if (!soundManager.isMuted) {
                soundManager.play("bounce", { pitch: 1.35, volume: 0.45 });
            }
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
        const activeCode = getLastInitials();
        // Permanently bind this Callsign to its selected Class if not yet bound!
        bindCallsignToClass(activeCode, selectedRunnerClass);
        const prof = getCallsignProfile(activeCode);
        const resumeState = (prof.savedRun && prof.savedRun.stage > 1) ? { ...prof.savedRun } : null;
        prof.lastPlayedAt = Date.now();
        saveCallsignProfile(activeCode, prof);

        initGame(); 
        if (resumeState) {
            currentSector = resumeState.stage;
            sectorsCleared = resumeState.sectorsCleared || (currentSector - 1);
            score = resumeState.score || 0;
            runUnbankedCreds = resumeState.unbankedCreds || 0;
            scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
            createBricks();
        } else {
            score = 0;
        }
        lives = 1;
        gameOver = false;
        rowBonusLevel = 0;
        ballIsStuck = true;
        applyRunnerClassTier();

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
            pauseButton.style.display = 'inline-flex';
            pauseButton.textContent = '⏸ PAUSE [P]';
        }
        resetButton.style.display = 'inline-flex';
        
        ballIsStuck = true;
        caughtByMagLock = false;
        paddleVelocityX = 0;
        prevPaddleX = paddleX;
        ballX = paddleX - BALL_SIZE / 2;
        ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE;
        levelStartLaunchGuardUntil = performance.now() + 220;
        soundManager.play('winSong');
        
        gameArea.classList.add('hide-cursor');
        gameRunning = true; 
        if (typeof applyArmedHackModesOnStart === 'function') {
            applyArmedHackModesOnStart();
        }
        const launchTheme = getSectorTheme(currentSector);
        showNotification({
          title: `${launchTheme.emoji} STAGE ${currentSector}: ${launchTheme.name}`,
          emoji: "🚀",
          name: resumeState ? `RESUMING STAGE ${currentSector}!` : "READY TO LAUNCH!",
          description: "AIM PADDLE • CLICK OR SPACE TO SERVE!",
          color: launchTheme.color || "#00ffff",
          mode: "burst"
        }, { x: paddleX });
        requestAnimationFrame(gameLoop);
    }
}

function togglePause() {
  if (gameOver || ballIsStuck || isLevelIntermissionOpen) return;
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
    if (pauseButton) pauseButton.textContent = "⏸ PAUSE [P]";
    gameMessage.style.display = "none";
    gameArea.classList.add("hide-cursor");
    lastTime = 0;
    requestAnimationFrame(gameLoop);
  } else {
    pauseStartTime = Date.now();
    cancelAnimationFrame(animationFrameId);
    if (pauseButton) pauseButton.textContent = "▶ RESUME [P]";
    gameMessage.classList.remove("end-overlay-mode", "victory-celebration", "level-intermission-mode");
    gameMessage.innerHTML = `<span class="name">PAUSED</span><p class="game-message-prompt">Press P / ESC or Click to Resume</p>`;
    gameMessage.style.display = "block";
    gameArea.classList.remove("hide-cursor");
  }
}
function resetAfterLifeLost(){ballIsStuck=!0,isRoofBonusActive=!1,ball.classList.remove("bonus-active","ball-slingshot"),activePowerUps={},statusIndicatorsContainer.innerHTML="",paddleSizeLevel=0,updatePaddleWidth(),paddle.classList.remove("paddle-sticky","paddle-armed","laser-tier-1","laser-tier-2","laser-tier-3"),isStickyPaddle=!1,isLaserActive=!1,magSlingshotCharges=0,caughtByMagLock=!1,resetBrickStreakOnMiss(),ballX=paddleX-BALL_SIZE/2,ballY=GAME_HEIGHT-PADDLE_HEIGHT-PADDLE_BOTTOM_OFFSET-BALL_SIZE,ballSpeedX=0,ballSpeedY=0}

function gameLoop(timestamp) {
  // 1) If the game is paused or over, don’t do anything
  if (!gameRunning) return;

  // 2) Compute time delta (in seconds)
  if (!lastTime) lastTime = timestamp;
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  // 3) Update all the moving parts & track horizontal paddle velocity for Mag-Lock flick aiming
  updateRogueProgressionFrame(delta);
  updatePaddlePosition(delta);
  if (delta > 0.001) {
    const instVelX = (paddleX - prevPaddleX) / delta;
    paddleVelocityX = paddleVelocityX * 0.55 + instVelX * 0.45;
    prevPaddleX = paddleX;
  }
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
    if (gameRunning && !gameOver) {
      animationFrameId = requestAnimationFrame(gameLoop);
    }
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
      endGame(false);
      return;
    }
  }

  // 9) Request the next frame if still running (draft modal or intermission may have paused gameRunning)
  if (gameRunning) {
    animationFrameId = requestAnimationFrame(gameLoop);
  }
}


function updatePaddlePosition(dt) {
  const halfPaddle = paddleWidth / 2;
  const titanRank = getAugmentRank("titan");
  const titanSpeedMult = 1 + titanRank * 0.14;
  const contractSpeedMult = Math.max(0.55, 1 + getContractPaddleSpeedMod());
  const speedMult = ((typeof isHackModeActive === "function" && isHackModeActive("juice")) ? 1.45 : 1) * titanSpeedMult * contractSpeedMult;
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
  let o = Math.pow(0.75, t) * getBoardDifficultySpeedMultiplier();
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
  // Calculate how big the paddle _should_ be logically (Expando stacks + Titan Deck Augment + Current Stage Modifier - Striker precision handicap - High-Roller Bust Shrink)
  // Note: No hidden per-stage shrinkage — paddle size only changes when an explicit Class, Power-Up, or active Stage Modifier specifies it!
  const titanBonus = getAugmentRank("titan") * 0.22;
  let classWidthMod = selectedRunnerClass === "striker" ? -0.12 : 0;
  if (selectedRunnerClass === "highroller" && highRollerBustShrink) {
    classWidthMod -= 0.20;
  }
  const contractWidthMod = getContractPaddleWidthMod();
  const scaleFactor = Math.max(0.60, 1 + paddleSizeLevel * 0.35 + titanBonus + classWidthMod + contractWidthMod);
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
          const baseMagBonus = [25, 40, 55][Math.min(magnetRank, 3) - 1] || 55;
          let magPts = Math.round(baseMagBonus * getSectorScoreMultiplier());
          if (isCatMode) magPts = magPts - (magPts % 10) + 9;
          score += magPts;
          if (isCatMode) score = score - (score % 10) + 9;
          scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
          showBrickScore(paddleX, padRect.top - 10, magPts);

          // High-Roller L2+ Wild Card Capsule Roulette:
          // 50% Bonus 4s Mini-Mod, 30% Double-Stack Upgrade, 20% Joker Curse (+2 extra bricks to clear!)
          if (selectedRunnerClass === "highroller" && rogueLevel >= 2) {
            const cardRoll = Math.random();
            if (cardRoll < 0.50) {
              const wildPool = ["wide-paddle", "slow-mo", "sticky-paddle"].filter(k => k !== pu.type);
              const bonusMod = wildPool[Math.floor(Math.random() * wildPool.length)] || "wide-paddle";
              const now = Date.now();
              if (!activePowerUps[bonusMod]) activePowerUps[bonusMod] = [];
              if (activePowerUps[bonusMod].length < MAX_PADDLE_LEVEL) {
                const lastEnd = activePowerUps[bonusMod].slice(-1)[0]?.endTime || now;
                activePowerUps[bonusMod].push({ endTime: Math.max(now, lastEnd) + 4000 });
              }
              if (bonusMod === "wide-paddle") {
                paddleSizeLevel = Math.min(activePowerUps[bonusMod].length, MAX_PADDLE_LEVEL);
                updatePaddleWidth();
              } else if (bonusMod === "sticky-paddle") {
                isStickyPaddle = true;
                paddle.classList.add("paddle-sticky");
              }
              createOrUpdateStatusIndicator(bonusMod);
              updateMultiplierBadge();
              showNotification({
                title: "🃏 WILD CARD ROULETTE!",
                emoji: POWER_UP_TYPES[bonusMod].emoji,
                name: `+4S ${POWER_UP_TYPES[bonusMod].name}!`,
                description: "HOLO-DRAW BONUS POWER-UP BURST!",
                color: "#ffd700",
                mode: "burst"
              }, { x: paddleX });
            } else if (cardRoll < 0.80) {
              if (def.type === "stacking" && (activePowerUps[pu.type]?.length || 0) < MAX_PADDLE_LEVEL) {
                activatePowerUp(pu.type);
              }
              showNotification({
                title: "🃏 WILD CARD ROULETTE!",
                emoji: "🃏",
                name: "DOUBLE STACK!",
                description: `LUCKY DRAW UPGRADED ${def.name}!`,
                color: "#ff00ff",
                mode: "burst"
              }, { x: paddleX });
            } else {
              spawnDisruptiveBricks(2);
              soundManager.play("multihit", { pitch: 0.75, volume: 0.7 });
              showNotification({
                title: "🃏 WILD CARD: JOKER CURSE!",
                emoji: "🃏",
                name: "+2 CURSED BRICKS!",
                description: "BAD DRAW SPAWNED 2 EXTRA BRICKS!",
                color: "#ff5577",
                mode: "burst"
              }, { x: paddleX });
            }
          }
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

function syncLaserPaddleVisuals() {
  const stacks = activePowerUps["laser-blast"]?.length || 0;
  paddle.classList.remove("laser-tier-1", "laser-tier-2", "laser-tier-3");
  if (frenzyTimerLeft > 0) {
    isLaserActive = true;
    paddle.classList.add("paddle-armed", "laser-tier-3");
  } else if (stacks > 0) {
    isLaserActive = true;
    paddle.classList.add("paddle-armed", `laser-tier-${Math.min(stacks, 3)}`);
  } else if (!(typeof isHackModeActive === "function" && isHackModeActive("juice"))) {
    isLaserActive = false;
    paddle.classList.remove("paddle-armed");
  }
}

function activatePowerUp(type) {
  const def = POWER_UP_TYPES[type];
  if (!def) return;

  // — Instant power-ups (only 'one-up' / Bricked Up!) —
  if (def.type === 'instant') {
    if (type === 'one-up') {
      spawnDisruptiveBricks(5);
      // Scoring effect for Bricked Up: Instant +150 * Level Grid Injection Bonus!
      let injectPts = Math.round(150 * getSectorScoreMultiplier() * getClassSkillScoreMultiplier());
      if (isCatMode) injectPts = injectPts - (injectPts % 10) + 9;
      score += injectPts;
      if (isCatMode) score = score - (score % 10) + 9;
      scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
      showBrickScore(paddleX, GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - 14, injectPts);
    }
    showNotification(type, { x: paddleX });
    return;
  }

  // — Stacking / Refreshing power-ups (Demolisher Handicap: -15% shorter duration) —
  if (!activePowerUps[type]) {
    activePowerUps[type] = [];
  }
  const now = Date.now();
  const durationMult = selectedRunnerClass === "demolisher" ? 0.85 : 1.0;
  const effDuration = Math.round(def.duration * durationMult);

  if (def.type === 'refreshing') {
    // single timer, always slot 0
    activePowerUps[type][0] = { endTime: now + effDuration };
  } else {
    // stacking: chain onto the last timer end (max 3 stacks)
    if (activePowerUps[type].length < MAX_PADDLE_LEVEL) {
      const lastEnd = activePowerUps[type].slice(-1)[0]?.endTime || now;
      activePowerUps[type].push({ endTime: lastEnd + effDuration });
    } else {
      activePowerUps[type][activePowerUps[type].length - 1].endTime += effDuration * 0.5;
    }
  }

  // — Apply the effect immediately —
  switch (type) {
    case 'wide-paddle': {
      paddleSizeLevel = Math.min(activePowerUps[type].length, MAX_PADDLE_LEVEL);
      updatePaddleWidth();
      soundManager.play('grow');
      const stackLevel = paddleSizeLevel; // 1..3
      showNotification(`wide-paddle-${stackLevel}`, { x: paddleX });
      break;
    }

    case 'slow-mo': {
      soundManager.play('bounce', { pitch: 0.8, volume: 0.7 });
      const lvl = activePowerUps['slow-mo']?.length || 0;
      const level = Math.min(Math.max(lvl, 1), 3);
      showNotification(`slow-mo-${level}`, { x: paddleX });
      break;
    }

    case 'sticky-paddle':
      isStickyPaddle = true;
      paddle.classList.add('paddle-sticky');
      soundManager.play('magActivate');
      showNotification(type, { x: paddleX });
      break;

    case 'laser-blast': {
      const laserTier = Math.min(Math.max(activePowerUps['laser-blast']?.length || 1, 1), 3);
      syncLaserPaddleVisuals();
      soundManager.play('laserFire', { pitch: 1.05 + laserTier * 0.18 });
      showNotification(`laser-blast-${laserTier}`, { x: paddleX });
      if (!ballIsStuck) {
        spawnLaserVolley(laserTier, true);
      }
      break;
    }
  }

  // Update the little timer bar below the UI
  createOrUpdateStatusIndicator(type);
  updateMultiplierBadge();
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
          if (ballIsStuck && caughtByMagLock) launchStuckBall();
        },
        "laser-blast": () => {
          syncLaserPaddleVisuals();
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
      const durationMult = selectedRunnerClass === "demolisher" ? 0.85 : 1.0;
      const duration = Math.round(def.duration * durationMult);
      const elapsed  = now - (first.endTime - duration);
      const pct      = Math.max(0, (duration - elapsed) / duration * 100);
      const bar      = indicator.querySelector(".timer-bar");
      bar.style.width = `${pct}%`;
    }
  }

  // --- Update the score multiplier badge ---
  updateMultiplierBadge();
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

    // 1) Move the laser bolt upward (and horizontally if it's a ricocheting High-Roller Spark Bolt!)
    const boltSpd = l.speed || LASER_SPEED;
    l.y -= boltSpd * dt;
    l.element.style.top = `${l.y}px`;
    if (l.vx) {
      l.x += l.vx * dt;
      if (l.x <= 4 && l.vx < 0) {
        l.x = 4;
        l.vx *= -1;
      } else if (l.x + l.width >= GAME_WIDTH - 4 && l.vx > 0) {
        l.x = GAME_WIDTH - l.width - 4;
        l.vx *= -1;
      }
      l.element.style.left = `${l.x}px`;
    }

    // 2) Remove if off‐screen
    if (l.y + l.height < 0) {
      l.element.remove();
      lasers.splice(i, 1);
      continue;
    }

    // 3) Collision check against every brick
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
        const hitDmg = l.damage || 1;
        b.hitsTaken = (b.hitsTaken || 0) + hitDmg;

        if (b.hitsTaken >= (b.hitsRequired || 1)) {
          // 1) Play destroy sound
          const soundName = destroySounds[destroySoundIndex];
          soundManager.play(soundName);
          destroySoundIndex = (destroySoundIndex + 1) % destroySounds.length;

          // 2) Compute points with active multipliers & Laser Tier scoring bonus
          const basePoints = isRoofBonusActive ? 15 : 10;
          const laserBonus = typeof l.bonusPts === "number" ? l.bonusPts : 4;
          const laserTierMult = typeof l.laserMult === "number" ? l.laserMult : 1.25;
          const expandoStacks = (activePowerUps['wide-paddle'] || []).length;
          let points = (basePoints + laserBonus) * laserTierMult;
          if (expandoStacks > 0) {
            points *= (expandoStacks + 1);
          }
          points *= (rowBonusLevel + 1);
          const siegeMult = selectedRunnerClass === "demolisher" ? 1.35 : 1.0;
          if (b.isVaultBrick) {
            points = Math.round(points * 3.0 * siegeMult);
          } else if (b.hitsRequired > 1) {
            points = Math.round(points * 1.6 * siegeMult);
          }
          points = Math.round(
            points *
            getSectorScoreMultiplier() *
            getClassSkillScoreMultiplier() *
            getSlowMoScoreMultiplier() *
            getNeonLegendMultiplier()
          );
          if (isCatMode) {
            points = points - (points % 10) + 9;
          }

          // 3) Add to total
          score += points;
          if (isCatMode) {
            score = score - (score % 10) + 9;
          }
          scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;

          // 4) Show the floating +N
          showBrickScore(b.x + b.width / 2, b.y, points);

          // 5) Break the brick, evaluate row clear, spawn any power-up
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
          triggerPlasmaNova(b);
          triggerWheelOfMayhem(b);
          triggerGuardianAegisBeam(b);
          recordBrickBrokenStreak(b);
          awardRogueXP(b.isVaultBrick ? 3 : (b.hitsRequired > 1 ? 2 : 1));
        } else {
          // Armored / Vault brick took partial laser damage!
          soundManager.play("multihit", { pitch: 1.3, volume: 0.55 });
          b.element.classList.add("damaged");
          b.element.classList.remove("shake");
          void b.element.offsetWidth;
          b.element.classList.add("shake");
        }

        // Guardian Perfect Parry Mortar splash ring on impact!
        if (l.splashRadius && l.splashRadius > 0) {
          const cx = b.x + b.width / 2;
          const cy = b.y + b.height / 2;
          const ring = document.createElement("div");
          ring.className = "plasma-nova-ring guardian-parry-ring";
          ring.style.left = `${cx}px`;
          ring.style.top = `${cy}px`;
          ring.style.setProperty("--nova-size", `${l.splashRadius * 2}px`);
          gameArea.appendChild(ring);
          setTimeout(() => ring.remove(), 360);

          bricks.forEach(adj => {
            if (adj.isBroken || adj === b) return;
            const ax = adj.x + adj.width / 2;
            const ay = adj.y + adj.height / 2;
            if (Math.hypot(ax - cx, ay - cy) <= l.splashRadius) {
              damageOrBreakBrickByAugment(adj, 1, 8);
            }
          });
        }

        l.element.remove();
        lasers.splice(i, 1);
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
      const wallJumpMult = Math.min(2.05, 1.32 + catBounceCombo * 0.10);
      ballSpeedY = -(INITIAL_BALL_SPEED * wallJumpMult);
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

  // — Paddle Collision (pixel-perfect with CSS scale) —
  const paddleBox = paddle.getBoundingClientRect();
  const areaBox   = gameArea.getBoundingClientRect();

  const padRect = {
    left:   paddleBox.left   - areaBox.left,
    right:  paddleBox.right  - areaBox.left,
    top:    paddleBox.top    - areaBox.top,
    bottom: paddleBox.bottom - areaBox.top
  };

  // only proceed if the ball is coming down
  if (isColliding(ballRect, padRect) && ballSpeedY > 0) {
    const padWidth     = padRect.right - padRect.left;
    const halfPaddle   = Math.max(1, padWidth / 2);
    const paddleCenter = padRect.left + halfPaddle;
    const impactPos    = (ballX + BALL_SIZE / 2 - paddleCenter) / halfPaddle;
    const absImpact    = Math.abs(impactPos);

    soundManager.play("bounce");
    // Charge the Skill Rally Frenzy Meter on every paddle return (+24% on Sweet-Spot center hit, +15% on wing return)!
    addSkillRallyFrenzyCharge(absImpact <= 0.40 ? 24 : 15, true);

    if (typeof isHackModeActive === "function" && isHackModeActive("party") && typeof triggerCollisionSparklers === "function") {
      triggerCollisionSparklers(ballX + BALL_SIZE / 2, padRect.top, "paddle");
    }
    if (typeof isHackModeActive === "function" && isHackModeActive("god") && typeof triggerDivinePaddleSmite === "function") {
      triggerDivinePaddleSmite(ballX + BALL_SIZE / 2, padRect.top);
    }
    // Striker 1-to-1 Paddle Bounce Trigger: Sweet-Spot Rail Bolts (or all bounces at L4+) + Tesla Arc Lightning!
    if (getAugmentRank("turret") > 0 && (rogueLevel >= 4 || absImpact <= 0.44)) {
      fireAutoTurretVolley();
    }
    if (getAugmentRank("tesla") > 0) {
      triggerTeslaArcBolts();
    }
    if (getAugmentRank("pierce") > 0) {
      pierceChargesLeft = getAugmentRank("pierce");
      ball.classList.add("ball-piercing");
      syncRogueHUD();
    }
    if (getAugmentRank("nova") > 0) {
      demolisherNovaArmed = true;
    }
    if (selectedRunnerClass === "guardian") {
      fireGuardianBastionMortar(absImpact);
    }
    if (selectedRunnerClass === "highroller") {
      rollHighRollerCyberDice();
    }

    // clear any roof bonus
    if (isRoofBonusActive) {
      isRoofBonusActive = false;
      ball.classList.remove("bonus-active");
    }

    if (isStickyPaddle && !(typeof isHackModeActive === "function" && isHackModeActive("juice"))) {
      // stick the ball to the Mag-Lock deck
      ballIsStuck = true;
      caughtByMagLock = true;
      ballSpeedX  = 0;
      ballSpeedY  = 0;
    } else {
      // bounce off the paddle
      ballY = padRect.top - BALL_SIZE;
      if (isCatMode) {
        // Cat Mode escalating leap: starts with smaller leaps on a new cat life and jumps higher each paddle hit!
        catBounceCombo++;
        const leapMult = Math.min(2.16, 1.08 + catBounceCombo * 0.14);
        ballSpeedY = -(INITIAL_BALL_SPEED * leapMult);
      } else {
        ballSpeedY *= -1;
      }

      // compute X-velocity based on hit position + subtle mouse-flick English
      ballSpeedX         = impactPos * INITIAL_BALL_SPEED * 1.5 + paddleVelocityX * 0.18;
      ballSpeedX         = Math.max(-520, Math.min(520, ballSpeedX));
      if (isCatMode && Math.abs(ballSpeedX) < 135) {
        ballSpeedX = (impactPos >= 0 ? 1 : -1) * 175;
      }
    }

    // finally, clear bank-shot flag
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

      // Wall-bounce bonus (+6 on High-Roller Bank Curve roll!)
      if (justBounced) {
        points += (selectedRunnerClass === "highroller" && highRollerBankCurveActive) ? 6 : 2;
      }

      // Bricked Up! restored brick bonus (+8 base PTS)
      if (brick.isExtraSpawn) {
        points += 8;
        brick.isExtraSpawn = false;
      }

      // Mag-Lock Slingshot Overcharge bonus (+8 base PTS & ×1.5 multiplier on next 3 bricks after launch!)
      let usedSlingshot = false;
      if (magSlingshotCharges > 0) {
        usedSlingshot = true;
        points = Math.round((points + 8) * 1.5);
        magSlingshotCharges--;
        if (magSlingshotCharges <= 0) {
          ball.classList.remove("ball-slingshot");
        }
      }

      // Multi-hit logic (Piercing Overcharge deals 2x hit damage & +14 Demolisher Pierce bonus!)
      const isPiercingHit = pierceChargesLeft > 0;
      if (isPiercingHit && selectedRunnerClass === "demolisher") {
        points += 14;
      }

      // Expando multiplier (🪴 1 stack → 2×, 2 stacks → 3×, 3 stacks → 4×)
      const expandoStacks = (activePowerUps['wide-paddle'] || []).length;
      if (expandoStacks > 0) {
        points *= (expandoStacks + 1);
      }

      brick.hitsTaken += (isPiercingHit ? 2 : 1) + getContractBonusDamage();
      if (isPiercingHit) {
        pierceChargesLeft = Math.max(0, pierceChargesLeft - 1);
        if (pierceChargesLeft <= 0) {
          ball.classList.remove("ball-piercing");
        }
        syncRogueHUD();
      }

      // only when the brick actually dies…
      if (brick.hitsTaken >= brick.hitsRequired) {
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

        // 3) Apply row-clear, Armored/Vault brick (+ Demolisher Siege Bonus), Sector, Class Skill, Slow-Mo & Neon Legend multipliers!
        points *= (rowBonusLevel + 1);
        const siegeMult = selectedRunnerClass === "demolisher" ? 1.35 : 1.0;
        if (brick.isVaultBrick) {
          points = Math.round(points * 3.0 * siegeMult);
        } else if (brick.hitsRequired > 1) {
          points = Math.round(points * 1.6 * siegeMult);
        }
        points = Math.round(
          points *
          getSectorScoreMultiplier() *
          getClassSkillScoreMultiplier() *
          getSlowMoScoreMultiplier() *
          getNeonLegendMultiplier()
        );

        let rawPoints = points;

        // Cat Mode: round popup → …9
        if (isCatMode) {
          points = rawPoints - (rawPoints % 10) + 9;
        }

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

        // 7b) Trigger Plasma Nova shockwave / Wheel of Mayhem / Guardian Aegis Beam if owned, record streak, then award Rogue XP
        triggerPlasmaNova(brick);
        triggerWheelOfMayhem(brick);
        triggerGuardianAegisBeam(brick);
        recordBrickBrokenStreak(brick);
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
      scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;

      // Brick shake & ball impact animation
      brick.element.classList.remove("shake");
      void brick.element.offsetWidth;
      brick.element.classList.add("shake");

      ball.classList.remove("impact-animation");
      void ball.offsetWidth;
      ball.classList.add("impact-animation");

      clearTimeout(emojiSwapTimeout);
      
      if (isCatMode) {
        BALL_EMOJI = '🐱'; 
        ball.textContent = BALL_EMOJI;
      } else if (isNeonLegend) {
        ball.textContent = "😎";
      } else {
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



let victoryCelebrationInterval = null;

function stopVictoryCelebrationShow() {
  if (victoryCelebrationInterval) {
    clearInterval(victoryCelebrationInterval);
    victoryCelebrationInterval = null;
  }
  if (gameArea) {
    gameArea.classList.remove("victory-arena-glow");
  }
}

function startVictoryCelebrationShow() {
  stopVictoryCelebrationShow();
  if (gameArea) {
    gameArea.classList.add("victory-arena-glow");
  }
  spawnConfettiShards(180);
  spawnVictoryDOMConfetti(38);
  if (typeof triggerCollisionSparklers === "function") {
    triggerCollisionSparklers(140, 180, "brick");
    triggerCollisionSparklers(GAME_WIDTH - 140, 180, "brick");
  }
  victoryCelebrationInterval = setInterval(() => {
    if (!gameOver || !pendingEndGameWon || gameMessage.style.display === "none") {
      stopVictoryCelebrationShow();
      return;
    }
    spawnConfettiShards(85);
    spawnVictoryDOMConfetti(14);
    if (typeof triggerCollisionSparklers === "function") {
      const fxX = Math.random() < 0.5
        ? 60 + Math.random() * 140
        : GAME_WIDTH - 60 - Math.random() * 140;
      const fxY = 90 + Math.random() * 340;
      triggerCollisionSparklers(fxX, fxY, "brick");
    }
  }, 850);
}

function endGame(won) {
  gameOver = true;
  gameRunning = false;
  isLevelIntermissionOpen = false;
  isFinalLevelIntermission = false;
  pendingEndGameWon = !!won;
  awaitingInitials = false;
  cancelAnimationFrame(animationFrameId);
  soundManager.stopAll();
  notificationsContainer.innerHTML = "";
  if (pauseButton) pauseButton.style.display = "none";
  if (won) {
    soundManager.play("winSong");
    playVictoryFanfareSynth(true);
    startVictoryCelebrationShow();
  } else {
    stopVictoryCelebrationShow();
    soundManager.play("loseSong");
  }

  const isHackedRun = runUsedCheats || isAnyHackCurrentlyArmed();
  const boardMode = isHackedRun ? "hacked" : "legit";
  activeLeaderboardTab = boardMode;

  // Apply 65% Flatline Penalty on Loss (!won) vs 100% Extraction Payout on Win (won)!
  lastRunRawScoreBeforePenalty = score;
  if (won) {
    lastRunPenaltyAmount = 0;
    lastRunCredsEarned = runUnbankedCreds;
    lastRunCredsLost = 0;
  } else {
    lastRunPenaltyAmount = Math.round(score * 0.65);
    score = Math.max(0, score - lastRunPenaltyAmount);
    lastRunCredsEarned = Math.round(runUnbankedCreds * 0.35);
    lastRunCredsLost = Math.max(0, runUnbankedCreds - lastRunCredsEarned);
  }
  scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;

  const runnerCallsign = getLastInitials();
  const earnedSafehouseAccess = Boolean(won && sectorsCleared >= 5 && sectorsCleared % 5 === 0);
  safehouseUpgradesRemaining = earnedSafehouseAccess ? 1 : 0;
  // Persist banked Cyber-Creds & Best Extraction Stage to this Callsign's profile!
  const csProfile = getCallsignProfile(runnerCallsign);
  if (csProfile) {
    csProfile.credits = (csProfile.credits || 0) + lastRunCredsEarned;
    csProfile.extractions = (csProfile.extractions || 0) + (won ? 1 : 0);
    if (won && sectorsCleared > (csProfile.bestSector || 0)) {
      csProfile.bestSector = sectorsCleared;
    } else if (!won && currentSector > (csProfile.bestSector || 0)) {
      csProfile.bestSector = Math.max(csProfile.bestSector || 0, sectorsCleared);
    }
    if (!won) {
      csProfile.savedRun = null;
    } else if (earnedSafehouseAccess) {
      csProfile.savedRun = {
        stage: currentSector + 1,
        sectorsCleared,
        score,
        unbankedCreds: 0,
        safehouseUpgradesLeft: 1
      };
    }
    csProfile.lastPlayedAt = Date.now();
    saveCallsignProfile(runnerCallsign, csProfile);
  }
  renderCallsignBuilder();

  const prevLegitHigh = getHighScore();
  const isNewLegitHigh = !isHackedRun && score > prevLegitHigh && score > 0;

  const lore = typeof getCallsignLore === "function" ? getCallsignLore(runnerCallsign) : null;
  const cDef = getSelectedClassDef();
  const hacksUsed = isHackedRun ? getRunHackEmojis() : [];
  const qualifies = score > 0 && qualifiesForLeaderboard(score, boardMode);
  const savedEntry = qualifies ? addLeaderboardEntry(runnerCallsign, score, won, boardMode, hacksUsed) : null;
  if (isNewLegitHigh) saveHighScore(score);

  const rating = getRating(score, won);
  const titleText = won
    ? `🟢 EXTRACTION SUCCESSFUL // STAGE ${sectorsCleared} SECURED! 🟢`
    : `💀 FLATLINED IN STAGE ${currentSector} // -65% RISK PENALTY APPLIED`;
  const augSummary = getActiveAugmentIcons().join(" ");

  let savedBannerHTML = "";
  if (isHackedRun) {
    const hackBadgeStr = hacksUsed.join("");
    savedBannerHTML = savedEntry
      ? `<div class="record-saved-banner hacked-banner">💻 ${hackBadgeStr} SAVED TO HACKED TOP 5!</div>`
      : `<div class="record-saved-banner hacked-banner">💻 ${hackBadgeStr} HACKED RUN</div>`;
  } else if (savedEntry) {
    savedBannerHTML = `<div class="record-saved-banner">${
      isNewLegitHigh
        ? `👑 NEW #1 ALL-TIME HIGH SCORE FOR ${savedEntry.initials}!`
        : `🏆 TOP 5 HALL OF FAME RECORD SAVED FOR ${savedEntry.initials}!`
    }</div>`;
  } else {
    const legitBoard = getLeaderboard("legit");
    const minNeeded = legitBoard.length >= MAX_LEADERBOARD_ENTRIES ? (legitBoard[legitBoard.length - 1].score + 1 - score) : 1;
    savedBannerHTML = `<div class="record-saved-banner legit-try-banner">🏆 ${formatArcadeScore(Math.max(1, minNeeded))} MORE PTS FOR TOP 5!</div>`;
  }

  const highlightId = savedEntry ? savedEntry.id : lastSavedEntryId;

  const summaryBlockHTML = won
    ? `
      <div class="victory-rank-pill">🟢 100% SCORE &amp; CYBER-CREDS BANKED TO ${runnerCallsign} SAFEHOUSE 🟢</div>
      <span class="name rating win-rating">${rating}</span>
      <div class="victory-summary-grid">
        <div class="victory-stat-box">
          <span class="v-stat-lbl">EXTRACTED SCORE</span>
          <strong class="v-stat-val v-gold">${formatArcadeScore(score)}</strong>
        </div>
        <div class="victory-stat-box">
          <span class="v-stat-lbl">CYBER-CREDS BANKED</span>
          <strong class="v-stat-val v-green">+${formatArcadeScore(lastRunCredsEarned)}¢ <span class="v-sub">(BANK: ${formatArcadeScore(csProfile?.credits || 0)}¢)</span></strong>
        </div>
        <div class="victory-stat-box">
          <span class="v-stat-lbl">BOUND CLASS</span>
          <strong class="v-stat-val">${cDef.emoji} ${cDef.name} L${rogueLevel} ${augSummary}</strong>
        </div>
        <div class="victory-stat-box">
          <span class="v-stat-lbl">STAGES EXTRACTED</span>
          <strong class="v-stat-val v-green">${sectorsCleared} CLEARED</strong>
        </div>
      </div>
    `
    : `
      <span class="name rating">${rating}</span>
      <div class="victory-summary-grid loss-penalty-grid">
        <div class="victory-stat-box">
          <span class="v-stat-lbl">RAW RUN SCORE</span>
          <strong class="v-stat-val">${formatArcadeScore(lastRunRawScoreBeforePenalty)}</strong>
        </div>
        <div class="victory-stat-box penalty-box">
          <span class="v-stat-lbl">65% FLATLINE PENALTY</span>
          <strong class="v-stat-val" style="color:#ff5577;">-${formatArcadeScore(lastRunPenaltyAmount)} PTS</strong>
        </div>
        <div class="victory-stat-box">
          <span class="v-stat-lbl">35% SALVAGED SCORE</span>
          <strong class="v-stat-val v-gold">${formatArcadeScore(score)}</strong>
        </div>
        <div class="victory-stat-box">
          <span class="v-stat-lbl">35% SALVAGED CREDS</span>
          <strong class="v-stat-val v-green">+${formatArcadeScore(lastRunCredsEarned)}¢ <span class="v-sub">(BANK: ${formatArcadeScore(csProfile?.credits || 0)}¢)</span></strong>
        </div>
      </div>
      <span class="description">Runner: ${runnerCallsign} &bull; Flatlined in Stage ${currentSector} &bull; ${cDef.emoji} L${rogueLevel}${augSummary ? ` (${augSummary})` : ""}${isHackedRun ? ` <span class="end-run-hack-tag">(${hacksUsed.join("")} HACKED)</span>` : ""}</span>
    `;

  gameMessage.classList.remove("level-intermission-mode");
  gameMessage.classList.add("end-overlay-mode");
  gameMessage.classList.toggle("victory-celebration", !!won);
  gameMessage.innerHTML = `
    <div class="end-modal-card ${won ? "win-card" : "loss-card"}">
      <span class="title ${won ? "win-kicker" : ""}">${titleText}</span>
      ${summaryBlockHTML}
      ${savedBannerHTML}
      <div id="end-leaderboard" class="leaderboard-panel">
        ${renderLeaderboardHTML(highlightId, activeLeaderboardTab)}
      </div>
    </div>
    <div class="end-game-actions">
      <button type="button" id="end-play-again-btn" class="end-action-btn end-play-btn">${won ? "🚀 PLAY NEW RUN [SPACE]" : "▶ PLAY AGAIN [SPACE]"}</button>
      ${earnedSafehouseAccess ? `<button type="button" id="end-safehouse-btn" class="end-action-btn end-switch-btn">🏠 ENTER SAFEHOUSE (1 UPGRADE) [U]</button>` : ""}
      <button type="button" id="end-switch-runner-btn" class="end-action-btn end-switch-btn">🕹️ SWITCH RUNNER [C]</button>
    </div>
  `;
  gameMessage.style.display = "block";
  gameArea.classList.remove("hide-cursor");
  armModalInputGuard(won ? 1450 : 950, "end-play-again-btn");

  const endLb = document.getElementById("end-leaderboard");
  if (endLb) {
    bindLeaderboardEvents(endLb, highlightId);
  }
  const playAgainBtn = document.getElementById("end-play-again-btn");
  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!isModalInputReady(false)) return;
      if (gameOver && assetsReady) startGame();
    });
  }
  const safehouseBtn = document.getElementById("end-safehouse-btn");
  if (safehouseBtn) {
    safehouseBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!isModalInputReady(false)) return;
      initGame(true);
    });
  }
  const switchRunnerBtn = document.getElementById("end-switch-runner-btn");
  if (switchRunnerBtn) {
    switchRunnerBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!isModalInputReady(false)) return;
      clearCallsignSlots();
      initGame(false);
    });
  }
}

function launchStuckBall() {
  if (ballIsStuck) {
    if (performance.now() < levelStartLaunchGuardUntil) return;
    clearTimeout(autoLaunchTimeout);
    soundManager.stop("winSong");
    ballIsStuck = false;

    // Ensure ballX is centered on the current paddle position before computing release vector
    ballX = paddleX - BALL_SIZE / 2;
    ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE;

    // In Cat Mode, start a new cat life with a smaller hop (1.08×) and escalate with each paddle hit!
    if (isCatMode) {
      const catStartMult = Math.min(2.16, 1.08 + catBounceCombo * 0.14);
      ballSpeedY = -(INITIAL_BALL_SPEED * catStartMult);
    } else {
      ballSpeedY = -INITIAL_BALL_SPEED;
    }

    let launchX = 0;

    // MAG-LOCK Flick-Velocity Aiming & Slingshot Overcharge (only when caught mid-level by Mag-Lock!)
    if (caughtByMagLock) {
      caughtByMagLock = false;
      magSlingshotCharges = 3;
      ball.classList.add("ball-slingshot");
      // Translate horizontal mouse/paddle movement velocity into the ball's release angle!
      launchX = paddleVelocityX * 0.48;
      launchX = Math.max(-440, Math.min(440, launchX));
      if (Math.abs(paddleVelocityX) > 140) {
        const dirText = paddleVelocityX > 0 ? "RIGHT FLICK ➔" : "⬅ LEFT FLICK";
        showNotification({
          title: `🧲 MAG-SLINGSHOT (${dirText})`,
          emoji: "🧲",
          name: "SLINGSHOT ×1.5!",
          description: "NEXT 3 BRICKS WORTH ×1.5 + 8 BASE PTS!",
          color: "#ff00ff",
          mode: "burst"
        }, { x: paddleX });
      }
      if (Math.abs(launchX) < 65) {
        launchX = (Math.random() > 0.5 ? 1 : -1) * 90;
      }
    } else {
      // Fresh Level Start Serve: smooth, predictable upward launch angle + gentle 0.65s speed ramp on higher levels!
      if (currentSector > 1) {
        draftResumeGraceTimer = Math.max(draftResumeGraceTimer, 0.65);
      }
      if (Math.abs(paddleVelocityX) > 45) {
        launchX = Math.max(-145, Math.min(145, paddleVelocityX * 0.22));
      } else {
        launchX = (paddleX < GAME_WIDTH / 2 ? 1 : -1) * 80;
      }
      if (isCatMode && Math.abs(launchX) < 135) {
        launchX = (launchX >= 0 ? 1 : -1) * 165;
      }
    }

    ballSpeedX = launchX;
    soundManager.play("magLaunch");
  }
}

function spawnLaserVolley(tier = 1, isAuto = false) {
  const clampedTier = Math.min(Math.max(tier, 1), 3);
  const paddleTop = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET;
  const wingOuter = Math.max(18, paddleWidth * 0.38);
  const wingInner = Math.max(8, paddleWidth * 0.18);

  if (clampedTier === 1) {
    // Tier 1: Twin Crimson Pulse Lasers (+4 base PTS, ×1.25 mult)
    const w = 6, h = 22;
    [paddleX - wingOuter - w / 2, paddleX + wingOuter - w / 2].forEach(bx => {
      const cx = Math.max(4, Math.min(GAME_WIDTH - w - 4, bx));
      const el = document.createElement("div");
      el.className = "laser-bolt laser-bolt-t1";
      el.style.left = `${cx}px`;
      el.style.top = `${paddleTop - h}px`;
      gameArea.appendChild(el);
      lasers.push({
        element: el,
        x: cx,
        y: paddleTop - h,
        width: w,
        height: h,
        damage: 1,
        bonusPts: 4,
        laserMult: 1.25,
        speed: LASER_SPEED
      });
    });
    soundManager.play("laserFire", { pitch: 1.0, volume: isAuto ? 0.42 : 0.75 });
  } else if (clampedTier === 2) {
    // Tier 2: Quad Rapid Cyan/Magenta Gatling Lasers (+7 base PTS, ×1.5 mult)
    const w = 6, h = 25;
    const mounts = [
      { x: paddleX - wingOuter - w / 2, yOff: 0 },
      { x: paddleX - wingInner - w / 2, yOff: 8 },
      { x: paddleX + wingInner - w / 2, yOff: 8 },
      { x: paddleX + wingOuter - w / 2, yOff: 0 }
    ];
    mounts.forEach((m, idx) => {
      const cx = Math.max(4, Math.min(GAME_WIDTH - w - 4, m.x));
      const cy = paddleTop - h - m.yOff;
      const el = document.createElement("div");
      el.className = `laser-bolt laser-bolt-t2 ${idx % 2 === 0 ? "gatling-cyan" : "gatling-magenta"}`;
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
      gameArea.appendChild(el);
      lasers.push({
        element: el,
        x: cx,
        y: cy,
        width: w,
        height: h,
        damage: 1,
        bonusPts: 7,
        laserMult: 1.5,
        speed: LASER_SPEED * 1.18
      });
    });
    soundManager.play("laserFire", { pitch: 1.28, volume: isAuto ? 0.45 : 0.8 });
  } else {
    // Tier 3: Hyper-Beam Golden/Violet Plasma Lances (3 wide lances, 2× Armor Damage, +12 base PTS, ×2.0 mult!)
    const mounts = [
      { x: paddleX - wingOuter - 5, w: 9, h: 30, yOff: 0 },
      { x: paddleX - 5,             w: 10, h: 34, yOff: 10 },
      { x: paddleX + wingOuter - 5, w: 9, h: 30, yOff: 0 }
    ];
    mounts.forEach(m => {
      const cx = Math.max(4, Math.min(GAME_WIDTH - m.w - 4, m.x));
      const cy = paddleTop - m.h - m.yOff;
      const el = document.createElement("div");
      el.className = "laser-bolt laser-bolt-t3";
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
      gameArea.appendChild(el);
      lasers.push({
        element: el,
        x: cx,
        y: cy,
        width: m.w,
        height: m.h,
        damage: 2,
        bonusPts: 12,
        laserMult: 2.0,
        speed: LASER_SPEED * 1.32
      });
    });
    soundManager.play("laserFire", { pitch: 0.86, volume: isAuto ? 0.52 : 0.88 });
  }
}

function fireLaser() {
  if (!canFire || !isLaserActive) return;
  canFire = false;
  const laserTier = frenzyTimerLeft > 0 ? 3 : Math.min(Math.max(activePowerUps["laser-blast"]?.length || 1, 1), 3);
  spawnLaserVolley(laserTier, false);
  const cooldown = [260, 190, 140][laserTier - 1] || 220;
  setTimeout(() => { canFire = true; }, cooldown);
}

function spawnDisruptiveBricks() {
  // 1) Find all currently broken bricks in the active grid
  const missingBricks = bricks.filter(b => b.isBroken);
  if (missingBricks.length === 0) return;

  // 2) Respawn between 20% and 50% of the missing bricks
  const restoreFraction = 0.20 + Math.random() * 0.30;
  const spawnCount = Math.max(
    1,
    Math.min(missingBricks.length, Math.round(missingBricks.length * restoreFraction))
  );

  // 3) Shuffle missing bricks and restore them in-place so they are 100% aligned to the grid
  const pool = [...missingBricks];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  for (let i = 0; i < spawnCount; i++) {
    const b = pool[i];
    b.isBroken = false;
    b.hitsTaken = 0;
    b.hitsRequired = 1;
    b.isVaultBrick = false;
    b.powerUpType = null;
    b.isExtraSpawn = true;
    b.element.innerHTML = "";
    b.element.classList.remove("broken", "damaged", "multihit", "brick-vault");
    b.element.classList.add("extra");
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

  const t = e.key.toLowerCase();
  if (" " === t) {
    isSpaceHeldDown = true;
  }

  // Between-Sector Extraction / Breach Terminal: E/SPACE/ENTER extracts ONLY at 5-stage checkpoints; J jumps out to character roster; 1/2/3 signs a Breach Contract!
  if (isLevelIntermissionOpen) {
    if ("j" === t) {
      e.preventDefault();
      if (!e.repeat && isModalInputReady(false)) {
        jumpOutToRunnerRoster(true);
      }
      return;
    }
    if (("e" === t || " " === t || "enter" === t) && canExtractAtCurrentIntermission()) {
      e.preventDefault();
      if (!e.repeat && isModalInputReady(true)) {
        extractFromSector(true);
      }
      return;
    }
    if (["1", "2", "3"].includes(t)) {
      e.preventDefault();
      const idx = parseInt(t, 10) - 1;
      if (!e.repeat && isModalInputReady(false) && currentContractOffers[idx]) {
        signBreachContractAndAdvance(currentContractOffers[idx].id, true);
      }
      return;
    }
    if (" " === t || "enter" === t || "e" === t) {
      e.preventDefault();
      return;
    }
  }

  // Global [M] mute shortcut when not typing a Callsign on the Start Screen
  if ("m" === t && !isStartScreenOpen() && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
    e.preventDefault();
    soundManager.init();
    soundManager.toggleMute();
    return;
  }

  // When on the Start Screen, allow typing A-Z or Backspace/Arrows into the Callsign Keypad, or 1-4 to pick Class
  if (isStartScreenOpen()) {
    if (" " === t || "enter" === t) {
      e.preventDefault();
      !e.repeat && assetsReady && startGame();
      return;
    }
    if (!isSafehouseMode) {
      if (["1", "2", "3", "4"].includes(t)) {
        const cId = RUNNER_CLASS_ORDER[parseInt(t, 10) - 1];
        if (cId) {
          e.preventDefault();
          setRunnerClass(cId);
          return;
        }
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
  }

  if (gameOver && gameMessage.style.display === "block" && ("c" === t || "u" === t)) {
    e.preventDefault();
    if (!e.repeat && isModalInputReady(false)) {
      if ("c" === t) {
        clearCallsignSlots();
        initGame(false);
      } else if ("u" === t && safehouseUpgradesRemaining > 0) {
        initGame(true);
      }
    }
    return;
  }

  if ("arrowleft" === t || "a" === t) {
    leftPressed = true;
  } else if ("arrowright" === t || "d" === t) {
    rightPressed = true;
  } else if (" " === t) {
    e.preventDefault();
    if (gameOver) {
      if (!e.repeat && isModalInputReady(true) && assetsReady) {
        startGame();
      }
    } else if (isLevelIntermissionOpen) {
      if (!e.repeat && isModalInputReady(true)) {
        resumeFromLevelIntermission(true);
      }
    } else if (!gameRunning) {
      !e.repeat && togglePause();
    } else {
      if (ballIsStuck) {
        launchStuckBall();
      } else if (frenzyReady && frenzyTimerLeft <= 0) {
        activateReadyLaserFrenzy();
      } else if (isLaserActive) {
        fireLaser();
      }
    }
  } else if ("f" === t || "e" === t || "shift" === t) {
    if (gameRunning && !gameOver && !isLevelIntermissionOpen) {
      if (frenzyReady && frenzyTimerLeft <= 0) {
        e.preventDefault();
        activateReadyLaserFrenzy();
      } else if (isLaserActive && "f" === t) {
        fireLaser();
      }
    }
  } else if ("p" === t || "escape" === t) {
    !gameOver && !isLevelIntermissionOpen && togglePause();
  }
});
document.addEventListener("keyup", e => {
  const t = e.key.toLowerCase();
  if (" " === t) {
    isSpaceHeldDown = false;
    spaceReleasedSinceModalOpen = true;
  }
  if ("arrowleft" === t || "a" === t) leftPressed = false;
  else if ("arrowright" === t || "d" === t) rightPressed = false;
});
document.addEventListener("mousemove",e=>{if(gameRunning&&!isLevelIntermissionOpen){const t=gameArea.getBoundingClientRect();let o=e.clientX-t.left,r=paddleWidth/2;o<r?o=r:o>GAME_WIDTH-r&&(o=GAME_WIDTH-r),paddleX=o}});

// Allow clicking on the playfield during active gameplay to launch a Mag-Locked/stuck ball (with mouse flick velocity!) or fire lasers
gameArea.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (isLevelIntermissionOpen) {
    // Only the explicit #intermission-continue-btn handles clicks on the intermission screen so stray laser clicks never skip it!
    return;
  }
  if (gameRunning && !gameOver) {
    if (ballIsStuck) {
      launchStuckBall();
    } else if (isLaserActive) {
      fireLaser();
    }
  }
});

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
  scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;

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
  if (!gameRunning && typeof kickStandaloneSparkLoop === "function") {
    kickStandaloneSparkLoop();
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
  if (soundManager.isMuted) return;
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
      gain.connect(soundManager.getDestination());
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
    osc.connect(gain).connect(soundManager.getDestination());
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
  resetBrickStreakOnMiss();
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
  if (!activeHackModes.has("god") || soundManager.isMuted) return;
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
      gain.connect(soundManager.getDestination());

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
      harpOsc.connect(harpGain).connect(soundManager.getDestination());
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
      totalBricksBrokenInRun++;
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
      scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
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
        totalBricksBrokenInRun++;
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
        scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
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
        advanceToNextSector();
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
    totalBricksBrokenInRun++;
    nb.element.classList.add("broken");
    const nbx = nb.x + nb.width / 2;
    const nby = nb.y;
    let chainPts = 40 * (rowBonusLevel + 1);
    if (isCatMode) chainPts = chainPts - (chainPts % 10) + 9;
    score += chainPts;
    if (isCatMode) score = score - (score % 10) + 9;
    scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
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
          scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
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
            totalBricksBrokenInRun++;
            b.element.classList.add("broken");

            const bx = b.x + b.width / 2;
            const by = b.y + b.height / 2;
            const randomDestroy = destroySounds[Math.floor(Math.random() * destroySounds.length)];
            soundManager.play(randomDestroy, { pitch: 0.85 + Math.random() * 0.3, volume: 0.6 });

            const brickPts = isCatMode ? 29 : 25;
            score += brickPts;
            if (isCatMode) score = score - (score % 10) + 9;
            scoreDisplay.textContent = `Score: ${formatArcadeScore(score)}`;
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
              advanceToNextSector();
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
        <p class="advert-subtitle">4 Bound Runner Classes • Infinite Stages (×1, ×2, ×3... Multiplier) • Stage Modifiers &amp; 65% Extraction Risk • Skill Rally Laser Frenzy &amp; 4 Falling Power-Ups.</p>
      </div>
      <button type="button" id="advert-close-btn" class="advert-close-btn">✕ CLOSE [ESC]</button>
    </div>

    <div class="advert-section-title">🕹️ 4 RUNNER CLASSES (DISTINCT PADDLES, BUFFS &amp; HANDICAPS)</div>
    <div class="advert-grid">
      <div class="advert-card" style="--card-accent: #00ffff;">
        <div class="advert-card-head">
          <span class="advert-card-name">⚡ STRIKER</span>
          <span class="advert-card-tag">TWIN-COIL CYAN RAIL DECK</span>
        </div>
        <p class="advert-card-body"><strong>L1–L5:</strong> 1×–3× Homing Tesla Bolts (+10 PTS) + Twin Wing Auto-Turrets (1.7s ➔ 0.72s, +8 PTS).<br><strong>▲ BUFF:</strong> <strong>Velocity Streak (×1.12–×1.40 PTS)</strong> on unbroken rallies!<br><strong>▼ HANDICAP:</strong> -12% Narrower Precision Paddle &amp; +10% Faster Ball.</p>
      </div>

      <div class="advert-card" style="--card-accent: #00ff88;">
        <div class="advert-card-head">
          <span class="advert-card-name">🛡️ GUARDIAN</span>
          <span class="advert-card-tag">ARMORED EMERALD BASTION DECK</span>
        </div>
        <p class="advert-card-body"><strong>L1–L5:</strong> +22%–+66% Paddle + <strong>1×–3× Emerald Mortar Bolts</strong> on every bounce + <strong>🛡️ Perfect Parry</strong> on center catches (2× Armor Dmg &amp; Emerald Splash) + <strong>Aegis Floor Shield</strong> (fires Homing Aegis Beams every 5th/4th/3rd brick &amp; Counter-Zaps 2 bricks on rebound!).<br><strong>▲ BUFF:</strong> <strong>×1.20–×1.40 Fortress Intact Bonus</strong> while Aegis is charged.<br><strong>▼ HANDICAP:</strong> -10% Slower Ball (Bonus pauses while shield recharges).</p>
      </div>

      <div class="advert-card" style="--card-accent: #ff6600;">
        <div class="advert-card-head">
          <span class="advert-card-name">💥 DEMOLISHER</span>
          <span class="advert-card-tag">HAZARD-ORANGE SIEGE RAM</span>
        </div>
        <p class="advert-card-body"><strong>L1–L5:</strong> Ball plows through 1–3 bricks (2× armor dmg, +14 PTS) + Plasma Nova Ring every 5th/4th/3rd brick (+14 PTS).<br><strong>▲ BUFF:</strong> <strong>×1.15–×1.25 Base + ×1.35 Siege PTS</strong> on Armored &amp; Gold Vaults.<br><strong>▼ HANDICAP:</strong> -15% Shorter Timed Power-Up Durations.</p>
      </div>

      <div class="advert-card" style="--card-accent: #ffd700;">
        <div class="advert-card-head">
          <span class="advert-card-name">🎲 HIGH-ROLLER</span>
          <span class="advert-card-tag">GOLD CASINO MARQUEE DECK</span>
        </div>
        <p class="advert-card-body"><strong>L1–L5:</strong> <strong>1D6 Bounce Chaos</strong> (Ricochet Sparks, Pierce, 4.5s Blaster Frenzy) + <strong>🃏 Wild Card Roulette</strong> (50% bonus mod, 30% double-stack, 20% Joker curse) + <strong>🎡 Wheel of Mayhem</strong> (every 8th/5th brick: Zap, Pop, or 🎁 Piñata Brick!).<br><strong>▼ HANDICAP:</strong> Roll 1 Snake Eyes shrinks paddle -20% &amp; ×0.75 PTS.</p>
      </div>
    </div>

    <div class="advert-section-title">🚀 INFINITE STAGES, STAGE MODIFIERS &amp; 65% EXTRACTION LOOP</div>
    <div class="advert-grid">
      <div class="advert-card" style="--card-accent: #90ff5a;">
        <div class="advert-card-head">
          <span class="advert-card-name">🟢 EXTRACT OR PUSH DEEPER</span>
          <span class="advert-card-tag">STAGE 1 ➔ ∞ (×1, ×2, ×3...)</span>
        </div>
        <p class="advert-card-body">Clearing all bricks completes the <strong>Stage</strong>! Choose to <strong>🟢 Jack Out &amp; Extract</strong> (bank <strong>100% of your Score &amp; Cyber-Creds ¢</strong> to your Callsign Safehouse) OR risk it all to enter the next Stage!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ff3366;">
        <div class="advert-card-head">
          <span class="advert-card-name">🔴 STAGE MODIFIERS &amp; 65% RISK</span>
          <span class="advert-card-tag">1 BUFF + 1 NERF PER STAGE</span>
        </div>
        <p class="advert-card-body">Entering the next Stage requires picking <strong>1 of 3 Stage Modifiers (1 Buff + 1 Nerf)</strong> for that Stage. If you flatline (drop the ball), <strong>65% of your Run Score &amp; unbanked Cyber-Creds are lost</strong>!</p>
      </div>
    </div>

    <div class="advert-section-title">⚡ SKILL RALLY LASER FRENZY &amp; 4 FALLING POWER-UPS</div>
    <div class="advert-grid">
      <div class="advert-card" style="--card-accent: #ff2a55;">
        <div class="advert-card-head">
          <span class="advert-card-name">🚨 LASER FRENZY OVERDRIVE</span>
          <span class="advert-card-tag">100% RALLY METER • [F / SPACE]</span>
        </div>
        <p class="advert-card-body">Unbroken paddle rallies fill your <strong>Skill Rally Frenzy Meter</strong> (+24% on center Sweet-Spot, +15% on wing bounce). Hit <strong>100% ("FRENZY READY!")</strong> and press <strong>[F] or [SPACE]</strong> to unleash a <strong>2.0s 🚨 LASER FRENZY</strong>!</p>
      </div>

      <div class="advert-card" style="--card-accent: #90ff5a;">
        <div class="advert-card-head">
          <span class="advert-card-name">🪴 EXPANDO</span>
          <span class="advert-card-tag">15s • STACKS UP TO 3×</span>
        </div>
        <p class="advert-card-body"><strong>Gameplay:</strong> +35% paddle width per stack (Lime ➔ Gold ➔ Orange).<br><strong>Scoring:</strong> Multiplies your active Score Multiplier by <strong>×2, ×3, and ×4</strong>!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ff00ff;">
        <div class="advert-card-head">
          <span class="advert-card-name">🧲 MAG-LOCK</span>
          <span class="advert-card-tag">4s • FLICK-VELOCITY AIM</span>
        </div>
        <p class="advert-card-body"><strong>Gameplay:</strong> Catches the ball—<strong>move your mouse while releasing</strong> to curve your launch angle with paddle flick velocity!<br><strong>Scoring:</strong> Grants <strong>×1.5 Slingshot Overcharge (+8 base PTS)</strong> on your next 3 bricks!</p>
      </div>

      <div class="advert-card" style="--card-accent: #00ffff;">
        <div class="advert-card-head">
          <span class="advert-card-name">🐌 SLOW-MO</span>
          <span class="advert-card-tag">5s • STACKS UP TO 3×</span>
        </div>
        <p class="advert-card-body"><strong>Gameplay:</strong> Cuts ball speed to <strong>75% / 56% / 42%</strong> with bullet-time trails.<br><strong>Scoring:</strong> Awards a <strong>×1.5 / ×1.75 / ×2.0 Precision Score Multiplier</strong> on all bricks broken during Slow-Mo!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ffa500;">
        <div class="advert-card-head">
          <span class="advert-card-name">🧱 BRICKED UP!</span>
          <span class="advert-card-tag">INSTANT • GRID REFILL</span>
        </div>
        <p class="advert-card-body"><strong>Gameplay:</strong> Restores <strong>20%–50% of broken bricks</strong> into aligned grid slots.<br><strong>Scoring:</strong> Awards an <strong>instant +150 × Stage Bonus on catch</strong>, plus <strong>+8 base PTS</strong> on every restored brick!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ffd700;">
        <div class="advert-card-head">
          <span class="advert-card-name">🛡️ ARMORED &amp; GOLD VAULTS</span>
          <span class="advert-card-tag">×1.6 (2-HIT) • ×3.0 (3-HIT)</span>
        </div>
        <p class="advert-card-body">Standard bricks pay <strong>10 base PTS (+1 XP)</strong>. Notched <strong>Armored Bricks</strong> take 2 hits for <strong>×1.6 PTS (+2 XP)</strong>, and <strong>Gold Vault Bricks</strong> take 3 hits for <strong>×3.0 PTS (+3 XP)</strong>!</p>
      </div>
    </div>

    <div class="advert-section-title">🔥 STUNT MULTIPLIERS &amp; NEON LEGEND OVERDRIVE</div>
    <div class="advert-grid">
      <div class="advert-card" style="--card-accent: #ffd700;">
        <div class="advert-card-head">
          <span class="advert-card-name">👑 ROOF BONUS</span>
          <span class="advert-card-tag">15 BASE PTS (×1.5)</span>
        </div>
        <p class="advert-card-body">Skim the ball off the top ceiling! Your ball ignites with a golden aura and boosts base brick value from <strong>10 ➔ 15 PTS</strong> until your next brick break.</p>
      </div>

      <div class="advert-card" style="--card-accent: #00ff00;">
        <div class="advert-card-head">
          <span class="advert-card-name">📐 WALL BANK-SHOT</span>
          <span class="advert-card-tag">+2 BASE PTS</span>
        </div>
        <p class="advert-card-body">Ricochet off the left or right perimeter wall immediately before smashing a brick to add <strong>+2 base points</strong> before all multipliers!</p>
      </div>

      <div class="advert-card" style="--card-accent: #00ffff;">
        <div class="advert-card-head">
          <span class="advert-card-name">⚡ EDGE RUNNER</span>
          <span class="advert-card-tag">×2 / ×3 / ×4 ROW BONUS</span>
        </div>
        <p class="advert-card-body">Wipe out an entire horizontal row of original bricks to award <strong>+4 Class XP</strong>, slam the arena jumbotron, and <strong>multiply all brick points by ×2, ×3, or ×4</strong> for the current Stage!</p>
      </div>

      <div class="advert-card" style="--card-accent: #ff00ff;">
        <div class="advert-card-head">
          <span class="advert-card-name">😎 NEON LEGEND OVERDRIVE</span>
          <span class="advert-card-tag">10-BRICK STREAK • ×1.5 PTS</span>
        </div>
        <p class="advert-card-body">Smash <strong>10 bricks in an unbroken streak</strong> (or pass 5,000 PTS) to ignite <strong>😎 Neon Legend Overdrive</strong>: grants a live <strong>×1.5 Score Multiplier + +8% Overdrive Speed</strong> until the ball drops!</p>
      </div>
    </div>

    <div class="advert-section-title">🏆 THE 14 CYBER-RUNNER RANKS (FLATLINE VS. SAFE EXTRACTION)</div>
    <div class="advert-ranks-box">
      <div class="advert-rank-col">
        <h4>💀 FLATLINED (BALL LOST • -65% RISK PENALTY)</h4>
        <ul class="advert-rank-list">
          <li><span>System Glitch</span><span class="advert-rank-score">&lt; 1,500</span></li>
          <li><span>Code Ghost</span><span class="advert-rank-score">1,500–3,999</span></li>
          <li><span>Memory Leak</span><span class="advert-rank-score">4,000–7,999</span></li>
          <li><span>Burned Out</span><span class="advert-rank-score">8,000–14,999</span></li>
          <li><span>Data Janitor</span><span class="advert-rank-score">15,000–27,999</span></li>
          <li><span>Pixel Drifter</span><span class="advert-rank-score">28,000–49,999</span></li>
          <li><span>Grid Runner</span><span class="advert-rank-score">50,000–79,999</span></li>
          <li><span>Neon Operator</span><span class="advert-rank-score">80,000+</span></li>
        </ul>
      </div>
      <div class="advert-rank-col win-col">
        <h4>🟢 SAFE EXTRACTION (100% SCORE &amp; CREDS BANKED)</h4>
        <ul class="advert-rank-list">
          <li><span>Neon Legend</span><span class="advert-rank-score">&lt; 55,000</span></li>
          <li><span>Circuit Surfer</span><span class="advert-rank-score">55,000–89,999</span></li>
          <li><span>Hologram Hacker</span><span class="advert-rank-score">90,000–129,999</span></li>
          <li><span>Beyond the Black Wall</span><span class="advert-rank-score">130,000–179,999</span></li>
          <li><span>Synth Overlord</span><span class="advert-rank-score">180,000–249,999</span></li>
          <li><span>You Are The Replaced</span><span class="advert-rank-score">250,000+</span></li>
        </ul>
      </div>
    </div>

    <div class="advert-secret-strip">
      <span>🕵️ <strong>CLASSIFIED DECK HACKS:</strong> Press <code>[~]</code> to open the Cyber-Deck Terminal &amp; breach (saves to Hacked Top 5):</span>
      <div>
        <code>catMode()</code>
        <code>poopStorm()</code>
        <code>confettiBlast()</code>
        <code>godMode()</code>
        <code>maxOverdrive()</code>
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
