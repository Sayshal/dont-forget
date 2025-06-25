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
    tag: 'div',
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
    main: {
      template: DontForget.TEMPLATES.REMINDER_LIST
    }
  };

  /**
   * Add event listeners after rendering
   */
  _onRender(context, options) {
    super._onRender(context, options);

    // Add click handlers for checkboxes
    this.element.querySelectorAll('.reminder-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', this._onCheckboxChange.bind(this));
    });
  }

  /**
   * Handle checkbox changes immediately
   */
  async _onCheckboxChange(event) {
    const checkbox = event.target;
    const reminderRow = checkbox.closest('[data-reminder-id]');
    if (!reminderRow) return;

    const reminderId = reminderRow.dataset.reminderId;
    const isDone = checkbox.checked;

    await ReminderManager.updateReminder(reminderId, { isDone });

    // Update the row's CSS class immediately
    if (isDone) {
      reminderRow.classList.add('completed');
    } else {
      reminderRow.classList.remove('completed');
    }

    // Update the text span as well
    const reminderText = reminderRow.querySelector('.reminder-text');
    if (reminderText) {
      if (isDone) {
        reminderText.classList.add('completed');
      } else {
        reminderText.classList.remove('completed');
      }
    }
  }

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
      showGMColumns: game.user.isGM,
      hasReminders: sortedReminders.length > 0
    };
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
        <div class="reminder-form-field">
          <label for="reminder-text">${game.i18n.localize('DONT-FORGET.reminder-text')}</label>
          <textarea
            id="reminder-text"
            name="reminderText"
            placeholder="${game.i18n.localize('DONT-FORGET.reminder-placeholder')}"
            autofocus></textarea>
        </div>
        ${
          game.user.isGM ?
            `
        <div class="reminder-form-field">
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

    const result = await DialogV2.prompt({
      window: {
        title: game.i18n.localize('DONT-FORGET.create-reminder-title'),
        icon: 'fas fa-plus'
      },
      content: content,
      ok: {
        label: game.i18n.localize('DONT-FORGET.create'),
        callback: (event, button, dialog) => {
          const reminderText = button.form.elements.reminderText.value.trim();
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

    if (result && result.reminderText) {
      const reminderData = {
        label: result.reminderText
      };

      const ownerId = game.user.isGM && result.reminderOwner ? result.reminderOwner : game.user.id;

      await ReminderManager.createReminder(ownerId, reminderData);
      ui.notifications.info(game.i18n.localize('DONT-FORGET.reminder-created'));
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
      modal: true
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
    const allReminders = ReminderManager.getReminders(game.user.id);
    const reminder = allReminders[reminderId];

    if (!reminder) {
      ui.notifications.error('Reminder not found');
      return;
    }

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
        <div class="reminder-form-field">
          <label for="reminder-text">${game.i18n.localize('DONT-FORGET.reminder-text')}</label>
          <textarea
            id="reminder-text"
            name="reminderText"
            autofocus>${reminder.label}</textarea>
        </div>
        ${
          game.user.isGM ?
            `
        <div class="reminder-form-field">
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

    const result = await DialogV2.prompt({
      window: {
        title: game.i18n.localize('DONT-FORGET.edit-reminder'),
        icon: 'fas fa-edit'
      },
      content: content,
      ok: {
        label: game.i18n.localize('DONT-FORGET.save'),
        callback: (event, button, dialog) => {
          const reminderText = button.form.elements.reminderText.value.trim();
          const reminderOwner = button.form.elements.reminderOwner?.value;

          return {
            reminderText: reminderText,
            reminderOwner: reminderOwner
          };
        }
      },
      modal: true,
      rejectClose: false,
      classes: [DontForget.ID, 'edit-reminder-dialog']
    });

    if (result && result.reminderText) {
      const updateData = {
        label: result.reminderText
      };

      if (game.user.isGM && result.reminderOwner && result.reminderOwner !== reminder.userId) {
        const newOwnerId = result.reminderOwner;
        await ReminderManager.deleteReminder(reminderId, reminder.userId);
        const newReminderData = {
          label: result.reminderText,
          isDone: reminder.isDone
        };
        await ReminderManager.createReminder(newOwnerId, newReminderData);
      } else {
        await ReminderManager.updateReminder(reminderId, updateData);
      }

      ui.notifications.info('Reminder updated successfully!');
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
      modal: true
    });

    if (confirmed) {
      for (const reminder of completedReminders) {
        await ReminderManager.deleteReminder(reminder.id, reminder.userId);
      }
      this.render();
    }
  }
}
