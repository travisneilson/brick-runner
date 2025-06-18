// js/notifications.js

// Limit how many notifications stack before the oldest get removed
const MAX_NOTIFICATIONS = 3;

export function showNotification(content, ttl = 3500) {
  const container = document.getElementById('notifications-container');

  // 1) Restack existing notifications
  const existing = container.querySelectorAll('.notification');
  existing.forEach((el, idx) => {
    el.className = `notification visible stack-${idx+1}`;
    if (idx + 1 >= MAX_NOTIFICATIONS) {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 500);
    }
  });

  // 2) Create and populate the new notification
  const t = document.createElement('div');
  t.classList.add('notification');
  if (typeof content === 'string') {
    t.innerHTML = `<span class="name">${content}</span>`;
  } else {
    t.innerHTML = `
      <span class="title">Power Up!</span>
      <span class="name">${content.emoji} ${content.name}!</span>
      <span class="description">${content.description}</span>
    `;
  }

  // 3) Append and animate in/out
  container.appendChild(t);
  setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => {
    t.classList.add('removing');
    setTimeout(() => t.remove(), 500);
  }, ttl);
}
