// js/notifications.js

const VEC_ICONS = {
  expando: `<svg class="notif-vec-svg" viewBox="0 0 24 24"><path d="M3 12h18M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>`,
  slowmo: `<svg class="notif-vec-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="10.5" stroke-dasharray="2.5 2.5"/><path d="M12 7.5V12l3.2 2.2"/></svg>`,
  mag: `<svg class="notif-vec-svg" viewBox="0 0 24 24"><path d="M6.5 6v6.5a5.5 5.5 0 0 0 11 0V6"/><path d="M4.8 6h3.6M15.6 6h3.6"/><path d="M8.5 3.8a5 5 0 0 1 7 0" stroke-dasharray="2 2"/></svg>`,
  brick: `<svg class="notif-vec-svg" viewBox="0 0 24 24"><rect x="3.5" y="12.5" width="7.8" height="5.5" rx="1"/><rect x="12.7" y="12.5" width="7.8" height="5.5" rx="1"/><rect x="8.1" y="5.5" width="7.8" height="5.5" rx="1"/></svg>`,
  laser: `<svg class="notif-vec-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="2"/></svg>`,
  bolt: `<svg class="notif-vec-svg" viewBox="0 0 24 24"><polygon points="13 2 4 14 11 14 10 22 20 10 13 10"/></svg>`,
  shield: `<svg class="notif-vec-svg" viewBox="0 0 24 24"><path d="M12 2l8 4v6c0 5.2-3.4 9.8-8 11-4.6-1.2-8-5.8-8-11V6l8-4z"/></svg>`
};

const NOTIFICATION_MESSAGES = {
  // Expando stacking tiers (wide-paddle)
  'wide-paddle-1': {
    title:       'CHASSIS EXPANSION // TIER I',
    emoji:       VEC_ICONS.expando,
    name:        'EXPANDO ×2',
    description: 'DECK WIDTH +35% • SCORE MULTIPLIER ×2',
    color:       '#00f0ff',
    mode:        'burst'
  },
  'wide-paddle-2': {
    title:       'CHASSIS EXPANSION // TIER II',
    emoji:       VEC_ICONS.expando,
    name:        'EXPANDO ×3',
    description: 'DECK WIDTH +70% • SCORE MULTIPLIER ×3',
    color:       '#10f58c',
    mode:        'burst'
  },
  'wide-paddle-3': {
    title:       'CHASSIS EXPANSION // MAX',
    emoji:       VEC_ICONS.expando,
    name:        'MAX EXPANDO ×4',
    description: 'MAXIMUM DECK SPAN • OVERDRIVE ×4',
    color:       '#ffaa00',
    mode:        'burst'
  },

  // Slow-Mo stacking tiers
  'slow-mo-1': {
    title:       'CHRONO DILATION // TIER I',
    emoji:       VEC_ICONS.slowmo,
    name:        'SLOW-MO ×1.5',
    description: '75% VELOCITY • ×1.5 PRECISION TELEMETRY',
    color:       '#ffaa00',
    mode:        'burst'
  },
  'slow-mo-2': {
    title:       'CHRONO DILATION // TIER II',
    emoji:       VEC_ICONS.slowmo,
    name:        'SLOW-MO ×1.75',
    description: '56% VELOCITY • ×1.75 PRECISION TELEMETRY',
    color:       '#ffaa00',
    mode:        'burst'
  },
  'slow-mo-3': {
    title:       'CHRONO DILATION // MAX',
    emoji:       VEC_ICONS.slowmo,
    name:        'BULLET TIME ×2.0',
    description: '42% VELOCITY • ×2.0 PRECISION TELEMETRY',
    color:       '#ffaa00',
    mode:        'burst'
  },

  // Mag-Lock (sticky-paddle)
  'sticky-paddle': {
    title:       'MAGNETIC CLAMP // ARMED',
    emoji:       VEC_ICONS.mag,
    name:        'MAG-LOCK ×1.5',
    description: 'CATCH & FLICK-SERVE FOR ×1.5 SLINGSHOT',
    color:       '#c084fc',
    mode:        'burst'
  },

  // Laser Blast stacking tiers
  'laser-blast': {
    title:       'ORDNANCE // ONLINE',
    emoji:       VEC_ICONS.laser,
    name:        'TWIN PULSE LASERS',
    description: 'WING TURRETS HOT • ×1.25 LASER PTS',
    color:       '#ff2a55',
    mode:        'burst'
  },
  'laser-blast-1': {
    title:       'ORDNANCE // TIER I',
    emoji:       VEC_ICONS.laser,
    name:        'TWIN PULSE LASERS',
    description: 'WING TURRETS HOT • ×1.25 LASER PTS',
    color:       '#ff2a55',
    mode:        'burst'
  },
  'laser-blast-2': {
    title:       'ORDNANCE // TIER II',
    emoji:       VEC_ICONS.bolt,
    name:        'QUAD GATLING ×1.5',
    description: '4× RAPID PLASMA BOLTS • ×1.5 LASER PTS',
    color:       '#00f0ff',
    mode:        'burst'
  },
  'laser-blast-3': {
    title:       'ORDNANCE // TIER III',
    emoji:       VEC_ICONS.bolt,
    name:        'HYPER-LANCE ×2.0',
    description: '2× ARMOR PENETRATION • ×2.0 LASER PTS',
    color:       '#ffaa00',
    mode:        'burst'
  },

  // Bricked Up! (one-up)
  'one-up': {
    title:       'SECTOR RECONSTRUCTION',
    emoji:       VEC_ICONS.brick,
    name:        'BRICKED UP +BRK',
    description: '+150×LVL BONUS & +8 BASE PTS/BRICK',
    color:       '#10f58c',
    mode:        'burst'
  },

  // Max-power warning
  'max-power': {
    title:       'CAPACITOR LIMIT',
    emoji:       VEC_ICONS.bolt,
    name:        'MAX OVERCHARGE',
    description: 'MODULE STACK LIMIT REACHED',
    color:       '#ffaa00',
    mode:        'burst'
  },

  // Neon Legend status (Jumbotron milestone)
  'neon-legend': {
    title:       '10-STREAK OVERDRIVE UNLOCKED',
    emoji:       '😎',
    name:        'NEON LEGEND ×1.5',
    description: 'ALL BRICK & LASER POINTS ×1.5 WHILE ALIVE',
    color:       '#ffaa00',
    mode:        'jumbotron'
  },

  // Edge Runner (row-clear) cascade bonuses (Jumbotron milestones)
  'row-clear-1': {
    title:       'SECTOR LAYER CLEARED',
    emoji:       VEC_ICONS.bolt,
    name:        'EDGE RUNNER ×2',
    description: 'ALL BRICKS NOW WORTH ×2',
    color:       '#00f0ff',
    mode:        'jumbotron'
  },
  'row-clear-2': {
    title:       'DEEP GRID BREACH',
    emoji:       VEC_ICONS.bolt,
    name:        'EDGE RUNNER ×3',
    description: 'ALL BRICKS NOW WORTH ×3',
    color:       '#ff2a55',
    mode:        'jumbotron'
  },
  'row-clear-3': {
    title:       'BLACKWALL SHATTERED',
    emoji:       VEC_ICONS.bolt,
    name:        'EDGE RUNNER ×4',
    description: 'ULTIMATE ×4 ROW MULTIPLIER',
    color:       '#ffaa00',
    mode:        'jumbotron'
  },

  // --- Hack Mode Jumbotron & Arena Callouts ---
  'hack-cat': {
    title:       'HACK DEPLOYED // NEKO-OS',
    emoji:       '🐱',
    name:        'CAT MODE: 9 LIVES',
    description: '9 LIVES SHIELD • MEOW SYNTH • SCORES END IN 9',
    color:       '#ff2a9d',
    mode:        'jumbotron'
  },
  'hack-poop': {
    title:       'HACK DEPLOYED // HAZARD RAIN',
    emoji:       '💩',
    name:        'POOP STORM',
    description: 'DEFLECT FALLING HAZARDS FOR +5 BONUS PTS',
    color:       '#ffaa00',
    mode:        'jumbotron'
  },
  'hack-party': {
    title:       'HACK DEPLOYED // SPARKLER FIELD',
    emoji:       VEC_ICONS.bolt,
    name:        'VECTOR SHARD OVERDRIVE',
    description: 'HIGH-DENSITY SHARDS ON EVERY COLLISION',
    color:       '#00f0ff',
    mode:        'jumbotron'
  },
  'hack-god': {
    title:       'HACK DEPLOYED // IMMORTAL BUS',
    emoji:       VEC_ICONS.shield,
    name:        'GOD MODE ONLINE',
    description: 'IMMORTAL FLOOR BARRIER • PADDLE SMITE',
    color:       '#ffaa00',
    mode:        'jumbotron'
  },
  'hack-juice': {
    title:       'HACK DEPLOYED // HYPER-CLOCK',
    emoji:       VEC_ICONS.bolt,
    name:        'MAX OVERDRIVE',
    description: '1.65× TURBO VELOCITY • CHAIN SHOCKWAVES',
    color:       '#ff2a55',
    mode:        'jumbotron'
  },
  'god-shield': {
    title:       'IMMORTAL INTERCEPT',
    emoji:       VEC_ICONS.shield,
    name:        'BARRIER DEFLECT',
    description: 'INTERCEPTED BY IMMORTAL FLOOR BUS',
    color:       '#ffaa00',
    mode:        'burst'
  },
  'god-smite': {
    title:       'HIGH-VOLTAGE DISCHARGE',
    emoji:       VEC_ICONS.bolt,
    name:        'ARC SMITE',
    description: 'GRID COLUMN VAPORIZED',
    color:       '#ffaa00',
    mode:        'burst'
  }
};

let lastBurstTime = 0;
let burstStaggerIndex = 0;
let borderResetTimeout = null;

function triggerArenaJuice(color, isHeavy = false) {
  const gameArea = document.getElementById('game-area');
  if (!gameArea) return;

  gameArea.style.setProperty('--arena-flash-color', color);
  gameArea.classList.add('arena-border-flash');
  clearTimeout(borderResetTimeout);
  borderResetTimeout = setTimeout(() => {
    gameArea.classList.remove('arena-border-flash');
  }, isHeavy ? 950 : 520);

  const shakeClass = isHeavy ? 'arena-shake-heavy' : 'arena-shake';
  gameArea.classList.remove('arena-shake', 'arena-shake-heavy');
  void gameArea.offsetWidth;
  gameArea.classList.add(shakeClass);
  setTimeout(() => {
    gameArea.classList.remove(shakeClass);
  }, isHeavy ? 340 : 200);
}

export function showNotification(keyOrObj, options = {}) {
  const content = typeof keyOrObj === 'object' && keyOrObj !== null
    ? {
        title:       keyOrObj.title || 'TELEMETRY',
        emoji:       keyOrObj.emoji || VEC_ICONS.bolt,
        name:        keyOrObj.name || '',
        description: keyOrObj.description || '',
        color:       keyOrObj.color || '#00f0ff',
        mode:        keyOrObj.mode || 'burst'
      }
    : NOTIFICATION_MESSAGES[keyOrObj];

  if (!content) return;

  const container = document.getElementById('notifications-container');
  const gameArea  = document.getElementById('game-area');
  if (!container || !gameArea) return;

  const isJumbotron = content.mode === 'jumbotron';
  triggerArenaJuice(content.color || '#00f0ff', isJumbotron);

  if (isJumbotron) {
    container.querySelectorAll('.notif-jumbotron').forEach(el => el.remove());

    const jumbo = document.createElement('div');
    jumbo.className = 'notif-jumbotron';
    jumbo.style.setProperty('--notif-color', content.color || '#00f0ff');
    jumbo.innerHTML = `
      <span class="jumbo-kicker">[ ${content.title} ]</span>
      <span class="jumbo-main" data-text="${content.name}">${content.name}</span>
      <span class="jumbo-sub">${content.description}</span>
    `;
    container.appendChild(jumbo);
    setTimeout(() => jumbo.remove(), 2200);
    return;
  }

  const now = performance.now();
  if (now - lastBurstTime < 650) {
    burstStaggerIndex = (burstStaggerIndex + 1) % 3;
  } else {
    burstStaggerIndex = 0;
  }
  lastBurstTime = now;

  let spawnX = typeof options.x === 'number' ? options.x : 450;
  const paddle = document.getElementById('paddle');
  if (typeof options.x !== 'number' && paddle) {
    const padLeft = parseFloat(paddle.style.left) || 375;
    const padWidth = paddle.offsetWidth || 150;
    spawnX = padLeft + padWidth / 2;
  }
  spawnX = Math.max(185, Math.min(900 - 185, spawnX));
  const spawnBottom = 68 + burstStaggerIndex * 54;

  const burst = document.createElement('div');
  burst.className = 'notif-burst oled-hud-callout';
  burst.style.left = `${spawnX}px`;
  burst.style.bottom = `${spawnBottom}px`;
  burst.style.setProperty('--notif-color', content.color || '#00f0ff');
  burst.innerHTML = `
    <span class="burst-kicker">${content.title || 'MODULE ONLINE'}</span>
    <div class="burst-headline">
      <span class="burst-emoji">${content.emoji}</span>
      <span class="burst-name">${content.name}</span>
    </div>
    <span class="burst-desc">${content.description}</span>
  `;

  container.appendChild(burst);
  setTimeout(() => burst.remove(), 1450);
}
