import { compareDueDate, formatDueDate } from './due-dates.mjs';

/**
 * Shape a stored reminder into the fields the list template renders
 * @param {object} reminder - The stored record
 * @returns {object} Render-ready row
 */
function toRow(reminder) {
  return {
    ...reminder,
    creatorName: game.users.get(reminder.userId)?.name ?? '',
    createdTime: reminder.createdAt ? foundry.utils.timeSince(reminder.createdAt) : '',
    dueText: formatDueDate(reminder.dueDate),
    isDue: reminder.isDue && !reminder.isDone
  };
}

/**
 * Order rows so the list reads as a schedule.
 * @param {object} a - Row
 * @param {object} b - Row
 * @returns {number} Sort comparison
 */
function byUrgency(a, b) {
  if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
  if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
  if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
  if (a.dueDate && b.dueDate) {
    const byDate = compareDueDate(a.dueDate, b.dueDate);
    if (byDate) return byDate;
  }
  if (game.user.isGM && a.userId !== b.userId) return a.creatorName.localeCompare(b.creatorName);
  if (a.createdAt && b.createdAt) return b.createdAt - a.createdAt;
  return a.id.localeCompare(b.id);
}

/**
 * Turn stored reminders into sorted, render-ready rows
 * @param {Object<string, object>} reminders - Stored records keyed by id
 * @returns {object[]} Sorted rows
 */
export function buildRows(reminders) {
  return Object.values(reminders).map(toRow).sort(byUrgency);
}

/**
 * Build the owner `<select>` options for a GM
 * @param {string} selectedId - The user to preselect
 * @returns {object[]} Option descriptors, or an empty list for players
 */
export function ownerOptions(selectedId) {
  if (!game.user.isGM) return [];
  return game.users.contents.map((user) => ({ id: user.id, name: user.name, selected: user.id === selectedId }));
}
