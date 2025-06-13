// --- Game Constants and DOM Element References ---
const GAME_WIDTH = 900;
const GAME_HEIGHT = 600;
const PADDLE_WIDTH = 150;
const PADDLE_HEIGHT = 20;
const BALL_SIZE = 60;
const BRICK_ROWS = 5;
const BRICK_COLS = 10;
const BRICK_GAP = 2;
const BRICK_WIDTH = (GAME_WIDTH / BRICK_COLS) - BRICK_GAP;
const BRICK_HEIGHT = 32;
const PADDLE_BOTTOM_OFFSET = 20;
const POWER_UP_CHANCE = 0.2;
const POWER_UP_SIZE = 30;

const INITIAL_BALL_SPEED = 350;
const PADDLE_SPEED = 600;
const POWER_UP_SPEED = 180;
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
const titleElement = document.getElementById('game-title');

// --- Game State Variables ---
let score = 0;
let highScore = parseInt(localStorage.getItem('highScore')) || 0;
let lives = 3;
let isGameRunning = false;
let ballVelocity = { x: 0, y: 0 };
let paddleVelocity = 0;
let bricks = [];
let powerUps = [];
let assetsReady = false;
let emojiCycleInterval = null;
let lastTimestamp = null;

// --- Utility Functions ---
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function animateTitle(titleElement, text, delay = 100) {
    titleElement.textContent = "";
    let i = 0;
    function nextLetter() {
        if (i < text.length) {
            titleElement.textContent += text[i];
            i++;
            setTimeout(nextLetter, delay);
        }
    }
    nextLetter();
}

// --- Game Initialization ---
function initGame() {
    score = 0;
    lives = 3;
    isGameRunning = false;
    ballVelocity = { x: 0, y: 0 };
    paddleVelocity = 0;
    bricks = [];
    powerUps = [];
    updateScore();
    updateLives();
    updateHighScore();
    resetPaddle();
    resetBall();
    createBricks();
    clearPowerUps();
    hideGameMessage();
    showStartScreen();
    gameArea.classList.add('hidden');
}

// --- Show/Hide Game Area and Start Screen ---
function showStartScreen() {
    startScreen.style.display = 'flex';
    gameArea.classList.add('hidden');
}
function hideStartScreen() {
    startScreen.style.display = 'none';
    gameArea.classList.remove('hidden');
}

// --- Setup Game Flow ---
function setupGame() {
    updateHighScore();
    startScreen.style.display = 'none';
    clickToStartOverlay.style.display = 'flex';

    const allEmojis = ["😀", "🚀", "🌟", "🍕", "🎉"];
    let emojiIndex = 0;
    if (loadingEmoji) {
        loadingEmoji.style.display = 'block';
        loadingEmoji.textContent = allEmojis[0];
    }
    emojiCycleInterval = setInterval(() => {
        if (loadingEmoji) {
            loadingEmoji.textContent = allEmojis[emojiIndex];
            emojiIndex = (emojiIndex + 1) % allEmojis.length;
        }
    }, 200);

    clickToStartOverlay.onclick = () => {
        clearInterval(emojiCycleInterval);
        if (loadingEmoji) loadingEmoji.style.display = 'none';
        clickToStartOverlay.style.opacity = '0';
        setTimeout(() => {
            clickToStartOverlay.style.display = 'none';
        }, 500);

        if (titleElement) {
            animateTitle(titleElement, "BRICK RUNNER", 80);
        }
        startScreen.style.display = 'flex';
        startPrompt.textContent = "Loading...";
        startPrompt.classList.add('loading');

        setTimeout(() => {
            assetsReady = true;
            startPrompt.textContent = "Press SPACE to Begin";
            startPrompt.classList.remove('loading');
        }, 1000);
    };

    initGame();
}

// --- Paddle Logic ---
function resetPaddle() {
    paddle.style.width = `${PADDLE_WIDTH}px`;
    paddle.style.left = `${(GAME_WIDTH - PADDLE_WIDTH) / 2}px`;
    paddle.style.bottom = `${PADDLE_BOTTOM_OFFSET}px`;
}
function movePaddle(dt) {
    let left = parseFloat(paddle.style.left);
    left += paddleVelocity * dt;
    left = clamp(left, 0, GAME_WIDTH - parseFloat(paddle.style.width));
    paddle.style.left = `${left}px`;
}

// --- Ball Logic ---
function resetBall() {
    ball.style.width = `${BALL_SIZE}px`;
    ball.style.height = `${BALL_SIZE}px`;
    ball.style.left = `${(GAME_WIDTH - BALL_SIZE) / 2}px`;
    ball.style.top = `${GAME_HEIGHT - PADDLE_BOTTOM_OFFSET - PADDLE_HEIGHT - BALL_SIZE}px`;
    ballVelocity = { x: 0, y: 0 };
}
function launchBall() {
    let angle = (Math.random() * Math.PI) / 2 + Math.PI / 4;
    ballVelocity.x = INITIAL_BALL_SPEED * Math.cos(angle);
    ballVelocity.y = -INITIAL_BALL_SPEED * Math.sin(angle);
}
function moveBall(dt) {
    let left = parseFloat(ball.style.left);
    let top = parseFloat(ball.style.top);
    left += ballVelocity.x * dt;
    top += ballVelocity.y * dt;

    if (left <= 0) {
        left = 0;
        ballVelocity.x *= -1;
    }
    if (left + BALL_SIZE >= GAME_WIDTH) {
        left = GAME_WIDTH - BALL_SIZE;
        ballVelocity.x *= -1;
    }
    if (top <= 0) {
        top = 0;
        ballVelocity.y *= -1;
    }
    if (top + BALL_SIZE >= GAME_HEIGHT) {
        loseLife();
        return;
    }

    if (checkBallPaddleCollision(left, top)) {
        ballVelocity.y *= -1;
        let paddleLeft = parseFloat(paddle.style.left);
        let hitPos = (left + BALL_SIZE / 2 - paddleLeft) / parseFloat(paddle.style.width) - 0.5;
        ballVelocity.x = INITIAL_BALL_SPEED * hitPos * 2;
        top = GAME_HEIGHT - PADDLE_BOTTOM_OFFSET - PADDLE_HEIGHT - BALL_SIZE;
    }

    checkBallBrickCollision(left, top);

    ball.style.left = `${left}px`;
    ball.style.top = `${top}px`;
}
function checkBallPaddleCollision(ballLeft, ballTop) {
    let paddleLeft = parseFloat(paddle.style.left);
    let paddleTop = GAME_HEIGHT - PADDLE_BOTTOM_OFFSET - PADDLE_HEIGHT;
    return (
        ballTop + BALL_SIZE >= paddleTop &&
        ballTop + BALL_SIZE <= paddleTop + PADDLE_HEIGHT &&
        ballLeft + BALL_SIZE >= paddleLeft &&
        ballLeft <= paddleLeft + parseFloat(paddle.style.width)
    );
}
function checkBallBrickCollision(ballLeft, ballTop) {
    for (let i = 0; i < bricks.length; i++) {
        let brick = bricks[i];
        if (!brick.destroyed) {
            if (
                ballLeft + BALL_SIZE > brick.left &&
                ballLeft < brick.left + BRICK_WIDTH &&
                ballTop + BALL_SIZE > brick.top &&
                ballTop < brick.top + BRICK_HEIGHT
            ) {
                brick.destroyed = true;
                bricksContainer.removeChild(brick.el);
                ballVelocity.y *= -1;
                score += 10;
                updateScore();
                maybeSpawnPowerUp(brick.left, brick.top);
                if (bricks.every(b => b.destroyed)) {
                    winGame();
                }
                break;
            }
        }
    }
}

// --- Brick Logic ---
function createBricks() {
    bricksContainer.innerHTML = '';
    bricks = [];
    const emojis = ["😀", "🚀", "🌟", "🍕", "🎉"];
    for (let row = 0; row < BRICK_ROWS; row++) {
        for (let col = 0; col < BRICK_COLS; col++) {
            let left = col * (BRICK_WIDTH + BRICK_GAP);
            let top = row * (BRICK_HEIGHT + BRICK_GAP);
            let el = document.createElement('div');
            el.className = 'brick';
            el.style.width = `${BRICK_WIDTH}px`;
            el.style.height = `${BRICK_HEIGHT}px`;
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            el.textContent = emojis[randomInt(0, emojis.length - 1)];
            bricksContainer.appendChild(el);
            bricks.push({ left, top, el, destroyed: false });
        }
    }
}

// --- Power-Up Logic ---
function maybeSpawnPowerUp(x, y) {
    if (Math.random() < POWER_UP_CHANCE) {
        const types = ["🛡️", "🧲", "🐢"];
        const type = types[randomInt(0, types.length - 1)];
        spawnPowerUp(x + BRICK_WIDTH / 2, y, type);
    }
}
function spawnPowerUp(x, y, type) {
    let el = document.createElement('div');
    el.className = 'power-up';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.textContent = type;
    bricksContainer.appendChild(el);
    powerUps.push({ x, y, el, type, active: true });
}
function movePowerUps(dt) {
    for (let powerUp of powerUps) {
        if (powerUp.active) {
            powerUp.y += POWER_UP_SPEED * dt;
            powerUp.el.style.top = `${powerUp.y}px`;
            let paddleLeft = parseFloat(paddle.style.left);
            let paddleTop = GAME_HEIGHT - PADDLE_BOTTOM_OFFSET - PADDLE_HEIGHT;
            if (
                powerUp.y + POWER_UP_SIZE > paddleTop &&
                powerUp.x > paddleLeft &&
                powerUp.x < paddleLeft + parseFloat(paddle.style.width)
            ) {
                applyPowerUp(powerUp.type);
                powerUp.active = false;
                bricksContainer.removeChild(powerUp.el);
            }
            if (powerUp.y > GAME_HEIGHT) {
                powerUp.active = false;
                bricksContainer.removeChild(powerUp.el);
            }
        }
    }
}
function clearPowerUps() {
    for (let powerUp of powerUps) {
        if (powerUp.el && powerUp.el.parentNode) {
            powerUp.el.parentNode.removeChild(powerUp.el);
        }
    }
    powerUps = [];
}
function applyPowerUp(type) {
    if (type === "🛡️") {
        lives++;
        updateLives();
        showNotification("Extra Life!");
    } else if (type === "🧲") {
        showNotification("Sticky Paddle! (not implemented)");
    } else if (type === "🐢") {
        ballVelocity.x *= 0.7;
        ballVelocity.y *= 0.7;
        showNotification("Slow Ball!");
    }
}

// --- Score, Lives, and UI ---
function updateScore() {
    scoreDisplay.textContent = score;
}
function updateLives() {
    livesDisplay.textContent = lives;
}
function updateHighScore() {
    highScoreDisplay.textContent = highScore;
}
function showNotification(msg) {
    let el = document.createElement('div');
    el.className = 'notification';
    el.textContent = msg;
    notificationsContainer.appendChild(el);
    setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, 2000);
    while (notificationsContainer.children.length > MAX_NOTIFICATIONS) {
        notificationsContainer.removeChild(notificationsContainer.firstChild);
    }
}

// --- Game State Management ---
function loseLife() {
    lives--;
    updateLives();
    if (lives <= 0) {
        gameOver();
    } else {
        resetBall();
    }
}
function winGame() {
    isGameRunning = false;
    showGameMessage("YOU WIN!");
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('highScore', highScore);
        updateHighScore();
    }
}
function gameOver() {
    isGameRunning = false;
    showGameMessage("GAME OVER");
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('highScore', highScore);
        updateHighScore();
    }
}
function showGameMessage(msg) {
    gameMessage.textContent = msg;
    gameMessage.style.display = 'block';
}
function hideGameMessage() {
    gameMessage.style.display = 'none';
}

// --- Main Game Loop ---
function gameLoop(timestamp) {
    if (!isGameRunning) return;
    if (!lastTimestamp) lastTimestamp = timestamp;
    let dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    movePaddle(dt);
    moveBall(dt);
    movePowerUps(dt);

    requestAnimationFrame(gameLoop);
}

// --- Event Listeners ---
document.addEventListener('keydown', (e) => {
    if (e.key === "ArrowLeft") {
        paddleVelocity = -PADDLE_SPEED;
    }
    if (e.key === "ArrowRight") {
        paddleVelocity = PADDLE_SPEED;
    }
    if (e.key === " " && !isGameRunning && assetsReady) {
        hideStartScreen();
        isGameRunning = true;
        launchBall();
        lastTimestamp = null;
        requestAnimationFrame(gameLoop);
    }
});
document.addEventListener('keyup', (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        paddleVelocity = 0;
    }
});
resetButton.addEventListener('click', () => {
    initGame();
});

// --- On Load ---
window.onload = () => {
    setupGame();
};