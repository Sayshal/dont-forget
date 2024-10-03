import { ReminderData } from './ReminderData.js';
import { registerSettings } from './settings.js';

export class Reminder {
  static ID = 'dont-forget';
  static TITLE = "Don't Forget!";
  static FLAGS = { REMINDERS: 'reminders' };
  static TEMPLATES = {
    DONTFORGETPOPUP: `modules/${this.ID}/templates/dont-forget-popup.hbs`,
  };
  static SETTINGS = { INJECT_BUTTON: 'inject-button' };
  static initialize() {
    this.reminderConfig = new ReminderConfig();
    console.log(`${Reminder.TITLE} | Initialize Module`);
    registerSettings();
    console.log(`${Reminder.TITLE} | Register Settings`);
    Handlebars.registerHelper('getUserName', function (userId) {
      const user = game.users.get(userId);
      return user ? user.name : 'Unknown'; // Fallback in case the user no longer exists.
    });
  }
}

Hooks.once('init', () => {
  Reminder.initialize();
});
Hooks.once('changeSidebarTab', () => {
  if (!game.settings.get(Reminder.ID, Reminder.SETTINGS.INJECT_BUTTON)) {
    //Hide everything if the setting is disabled.
    return;
  }
  const journalFooter = $('section[class*="journal-sidebar"]').find('footer[class*="directory-footer"]');
  console.log(`${Reminder.TITLE} | Initialize Journal Button`);
  const tooltip = game.i18n.localize('DONT-FORGET.button-title');
  journalFooter.append(`<button type='button' class='${Reminder.ID}-journal-icon-button' title='${tooltip}'><i class='fas fa-note-sticky'></i> ${Reminder.TITLE}</button>`);
  const userId = game.userId;
  $(document).on('click', `.${Reminder.ID}-journal-icon-button`, (event) => {
    Reminder.reminderConfig.render(true, { userId });
  });
});

/* Time to go ApplicationV2! */
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
class ReminderConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${Reminder.ID}`,
    tag: 'form',
    form: {
      handler: ReminderConfig.formHandler,
      closeOnSubmit: false, // do not close when submitted
      submitOnChange: true, // submit when any input changes
      submitOnClose: true, // submit on close
    },
    actions: {
      create: ReminderConfig.create,
      delete: ReminderConfig.delete,
      edit: ReminderConfig.edit,
      ['delete-completed']: ReminderConfig.deleteCompleted,
    },
    position: {
      height: 'auto',
      width: 'auto',
    },
    window: {
      icon: 'fas fa-note-sticky',
      resizable: false,
    },
    classes: [`${Reminder.ID}` /*, `${Reminder.ID}-popup`, `${Reminder.ID}-popup-input`, `${Reminder.ID}-popup-delete`, `${Reminder.ID}-popup-checkbox`*/],
  };
  get title() {
    if (game.users.get(game.userId).isGM) {
      return `${Reminder.TITLE} ${game.i18n.localize('DONT-FORGET.window-title')} (${game.i18n.localize('DONT-FORGET.dungeon-master')})`;
    } else {
      return `${Reminder.TITLE} ${game.i18n.localize('DONT-FORGET.window-title')} (${game.user.name})`;
    }
  }
  static PARTS = {
    form: {
      template: Reminder.TEMPLATES.DONTFORGETPOPUP,
    },
  };
  _prepareContext(options) {
    const reminders = ReminderData.getReminders(game.userId);
    console.log('REMINDER DATA PREPARE CONTEXT: ', ReminderData.getRemindersForUser(game.userId));
    return {
      reminders: reminders, // Now contains userId for each reminder.
    };
  }
  static async formHandler(event, form, formData) {
    //const expandedData = foundry.utils.expandObject(formData.object);
    await ReminderData.updateUserReminders(game.userId, formData.object);
  }
  static async create(event, target) {
    console.log('CREATE: ' + this);

    // Find the closest parent with the attribute 'data-reminder-id' and retrieve its value
    const reminderElement = target.closest('[data-reminder-id]');

    //console.log(`${Reminder.TITLE} Button Click: `, { this: this, reminderID, userId });

    await ReminderData.createReminder(game.userId);
    this.render();
  }

  static async delete(event, target) {
    console.log('DELETE: ' + { target });
    
    // Find the closest parent with the attribute 'data-reminder-id' and retrieve its value
    const reminderElement = target.closest('[data-reminder-id]');
    const reminderID = reminderElement ? reminderElement.getAttribute('data-reminder-id') : null;

    // Get the userId associated with the reminder
    const userId = reminderElement ? reminderElement.getAttribute('data-user-id') : null;

    console.log(`${Reminder.TITLE} Button Click: `, { this: this, reminderID, userId });
    const confirmed = await DialogV2.confirm({
      window: {
        title: game.i18n.localize('DONT-FORGET.confirms.deleteConfirm.Title'),
      },
      content: game.i18n.localize('DONT-FORGET.confirms.deleteConfirm.Content'),
      modal: false,
    });

    if (confirmed && reminderID && userId) {
      // Perform the deletion
      const result = await ReminderData.deleteReminder(reminderID, userId);
      if (result) {
        console.log(`Reminder ${reminderID} deleted successfully.`);
        this.render(); // Re-render the reminders
      } else {
        console.error(`Failed to delete reminder ${reminderID}.`);
      }
    }
  }
  static edit(event, target) {
    if (target.closest('.dont-forget-edit')) {
      const listItem = target.closest('.dont-forget-list-item');
      const inputField = listItem.querySelector('.dont-forget-input');

      // Toggle the readonly property
      inputField.readOnly = !inputField.readOnly; // Fixed 'readonly' to 'ReadOnly'
    }
  }

  static async deleteCompleted(event, target) {
    if (target.closest('.dont-forget-delete-completed')) {
      const completedReminders = Array.from(document.querySelectorAll('.dont-forget-checkbox:checked'));

      if (completedReminders.length === 0) {
        console.log('No completed reminders to delete.');
        return;
      }

      // Confirm deletion
      const confirmed = await DialogV2.confirm({
        window: {
          title: game.i18n.localize('DONT-FORGET.confirms.deleteCompletedConfirm.Title'),
        },
        content: game.i18n.localize('DONT-FORGET.confirms.deleteCompletedConfirm.Content'),
        modal: false,
      });
      if (!confirmed) return;

      completedReminders.forEach(async (checkbox) => {
        const listItem = checkbox.closest('.dont-forget-list-item');
        const reminderID = listItem.dataset.reminderId;
        const userId = listItem.dataset.userId;

        // Call your deleteReminder function
        const result = await ReminderData.deleteReminder(reminderID, userId);
        if (result) {
          console.log(`Reminders ${completedReminders} deleted successfully.`);
          this.render();
        } else {
          console.error(`Failed to delete reminders: ${completedReminders}`);
        }
      });
    }
  }
}