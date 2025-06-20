// js/notifications.js

// Limit how many notifications stack before the oldest get removed
const MAX_NOTIFICATIONS = 3;

const NOTIFICATION_MESSAGES = {
  // Expando stacking tiers (wide-paddle)
  'wide-paddle-1': {
    title:       'Expando I',
    emoji:       '🪴',
    name:        'EXPANDO I',
    description: 'Score ×2!'
  },
  'wide-paddle-2': {
    title:       'Expando II',
    emoji:       '🪴',
    name:        'EXPANDO II',
    description: 'Score ×3!'
  },
  'wide-paddle-3': {
    title:       'Expando III',
    emoji:       '🪴',
    name:        'EXPANDO III',
    description: 'Score ×4!'
  },

  // Slow-Mo stacking tiers
  'slow-mo-1': {
    title:       'Slow-Mo 1',
    emoji:       '🐌',
    name:        'SLOW-MO 1',
    description: 'Ball speed reduced ×1'
  },
  'slow-mo-2': {
    title:       'Slow-Mo 2',
    emoji:       '🐌',
    name:        'SLOW-MO 2',
    description: 'Ball speed reduced ×2'
  },
  'slow-mo-3': {
    title:       'Slow-Mo 3',
    emoji:       '🐌',
    name:        'SLOW-MO 3',
    description: 'Ball speed reduced ×3'
  },

  // Mag-Lock (sticky-paddle)
  'sticky-paddle': {
    title:       'Mag-Lock',
    emoji:       '🧲',
    name:        'MAG-LOCK',
    description: 'Catch & launch the ball'
  },

  // Laser Blast
  'laser-blast': {
    title:       'Laser Blast',
    emoji:       '🎯',
    name:        'LASER BLAST',
    description: 'Press F to fire!'
  },

  // Bricked Up! (one-up)
  'one-up': {
    title:       'Bricked Up!',
    emoji:       '🧱',
    name:        'Bricked Up!',
    description: 'New bricks incoming!'
  },

  // Neon Legend status
  'neon-legend': {
    title:       'Neon Legend',
    emoji:       '😎',
    name:        'NEON LEGEND',
    description: 'Over 500 Score Achieved!'
  },

  // Max-power warning
  'max-power': {
    title:       'Max Power',
    emoji:       '⚠️',
    name:        'MAX POWER!',
    description: 'Power capped'
  },

  // Edge Runner (row-clear) cascade bonuses
  'row-clear-1': {
    title:       'Edge Runner',
    emoji:       '⚡️',
    name:        'Edge 1',
    description: 'Layer hack bonus applied — Score ×2!'
  },
  'row-clear-2': {
    title:       'Edge Runner',
    emoji:       '⚡️',
    name:        'Edge 2',
    description: 'Deeper layer hack — Score ×3!'
  },
  'row-clear-3': {
    title:       'Edge Runner',
    emoji:       '⚡️',
    name:        'Edge 3',
    description: 'Ultimate layer hack — Score ×4!'
  }
};

export function showNotification(key, ttl = 3500) {

  const content = NOTIFICATION_MESSAGES[key];
  if (!content) {
    return;
  }

  const container = document.getElementById('notifications-container');
  if (!container) return;

  // Shift existing notifications down
  const existing = container.querySelectorAll('.notification');
  existing.forEach((el, idx) => {
    el.className = `notification visible stack-${idx+1}`;
    if (idx+1 >= 3) {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 500);
    }
  });

  // Build the new notification
  const notif = document.createElement('div');
  notif.classList.add('notification');
  notif.innerHTML = `
    <span class="title">${content.title}</span>
    <span class="name">${content.emoji} ${content.name}</span>
    <span class="description">${content.description}</span>
  `;

  container.appendChild(notif);
  setTimeout(() => notif.classList.add('visible'), 10);
  setTimeout(() => {
    notif.classList.add('removing');
    setTimeout(() => notif.remove(), 500);
  }, ttl);
}
