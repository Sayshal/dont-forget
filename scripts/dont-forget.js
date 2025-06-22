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

    // Register Handlebars helpers
    this.registerHandlebarsHelpers();

    // Create reminder app instance
    this.reminderApp = new ReminderApp();
  }

  /**
   * Register Handlebars helpers for use in templates
   */
  static registerHandlebarsHelpers() {
    Handlebars.registerHelper('getUserName', function (userId) {
      const user = game.users.get(userId);
      return user ? user.name : 'Unknown User';
    });

    Handlebars.registerHelper('isGM', function () {
      return game.user.isGM;
    });
  }
}

/**
 * Hook initialization
 */
Hooks.once('init', () => {
  DontForget.initialize();
});

/**
 * Add reminder icons to the player list
 */
Hooks.once('ready', () => {
  if (!game.settings.get(DontForget.ID, DontForget.SETTINGS.INJECT_BUTTON)) {
    return;
  }

  // Function to add icons that can be called initially and when player list updates
  const addReminderIcons = () => {
    const playerItems = document.querySelectorAll('aside#players li.player');

    playerItems.forEach((playerItem) => {
      // Skip if already has icon
      if (playerItem.querySelector(`.${DontForget.ID}-player-icon`)) return;

      const userId = playerItem.dataset.userId;

      // Only show for current user or for all users if GM
      if (userId === game.user.id || game.user.isGM) {
        const playerName = playerItem.querySelector('.player-name');

        // Create reminder icon
        const reminderIcon = document.createElement('i');
        reminderIcon.classList.add(`${DontForget.ID}-player-icon`, 'fas', 'fa-sticky-note');
        reminderIcon.setAttribute('data-tooltip', game.i18n.localize('DONT-FORGET.button-title'));
        reminderIcon.setAttribute('data-tooltip-direction', 'RIGHT');

        // Add click handler
        reminderIcon.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          DontForget.reminderApp.render(true, { userId });
        });

        // Insert after player name
        if (playerName) {
          playerName.after(reminderIcon);
        }
      }
    });
  };

  // Add icons initially
  addReminderIcons();

  // Watch for changes in the player list
  const observer = new MutationObserver(addReminderIcons);
  const playerList = document.querySelector('aside#players ol#player-list');

  if (playerList) {
    observer.observe(playerList, { childList: true, subtree: true });
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
      width: 550
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
    const reminders = ReminderManager.getReminders(game.user.id);

    // Sort reminders: completed at bottom, then by user
    const sortedReminders = Object.values(reminders).sort((a, b) => {
      // First sort by completion status
      if (a.isDone !== b.isDone) {
        return a.isDone ? 1 : -1;
      }

      // If completion status is the same, sort by user (for GM view)
      if (game.user.isGM && a.userId !== b.userId) {
        const userA = game.users.get(a.userId)?.name || '';
        const userB = game.users.get(b.userId)?.name || '';
        return userA.localeCompare(userB);
      }

      // Default to sorting by ID to ensure stable order
      return a.id.localeCompare(b.id);
    });

    return {
      reminders: sortedReminders,
      isGM: game.user.isGM
    };
  }

  /**
   * Handle form submission
   */
  static async formHandler(event, form, formData) {
    if (!formData.object) return;

    for (const [id, data] of Object.entries(formData.object)) {
      await ReminderManager.updateReminder(id, data);
    }
  }

  /**
   * Create a new reminder
   */
  static async createReminder() {
    const label = game.i18n.localize('DONT-FORGET.new-reminder-text');
    await ReminderManager.createReminder(game.user.id, { label });
    this.render();
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
    const listItem = target.closest('.reminder-item');
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
