/**
 * main.js
 *
 * The core controller for the BRICK RUNNER game. This file is responsible for:
 * - Initializing the game and DOM elements.
 * - Managing the game state (score, lives, game over).
 * - Running the main game loop (requestAnimationFrame).
 * - Handling player input and game events.
 * - Coordinating updates between different game modules (once they are created).
 */

// Import all game settings from our constants module
import * as C from './constants.js';

// --- PLACEHOLDER for future module imports ---
// import soundManager from './soundManager.js';
// import { update as updateUI, showNotification } from './ui.js';
// import { createPowerUp, updateActivePowerUps } from './powerups.js';

// --- DOM Element References ---
const gameArea = document.getElementById('game-area');
const scoreDisplay = document.getElementById('score-display');
const highScoreDisplay = document.getElementById('high-score-display');
const bricksContainer = document.getElementById('bricks-container');
const paddleElement = document.getElementById('paddle');
const ballElement = document.getElementById('ball');
const startScreen = document.getElementById('start-screen');
const endScreen = document.getElementById('end-screen');
const endScreenTitle = document.getElementById('end-screen-title');
const finalScoreDisplay = document.getElementById('final-score');

// --- Game State Variables ---
let score = 0;
let highScore = 0;
let bricks = [];
let activePowerUps = new Map(); // Using a Map to track power-ups and their timers

let gameOver = false;
let gameRunning = false;
let ballIsStuck = true;
let isRoofBonusActive = false;
let isNeonLegend = false;
let lastTime = 0;

// Game object states
const paddle = {
  x: (gameArea.clientWidth - C.PADDLE_INITIAL_WIDTH) / 2,
  y: gameArea.clientHeight - C.PADDLE_HEIGHT - 20,
  width: C.PADDLE_INITIAL_WIDTH,
  height: C.PADDLE_HEIGHT,
  element: paddleElement
};

const ball = {
  x: paddle.x + paddle.width / 2 - C.BALL_DIAMETER / 2,
  y: paddle.y - C.BALL_DIAMETER,
  dx: 0, // direction x
  dy: 0, // direction y
  speed: C.BALL_INITIAL_SPEED,
  diameter: C.BALL_DIAMETER,
  element: ballElement
};


// --- Core Game Functions ---

/**
 * The main game loop, powered by requestAnimationFrame for smooth animation.
 * @param {number} timestamp The current time provided by the browser.
 */
function gameLoop(timestamp) {
  if (gameOver) return;

  const deltaTime = (timestamp - lastTime) / 1000; // Time in seconds
  lastTime = timestamp;

  if (gameRunning) {
    update(deltaTime);
    render();
  }

  requestAnimationFrame(gameLoop);
}

/**
 * Updates the state of all game objects.
 * @param {number} deltaTime The time elapsed since the last frame.
 */
function update(deltaTime) {
  if (ballIsStuck) return;

  // Move ball
  ball.x += ball.dx * ball.speed * deltaTime;
  ball.y += ball.dy * ball.speed * deltaTime;

  checkCollisions();
  // updateActivePowerUps(deltaTime); // This will be moved to a powerups.js module
}

/**
 * Renders all game objects to the screen by updating their CSS.
 */
function render() {
  paddle.element.style.width = `${paddle.width}px`;
  paddle.element.style.transform = `translateX(${paddle.x}px)`;
  ball.element.style.transform = `translate(${ball.x}px, ${ball.y}px)`;
}

/**
 * Checks for and handles all collisions in the game.
 */
function checkCollisions() {
  // Ball vs. Walls
  if (ball.x <= 0 || ball.x + C.BALL_DIAMETER >= gameArea.clientWidth) {
    ball.dx *= -1;
    // soundManager.play('bounce');
  }
  if (ball.y <= 0) { // Hit the roof
    ball.dy *= -1;
    isRoofBonusActive = true;
    ball.element.classList.add('bonus-active');
    // soundManager.play('bounce', { pitch: 1.2 });
  }

  // Ball vs. Out of Bounds (Game Over)
  if (ball.y + C.BALL_DIAMETER >= gameArea.clientHeight) {
    handleGameOver("System Failure!");
  }

  // Ball vs. Paddle
  const paddleRect = paddle.element.getBoundingClientRect();
  const ballRect = ball.element.getBoundingClientRect();

  if (
    ballRect.left < paddleRect.right &&
    ballRect.right > paddleRect.left &&
    ballRect.top < paddleRect.bottom &&
    ballRect.bottom > paddleRect.top
  ) {
    if (ball.dy > 0) { // Only collide if the ball is moving downwards
      ball.dy *= -1;
      
      // Change horizontal angle based on where it hit the paddle
      let collidePoint = ball.x - (paddle.x + paddle.width / 2);
      ball.dx = (collidePoint / (paddle.width / 2)) * 50; // Adjust multiplier for sensitivity
      
      // Deactivate roof bonus on paddle hit
      isRoofBonusActive = false;
      ball.element.classList.remove('bonus-active');
      // soundManager.play('bounce');
    }
  }

  // Ball vs. Bricks
  for (let i = bricks.length - 1; i >= 0; i--) {
    const brick = bricks[i];
    const brickRect = brick.element.getBoundingClientRect();

    if (
      ballRect.left < brickRect.right &&
      ballRect.right > brickRect.left &&
      ballRect.top < brickRect.bottom &&
      ballRect.bottom > brickRect.top
    ) {
      handleBrickCollision(brick, i);
      break; // Exit loop after handling one collision to prevent multi-hits
    }
  }
}

/**
 * Handles the logic when the ball collides with a brick.
 * @param {object} brick The brick object that was hit.
 * @param {number} index The index of the brick in the bricks array.
 */
function handleBrickCollision(brick, index) {
  // soundManager.play('thud');
  ball.dy *= -1; // Simple vertical bounce

  brick.hitsLeft--;

  if (brick.hitsLeft <= 0) {
    let pointsEarned = C.POINTS_PER_BRICK;
    if (isRoofBonusActive) {
      pointsEarned *= C.ROOF_BONUS_MULTIPLIER;
      isRoofBonusActive = false; // Use the bonus once
      ball.element.classList.remove('bonus-active');
    }
    updateScore(pointsEarned);

    // Remove brick from array and DOM
    bricksContainer.removeChild(brick.element);
    bricks.splice(index, 1);
    // soundManager.play('power_chord');

    // Check for victory
    if (bricks.length === 0) {
      handleVictory();
    }
  } else {
    // Update visual for multi-hit brick
    brick.element.style.setProperty('--notch-display', 'none');
  }
}


// --- Game Flow & State Management ---

/**
 * Resets the game to its initial state for a new round.
 */
function resetGame() {
  score = 0;
  updateScore(0);
  gameOver = false;
  isNeonLegend = false;
  gameRunning = false;
  ballIsStuck = true;
  isRoofBonusActive = false;

  // Clear any active power-ups
  activePowerUps.clear();

  // Reset ball and paddle positions
  paddle.width = C.PADDLE_INITIAL_WIDTH;
  paddle.x = (gameArea.clientWidth - paddle.width) / 2;
  ball.x = paddle.x + paddle.width / 2 - C.BALL_DIAMETER / 2;
  ball.y = paddle.y - C.BALL_DIAMETER;
  ball.speed = C.BALL_INITIAL_SPEED;
  ball.element.className = 'ball'; // Reset visual state

  // Rebuild the brick layout
  bricksContainer.innerHTML = '';
  bricks = [];
  createBricksLayout();
}

/**
 * Creates the grid of bricks based on constants.
 */
function createBricksLayout() {
  for (let row = 0; row < C.BRICK_ROWS; row++) {
    for (let col = 0; col < C.BRICK_COLUMNS; col++) {
      const isMultiHit = Math.random() < 0.2; // 20% chance for a multi-hit brick
      const brickElement = document.createElement('div');
      brickElement.classList.add('brick');
      if (isMultiHit) {
        brickElement.classList.add('multi-hit');
      }

      const brickObject = {
        element: brickElement,
        x: C.BRICK_OFFSET_LEFT + col * (C.BRICK_WIDTH + C.BRICK_GAP),
        y: C.BRICK_OFFSET_TOP + row * (C.BRICK_HEIGHT + C.BRICK_GAP),
        hitsLeft: isMultiHit ? C.MULTI_HIT_BRICK_HITS : 1
      };

      brickElement.style.left = `${brickObject.x}px`;
      brickElement.style.top = `${brickObject.y}px`;

      bricks.push(brickObject);
      bricksContainer.appendChild(brickElement);
    }
  }
}

/**
 * Starts the actual gameplay.
 */
function startGame() {
  if (gameRunning) return;

  resetGame();
  startScreen.style.display = 'none';
  endScreen.style.display = 'none';
  gameRunning = true;
  // soundManager.play('intro');

  setTimeout(launchStuckBall, C.AUTO_LAUNCH_DELAY_MS);
}

function launchStuckBall() {
  if (!ballIsStuck) return;
  ballIsStuck = false;
  ball.dx = (Math.random() - 0.5) * 50; // Random initial angle
  ball.dy = -100; // Straight up
}

function handleGameOver(message) {
  gameOver = true;
  gameRunning = false;
  // soundManager.play('game_over');

  if (score > highScore) {
    highScore = score;
    localStorage.setItem('brickRunnerHighScore', highScore);
    highScoreDisplay.textContent = `High Score: ${highScore}`;
  }

  endScreenTitle.textContent = message;
  finalScoreDisplay.textContent = `Final Score: ${score}`;
  endScreen.style.display = 'flex';
}

function handleVictory() {
    handleGameOver("Mission Complete!");
    // soundManager.play('mission_complete');
}

/**
 * Updates the player's score and checks for Neon Legend status.
 * @param {number} points The points to add to the score.
 */
function updateScore(points) {
  if (points === 0) {
    score = 0;
  } else {
    score += Math.round(points);
  }
  scoreDisplay.textContent = `Score: ${score}`;

  if (!isNeonLegend && score > C.NEON_LEGEND_SCORE_THRESHOLD) {
    isNeonLegend = true;
    ball.element.innerHTML = '😎'; // As per PRD
    // soundManager.play('neon_legend');
    // showNotification('NEON LEGEND!');
  }
}

// --- Event Handlers ---
function setupEventListeners() {
  document.addEventListener('mousemove', e => {
    let newPaddleX = e.clientX - gameArea.getBoundingClientRect().left - paddle.width / 2;
    // Constrain paddle to game area
    paddle.x = Math.max(0, Math.min(newPaddleX, gameArea.clientWidth - paddle.width));
  });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space') {
      handlePlayerAction();
    }
  });

  document.addEventListener('click', handlePlayerAction);
}

function handlePlayerAction() {
  if (!gameRunning && !gameOver) {
    startGame();
  } else if (ballIsStuck) {
    launchStuckBall();
  }
  // Add pause/laser logic here later
}


// --- Initializer ---
function initializeGame() {
  highScore = localStorage.getItem('brickRunnerHighScore') || 0;
  highScoreDisplay.textContent = `High Score: ${highScore}`;
  setupEventListeners();
  requestAnimationFrame(gameLoop);
}

// Let's get the game started!
initializeGame();