import { Reminder } from './dont-forget.js';
/**
 * A single reminder
 * @typedef {Object} Reminder
 * @property {string} id - A unique ID to identify this reminder
 * @property {string} label - The text of the reminder
 * @property {boolean} isDone - Marks whether the reminder is done
 * @property {string} userId - The user who owns this reminder
 */
//Create the Data Layer
export class ReminderData {
  //all reminders for all users
  static getReminders(userId) {
    userId = userId.toString();
    console.log(`${Reminder.TITLE} | ORIGINAL USERID: `, userId);
    if (game.users.get(userId).isGM) {
      console.log(`${Reminder.TITLE} | USER IS GM!`);
      return this.allReminders();
    } else if (!game.users.get(userId).isGM) {
      console.log(`${Reminder.TITLE} | USER IS NOT GM!`, game.users.get(userId).isGM, userId);
      return this.getRemindersForUser(userId);
    } else {
      console.log(`${Reminder.TITLE} | USER IS INVALID: `, userId);
    }
  }

  static allReminders() {
    const allReminders = game.users.reduce((accumulator, user) => {
      const userReminders = this.getRemindersForUser(user.id);
      return {
        ...accumulator,
        ...userReminders,
      };
    }, {});

    return allReminders;
  }

  static getRemindersForUser(userId) {
    return game.users.get(userId)?.getFlag(Reminder.ID, Reminder.FLAGS.REMINDERS) || {};
  }

  //create a new reminder for a given user
  static createReminder(userId, reminderData) {
    //generate a random id for this new reminder and populate the userId
    const newReminder = {
      isDone: false,
      ...reminderData,
      id: foundry.utils.randomID(16),
      userId,
    };

    //construct the update to insert the new reminder
    const newReminders = {
      [newReminder.id]: newReminder,
    };

    //update the database with the new reminders
    return game.users.get(game.userId)?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, newReminders);
  }

  //update a specific reminder by id with the provided updateData
  static updateReminder(reminderId, updateData) {
    const allReminders = this.allReminders();
    const relevantReminder = allReminders[reminderId];

    if (!relevantReminder) {
      console.error(`Reminder with id ${reminderId} not found.`);
      return;
    }

    //Update the database with the updated reminder
    return game.users.get(relevantReminder.userId)?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, {
      [reminderId]: {
        ...relevantReminder,
        ...updateData, // merge the existing reminder with the new updateData
      },
    });
  }

  //update multiple reminders for a given user
  static updateUserReminders(userId, updateData) {
    if (!updateData || typeof updateData !== 'object') {
      console.error(`Invalid update data provided for user ${userId}.`);
      return;
    }

    const user = game.users.get(userId);

    if (!user) {
      console.error(`User with id ${userId} not found.`);
      return;
    }

    // Update the user's reminders with the provided data
    return user.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, updateData);
  }

  //delete a specific reminder by id
  static deleteReminder(reminderId, userId) {
    const allReminders = this.allReminders();
    const relevantReminder = allReminders[reminderId];

    if (!relevantReminder) {
      console.error(`Reminder with id ${reminderId} not found.`);
      return;
    }

    // Foundry specific syntax required to delete a key from a persisted object in the database
    const keyDeletion = {
      [`-=${reminderId}`]: null,
    };

    // Update the database with the updated reminder list
    return game.users.get(userId)?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, keyDeletion);
  }
}
