import { MODULE } from './constants.mjs';

/**
 * @typedef {object} Reminder
 * @property {string} id - Unique identifier
 * @property {string} label - Reminder text
 * @property {boolean} isDone - Completion status
 * @property {string} userId - User the reminder belongs to
 * @property {number} [createdAt] - Creation timestamp
 * @property {string} [source] - Module id that produced the reminder
 * @property {string|null} [ref] - The producer's own key for whatever the reminder is about
 * @property {object|null} [dueDate] - In-world due date {year, month (1-indexed), day (1-indexed)}
 * @property {string|null} [noteId] - Journal entry page id of the backing Calendaria note
 * @property {boolean} [isDue] - Whether the backing note has delivered
 */

/**
 * Reads and writes reminder records, which persist as flags on the user they belong to.
 */
export class ReminderManager {
  /**
   * Get reminders for a user, or every reminder in the world when that user is a GM
   * @param {string} userId - The user ID to get reminders for
   * @returns {Object<string, Reminder>} Dictionary of reminders
   */
  static getReminders(userId) {
    const user = game.users.get(userId);
    if (!user) {
      ATLAS.log(1, `User with ID ${userId} not found`);
      return {};
    }
    return user.isGM ? this.getAllReminders() : this.getUserReminders(userId);
  }

  /**
   * Get every reminder across all users
   * @returns {Object<string, Reminder>} Dictionary of all reminders
   */
  static getAllReminders() {
    const all = {};
    game.users.forEach((user) => Object.assign(all, this.getUserReminders(user.id)));
    return all;
  }

  /**
   * Get the reminders belonging to one user
   * @param {string} userId - The user ID
   * @returns {Object<string, Reminder>} Dictionary of that user's reminders
   */
  static getUserReminders(userId) {
    return game.users.get(userId)?.getFlag(MODULE.ID, MODULE.FLAGS.REMINDERS) || {};
  }

  /**
   * Find reminders matching a producer, an entity, an owner, or a completion state
   * @param {object} [query] - Query terms; omitted terms match anything
   * @param {string} [query.source] - Module id that produced the reminder
   * @param {string} [query.ref] - The producer's own key for the reminder's subject
   * @param {string} [query.userId] - Owner, which also narrows the scan to that user
   * @param {boolean} [query.isDone] - Completion state
   * @returns {Reminder[]} Matching reminders
   */
  static findReminders({ source, ref, userId, isDone } = {}) {
    const pool = userId ? this.getUserReminders(userId) : this.getAllReminders();
    return Object.values(pool).filter(
      (reminder) =>
        (source === undefined || (reminder.source || MODULE.ID) === source) && (ref === undefined || (reminder.ref ?? null) === ref) && (isDone === undefined || !!reminder.isDone === isDone)
    );
  }

  /**
   * Whether the current user may write to another user's reminders
   * @param {string} userId - Owner of the reminders being written
   * @returns {boolean} True when the write is permitted
   */
  static #canWrite(userId) {
    return game.user.id === userId || game.user.isGM;
  }

  /**
   * Check whether a declared producer source may act on a reminder
   * @param {Reminder} reminder - The reminder being acted on
   * @param {string} [source] - Declared producer source
   * @returns {boolean} True when the action must be refused
   */
  static #sourceBlocked(reminder, source) {
    const owner = reminder.source || MODULE.ID;
    if (!source || source === owner) return false;
    ui.notifications.error('DONTFORGET.Api.SourceMismatch', { format: { source: owner } });
    return true;
  }

  /**
   * Create a reminder for a user
   * @param {string} userId - The user the reminder belongs to
   * @param {object} reminderData - Initial reminder data
   * @returns {Promise<Reminder|null>} The created reminder record
   */
  static async createReminder(userId, reminderData = {}) {
    const user = game.users.get(userId);
    if (!user) {
      ui.notifications.error('DONTFORGET.Api.UserNotFound');
      return null;
    }
    if (!this.#canWrite(userId)) {
      ui.notifications.error('DONTFORGET.Api.NoCreatePermission');
      return null;
    }

    const reminder = {
      id: foundry.utils.randomID(16),
      label: reminderData.label || '',
      isDone: false,
      userId,
      createdAt: Date.now(),
      source: reminderData.source || MODULE.ID,
      ref: reminderData.ref ?? null,
      dueDate: reminderData.dueDate ?? null,
      noteId: reminderData.noteId ?? null,
      isDue: false
    };

    await user.setFlag(MODULE.ID, MODULE.FLAGS.REMINDERS, { [reminder.id]: reminder });
    return reminder;
  }

  /**
   * Apply a partial update to a reminder
   * @param {string} reminderId - The reminder ID
   * @param {object} updateData - The keys to change
   * @param {string} [source] - Declared producer source; must match the reminder's own source
   * @returns {Promise} Promise for the flag operation
   */
  static async updateReminder(reminderId, updateData, source) {
    const reminder = this.getAllReminders()[reminderId];
    if (!reminder) {
      ATLAS.log(1, `Reminder with ID ${reminderId} not found`);
      return null;
    }
    const user = game.users.get(reminder.userId);
    if (!user) {
      ATLAS.log(1, `User ${reminder.userId} not found`);
      return null;
    }
    if (!this.#canWrite(reminder.userId)) {
      ui.notifications.error('DONTFORGET.Api.NoUpdatePermission');
      return null;
    }
    if (this.#sourceBlocked(reminder, source)) return null;
    return user.setFlag(MODULE.ID, MODULE.FLAGS.REMINDERS, { [reminderId]: updateData });
  }

  /**
   * Mark a reminder as completed
   * @param {string} reminderId - The reminder ID
   * @param {string} [source] - Declared producer source; must match the reminder's own source
   * @returns {Promise} Promise for the flag operation
   */
  static async completeReminder(reminderId, source) {
    return this.updateReminder(reminderId, { isDone: true }, source);
  }

  /**
   * Delete one reminder
   * @param {string} reminderId - The reminder ID
   * @param {string} userId - The user the reminder belongs to
   * @param {string} [source] - Declared producer source; must match the reminder's own source
   * @returns {Promise} Promise for the flag operation
   */
  static async deleteReminder(reminderId, userId, source) {
    const user = game.users.get(userId);
    if (!user) {
      ATLAS.log(1, `User ${userId} not found`);
      return null;
    }
    if (!this.#canWrite(userId)) {
      ui.notifications.error('DONTFORGET.Api.NoDeletePermission');
      return null;
    }
    const reminder = this.getUserReminders(userId)[reminderId];
    if (reminder && this.#sourceBlocked(reminder, source)) return null;
    return user.setFlag(MODULE.ID, MODULE.FLAGS.REMINDERS, { [reminderId]: _del });
  }

  /**
   * Delete several reminders with one flag write per owning user
   * @param {Reminder[]} reminders - The reminders to delete
   * @param {string} [source] - Declared producer source; must match each reminder's own source
   * @returns {Promise<number>} How many reminders were deleted
   */
  static async deleteReminders(reminders, source) {
    const byUser = new Map();
    for (const reminder of reminders) {
      if (this.#sourceBlocked(reminder, source)) continue;
      if (!byUser.has(reminder.userId)) byUser.set(reminder.userId, {});
      byUser.get(reminder.userId)[reminder.id] = _del;
    }
    let deleted = 0;
    for (const [userId, removals] of byUser) {
      const user = game.users.get(userId);
      if (!user) {
        ATLAS.log(1, `User ${userId} not found`);
        continue;
      }
      if (!this.#canWrite(userId)) {
        ui.notifications.error('DONTFORGET.Api.NoDeletePermission');
        continue;
      }
      await user.setFlag(MODULE.ID, MODULE.FLAGS.REMINDERS, removals);
      deleted += Object.keys(removals).length;
    }
    return deleted;
  }
}
