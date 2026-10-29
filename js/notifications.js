// js/notifications.js

const NOTIFICATION_MESSAGES = {
  // Expando stacking tiers (wide-paddle)
  'wide-paddle-1': {
    title:       'EXPANDO I',
    emoji:       '🪴',
    name:        'EXPANDO ×2!',
    description: 'SCORE MULTIPLIER ×2',
    color:       '#90ff5a',
    mode:        'burst'
  },
  'wide-paddle-2': {
    title:       'EXPANDO II',
    emoji:       '🪴',
    name:        'EXPANDO ×3!',
    description: 'SCORE MULTIPLIER ×3',
    color:       '#ffe63c',
    mode:        'burst'
  },
  'wide-paddle-3': {
    title:       'EXPANDO III',
    emoji:       '🪴',
    name:        'MAX EXPANDO ×4!',
    description: 'OVERDRIVE MULTIPLIER ×4',
    color:       '#ff6b00',
    mode:        'burst'
  },

  // Slow-Mo stacking tiers
  'slow-mo-1': {
    title:       'TIME DILATION',
    emoji:       '🐌',
    name:        'SLOW-MO ×1!',
    description: 'BALL SPEED REDUCED',
    color:       '#00e5ff',
    mode:        'burst'
  },
  'slow-mo-2': {
    title:       'TIME DILATION',
    emoji:       '🐌',
    name:        'SLOW-MO ×2!',
    description: 'DEEP TIME SLOW',
    color:       '#00e5ff',
    mode:        'burst'
  },
  'slow-mo-3': {
    title:       'TIME DILATION',
    emoji:       '🐌',
    name:        'SLOW-MO ×3!',
    description: 'BULLET TIME!',
    color:       '#00e5ff',
    mode:        'burst'
  },

  // Mag-Lock (sticky-paddle)
  'sticky-paddle': {
    title:       'MAGNETIC FIELD',
    emoji:       '🧲',
    name:        'MAG-LOCK!',
    description: 'CATCH & SPACE TO LAUNCH',
    color:       '#ff00ff',
    mode:        'burst'
  },

  // Laser Blast
  'laser-blast': {
    title:       'WEAPONS HOT',
    emoji:       '🎯',
    name:        'TWIN LASERS!',
    description: 'MASH SPACE TO FIRE!',
    color:       '#ff2a55',
    mode:        'burst'
  },

  // Bricked Up! (one-up)
  'one-up': {
    title:       'GRID INJECTION',
    emoji:       '🧱',
    name:        'BRICKED UP!',
    description: '+5 BONUS BRICKS SPAWNED!',
    color:       '#ff9900',
    mode:        'burst'
  },

  // Max-power warning
  'max-power': {
    title:       'OVERCHARGE',
    emoji:       '⚡',
    name:        'MAX POWER!',
    description: 'STACK LIMIT REACHED!',
    color:       '#ffd700',
    mode:        'burst'
  },

  // Neon Legend status (Jumbotron milestone)
  'neon-legend': {
    title:       'STATUS UNLOCKED',
    emoji:       '😎',
    name:        'NEON LEGEND',
    description: '500+ SCORE OVERDRIVE!',
    color:       '#ffd700',
    mode:        'jumbotron'
  },

  // Edge Runner (row-clear) cascade bonuses (Jumbotron milestones)
  'row-clear-1': {
    title:       'LAYER HACKED',
    emoji:       '⚡️',
    name:        'EDGE RUNNER ×2',
    description: 'ALL BRICKS NOW WORTH ×2!',
    color:       '#00ffff',
    mode:        'jumbotron'
  },
  'row-clear-2': {
    title:       'DEEP BREACH',
    emoji:       '⚡️',
    name:        'EDGE RUNNER ×3',
    description: 'ALL BRICKS NOW WORTH ×3!',
    color:       '#ff00ff',
    mode:        'jumbotron'
  },
  'row-clear-3': {
    title:       'BLACKWALL SHATTERED',
    emoji:       '⚡️',
    name:        'EDGE RUNNER ×4',
    description: 'ULTIMATE ×4 ROW MULTIPLIER!',
    color:       '#ffea00',
    mode:        'jumbotron'
  },

  // --- Hack Mode Jumbotron & Arena Callouts ---
  'hack-cat': {
    title:       'HACK DEPLOYED // NEKO-OS',
    emoji:       '🐱',
    name:        'CAT MODE: 9 LIVES',
    description: '🐾 9 LIVES SHIELD • MEOW SFX • SCORES END IN 9!',
    color:       '#ff2a9d',
    mode:        'jumbotron'
  },
  'hack-poop': {
    title:       'HACK DEPLOYED // HAZARD RAIN',
    emoji:       '💩',
    name:        'POOP STORM!',
    description: 'BOUNCE FALLING 💩 FOR +5 BONUS PTS!',
    color:       '#ffaa00',
    mode:        'jumbotron'
  },
  'hack-party': {
    title:       'HACK DEPLOYED // SPARKLER FIELD',
    emoji:       '🎉',
    name:        'CONFETTI BLAST!',
    description: 'CHAOTIC SPARKLER BURSTS ON EVERY SINGLE HIT!',
    color:       '#00ffcc',
    mode:        'jumbotron'
  },
  'hack-god': {
    title:       'HACK DEPLOYED // CELESTIAL',
    emoji:       '🎮',
    name:        'GOD MODE ON',
    description: 'DIVINE HYMN • PADDLE SMITE • IMMORTAL BULLET-TIME!',
    color:       '#ffd700',
    mode:        'jumbotron'
  },
  'hack-juice': {
    title:       'HACK DEPLOYED // HYPER-SPEED',
    emoji:       '⚡',
    name:        'MAX OVERDRIVE!',
    description: '1.65× TURBO BALL • AUTO-GATLING • CHAIN BLASTS!',
    color:       '#ff3355',
    mode:        'jumbotron'
  },
  'god-shield': {
    title:       'IMMORTAL INTERCEPT',
    emoji:       '🛡️',
    name:        'GOD SHIELD!',
    description: 'SAVED BY IMMORTAL BARRIER + DIVINE SMITE!',
    color:       '#ffd700',
    mode:        'burst'
  },
  'god-smite': {
    title:       'WRATH OF THE PADDLE',
    emoji:       '⚡',
    name:        'DIVINE SMITE!',
    description: 'HEAVENLY LIGHTNING VAPORIZED THE GRID!',
    color:       '#ffd700',
    mode:        'burst'
  }
};

let lastBurstTime = 0;
let burstStaggerIndex = 0;
let borderResetTimeout = null;

function triggerArenaJuice(color, isHeavy = false) {
  const gameArea = document.getElementById('game-area');
  if (!gameArea) return;

  // 1) Flash the arena border & inset glow in the power-up's signature color
  gameArea.style.setProperty('--arena-flash-color', color);
  gameArea.classList.add('arena-border-flash');
  clearTimeout(borderResetTimeout);
  borderResetTimeout = setTimeout(() => {
    gameArea.classList.remove('arena-border-flash');
  }, isHeavy ? 950 : 520);

  // 2) Trigger crisp arcade screen shake
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
        title:       keyOrObj.title || 'OVERDRIVE',
        emoji:       keyOrObj.emoji || '⚡',
        name:        keyOrObj.name || '',
        description: keyOrObj.description || '',
        color:       keyOrObj.color || '#00ffff',
        mode:        keyOrObj.mode || 'burst'
      }
    : NOTIFICATION_MESSAGES[keyOrObj];

  if (!content) return;

  const container = document.getElementById('notifications-container');
  const gameArea  = document.getElementById('game-area');
  if (!container || !gameArea) return;

  const isJumbotron = content.mode === 'jumbotron';
  triggerArenaJuice(content.color || '#00ffff', isJumbotron);

  if (isJumbotron) {
    // Remove any existing jumbotron watermark so milestone slams cleanly into the arena floor
    container.querySelectorAll('.notif-jumbotron').forEach(el => el.remove());

    const jumbo = document.createElement('div');
    jumbo.className = 'notif-jumbotron';
    jumbo.style.setProperty('--notif-color', content.color || '#00ffff');
    jumbo.innerHTML = `
      <span class="jumbo-kicker">${content.emoji} ${content.title} ${content.emoji}</span>
      <span class="jumbo-main" data-text="${content.name}">${content.name}</span>
      <span class="jumbo-sub">${content.description}</span>
    `;
    container.appendChild(jumbo);
    setTimeout(() => jumbo.remove(), 2200);
    return;
  }

  // --- Kinetic Arcade Burst (explodes upward from the paddle with zero dark box) ---
  const now = performance.now();
  if (now - lastBurstTime < 650) {
    burstStaggerIndex = (burstStaggerIndex + 1) % 3;
  } else {
    burstStaggerIndex = 0;
  }
  lastBurstTime = now;

  // Determine horizontal spawn position from options.x or current paddle center
  let spawnX = typeof options.x === 'number' ? options.x : 450;
  const paddle = document.getElementById('paddle');
  if (typeof options.x !== 'number' && paddle) {
    const padLeft = parseFloat(paddle.style.left) || 375;
    const padWidth = paddle.offsetWidth || 150;
    spawnX = padLeft + padWidth / 2;
  }
  // Clamp horizontally so the burst text never clips outside the 900px playfield
  spawnX = Math.max(185, Math.min(900 - 185, spawnX));
  const spawnBottom = 64 + burstStaggerIndex * 54;
  const tiltDeg = ((Math.random() - 0.5) * 11).toFixed(1);

  const burst = document.createElement('div');
  burst.className = 'notif-burst';
  burst.style.left = `${spawnX}px`;
  burst.style.bottom = `${spawnBottom}px`;
  burst.style.setProperty('--notif-color', content.color || '#00ff00');
  burst.style.setProperty('--burst-tilt', `${tiltDeg}deg`);
  burst.innerHTML = `
    <div class="burst-headline">
      <span class="burst-emoji">${content.emoji}</span>
      <span class="burst-name">${content.name}</span>
    </div>
    <span class="burst-desc">${content.description}</span>
  `;

  container.appendChild(burst);
  setTimeout(() => burst.remove(), 1450);
}
