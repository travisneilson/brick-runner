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

const gameArea = document.getElementById('game-area');
const scoreDisplay = document.getElementById('score');
const livesDisplay = document.getElementById('lives-display');
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
    'wide-paddle': { type: "stacking", emoji: "🍄", name: "EXPANDO", cssClass: "wide-paddle", description: "Paddle size increased", duration: 15000 },
    'slow-mo': { type: "stacking", emoji: "🐌", name: "SLOW-MO", cssClass: "slow-mo", description: "Ball speed reduced", duration: 5000 },
    'sticky-paddle': { type: "refreshing", emoji: "🧲", name: "MAG-LOCK", cssClass: "sticky-paddle", description: "Catch & launch the ball", duration: 4000 },
    'laser-blast': { type: "refreshing", emoji: "🎯", name: "LASER BLAST", cssClass: "laser-blast", description: "Press SPACE to fire!", duration: 3000 },
    'one-up': { type: "instant", emoji: "👼", name: "1-UP", cssClass: "one-up", description: "Extra Life! More Bricks!" }
};
const POWER_UP_SPAWN_CHANCES = ['wide-paddle', 'wide-paddle', 'wide-paddle', 'slow-mo', 'slow-mo', 'sticky-paddle', 'laser-blast', 'one-up'];
const soundsToLoad = { 'bounce': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/paddle-and-wall.mp3" }, 'multihit': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/multi-hit.mp3" }, 'destroy1': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/Destroy1.mp3" }, 'destroy2': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/Destroy2.mp3" }, 'destroy3': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/Destroy3.mp3" }, 'powerUpSpawn': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/Drop.mp3" }, 'laserFire': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/Laser2.mp3" }, 'winSong': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/theme.wav" }, 'loseSong': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/LoserSong.mp3" }, 'grow': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/Grow.mp3", reversable: true }, 'magActivate': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/mag1.mp3" }, 'magLaunch': { url: "https://raw.githubusercontent.com/travisneilson/brick-runner/main/mag2.mp3" } };
const destroySounds = ['destroy1', 'destroy2', 'destroy3'];
let destroySoundIndex = 0;
let paddleX, paddleWidth = PADDLE_DEFAULT_WIDTH, leftPressed = false, rightPressed = false;
let ballX, ballY, ballSpeedX, ballSpeedY;
const BALL_EMOJI = "😊", CHAOTIC_EMOJIS = ["😵","🤪","🤯","😱","🥴","😡","🤢","🫠","💀","🤡","😭","🗿","😂","🤣","😏","🙄","😮","🤧","🤮","🤠","🥸","👽","🤖","👺","👻","🤓","🧐","🥺","😠","😲"];
// UPDATED: The 'bricks' array is now declared with 'let' instead of 'const'
let bricks = [];
let lastTime = 0, frameCounter = 0;

// --- Helper Functions ---
function getHighScore(){return parseInt(localStorage.getItem("brickRunnerHighScore"))||0}
function saveHighScore(e){const t=getHighScore();e>t&&localStorage.setItem("brickRunnerHighScore",e),updateHighScoreDisplay()}
function updateHighScoreDisplay(){const e=getHighScore();highScoreDisplay.textContent=`High Score: ${e}`}
function getRating(e,t){if(t){if(700<e)return"You Are The Replaced";if(550<e)return"Beyond the Black Wall";return"Neon Legend"}if(e<50)return"System Glitch";if(e<200)return"Data Janitor";if(e<400)return"Grid Runner";return"Burned Out"}
function updateLivesDisplay(){let e="";for(let t=0;t<lives;t++)e+="❤️";livesDisplay.textContent=e}

// --- Game Core Functions ---
function initGame() {
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
    livesDisplay.style.display = 'none';
    statusIndicatorsContainer.style.display = 'none';
    ball.style.display = 'none';
    resetButton.style.display = 'none';
    
    gameArea.classList.remove('hide-cursor');
    lastTime = 0;
    soundManager.stopAll();
    clearTimeout(autoLaunchTimeout);
}

function createBricks(){const e=50*GAME_SCALE,t=(GAME_WIDTH-10*(BRICK_WIDTH+BRICK_GAP)+BRICK_GAP)/2;for(let o=0;o<BRICK_ROWS;o++)for(let r=0;r<BRICK_COLS;r++){const n=document.createElement("div");n.classList.add("brick",`brick-row-${o}`);let a=null;.35>Math.random()&&(a=POWER_UP_SPAWN_CHANCES[Math.floor(Math.random()*POWER_UP_SPAWN_CHANCES.length)]);const l={element:n,x:t+r*(BRICK_WIDTH+BRICK_GAP),y:e+o*(BRICK_HEIGHT+BRICK_GAP),width:BRICK_WIDTH,height:BRICK_HEIGHT,isBroken:!1,hitsRequired:1,hitsTaken:0,powerUpType:a};.25>Math.random()&&(l.hitsRequired=2,n.classList.add("multihit")),l.powerUpType&&(()=>{const c=document.createElement("span");c.className="power-up-indicator",c.textContent=POWER_UP_TYPES[l.powerUpType].emoji,n.appendChild(c)})(),n.style.width=`${BRICK_WIDTH}px`,n.style.height=`${BRICK_HEIGHT}px`,bricksContainer.appendChild(n),bricks.push(l)}}

function setupGame() {
    // Show only the click-to-start overlay
    startScreen.style.display = 'none';
    gameArea.classList.add('hidden');
    clickToStartOverlay.style.display = 'flex';

    const allEmojis = [BALL_EMOJI, ...Object.values(POWER_UP_TYPES).map(p => p.emoji)];
    let emojiIndex = 0;
    emojiCycleInterval = setInterval(() => {
        if(loadingEmoji) {
            loadingEmoji.textContent = allEmojis[emojiIndex];
            emojiIndex = (emojiIndex + 1) % allEmojis.length;
        }
    }, 500);

    clickToStartOverlay.onclick = () => {
        // Hide overlay, show start screen
        clickToStartOverlay.style.display = 'none';
        startScreen.style.display = 'flex';
        // Animate title, show "Press SPACE to Begin"
        // (Do NOT call initGame() here!)
    };
}

// Listen for SPACE on the start screen to actually start the game
document.addEventListener('keydown', (e) => {
    if (
        e.key === " " &&
        startScreen.style.display === 'flex'
    ) {
        startScreen.style.display = 'none';
        gameArea.classList.remove('hidden');
        initGame(); // <-- Only call here!
    }
});

function startGame() {
    if (gameOver && assetsReady) {
        initGame(); 
        lives = 1;
        updateLivesDisplay();
        gameOver = false;
        
        startScreen.style.display = 'none';
        scoreDisplay.style.display = 'block';
        livesDisplay.style.display = 'block';
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
function gameLoop(e){if(!gameRunning)return;lastTime||(lastTime=e);const t=(e-lastTime)/1e3;lastTime=e,updatePaddlePosition(t),updateBallPosition(t),updatePowerUps(t),updateLasers(t),updateStatusIndicators(),checkCollisions(),renderGame(),ballIsStuck&&(ballX=paddleX-BALL_SIZE/2,ballY=GAME_HEIGHT-PADDLE_HEIGHT-PADDLE_BOTTOM_OFFSET-BALL_SIZE);const o=activePowerUps["slow-mo"]?.length||0;o>0&&++frameCounter%(8+4*(o-1))==0&&createOnionSkin(),bricks.every(e=>e.isBroken)?endGame(!0):ballY+BALL_SIZE>GAME_HEIGHT&&!ballIsStuck&&(lives--,updateLivesDisplay(),0<lives?resetAfterLifeLost():endGame(!1)),animationFrameId=requestAnimationFrame(gameLoop)}
function updatePaddlePosition(e){const t=paddleWidth/2;leftPressed&&paddleX-t>0?paddleX-=PADDLE_SPEED*e:rightPressed&&paddleX+t<GAME_WIDTH&&(paddleX+=PADDLE_SPEED*e)}
function updateBallPosition(e){if(ballIsStuck)return;const t=activePowerUps["slow-mo"]?.length||0,o=Math.pow(.75,t);ballX+=ballSpeedX*o*e,ballY+=ballSpeedY*o*e}
function isColliding(e,t){return!(e.bottom<t.top||e.top>t.bottom||e.right<t.left||e.left>t.right)}
function showNotification(e){const t=document.createElement("div");t.classList.add("notification");const o=notificationsContainer.querySelectorAll(".notification");o.forEach((e,t)=>{e.className=`notification visible stack-${t+1}`,t+1>=MAX_NOTIFICATIONS&&(e.classList.add("removing"),setTimeout(()=>{e.remove()},500))}),"string"==typeof e?t.innerHTML=`<span class="name">${e}</span>`:t.innerHTML=`
            <span class="title">Power Up!</span>
            <span class="name">${e.emoji} ${e.name}!</span>
            <span class="description">${e.description}</span>
        `,notificationsContainer.appendChild(t),setTimeout(()=>{t.classList.add("visible")},10),setTimeout(()=>{t.classList.add("removing"),setTimeout(()=>{t.remove()},500)},3500)}
function updatePaddleWidth(){paddleWidth=PADDLE_DEFAULT_WIDTH*(1+paddleSizeLevel*.35);const e=1+paddleSizeLevel*.35;paddle.style.transform=`scaleX(${e})`,paddle.classList.remove("paddle-glow-1","paddle-glow-2","paddle-glow-3"),1===paddleSizeLevel?paddle.classList.add("paddle-glow-1"):2===paddleSizeLevel?paddle.classList.add("paddle-glow-2"):3===paddleSizeLevel&&paddle.classList.add("paddle-glow-3")}
function spawnPowerUp(e,t){soundManager.play("powerUpSpawn",{pitch:2});const o=POWER_UP_TYPES[e];if(!o)return;const r=document.createElement("div");r.classList.add("power-up"),r.textContent=o.emoji;const n={element:r,type:e,x:t.x+t.width/2-POWER_UP_SIZE/2,y:t.y+t.height/2-POWER_UP_SIZE/2,bounced:!1,vx:0,vy:0,originX:t.x+t.width/2-POWER_UP_SIZE/2,swayAmplitude:25+20*Math.random(),swayFrequency:.02+.02*Math.random(),swayPhase:2*Math.random()*Math.PI};r.style.left=`${n.x}px`,r.style.top=`${n.y}px`,gameArea.appendChild(r),powerUps.push(n)}
function updatePowerUps(e){for(let t=powerUps.length-1;0<=t;t--){const o=powerUps[t];o.bounced?(o.vy+=GRAVITY*60*e,o.x+=o.vx*60*e,o.y+=o.vy*60*e):(o.y+=POWER_UP_SPEED*e,o.x=o.originX+o.swayAmplitude*Math.sin(o.y*o.swayFrequency+o.swayPhase));const r=paddleWidth/2,n={left:paddleX-r,right:paddleX+r,top:GAME_HEIGHT-PADDLE_HEIGHT-PADDLE_BOTTOM_OFFSET,bottom:GAME_HEIGHT-PADDLE_BOTTOM_OFFSET},a={left:o.x,right:o.x+POWER_UP_SIZE,top:o.y,bottom:o.y+POWER_UP_SIZE};if(!o.bounced&&isColliding(a,n)){const l=activePowerUps[o.type]||[],c=POWER_UP_TYPES[o.type];"stacking"===c.type&&l.length>=MAX_PADDLE_LEVEL?(o.bounced=!0,o.vy=-105,o.vx=105*(Math.random()-.5),showNotification("MAX POWER!")):(activatePowerUp(o.type),o.element.remove(),powerUps.splice(t,1));continue}o.y>GAME_HEIGHT?(o.element.remove(),powerUps.splice(t,1)):(o.element.style.top=`${o.y}px`,o.element.style.left=`${o.x}px`)}}
function activatePowerUp(e){const t=POWER_UP_TYPES[e];if(!t)return;"instant"===t.type?(("one-up"===e&&(lives++,updateLivesDisplay(),spawnDisruptiveBricks(5))),showNotification(t)):(activePowerUps[e]||(activePowerUps[e]=[]),(()=>{if("refreshing"===t.type){const o=Date.now()+t.duration;activePowerUps[e][0]={endTime:o}}else{const r=0<activePowerUps[e].length?activePowerUps[e][activePowerUps[e].length-1].endTime:Date.now(),n=r+t.duration;activePowerUps[e].push({endTime:n})}})(),(()=>{switch(e){case"wide-paddle":paddleSizeLevel=Math.min(activePowerUps[e].length,MAX_PADDLE_LEVEL),updatePaddleWidth(),soundManager.play("grow");break;case"sticky-paddle":isStickyPaddle=!0,paddle.classList.add("paddle-sticky"),soundManager.play("magActivate");break;case"laser-blast":isLaserActive=!0,paddle.classList.add("paddle-armed"),soundManager.play("laserFire",{pitch:1.2});break;case"slow-mo":soundManager.play("bounce",{pitch:.8,volume:.7})}})(),createOrUpdateStatusIndicator(e))}
function updateStatusIndicators(){for(const e in activePowerUps){const t=activePowerUps[e];if(!t||0===t.length){activePowerUps[e]&&(delete activePowerUps[e],document.getElementById(`status-${e}`)?.remove());continue}let o=!1;for(;t.length>0&&Date.now()>=t[0].endTime;)t.shift(),o=!0;if(o){if(soundManager.sounds.grow_reversed)soundManager.play("grow_reversed",{pitch:1.2,volume:.5});else soundManager.play("multihit",{pitch:.7,volume:.5});const r={"wide-paddle":()=>{paddleSizeLevel=t.length,updatePaddleWidth()},"sticky-paddle":()=>{isStickyPaddle=!1,paddle.classList.remove("paddle-sticky"),ballIsStuck&&launchStuckBall()},"laser-blast":()=>{isLaserActive=!1,paddle.classList.remove("paddle-armed")}};r[e]&&r[e]()}if(0===t.length)document.getElementById(`status-${e}`)?.remove(),delete activePowerUps[e];else{const n=document.getElementById(`status-${e}`);if(n){const a=n.querySelector(".stack-count"),l=t.length;1<l?(a.textContent=`x${l}`,a.style.display="inline-block"):(a.style.display="none");const c=t[0],d=POWER_UP_TYPES[e],s=c.endTime-d.duration,i=c.endTime-s,u=c.endTime-Date.now(),p=n.querySelector(".timer-bar"),g=Math.max(0,u/i*100);p.style.width=`${g}%`}}}}
function createOrUpdateStatusIndicator(e){if(document.getElementById(`status-${e}`))return;const t=POWER_UP_TYPES[e],o=document.createElement("div");o.id=`status-${e}`,o.className="status-indicator",o.innerHTML=`<span class="emoji">${t.emoji}</span><span class="stack-count"></span><div class="timer-bar-container"><div class="timer-bar ${t.cssClass}"></div></div>`,statusIndicatorsContainer.appendChild(o)}
function createOnionSkin(){const e=document.createElement("div");e.className="onion-skin",e.textContent=ball.textContent,e.style.left=`${ballX}px`,e.style.top=`${ballY}px`,gameArea.appendChild(e),setTimeout(()=>{e.remove()},500)}
function updateLasers(e){for(let t=lasers.length-1;0<=t;t--){const o=lasers[t];if(o.y-=LASER_SPEED*e,o.y<-o.height){o.element.remove(),lasers.splice(t,1);continue}const r={left:o.x,right:o.x+o.width,top:o.y,bottom:o.y+o.height};for(let n=bricks.length-1;0<=n;n--){const a=bricks[n];if(!a.isBroken){const l={left:a.x,right:a.x+a.width,top:a.y,bottom:a.y+a.height};if(isColliding(r,l)){const c=destroySounds[Math.floor(Math.random()*destroySounds.length)];soundManager.play(c),a.isBroken=!0,a.element.classList.add("broken"),score+=10,scoreDisplay.textContent=`Score: ${score}`,a.powerUpType&&spawnPowerUp(a.powerUpType,a),o.element.remove(),lasers.splice(t,1);break}}}o.element&&(o.element.style.top=`${o.y}px`)}}
function checkCollisions(){if(ballIsStuck)return;const e={left:ballX,right:ballX+BALL_SIZE,top:ballY,bottom:ballY+BALL_SIZE};if(ballX<=0&&ballSpeedX<0||ballX+BALL_SIZE>=GAME_WIDTH&&ballSpeedX>0)ballSpeedX*=-1,soundManager.play("bounce");if(ballY<=0&&ballSpeedY<0){ballY=0,ballSpeedY*=-1,soundManager.play("bounce",{pitch:.8});if(!isRoofBonusActive){isRoofBonusActive=!0,ball.classList.add("bonus-active"),soundManager.play("powerUpSpawn",{pitch:2.5,volume:.5})}}const t=paddleWidth/2,o={left:paddleX-t,right:paddleX+t,top:GAME_HEIGHT-PADDLE_HEIGHT-PADDLE_BOTTOM_OFFSET,bottom:GAME_HEIGHT-PADDLE_BOTTOM_OFFSET};if(isColliding(e,o)&&ballSpeedY>0){soundManager.play("bounce"),isRoofBonusActive&&(isRoofBonusActive=!1,ball.classList.remove("bonus-active"));if(isStickyPaddle)ballIsStuck=!0,ballSpeedX=0,ballSpeedY=0;else{ballY=o.top-BALL_SIZE,ballSpeedY*=-1;const r=(ballX+BALL_SIZE/2-paddleX)/t*INITIAL_BALL_SPEED*1.5;ballSpeedX=r}}for(let n=0;n<bricks.length;n++){const a=bricks[n];if(!a.isBroken){const l={left:a.x,right:a.x+a.width,top:a.y,bottom:a.y+a.height};if(isColliding(e,l)){let c=10;isRoofBonusActive&&(c=15,isRoofBonusActive=!1,ball.classList.remove("bonus-active"),soundManager.play("powerUpSpawn",{pitch:3,volume:.7})),a.hitsTaken++;if(a.hitsTaken>=a.hitsRequired){const d=destroySounds[destroySoundIndex];soundManager.play(d),destroySoundIndex=(destroySoundIndex+1)%destroySounds.length,a.isBroken=!0,a.element.classList.add("broken"),score+=c,a.powerUpType&&spawnPowerUp(a.powerUpType,a)}else soundManager.play("multihit",{pitch:1}),setTimeout(()=>soundManager.play("multihit",{pitch:1.5,volume:.7}),50),a.element.classList.add("damaged");if(scoreDisplay.textContent=`Score: ${score}`,500<score&&!isNeonLegend)isNeonLegend=!0,showNotification({emoji:"😎",name:"NEON LEGEND",description:"Status Achieved!"}),soundManager.play("winSong");a.element.classList.remove("shake"),a.element.offsetWidth,a.element.classList.add("shake"),ball.classList.remove("impact-animation"),ball.offsetWidth,ball.classList.add("impact-animation"),clearTimeout(emojiSwapTimeout);if(isNeonLegend)ball.textContent="😎";else{const s=Math.floor(Math.random()*CHAOTIC_EMOJIS.length);ball.textContent=CHAOTIC_EMOJIS[s],emojiSwapTimeout=setTimeout(()=>{ball.textContent=BALL_EMOJI},250)}ballSpeedY*=-1;const i=1.005;ballSpeedX*=i,ballSpeedY*=i;break}}}}
function renderGame(){ball.style.left=`${ballX}px`,ball.style.top=`${ballY}px`;const e=paddleX-PADDLE_DEFAULT_WIDTH/2;paddle.style.left=`${e}px`}
function endGame(e){gameOver=!0,gameRunning=!1,cancelAnimationFrame(animationFrameId),soundManager.stopAll(),e?soundManager.play("winSong"):soundManager.play("loseSong");const t=getHighScore();let o=!1;score>t&&(saveHighScore(score),o=!0);const r=getHighScore(),n=getRating(score,e),a=e?"Mission Complete!":"System Failure!";gameMessage.innerHTML=`<span class="title">${a}</span><span class="name rating">${n}</span><span class="description">Final Score: ${score}</span><span class="high-score">${o?"New High Score!":""}</span><p class="game-message-prompt">Press SPACE to Restart</p>`,gameMessage.style.display="block",gameArea.classList.remove("hide-cursor")}
function launchStuckBall(){if(ballIsStuck){clearTimeout(autoLaunchTimeout),soundManager.stop("winSong"),ballIsStuck=!1,ballSpeedY=-INITIAL_BALL_SPEED;const e=paddleWidth/2,t=(ballX+BALL_SIZE/2-paddleX)/e*INITIAL_BALL_SPEED*1.5;ballSpeedX=t,soundManager.play("magLaunch")}}
function fireLaser(){if(!canFire||!isLaserActive)return;canFire=!1,soundManager.play("laserFire"),(()=>{const e=6,t=20,o=GAME_HEIGHT-PADDLE_HEIGHT-PADDLE_BOTTOM_OFFSET,r={x:paddleX-e/2,y:o-t,width:e,height:t},n=document.createElement("div");n.className="laser-bolt",n.style.left=`${r.x}px`,n.style.top=`${r.y}px`,gameArea.appendChild(n),r.element=n,lasers.push(r)})(),setTimeout(()=>{canFire=!0},FIRE_COOLDOWN)}
function spawnDisruptiveBricks() {
    const numBricks = 5; // Number of disruptive bricks to spawn
    const positions = [];

    // Determine positions for disruptive bricks
    for (let i = 0; i < numBricks; i++) {
        let left, top;

        // Ensure bricks are not too close to each other
        do {
            left = Math.random() * (GAME_WIDTH - BRICK_WIDTH);
            top = Math.random() * (GAME_HEIGHT / 2 - BRICK_HEIGHT); // Spawn in the upper half of the game area
        } while (positions.some(pos => Math.abs(pos.left - left) < BRICK_WIDTH + BRICK_GAP && Math.abs(pos.top - top) < BRICK_HEIGHT + BRICK_GAP));

        positions.push({ left, top });

        let el = document.createElement('div');
        el.className = 'brick disruptive';
        el.style.width = `${BRICK_WIDTH}px`;
        el.style.height = `${BRICK_HEIGHT}px`;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.textContent = "👼";
        bricksContainer.appendChild(el);

        // Make sure to match the structure of createBricks()
        bricks.push({ left, top, el, destroyed: false, type: "disruptive" });
    }
}

document.addEventListener('DOMContentLoaded',setupGame);
resetButton.addEventListener("click",initGame);
document.addEventListener("keydown",e=>{const t=e.key.toLowerCase();if("arrowleft"===t||"a"===t)leftPressed=!0;else if("arrowright"===t||"d"===t)rightPressed=!0;else if(" "===t){e.preventDefault();if(gameOver){assetsReady&&startGame()}else if(ballIsStuck)launchStuckBall();else{togglePause()}}else if("f"===t)isLaserActive&&gameRunning&&fireLaser()});
document.addEventListener("keyup",e=>{const t=e.key.toLowerCase();"arrowleft"===t||"a"===t?leftPressed=!1:"arrowright"===t||"d"===t&&(rightPressed=!1)});
document.addEventListener("mousemove",e=>{if(gameRunning){const t=gameArea.getBoundingClientRect();let o=e.clientX-t.left,r=paddleWidth/2;o<r?o=r:o>GAME_WIDTH-r&&(o=GAME_WIDTH-r),paddleX=o}});

setupGame();