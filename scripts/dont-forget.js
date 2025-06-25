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
 * Add reminder icons to the player list whenever it renders
 */
Hooks.on('renderPlayerList', (app, html, data) => {
  if (!game.settings.get(DontForget.ID, DontForget.SETTINGS.INJECT_BUTTON)) {
    return;
  }

  // Add icons to each player item
  const playerItems = html.find('li.player');

  playerItems.each((index, playerItem) => {
    const $playerItem = $(playerItem);

    // Skip if already has icon
    if ($playerItem.find(`.${DontForget.ID}-player-icon`).length > 0) return;

    const userId = $playerItem.data('user-id');

    // Only show for current user or for all users if GM
    if (userId === game.user.id || game.user.isGM) {
      const $playerName = $playerItem.find('.player-name');

      // Create reminder icon
      const $reminderIcon = $(`
        <i class="${DontForget.ID}-player-icon fas fa-sticky-note"
           data-tooltip="${game.i18n.localize('DONT-FORGET.button-title')}"
           data-tooltip-direction="RIGHT">
        </i>
      `);

      // Add click handler
      $reminderIcon.on('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        DontForget.reminderApp.render(true, { userId });
      });

      // Insert after player name
      if ($playerName.length) {
        $playerName.after($reminderIcon);
      }
    }
  });
});

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

// DELETE THE ENTIRE CreateReminderDialog CLASS - IT'S NO LONGER NEEDED

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
      width: 700
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
        creatorName: user ? user.name : 'Unknown User',
        timeDisplay: reminder.createdAt ? foundry.utils.timeSince(reminder.createdAt) : '',
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
   * Create a new reminder - opens dialog (Alternative approach with debugging)
   */
  static async createReminder() {
    // Build user options for select dropdown
    let userOptions = '';
    if (game.user.isGM) {
      for (const user of game.users) {
        const selected = user.id === game.user.id ? 'selected' : '';
        userOptions += `<option value="${user.id}" ${selected}>${user.name}</option>`;
      }
    }

    const content = `
    <form id="create-reminder-form">
      <div class="form-group">
        <label for="reminder-text">${game.i18n.localize('DONT-FORGET.reminder-text')}</label>
        <input type="text" id="reminder-text" name="reminderText" value="${game.i18n.localize('DONT-FORGET.new-reminder-text')}" autofocus />
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

    console.log('Dialog content HTML:', content);

    const result = await foundry.applications.api.DialogV2.prompt({
      window: {
        title: game.i18n.localize('DONT-FORGET.create-reminder-title'),
        icon: 'fas fa-plus'
      },
      content: content,
      ok: {
        label: game.i18n.localize('DONT-FORGET.create'),
        callback: (event, button, dialog) => {
          console.log('Button form:', button.form);
          console.log('Form elements:', button.form.elements);

          // Access form data through button.form.elements
          const reminderText = button.form.elements.reminderText.value;
          const reminderOwner = button.form.elements.reminderOwner?.value;

          console.log('Reminder text:', reminderText);
          console.log('Reminder owner:', reminderOwner);

          // Return the form data object
          return {
            reminderText: reminderText,
            reminderOwner: reminderOwner
          };
        }
      },
      modal: true,
      rejectClose: false
    });

    console.log('Dialog result:', result);

    // If we got valid form data back
    if (result) {
      const reminderData = {
        label: result.reminderText || game.i18n.localize('DONT-FORGET.new-reminder-text')
      };

      console.log('Processed reminder data:', reminderData);

      const ownerId = game.user.isGM && result.reminderOwner ? result.reminderOwner : game.user.id;
      console.log('Owner ID:', ownerId);

      try {
        await ReminderManager.createReminder(ownerId, reminderData);

        // Force re-render the app
        this.render(true);

        ui.notifications.info(`${game.i18n.localize('DONT-FORGET.reminder-created')}`);
      } catch (error) {
        console.error('Error creating reminder:', error);
        ui.notifications.error(`${game.i18n.localize('DONT-FORGET.error-creating-reminder')}`);
      }
    } else {
      console.log('No result returned from dialog');
    }
  }

  /**
   * Delete a reminder
   */
  static async deleteReminder(event, target) {
    const reminderElement = target.closest('[data-reminder-id]');
    if (!reminderElement) return;

    const reminderId = reminderElement.dataset.reminderId;
    const userId = reminderElement.dataset.userId;

    if (!reminderId || !userId) return;

    const confirmed = await DialogV2.confirm({
      window: {
        title: game.i18n.localize('DONT-FORGET.confirms.deleteConfirm.Title')
      },
      content: game.i18n.localize('DONT-FORGET.confirms.deleteConfirm.Content'),
      modal: false
    });

    if (confirmed) {
      await ReminderManager.deleteReminder(reminderId, userId);
      this.render();
    }
  }

  /**
   * Edit a reminder
   */
  static editReminder(event, target) {
    const listItem = target.closest('tr');
    if (!listItem) return;

    const inputField = listItem.querySelector('.reminder-input');
    if (!inputField) return;

    // Toggle readonly state
    inputField.readOnly = !inputField.readOnly;

    // Focus the input if it's now editable
    if (!inputField.readOnly) {
      inputField.focus();
      inputField.select();
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
