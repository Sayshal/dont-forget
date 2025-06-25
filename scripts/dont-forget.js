import { ReminderManager } from './reminder-manager.js';
import { registerSettings } from './settings.js';

/**
 * Main module class that initializes the Don't Forget module
 */
export class DontForget {
  static ID = 'dont-forget';
  static TITLE = "Don't Forget!";

  static FLAGS = {
    REMINDERS: 'reminders'
  };

  static TEMPLATES = {
    REMINDER_LIST: `modules/${this.ID}/templates/reminder-list.hbs`
    // Removed CREATE_REMINDER template
  };

  static SETTINGS = {
    INJECT_BUTTON: 'inject-button'
  };

  /**
   * Initialize the module
   */
  static initialize() {
    console.log(`${this.TITLE} | Initializing module`);

    // Register settings
    registerSettings();

    // Create reminder app instance
    this.reminderApp = new ReminderApp();
  }
}

/**
 * Hook initialization
 */
Hooks.once('init', () => {
  DontForget.initialize();
});

/**
 * Add reminder button to the player list header
 */
Hooks.on('renderPlayerList', (app, html, data) => {
  if (!game.settings.get(DontForget.ID, DontForget.SETTINGS.INJECT_BUTTON)) {
    return;
  }

  // Remove any existing reminder buttons
  html.find(`.${DontForget.ID}-header-button`).remove();

  // Add single button to the h3 header
  const $header = html.find('h3[aria-label="Players"]');

  if ($header.length > 0) {
    const $reminderButton = $(
      `<i class="${DontForget.ID}-header-button fas fa-sticky-note" data-tooltip="${game.i18n.localize('DONT-FORGET.button-title')}" data-tooltip-direction="LEFT"></i>`
    );
    // Add click handler
    $reminderButton.on('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      DontForget.reminderApp.render(true);
    });

    // Insert at the end of the header
    $header.append($reminderButton);
  }
});

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Main application for managing reminders
 */
class ReminderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${DontForget.ID}-app`,
    tag: 'form',
    form: {
      handler: ReminderApp.formHandler,
      closeOnSubmit: false,
      submitOnChange: true,
      submitOnClose: true
    },
    actions: {
      'create': ReminderApp.createReminder,
      'delete': ReminderApp.deleteReminder,
      'edit': ReminderApp.editReminder,
      'delete-completed': ReminderApp.deleteCompletedReminders
    },
    position: {
      height: 'auto',
      width: 600
    },
    window: {
      icon: 'fas fa-sticky-note',
      resizable: true
    },
    classes: [DontForget.ID]
  };

  get title() {
    return game.user.isGM ? `${DontForget.TITLE} - ${game.i18n.localize('DONT-FORGET.dungeon-master')}` : `${DontForget.TITLE} - ${game.user.name}`;
  }

  /**
   * Template parts for the application
   */
  static PARTS = {
    form: {
      template: DontForget.TEMPLATES.REMINDER_LIST
    }
  };

  /**
   * Prepare context data for rendering the template
   */
  _prepareContext() {
    const rawReminders = ReminderManager.getReminders(game.user.id);

    // Process and enhance reminder data
    const processedReminders = Object.values(rawReminders).map((reminder) => {
      const user = game.users.get(reminder.userId);

      return {
        ...reminder,
        creatorName: user ? user.name : '',
        createdTime: reminder.createdAt ? foundry.utils.timeSince(reminder.createdAt) : '',
        completed: reminder.isDone
      };
    });

    // Sort reminders: completed at bottom, then by user, then by creation time
    const sortedReminders = processedReminders.sort((a, b) => {
      // First sort by completion status
      if (a.isDone !== b.isDone) {
        return a.isDone ? 1 : -1;
      }

      // If completion status is the same, sort by user (for GM view)
      if (game.user.isGM && a.userId !== b.userId) {
        return a.creatorName.localeCompare(b.creatorName);
      }

      // Then by creation time (newest first)
      if (a.createdAt && b.createdAt) {
        return b.createdAt - a.createdAt;
      }

      // Default to sorting by ID to ensure stable order
      return a.id.localeCompare(b.id);
    });

    return {
      reminders: sortedReminders,
      isGM: game.user.isGM,
      showGMColumns: game.user.isGM, // Added this for template
      hasReminders: sortedReminders.length > 0
    };
  }

  /**
   * Handle form submission with proper data parsing
   */
  static async formHandler(event, form, formData) {
    if (!formData.object) return;

    // Parse the form data to reconstruct reminder objects
    const reminderUpdates = {};

    for (const [key, value] of Object.entries(formData.object)) {
      // Parse keys like "reminderId.property" into structured data
      const parts = key.split('.');
      if (parts.length === 2) {
        const [reminderId, property] = parts;

        if (!reminderUpdates[reminderId]) {
          reminderUpdates[reminderId] = {};
        }

        reminderUpdates[reminderId][property] = value;
      }
    }

    // Update each reminder
    for (const [reminderId, updateData] of Object.entries(reminderUpdates)) {
      await ReminderManager.updateReminder(reminderId, updateData);
    }
  }

  /**
   * Create a new reminder using DialogV2
   */
  static async createReminder(event, target) {
    let userOptions = '';

    if (game.user.isGM) {
      for (const user of game.users.contents) {
        if (user.active) {
          const selected = user.id === game.user.id ? 'selected' : '';
          userOptions += `<option value="${user.id}" ${selected}>${user.name}</option>`;
        }
      }
    }

    const content = `
    <form id="create-reminder-form">
      <div class="form-group">
        <label for="reminder-text">${game.i18n.localize('DONT-FORGET.reminder-text')}</label>
        <input type="text" id="reminder-text" name="reminderText" placeholder="${game.i18n.localize('DONT-FORGET.new-reminder-text')}" autofocus />
      </div>
      ${
        game.user.isGM ?
          `
        <div class="form-group">
          <label for="reminder-owner">${game.i18n.localize('DONT-FORGET.reminder-owner')}</label>
          <select id="reminder-owner" name="reminderOwner">
            ${userOptions}
          </select>
        </div>
      `
        : ''
      }
    </form>
  `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: {
        title: game.i18n.localize('DONT-FORGET.create-reminder-title'),
        icon: 'fas fa-plus'
      },
      content: content,
      ok: {
        label: game.i18n.localize('DONT-FORGET.create'),
        callback: (event, button, dialog) => {
          // Access form data through button.form.elements
          const reminderText = button.form.elements.reminderText.value;
          const reminderOwner = button.form.elements.reminderOwner?.value;

          return {
            reminderText: reminderText,
            reminderOwner: reminderOwner
          };
        }
      },
      modal: true,
      rejectClose: false,
      classes: [DontForget.ID, 'create-reminder-dialog']
    });

    // If we got valid form data back
    if (result) {
      const reminderData = {
        label: result.reminderText || game.i18n.localize('DONT-FORGET.new-reminder-text')
      };

      const ownerId = game.user.isGM && result.reminderOwner ? result.reminderOwner : game.user.id;

      // Create reminder
      await ReminderManager.createReminder(ownerId, reminderData);

      // Show success message
      ui.notifications.info(game.i18n.localize('DONT-FORGET.reminder-created'));

      // Re-render the app
      this.render();
    }
  }

  /**
   * Delete a reminder
   */
  static async deleteReminder(event, target) {
    const reminderElement = target.closest('[data-reminder-id]');
    if (!reminderElement) return;

    const reminderId = reminderElement.dataset.reminderId;

    // Get all reminders and find the specific one
    const allReminders = ReminderManager.getReminders(game.user.id);
    const reminder = allReminders[reminderId];

    if (!reminder) {
      ui.notifications.error('Reminder not found');
      return;
    }

    const confirmed = await DialogV2.confirm({
      window: {
        title: game.i18n.localize('DONT-FORGET.confirms.deleteConfirm.Title')
      },
      content: game.i18n.localize('DONT-FORGET.confirms.deleteConfirm.Content'),
      modal: false
    });

    if (confirmed) {
      await ReminderManager.deleteReminder(reminderId, reminder.userId);
      this.render();
    }
  }

  /**
   * Edit an existing reminder using DialogV2
   */
  static async editReminder(event, target) {
    const reminderElement = target.closest('[data-reminder-id]');
    if (!reminderElement) return;

    const reminderId = reminderElement.dataset.reminderId;

    // Get all reminders and find the specific one
    const allReminders = ReminderManager.getReminders(game.user.id);
    const reminder = allReminders[reminderId];

    if (!reminder) {
      ui.notifications.error('Reminder not found');
      return;
    }

    // Check permissions
    if (game.user.id !== reminder.userId && !game.user.isGM) {
      ui.notifications.error("You don't have permission to edit this reminder");
      return;
    }

    let userOptions = '';

    if (game.user.isGM) {
      for (const user of game.users.contents) {
        if (user.active) {
          const selected = user.id === reminder.userId ? 'selected' : '';
          userOptions += `<option value="${user.id}" ${selected}>${user.name}</option>`;
        }
      }
    }

    const content = `
    <form id="edit-reminder-form">
      <div class="form-group">
        <label for="reminder-text">${game.i18n.localize('DONT-FORGET.reminder-text')}</label>
        <input type="text" id="reminder-text" name="reminderText" placeholder="${reminder.label}" autofocus />
      </div>
      ${
        game.user.isGM ?
          `
        <div class="form-group">
          <label for="reminder-owner">${game.i18n.localize('DONT-FORGET.reminder-owner')}</label>
          <select id="reminder-owner" name="reminderOwner">
            ${userOptions}
          </select>
        </div>
      `
        : ''
      }
    </form>
  `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: {
        title: game.i18n.localize('DONT-FORGET.edit-reminder'),
        icon: 'fas fa-edit'
      },
      content: content,
      ok: {
        label: game.i18n.localize('DONT-FORGET.save'),
        callback: (event, button, dialog) => {
          // Access form data through button.form.elements
          const reminderText = button.form.elements.reminderText.value;
          const reminderOwner = button.form.elements.reminderOwner?.value;

          return {
            reminderText: reminderText,
            reminderOwner: reminderOwner
          };
        }
      },
      modal: true,
      rejectClose: false,
      classes: [DontForget.ID, 'edit-reminder-dialog'],
      position: { width: 'auto', height: 'auto' }
    });

    // If we got valid form data back
    if (result) {
      const updateData = {
        label: result.reminderText
      };

      // Handle owner change if GM changed it
      if (game.user.isGM && result.reminderOwner && result.reminderOwner !== reminder.userId) {
        // If owner is changing, we need to delete from old user and create for new user
        const newOwnerId = result.reminderOwner;

        // Delete from old owner
        await ReminderManager.deleteReminder(reminderId, reminder.userId);

        // Create for new owner
        const newReminderData = {
          label: result.reminderText,
          isDone: reminder.isDone
        };
        await ReminderManager.createReminder(newOwnerId, newReminderData);
      } else {
        // Just update the existing reminder
        await ReminderManager.updateReminder(reminderId, updateData);
      }

      // Show success message
      ui.notifications.info('Reminder updated successfully!');

      // Re-render the app
      this.render();
    }
  }

  /**
   * Delete all completed reminders
   */
  static async deleteCompletedReminders() {
    const reminders = ReminderManager.getReminders(game.user.id);
    const completedReminders = Object.values(reminders).filter((r) => r.isDone);

    if (completedReminders.length === 0) {
      ui.notifications.info(game.i18n.localize('DONT-FORGET.no-completed-reminders'));
      return;
    }

    const confirmed = await DialogV2.confirm({
      window: {
        title: game.i18n.localize('DONT-FORGET.confirms.deleteCompletedConfirm.Title')
      },
      content: game.i18n.localize('DONT-FORGET.confirms.deleteCompletedConfirm.Content'),
      modal: false
    });

    if (confirmed) {
      for (const reminder of completedReminders) {
        await ReminderManager.deleteReminder(reminder.id, reminder.userId);
      }
      this.render();
    }
  }
}
