import { DontForget } from './dont-forget.js';

/**
 * @typedef {object} Reminder
 * @property {string} id - Unique identifier
 * @property {string} label - Reminder text
 * @property {boolean} isDone - Completion status
 * @property {string} userId - User who created the reminder
 * @property {number} [createdAt] - Creation timestamp
 * @property {string} [source] - Module id that produced the reminder
 * @property {string|null} [ref] - The producer's own key for whatever the reminder is about
 * @property {object|null} [dueDate] - In-world due date {year, month (1-indexed), day (1-indexed)}
 * @property {string|null} [noteId] - Journal entry page id of the backing Calendaria note
 * @property {boolean} [isDue] - Whether the backing note has delivered
 */

/**
 * Manages reminder data and persistence
 */
export class ReminderManager {
  /**
   * Get reminders for a specific user or all reminders for GM
   * @param {string} userId - The user ID to get reminders for
   * @returns {Object<string, Reminder>} Dictionary of reminders
   */
  static getReminders(userId) {
    const user = game.users.get(userId);

    if (!user) {
      ATLAS.log(1, `User with ID ${userId} not found`);
      return {};
    }

    // GMs see all reminders
    if (user.isGM) {
      return this.getAllReminders();
    }

    // Regular users only see their own
    return this.getUserReminders(userId);
  }

  /**
   * Get all reminders across all users
   * @returns {Object<string, Reminder>} Dictionary of all reminders
   */
  static getAllReminders() {
    const allReminders = {};

    game.users.forEach((user) => {
      const userReminders = this.getUserReminders(user.id);
      Object.assign(allReminders, userReminders);
    });

    return allReminders;
  }

  /**
   * Get reminders for a specific user
   * @param {string} userId - The user ID
   * @returns {Object<string, Reminder>} Dictionary of user's reminders
   */
  static getUserReminders(userId) {
    const user = game.users.get(userId);
    if (!user) return {};

    return user.getFlag(DontForget.ID, DontForget.FLAGS.REMINDERS) || {};
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
        (source === undefined || (reminder.source || DontForget.ID) === source) && (ref === undefined || (reminder.ref ?? null) === ref) && (isDone === undefined || !!reminder.isDone === isDone)
    );
  }

  /**
   * Check whether a declared producer source may act on a reminder
   * @param {Reminder} reminder - The reminder being acted on
   * @param {string} [source] - Declared producer source
   * @returns {boolean} True when the action must be refused
   */
  static #sourceBlocked(reminder, source) {
    const owner = reminder.source || DontForget.ID;
    if (!source || source === owner) return false;

    ui.notifications.error('DONT-FORGET.api.source-mismatch', { format: { source: owner } });
    return true;
  }

  /**
   * Create a new reminder for a user
   * @param {string} userId - The user ID
   * @param {object} reminderData - Initial reminder data
   * @returns {Promise<Reminder|null>} The created reminder record
   */
  static async createReminder(userId, reminderData = {}) {
    const user = game.users.get(userId);
    if (!user) {
      ui.notifications.error(`${DontForget.TITLE} | Cannot create reminder: User not found`);
      return null;
    }

    if (game.user.id !== userId && !game.user.isGM) {
      ui.notifications.error(`${DontForget.TITLE} | You don't have permission to create reminders for another user`);
      return null;
    }

    const id = foundry.utils.randomID(16);

    const reminder = {
      id,
      label: reminderData.label || '',
      isDone: false,
      userId,
      createdAt: Date.now(),
      source: reminderData.source || DontForget.ID,
      ref: reminderData.ref ?? null,
      dueDate: reminderData.dueDate ?? null,
      noteId: reminderData.noteId ?? null,
      isDue: false
    };

    // Create an object with just this reminder to update flags
    const updateData = {
      [id]: reminder
    };

    await user.setFlag(DontForget.ID, DontForget.FLAGS.REMINDERS, updateData);
    return reminder;
  }

  /**
   * Update a specific reminder
   * @param {string} reminderId - The reminder ID
   * @param {object} updateData - Data to update
   * @param {string} [source] - Declared producer source; must match the reminder's own source
   * @returns {Promise} Promise for the flag operation
   */
  static async updateReminder(reminderId, updateData, source) {
    const allReminders = this.getAllReminders();
    const reminder = allReminders[reminderId];

    if (!reminder) {
      ATLAS.log(1, `Reminder with ID ${reminderId} not found`);
      return null;
    }

    // Get the owner user
    const user = game.users.get(reminder.userId);
    if (!user) {
      ATLAS.log(1, `User ${reminder.userId} not found`);
      return null;
    }

    // Only update if user is owner or GM
    if (game.user.id !== reminder.userId && !game.user.isGM) {
      ui.notifications.error(`${DontForget.TITLE} | You don't have permission to update this reminder`);
      return null;
    }

    if (this.#sourceBlocked(reminder, source)) return null;

    // Write only the changed keys; the flag update merges them into the stored record
    return user.setFlag(DontForget.ID, DontForget.FLAGS.REMINDERS, { [reminderId]: updateData });
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
   * Delete a specific reminder
   * @param {string} reminderId - The reminder ID
   * @param {string} userId - The user ID who owns the reminder
   * @param {string} [source] - Declared producer source; must match the reminder's own source
   * @returns {Promise} Promise for the flag operation
   */
  static async deleteReminder(reminderId, userId, source) {
    const user = game.users.get(userId);
    if (!user) {
      ATLAS.log(1, `User ${userId} not found`);
      return null;
    }
    if (game.user.id !== userId && !game.user.isGM) {
      ui.notifications.error(`${DontForget.TITLE} | You don't have permission to delete this reminder`);
      return null;
    }
    const reminder = this.getUserReminders(userId)[reminderId];
    if (reminder && this.#sourceBlocked(reminder, source)) return null;
    return user.setFlag(DontForget.ID, DontForget.FLAGS.REMINDERS, { [reminderId]: _del });
  }
}
