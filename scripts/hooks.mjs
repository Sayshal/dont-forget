import { ReminderApp } from './apps/reminder-app.mjs';
import { MODULE, reminderApp } from './constants.mjs';
import { ReminderManager } from './reminder-manager.mjs';

/** @type {Map<string, Object<string, object>>} Last-seen reminders per user, used to classify flag changes. */
const lastSeen = new Map();

/**
 * Record the current reminder state for every user without firing hooks
 * @returns {void}
 */
export function seedReminderCache() {
  game.users.forEach((user) => lastSeen.set(user.id, foundry.utils.deepClone(ReminderManager.getUserReminders(user.id))));
}

/**
 * Fire reminder hooks for whatever changed in a user's reminder flags
 * @param {foundry.documents.User} user - The updated user document
 * @param {boolean} remote - Whether another client authored the change
 * @returns {void}
 */
function syncReminders(user, remote) {
  const seeded = lastSeen.has(user.id);
  const previous = lastSeen.get(user.id) ?? {};
  const current = ReminderManager.getUserReminders(user.id);
  lastSeen.set(user.id, foundry.utils.deepClone(current));
  if (!seeded) return;
  for (const reminder of Object.values(current)) {
    const before = previous[reminder.id];
    if (!before) Hooks.callAll(MODULE.HOOKS.REMINDER_CREATED, reminder, { remote });
    else if (reminder.isDone && !before.isDone) Hooks.callAll(MODULE.HOOKS.REMINDER_COMPLETED, reminder, { remote });
  }
  for (const reminder of Object.values(previous)) if (!current[reminder.id]) Hooks.callAll(MODULE.HOOKS.REMINDER_DELETED, reminder, { remote });
}

/**
 * Add the sticky-note button to a player list row, opening that player's reminders
 * @param {HTMLElement} playerRow - The `.player` row
 * @returns {void}
 */
function addReminderButton(playerRow) {
  const userId = playerRow.dataset.userId;
  const playerName = playerRow.querySelector('.player-name');
  if (!playerName || !userId) return;
  const button = document.createElement('i');
  button.className = `${MODULE.ID}-header-button fas fa-sticky-note`;
  button.setAttribute('data-tooltip', 'DONTFORGET.Button.Title');
  button.setAttribute('data-tooltip-direction', 'LEFT');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const app = reminderApp() ?? new ReminderApp();
    app.setViewingUser(userId);
    app.render(true);
  });
  button.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await ReminderApp.promptCreate(userId);
  });
  playerName.insertAdjacentElement('afterend', button);
}

/**
 * Wire the flag listener that drives the hooks and the live refresh, plus the player-list button
 * @returns {void}
 */
export function registerHooks() {
  Hooks.on('updateUser', (user, changes, _options, userId) => {
    if (!changes.flags?.[MODULE.ID]) return;
    syncReminders(user, userId !== game.user.id);
    const app = reminderApp();
    if (app?.rendered && !app.isTyping) app.render();
  });
  Hooks.on('renderPlayers', (_app, html) => {
    if (!game.settings.get(MODULE.ID, MODULE.SETTINGS.INJECT_BUTTON)) return;
    html.querySelectorAll(`.${MODULE.ID}-header-button`).forEach((button) => button.remove());
    const rows = game.user.isGM ? html.querySelectorAll('.player') : html.querySelectorAll('.player.self');
    rows.forEach(addReminderButton);
  });
}
