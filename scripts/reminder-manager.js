import { DontForget } from './dont-forget.js';

/**
 * @typedef {Object} Reminder
 * @property {string} id - Unique identifier
 * @property {string} label - Reminder text
 * @property {boolean} isDone - Completion status
 * @property {string} userId - User who created the reminder
 * @property {number} [createdAt] - Creation timestamp
 */

/**
 * Manages reminder data and persistence
 */
export class ReminderManager {
  /**
   * Get reminders for a specific user or all reminders for GM
   * @param {string} userId - The user ID to get reminders for
   * @returns {Object.<string, Reminder>} Dictionary of reminders
   */
  static getReminders(userId) {
    const user = game.users.get(userId);

    if (!user) {
      console.error(`${DontForget.TITLE} | User with ID ${userId} not found`);
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
   * @returns {Object.<string, Reminder>} Dictionary of all reminders
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
   * @returns {Object.<string, Reminder>} Dictionary of user's reminders
   */
  static getUserReminders(userId) {
    const user = game.users.get(userId);
    if (!user) return {};

    return user.getFlag(DontForget.ID, DontForget.FLAGS.REMINDERS) || {};
  }

  /**
   * Create a new reminder for a user
   * @param {string} userId - The user ID
   * @param {Object} reminderData - Initial reminder data
   * @returns {Promise} Promise for the flag operation
   */
  static async createReminder(userId, reminderData = {}) {
    const user = game.users.get(userId);
    if (!user) {
      ui.notifications.error(`${DontForget.TITLE} | Cannot create reminder: User not found`);
      return null;
    }

    const id = foundry.utils.randomID(16);

    const reminder = {
      id,
      label: reminderData.label || '',
      isDone: false,
      userId,
      createdAt: Date.now()
    };

    // Create an object with just this reminder to update flags
    const updateData = {
      [id]: reminder
    };

    return user.setFlag(DontForget.ID, DontForget.FLAGS.REMINDERS, updateData);
  }

  /**
   * Update a specific reminder
   * @param {string} reminderId - The reminder ID
   * @param {Object} updateData - Data to update
   * @returns {Promise} Promise for the flag operation
   */
  static async updateReminder(reminderId, updateData) {
    const allReminders = this.getAllReminders();
    const reminder = allReminders[reminderId];

    if (!reminder) {
      console.error(`${DontForget.TITLE} | Reminder with ID ${reminderId} not found`);
      return null;
    }

    // Get the owner user
    const user = game.users.get(reminder.userId);
    if (!user) {
      console.error(`${DontForget.TITLE} | User ${reminder.userId} not found`);
      return null;
    }

    // Only update if user is owner or GM
    if (game.user.id !== reminder.userId && !game.user.isGM) {
      ui.notifications.error(`${DontForget.TITLE} | You don't have permission to update this reminder`);
      return null;
    }

    // Create update data for just this reminder
    const reminderUpdate = {
      [reminderId]: {
        ...reminder,
        ...updateData
      }
    };

    return user.setFlag(DontForget.ID, DontForget.FLAGS.REMINDERS, reminderUpdate);
  }

  /**
   * Delete a specific reminder
   * @param {string} reminderId - The reminder ID
   * @param {string} userId - The user ID who owns the reminder
   * @returns {Promise} Promise for the flag operation
   */
  static async deleteReminder(reminderId, userId) {
    const user = game.users.get(userId);
    if (!user) {
      console.error(`${DontForget.TITLE} | User ${userId} not found`);
      return null;
    }

    // Only allow delete if user is owner or GM
    if (game.user.id !== userId && !game.user.isGM) {
      ui.notifications.error(`${DontForget.TITLE} | You don't have permission to delete this reminder`);
      return null;
    }

    // Create deletion key in Foundry format
    const deletion = {
      [`-=${reminderId}`]: null
    };

    return user.setFlag(DontForget.ID, DontForget.FLAGS.REMINDERS, deletion);
  }
}
