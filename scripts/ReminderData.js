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

  //get all reminders for a given user
  static getRemindersForUser(userId) {
    return game.users.get(userId)?.getFlag(Reminder.ID, Reminder.FLAGS.REMINDERS);
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
    const relevantReminder = this.allReminders[reminderId];

    //construct the update to send
    const update = {
      [reminderId]: updateData,
    };

    //Update the database with the updated reminder list
    return game.users.get(relevantReminder.game.userId)?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, update);
  }

  //update multiple reminders on a user
  static updateUserReminders(userId, updateData) {
    return game.users.get(userId)?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, updateData);
  }

  //delete a specific reminder by id
  static deleteReminder(reminderId, userId) {
    const relevantReminder = this.allReminders[reminderId];

    //Foundry specific syntax required to delete a key from a persisted object in the database
    const keyDeletion = {
      [`-=${reminderId}`]: null,
    };

    //update the database with the updated reminder list
    return game.users.get(relevantReminder.userId)?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, keyDeletion);
  }
}
