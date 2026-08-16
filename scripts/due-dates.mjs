import { MODULE } from './constants.mjs';
import { ReminderManager } from './reminder-manager.mjs';

/** @type {object|undefined} ATLAS registration handle, the only route to the relay. */
let relay;

/**
 * Whether Calendaria is installed and active, guarding access to its global namespace
 * @returns {boolean} True when the CALENDARIA global is safe to read
 */
export function isCalendariaActive() {
  return !!game.modules.get('calendaria')?.active;
}

/**
 * Whether due dates are offered.
 * @returns {boolean} True when Calendaria is active and the world has due dates switched on
 */
export function dueDatesEnabled() {
  return isCalendariaActive() && game.settings.get(MODULE.ID, MODULE.SETTINGS.DUE_DATES);
}

/**
 * Order two in-world due dates, oldest first
 * @param {object} a - Due date {year, month, day}
 * @param {object} b - Due date {year, month, day}
 * @returns {number} Sort comparison
 */
export function compareDueDate(a, b) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Format an in-world due date for display
 * @param {object} [dueDate] - Due date {year, month, day}
 * @returns {string} Formatted date, or an empty string when there is no date
 */
export function formatDueDate(dueDate) {
  if (!dueDate || !isCalendariaActive()) return '';
  return CALENDARIA.api.formatDate(dueDate);
}

/**
 * Find the reminder linked to a calendar note
 * @param {string} noteId - The journal entry page ID
 * @returns {object|null} The linked reminder
 */
function reminderForNote(noteId) {
  return Object.values(ReminderManager.getAllReminders()).find((reminder) => reminder.noteId === noteId) ?? null;
}

/**
 * Create, move, or remove the calendar note backing a reminder. Runs on the active GM only
 * @param {object} request - The note request
 * @param {string} request.action - 'create', 'update' or 'delete'
 * @param {string} [request.reminderId] - Reminder the created note is linked back to
 * @param {string} [request.userId] - User the note's reminder delivery targets
 * @param {string} [request.label] - Reminder text, used as the note name
 * @param {object} [request.dueDate] - In-world due date {year, month, day}
 * @param {string} [request.noteId] - Existing backing note id
 * @returns {Promise<void>}
 */
async function syncNote(request) {
  if (!game.users.activeGM?.isSelf) return;
  if (request.action === 'delete') {
    await CALENDARIA.api.deleteNote(request.noteId);
    return;
  }
  if (request.action === 'update') {
    await CALENDARIA.api.updateNote(request.noteId, { name: request.label, startDate: request.dueDate });
    return;
  }
  const note = await CALENDARIA.api.createNote({
    name: request.label,
    startDate: request.dueDate,
    visibility: 'hidden',
    openSheet: false,
    reminderType: 'toast',
    reminderTargets: 'specific',
    reminderUsers: [request.userId],
    reminderOffset: 0
  });
  if (note) await ReminderManager.updateReminder(request.reminderId, { noteId: note.id });
}

/**
 * Run a backing-note operation on the active GM, so players without note permission still get one
 * @param {object} request - The note request, as accepted by syncNote
 * @returns {void}
 */
export function requestNote(request) {
  if (!dueDatesEnabled()) return;
  if (game.users.activeGM?.isSelf) {
    syncNote(request);
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn('DONTFORGET.Due.NoGM', { localize: true });
    return;
  }
  relay?.broadcast(MODULE.NOTE_SYNC, request);
}

/**
 * Mark the linked reminder due when its backing note delivers
 * @param {object} event - The Calendaria event payload
 * @returns {void}
 */
function onEventTriggered(event) {
  if (!event?.isReminder || !game.users.activeGM?.isSelf) return;
  const reminder = reminderForNote(event.id);
  if (reminder && !reminder.isDue) ReminderManager.updateReminder(reminder.id, { isDue: true });
}

/**
 * Clear the due-date link when the backing note is deleted; the reminder itself survives
 * @param {string} noteId - The deleted journal entry page ID
 * @returns {void}
 */
function onNoteDeleted(noteId) {
  if (!game.users.activeGM?.isSelf) return;
  const reminder = reminderForNote(noteId);
  if (reminder) ReminderManager.updateReminder(reminder.id, { dueDate: null, noteId: null, isDue: false });
}

/**
 * Wire the due-date picker in a create or edit dialog
 * @param {HTMLElement} html - The dialog element
 * @returns {void}
 */
export function wireDueDate(html) {
  const input = html.querySelector('input[name="dueDate"]');
  if (!input) return;
  const pickButton = html.querySelector('.due-date-pick');
  pickButton.addEventListener('click', async () => {
    const picked = await CALENDARIA.api.showDatePicker({ date: input.value ? JSON.parse(input.value) : undefined });
    if (!picked) return;
    input.value = JSON.stringify(picked);
    pickButton.textContent = CALENDARIA.api.formatDate(picked);
  });
  html.querySelector('.due-date-clear').addEventListener('click', () => {
    input.value = '';
    pickButton.textContent = _loc('DONTFORGET.Due.Pick');
  });
}

/**
 * Read the picked due date out of a submitted dialog form
 * @param {HTMLFormElement} form - The dialog form
 * @returns {object|null} Due date {year, month, day} or null
 */
export function readDueDate(form) {
  const value = form.elements.dueDate?.value;
  return value ? JSON.parse(value) : null;
}

/**
 * Wire the GM-side note writer and the Calendaria listeners
 * @param {object} atlas - The module's ATLAS registration handle, used to relay note requests
 * @returns {void}
 */
export function registerDueDates(atlas) {
  relay = atlas;
  if (!isCalendariaActive()) return;
  Hooks.on(MODULE.NOTE_SYNC, syncNote);
  Hooks.on('calendaria.eventTriggered', onEventTriggered);
  Hooks.on('calendaria.noteDeleted', onNoteDeleted);
}
