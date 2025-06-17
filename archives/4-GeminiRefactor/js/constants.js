/**
 * constants.js
 * * This file contains all the static configuration variables for the BRICK RUNNER game.
 * Centralizing these values makes it easy to adjust game balance and behavior
 * without digging through the main game logic.
 */

// --- Game Core Mechanics & Scoring ---
export const POINTS_PER_BRICK = 10;
export const ROOF_BONUS_MULTIPLIER = 1.5;
export const NEON_LEGEND_SCORE_THRESHOLD = 500;
export const AUTO_LAUNCH_DELAY_MS = 3000; // 3-second delay before auto-launch

// --- Brick Layout & Types ---
export const BRICK_ROWS = 8;
export const BRICK_COLUMNS = 10;
export const BRICK_WIDTH = 75;
export const BRICK_HEIGHT = 20;
export const BRICK_GAP = 5;
export const BRICK_OFFSET_TOP = 50;
export const BRICK_OFFSET_LEFT = 30;
export const MULTI_HIT_BRICK_HITS = 2;

// --- Paddle & Ball Properties ---
export const PADDLE_INITIAL_WIDTH = 100;
export const PADDLE_HEIGHT = 20;
export const BALL_DIAMETER = 20;
export const BALL_INITIAL_SPEED = 6; // Representing speed as a single value
export const BALL_MAX_SPEED = 12;

// --- Power-Up Configuration ---
export const POWER_UP_DURATION_MS = 10000; // Default duration (10 seconds) for most power-ups
export const POWER_UP_SPAWN_CHANCE = 0.2; // 20% chance for a brick to drop a power-up

export const POWER_UP_TYPES = {
  EXPANDO: {
    id: 'expando',
    emoji: '🍄',
    color: '#ff6b6b',
    sound: 'grow',
    type: 'stacking' // duration stacks
  },
  SLOW_MO: {
    id: 'slowmo',
    emoji: '🐌',
    color: '#feca57',
    sound: 'slow',
    type: 'stacking' // duration stacks
  },
  MAG_LOCK: {
    id: 'maglock',
    emoji: '🧲',
    color: '#48dbfb',
    sound: 'magnet',
    type: 'refreshing' // duration resets
  },
  LASER_BLAST: {
    id: 'laser',
    emoji: '🎯',
    color: '#1dd1a1',
    sound: 'laser_powerup',
    type: 'refreshing' // duration resets
  }
};

// --- Audio Assets & Configuration ---
// Map of sound names to their file paths and properties
export const soundsToLoad = {
  intro: { url: './assets/sounds/intro.wav', reversable: false },
  bounce: { url: './assets/sounds/bounce.wav', reversable: false },
  brick_hit_1: { url: './assets/sounds/brick_hit_1.wav', reversable: false },
  brick_hit_2: { url: './assets/sounds/brick_hit_2.wav', reversable: false },
  multihit: { url: './assets/sounds/multihit.wav', reversable: true }, // Used for power-up expiration
  thud: { url: './assets/sounds/thud.wav', reversable: false }, // For multi-hit bricks
  power_chord: { url: './assets/sounds/power_chord.wav', reversable: false }, // For breaking multi-hit bricks
  laser_fire: { url: './assets/sounds/laser_fire.wav', reversable: false },
  powerup_spawn: { url: './assets/sounds/powerup_spawn.wav', reversable: false },
  powerup_collect: { url: './assets/sounds/powerup_collect.wav', reversable: false },
  game_over: { url: './assets/sounds/game_over.wav', reversable: false },
  mission_complete: { url: './assets/sounds/mission_complete.wav', reversable: false },
  neon_legend: { url: './assets/sounds/win_song.wav', reversable: false }
};

// A curated list of sounds to play when a normal brick is destroyed
export const DESTROY_SOUNDS = [
  'brick_hit_1',
  'brick_hit_2'
];

// Pitches for the unimplemented "Cat!" multi-ball feature (good to keep for future)
export const CAT_DESTROY_PITCHES = [0.8, 0.9, 1.0, 1.1, 1.2];