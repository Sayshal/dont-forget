class Reminder {
  static ID = "dont-forget";
  static TITLE = "Don't Forget!";
  static FLAGS = { REMINDERS: "reminders" };
  static TEMPLATES = {
    DONTFORGETPOPUP: `modules/${this.ID}/templates/dont-forget-popup.hbs`,
  };
  static SETTINGS = { INJECT_BUTTON: "inject-button" };
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
}

Hooks.once("init", () => {
  Reminder.initialize();
});
Hooks.once("changeSidebarTab", () => {
  if (!game.settings.get(Reminder.ID, Reminder.SETTINGS.INJECT_BUTTON)) {
    //Hide everything if the setting is disabled.
    return;
  }
  const journalFooter = $('section[class*="journal-sidebar"]').find(
    'footer[class*="directory-footer"]'
  );
  console.log("FOOTER: " + journalFooter);
  const tooltip = game.i18n.localize("DONT-FORGET.button-title");
  journalFooter.append(
    `<button type='button' class='${Reminder.ID}-journal-icon-button' title='${tooltip}'><i class='fas fa-note-sticky'></i> ${Reminder.TITLE}</button>`
  );
  const userId = game.userId;
  $(document).on("click", `.${Reminder.ID}-journal-icon-button`, (event) => {
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
      .get(game.userId)
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
      .get(relevantReminder.game.userId)
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
/* Time to go ApplicationV2! */
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } =
  foundry.applications.api;
class ReminderConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${Reminder.ID}`,
    tag: "form",
    form: {
      handler: ReminderConfig.formHandler,
      closeOnSubmit: false, // do not close when submitted
      submitOnChange: true, // submit when any input changes
      submitOnClose: true, // submit on close
    },
    actions: {
      create: ReminderConfig.create,
      delete: ReminderConfig.delete,
      //save: ReminderConfig.save,
      //edit: ReminderConfig.edit,
    },
    position: {
      height: "auto",
      width: "auto",
    },
    window: {
      icon: "fas fa-note-sticky",
      resizable: true,
    },
    classes: [`${Reminder.ID}`/*, `${Reminder.ID}-popup`, `${Reminder.ID}-popup-input`, `${Reminder.ID}-popup-delete`, `${Reminder.ID}-popup-checkbox`*/],
  };
  get title() {
    return `${Reminder.TITLE} ${game.i18n.localize(
      "DONT-FORGET.window-title"
    )} (${game.user.name})`;
  }
  static PARTS = {
    form: {
      template: Reminder.TEMPLATES.DONTFORGETPOPUP,
    },
  };
  _prepareContext(options) {
    console.log(
      "REMINDER DATA PREPARE CONTEXT: ",
      ReminderData.getRemindersForUser(game.userId)
    );
    return {
      reminders: ReminderData.getRemindersForUser(game.userId),
    };
  }
  static async formHandler(event, form, formData) {
    //const expandedData = foundry.utils.expandObject(formData.object);
    //console.log(`${Reminder.TITLE} Saving: `, { expandedData });
    await ReminderData.updateUserReminders(game.userId, formData.object);
  }
  static async create(event, target) {
    console.log("CREATE: " + this);

    // Find the closest parent with the attribute 'data-reminder-id' and retrieve its value
    const reminderElement = target.closest("[data-reminder-id]");
    const reminderID = reminderElement
      ? reminderElement.getAttribute("data-reminder-id")
      : null;

    console.log(`${Reminder.TITLE} Button Click: `, { this: this, reminderID });

    await ReminderData.createReminder(game.userId);
    this.render();
  }

  static async delete(event, target) {
    console.log("DELETE: " + this);

    // Find the closest parent with the attribute 'data-reminder-id' and retrieve its value
    const reminderElement = target.closest("[data-reminder-id]");
    const reminderID = reminderElement
      ? reminderElement.getAttribute("data-reminder-id")
      : null;

    console.log(`${Reminder.TITLE} Button Click: `, { this: this, reminderID });
    const confirmed = await DialogV2.confirm({
      window: {
        title: game.i18n.localize("DONT-FORGET.confirms.deleteConfirm.Title"),
      },
      content: game.i18n.localize("DONT-FORGET.confirms.deleteConfirm.Content"),
      modal: true,
    });

    if (confirmed && reminderID) {
      await ReminderData.deleteReminder(reminderID);
      this.render();
    }
  }
}
