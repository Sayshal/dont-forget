class Reminder {
  static ID = "dont-forget";

  static TITLE = "Don't Forget!";

  static FLAGS = {
    REMINDERS: "reminders",
  };

  static TEMPLATES = {
    DONTFORGET: `modules/${this.ID}/templates/dont-forget.hbs`,
  };

  static initialize() {
    this.reminderConfig = new ReminderConfig();
    game.settings.register(this.ID, this.SETTINGS.INJECT_BUTTON, {
      name: `DONT-FORGET.settings.${this.SETTINGS.INJECT_BUTTON}.Name`,
      default: true,
      type: Boolean,
      scope: "client",
      config: true,
      hint: `DONT-FORGET.settings.${this.SETTINGS.INJECT_BUTTON}.Hint`,
      onChange: () => ui.players.render(),
    });
  }

  static SETTINGS = {
    INJECT_BUTTON: "inject-button",
  };
}

Hooks.on("init", () => {
  Reminder.initialize();
});

Hooks.on("renderPlayerList", (playerList, html) => {
  if (!game.settings.get(Reminder.ID, Reminder.SETTINGS.INJECT_BUTTON)) {
    //Hide everything if the setting is disabled.

    return;
  }
  //find the element which has our logged in user's id
  const loggedInUserListItem = html.find(`[data-user-id="${game.userId}"]`);
  //create localized tooltip
  const tooltip = game.i18n.localize("DONT-FORGET.button-title");
  //insert a button at the end of this element
  loggedInUserListItem.append(
    `<button type='button' class='${Reminder.ID}-icon-button flex0' title='${tooltip}'><i class='fas fa-note-sticky'></i></button>`
  );

  html.on("click", `.${Reminder.ID}-icon-button`, (event) => {
    const userId = $(event.currentTarget)
      .parents("[data-user-id]")
      ?.data()?.userId;
    Reminder.reminderConfig.render(true, { userId });
  });
});

/**
 * A single reminder
 * @typedef {Object} Reminder
 * @property {string} id - A unique ID to identify this reminder
 * @property {string} label - The text of the reminder
 * @property {boolean} isDone - Marks whether the reminder is done
 * @property {string} userId - The user who owns this reminder
 */

//Create the Data Layer
class ReminderData {
  //all reminders for all users
  static get allReminders() {
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
    return game.users
      .get(userId)
      ?.getFlag(Reminder.ID, Reminder.FLAGS.REMINDERS);
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
    return game.users
      .get(userId)
      ?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, newReminders);
  }

  //update a specific reminder by id with the provided updateData
  static updateReminder(reminderId, updateData) {
    const relevantReminder = this.allReminders[reminderId];

    //construct the update to send
    const update = {
      [reminderId]: updateData,
    };

    //Update the database with the updated reminder list
    return game.users
      .get(relevantReminder.userId)
      ?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, update);
  }

  //update multiple reminders on a user
  static updateUserReminders(userId, updateData) {
    return game.users
      .get(userId)
      ?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, updateData);
  }

  //delete a specific reminder by id
  static deleteReminder(reminderId) {
    const relevantReminder = this.allReminders[reminderId];

    //Foundry specific syntax required to delete a key from a persisted object in the database
    const keyDeletion = {
      [`-=${reminderId}`]: null,
    };

    //update the database with the updated reminder list
    return game.users
      .get(relevantReminder.userId)
      ?.setFlag(Reminder.ID, Reminder.FLAGS.REMINDERS, keyDeletion);
  }
}

class ReminderConfig extends FormApplication {
  static get defaultOptions() {
    const defaults = super.defaultOptions;

    const overrides = {
      height: "auto",
      id: `${Reminder.ID}`,
      template: Reminder.TEMPLATES.DONTFORGET,
      title: `${Reminder.TITLE}`,
      userId: game.userId,
      closeOnSubmit: false, // do not close when submitted
      submitOnChange: true, // submit when any input changes
      submitOnClose: true, // submit when closed
    };

    const mergedOptions = foundry.utils.mergeObject(defaults, overrides);

    return mergedOptions;
  }
  getData(options) {
    return {
      reminders: ReminderData.getRemindersForUser(options.userId),
    };
  }

  async _updateObject(event, formData) {
    const expandedData = foundry.utils.expandObject(formData);
    //console.log(`${Reminder.TITLE} Saving: `, {formData});
    await ReminderData.updateUserReminders(this.options.userId, expandedData);

    this.render();
  }

  async _handleButtonClick(event) {
    const clickedElement = $(event.currentTarget);
    const action = clickedElement.data().action;
    const reminderID = clickedElement
      .parents("[data-reminder-id]")
      ?.data()?.reminderId;

    console.log(`${Reminder.TITLE} Button Click: `, {
      this: this,
      action,
      reminderID,
    });

    switch (action) {
      case "create": {
        await ReminderData.createReminder(this.options.userId);
        this.render();
        break;
      }

      case "delete": {
        const confirmed = await Dialog.confirm({
          title: game.i18n.localize("DONT-FORGET.confirms.deleteConfirm.Title"),
          content: game.i18n.localize(
            "DONT-FORGET.confirms.deleteConfirm.Content"
          ),
        });
        if (confirmed) {
          await ReminderData.deleteReminder(reminderID);
          this.render();
        }
        break;
      }
      default:
        console.log("Invalid action detected: " + action);
    }
  }

  activateListeners(html) {
    super.activateListeners(html); //re-enable foundrys built in listeners.
    html.on("click", "[data-action]", this._handleButtonClick.bind(this));
  }
}
