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

const INITIAL_BALL_SPEED = 200 * GAME_SCALE;
const PADDLE_SPEED = 450 * GAME_SCALE;
const POWER_UP_SPEED = 120 * GAME_SCALE;
const GRAVITY = 10 * GAME_SCALE;
const LASER_SPEED = 500 * GAME_SCALE;
const FIRE_COOLDOWN = 300;
const MAX_NOTIFICATIONS = 3;
let rowBonusLevel = 0;
let isCatMode = false;

const gameArea = document.getElementById('game-area');
const scoreDisplay = document.getElementById('score');
const notificationsContainer = document.getElementById('notifications-container');
const statusIndicatorsContainer = document.getElementById('status-indicators');
const ball = document.getElementById('ball');
const paddle = document.getElementById('paddle');
const bricksContainer = document.getElementById('bricks-container');
const gameMessage = document.getElementById('game-message');
const startScreen = document.getElementById('start-screen');
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
    description: 'Press F to fire!',
    cssClass:    'laser-blast',
    duration:    3000
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
  'bounce':      { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/paddle-and-wall.mp3" }, 
  'multihit':    { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/multi-hit.mp3" }, 
  'destroy1':    { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/Destroy1.mp3" }, 
  'destroy2':    { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/Destroy2.mp3" }, 
  'destroy3':    { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/Destroy3.mp3" }, 
  'powerUpSpawn':{ url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/Drop.mp3" }, 
  'laserFire':   { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/Laser2.mp3" }, 
  'winSong':     { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/theme.wav" }, 
  'loseSong':    { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/LoserSong.mp3" }, 
  'grow':        { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/Grow.mp3", reversable: true }, 
  'magActivate': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/mag1.mp3" }, 
  'magLaunch':   { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/sounds/mag2.mp3" } 
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

// --- Helper Functions ---
function getHighScore(){return parseInt(localStorage.getItem("brickRunnerHighScore"))||0}
function saveHighScore(e){const t=getHighScore();e>t&&localStorage.setItem("brickRunnerHighScore",e),updateHighScoreDisplay()}
function updateHighScoreDisplay(){const e=getHighScore();highScoreDisplay.textContent=`High Score: ${e}`}

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
    isCatMode   = false;
    BALL_EMOJI  = "😊";      // your default face
    ball.textContent = BALL_EMOJI;  
    score = 0;
    scoreDisplay.textContent = `Score: ${score}`;
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
    powerUps.forEach(p => p.element.remove());
    powerUps = [];
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
    
    startScreen.style.display = 'flex';
    gameMessage.style.display = 'none';
    scoreDisplay.style.display = 'none';
     statusIndicatorsContainer.style.display = 'none';
    ball.style.display = 'none';
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



function setupGame() {
    updateHighScoreDisplay();
    startScreen.style.display = 'none';
    clickToStartOverlay.style.display = 'flex';

    const allEmojis = [BALL_EMOJI, ...Object.values(POWER_UP_TYPES).map(p => p.emoji)];
    let emojiIndex = 0;
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

        soundManager.init();
        startScreen.style.display = 'flex';
        startPrompt.textContent = "Loading...";
        startPrompt.classList.add('loading');
        
        soundManager.loadAll(soundsToLoad).then(() => {
            assetsReady = true;
            startPrompt.textContent = "Press SPACE to Begin";
            startPrompt.classList.remove('loading');
        });
    }, { once: true });
    
    initGame();
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

function togglePause(){if(gameOver||ballIsStuck)return;gameRunning=!gameRunning,gameRunning?(gameMessage.style.display="none",gameArea.classList.add("hide-cursor"),lastTime=0,requestAnimationFrame(gameLoop)):(cancelAnimationFrame(animationFrameId),gameMessage.innerHTML="PAUSED",gameMessage.style.display="block",gameArea.classList.remove("hide-cursor"))}
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

  // 5) Draw everything to the screen
  renderGame();

  // 6) If the ball is stuck to the paddle (mag-lock), keep it there
  if (ballIsStuck) {
    ballX = paddleX - BALL_SIZE / 2;
    ballY = GAME_HEIGHT - PADDLE_HEIGHT - PADDLE_BOTTOM_OFFSET - BALL_SIZE;
  }

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


function updatePaddlePosition(e){const t=paddleWidth/2;leftPressed&&paddleX-t>0?paddleX-=PADDLE_SPEED*e:rightPressed&&paddleX+t<GAME_WIDTH&&(paddleX+=PADDLE_SPEED*e)}
function updateBallPosition(e){if(ballIsStuck)return;const t=activePowerUps["slow-mo"]?.length||0,o=Math.pow(.75,t);ballX+=ballSpeedX*o*e,ballY+=ballSpeedY*o*e}
function isColliding(e,t){return!(e.bottom<t.top||e.top>t.bottom||e.right<t.left||e.left>t.right)}


function updatePaddleWidth() {
  // Calculate how big the paddle _should_ be logically
  const scaleFactor = 1 + paddleSizeLevel * 0.35;
  paddleWidth = PADDLE_DEFAULT_WIDTH * scaleFactor;

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
        showNotification("MAXO EXPANDO!");
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
    showNotification(type);
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
      showNotification(`wide-paddle-${stackLevel}`);
      break;
    }

    case 'slow-mo':
      soundManager.play('bounce', { pitch: 0.8, volume: 0.7 });
      // 🔑 show Slow-Mo banner
      // Stack count for slow-mo
      const lvl = activePowerUps['slow-mo']?.length || 0;
      // Clamp between 1 and 3
      const level = Math.min(Math.max(lvl, 1), 3);
      showNotification(`slow-mo-${level}`);
      break;

    case 'sticky-paddle':
      isStickyPaddle = true;
      paddle.classList.add('paddle-sticky');
      soundManager.play('magActivate');
      // 🔑 show Mag-Lock banner
      showNotification(type);
      break;

    case 'laser-blast':
      isLaserActive = true;
      paddle.classList.add('paddle-armed');
      soundManager.play('laserFire', { pitch: 1.2 });
      // 🔑 show Laser Blast banner
      showNotification(type);
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
        // 1) Compute base points
        const basePoints = isRoofBonusActive ? 15 : 10;
        const laserBonus = 3;

        // 2) Make points mutable, then round the popup to …9 in Cat Mode
        let points = basePoints + laserBonus;
        if (isCatMode) {
          points = points - (points % 10) + 9;
        }

        // 3) Add to total and round the total as well
        score += points;
        if (isCatMode) {
          score = score - (score % 10) + 9;
        }
        scoreDisplay.textContent = `Score: ${score}`;

        // 4) Show the floating +N (now ending in 9)
        const popupX = b.x + b.width / 2;
        const popupY = b.y;
        showBrickScore(popupX, popupY, points);

        // 5) Break the brick, spawn any power-up, remove the bolt
        b.isBroken = true;
        b.element.classList.add('broken');
        if (b.powerUpType) spawnPowerUp(b.powerUpType, b);
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
      // 4. Expando multiplier (🪴 Multiply your score!)
      //    1 stack → 2×, 2 stacks → 3×, 3 stacks → 4×
      const expandoStacks = (activePowerUps['wide-paddle'] || []).length;
      if (expandoStacks > 0) {
        points *= (expandoStacks + 1);
      }
      // Clear roof bonus
      if (isRoofBonusActive) {
        isRoofBonusActive = false;
        ball.classList.remove("bonus-active");
        soundManager.play("powerUpSpawn", { pitch: 3, volume: 0.7 });
      }

     // Multi-hit logic
     // Multi-hit logic
      brick.hitsTaken++;

      // only when the brick actually dies…
      if (brick.hitsTaken >= brick.hitsRequired) {
        // 1) Play the destroy sound
        const soundName = destroySounds[destroySoundIndex];
        soundManager.play(soundName);
        destroySoundIndex = (destroySoundIndex + 1) % destroySounds.length;

        // 2) Mark the brick as broken
        brick.isBroken = true;
        brick.element.classList.add("broken");

        // … after you calculate your raw points (before any rounding) …
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

        // 3) Apply row-clear multiplier if any
        points *= (rowBonusLevel + 1);

        // 2 hit brick bonus...
        if (brick.hitsRequired > 1) {
          points = Math.round(points * 1.6);  // +20%
        }

        const devBreakdown = {
          basePoints:            isRoofBonusActive ? 15 : 10,
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

        // Now show the popup and continue…
        showBrickScore(
          brick.x + brick.width/2,
          brick.y,
          points
        );

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
        showNotification({
          emoji:       "😎",
          name:        "NEON LEGEND",
          description: "Over 500 Achieved!"
        });
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


      // Bounce and accelerate
      ballSpeedY *= -1;
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

  // Center the paddle’s hitbox
  const left = paddleX - paddleWidth / 2;
  paddle.style.left = `${left}px`;

  // (Optional) re-apply the transform here if you like:
  const scaleFactor = paddleWidth / PADDLE_DEFAULT_WIDTH;
  paddle.style.transform = `scaleX(${scaleFactor})`;
}



function endGame(e){gameOver=!0,gameRunning=!1,cancelAnimationFrame(animationFrameId),soundManager.stopAll(),e?soundManager.play("winSong"):soundManager.play("loseSong");const t=getHighScore();let o=!1;score>t&&(saveHighScore(score),o=!0);const r=getHighScore(),n=getRating(score,e),a=e?"Mission Complete!":"System Failure!";gameMessage.innerHTML=`<span class="title">${a}</span><span class="name rating">${n}</span><span class="description">Final Score: ${score}</span><span class="high-score">${o?"New High Score!":""}</span><p class="game-message-prompt">Press SPACE to Restart</p>`,gameMessage.style.display="block",gameArea.classList.remove("hide-cursor")}
function launchStuckBall(){if(ballIsStuck){clearTimeout(autoLaunchTimeout),soundManager.stop("winSong"),ballIsStuck=!1,ballSpeedY=-INITIAL_BALL_SPEED;const e=paddleWidth/2,t=(ballX+BALL_SIZE/2-paddleX)/e*INITIAL_BALL_SPEED*1.5;ballSpeedX=t,soundManager.play("magLaunch")}}
function fireLaser(){if(!canFire||!isLaserActive)return;canFire=!1,soundManager.play("laserFire"),(()=>{const e=6,t=20,o=GAME_HEIGHT-PADDLE_HEIGHT-PADDLE_BOTTOM_OFFSET,r={x:paddleX-e/2,y:o-t,width:e,height:t},n=document.createElement("div");n.className="laser-bolt",n.style.left=`${r.x}px`,n.style.top=`${r.y}px`,gameArea.appendChild(n),r.element=n,lasers.push(r)})(),setTimeout(()=>{canFire=!0},FIRE_COOLDOWN)}

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
  // bail if row is missing or not a finite number
  if (typeof row !== 'number' || !Number.isFinite(row)) {
    return;
  }

  // don’t re-fire a lower or equal level
  if (row < rowBonusLevel) return;

  // gather only non-extra bricks in that row
  const inRow = bricks.filter(b => b.row === row && !b.isExtraSpawn);
  if (!inRow.length || !inRow.every(b => b.isBroken)) return;

  // bump level (1..3)
  rowBonusLevel = Math.min(row + 1, 3);
  showNotification(`row-clear-${rowBonusLevel}`);
}


document.addEventListener('DOMContentLoaded',setupGame);
resetButton.addEventListener("click",initGame);
document.addEventListener("keydown",e=>{const t=e.key.toLowerCase();if("arrowleft"===t||"a"===t)leftPressed=!0;else if("arrowright"===t||"d"===t)rightPressed=!0;else if(" "===t){e.preventDefault();if(gameOver){assetsReady&&startGame()}else if(ballIsStuck)launchStuckBall();else{togglePause()}}else if("f"===t)isLaserActive&&gameRunning&&fireLaser()});
document.addEventListener("keyup",e=>{const t=e.key.toLowerCase();"arrowleft"===t||"a"===t?leftPressed=!1:"arrowright"===t||"d"===t&&(rightPressed=!1)});
document.addEventListener("mousemove",e=>{if(gameRunning){const t=gameArea.getBoundingClientRect();let o=e.clientX-t.left,r=paddleWidth/2;o<r?o=r:o>GAME_WIDTH-r&&(o=GAME_WIDTH-r),paddleX=o}});

setupGame();

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

    // get paddle bounds in game‐space
    const padBox  = paddle.getBoundingClientRect();
    const areaBox = area.getBoundingClientRect();
    const padLeft = padBox.left   - areaBox.left;
    const padTop  = padBox.top    - areaBox.top;
    const padRight= padBox.right  - areaBox.left;

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
  for (let i = 0; i < 100; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    area.appendChild(c);
    // your .confetti CSS can animate color, fall, etc.
    setTimeout(() => c.remove(), 2000);
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
  isCatMode = true;
  // 1) Switch the ball emoji to a cat
  ball.textContent = '🐱';
  // Also update your global BALL_EMOJI if you use it elsewhere
  window.BALL_EMOJI = '🐱';
  //ball.textContent = BALL_EMOJI;

  console.log('🐱 Cat Mode: Permanent 9s!');
}
window.catMode = catMode;
window['🐱']   = catMode;

// ─── Pro‐tip Rotator ───

// 1) Define all your tips here:
const TIPS = [
  "Hit the top edge for a Roof Bonus (×1.5).",
  "Bank‐shots off walls give a small extra bonus.",
  "“Expando” stacks multiply your points ×2, ×3, ×4…",
  "Bricked Up! power-ups re-fill empty slots—use them wisely.",
  "Shooting bricks with the Laser gives +3 points plus bonuses.",
  "Clear entire layers quickly for “Edge Runner” bonuses.",
  "Stay on the move—never let the ball slip past your paddle!"
];

// 2) Grab references & state:
const tipBox    = document.getElementById("tips-box");
const tipText   = document.getElementById("tip-text");
let   tipIndex  = 0;

// 3) Initialize with the first tip:
tipText.textContent = TIPS[tipIndex];

// 4) On "T" keypress, advance to the next tip:
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "t") {
    tipIndex = (tipIndex + 1) % TIPS.length;
    tipText.textContent = TIPS[tipIndex];
  }
});
