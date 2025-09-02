import { ReminderManager } from './reminder-manager.js';
import { registerSettings } from './settings.js';

const { renderTemplate } = foundry.applications.handlebars;

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
    REMINDER_LIST: `modules/${this.ID}/templates/reminder-list.hbs`,
    CREATE_REMINDER_FORM: `modules/${this.ID}/templates/create-reminder.hbs`
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
 * Add reminder button to the player list
 */
Hooks.on('renderPlayers', (_app, html, _data) => {
  if (!game.settings.get(DontForget.ID, DontForget.SETTINGS.INJECT_BUTTON)) {
    return;
  }

  // Remove any existing reminder buttons
  const existingButtons = html.querySelectorAll(`.${DontForget.ID}-header-button`);
  existingButtons.forEach((button) => button.remove());

  // If GM, add buttons for all players. If not GM, only add for self
  const playersToProcess = game.user.isGM ? html.querySelectorAll('.player') : html.querySelectorAll('.player.self');

  playersToProcess.forEach((playerElement) => {
    const userId = playerElement.dataset.userId;
    const playerNameSpan = playerElement.querySelector('.player-name');

    if (playerNameSpan && userId) {
      // Create the reminder button element
      const reminderButton = document.createElement('i');
      reminderButton.className = `${DontForget.ID}-header-button fas fa-sticky-note`;
      reminderButton.setAttribute('data-tooltip', game.i18n.localize('DONT-FORGET.button-title'));
      reminderButton.setAttribute('data-tooltip-direction', 'LEFT');
      reminderButton.style.marginLeft = '8px';
      reminderButton.style.cursor = 'pointer';

      // Add left-click handler (open main window for this specific user)
      reminderButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        DontForget.reminderApp.setViewingUser(userId);
        DontForget.reminderApp.render(true);
      });

      // Add right-click handler (immediately open Add Reminder dialog for this user)
      reminderButton.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await ReminderApp.createReminderForUser(event, event.target, userId);
      });

      // Insert after the player name span
      playerNameSpan.insertAdjacentElement('afterend', reminderButton);
    }
  });
});

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Main application for managing reminders
 */
class ReminderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @inheritdoc */
  constructor(options = {}) {
    super(options);
    this.viewingUserId = game?.user?.id; // Default to current user
  }

  static DEFAULT_OPTIONS = {
    id: `${DontForget.ID}-app`,
    tag: 'div',
    actions: {
      create: ReminderApp.createReminder,
      delete: ReminderApp.deleteReminder,
      edit: ReminderApp.editReminder,
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

  /**
   * Set which user's reminders to view
   * @param userId ID of viewing user (game.user.id)
   */
  setViewingUser(userId) {
    this.viewingUserId = userId;
  }

  /** @inheritdoc */
  get title() {
    const viewingUser = game.users.get(this.viewingUserId);
    const viewingUserName = viewingUser ? viewingUser.name : 'Unknown User';

    if (game.user.isGM) {
      return `${DontForget.TITLE} - ${viewingUserName}${this.viewingUserId === game.user.id ? ' (You)' : ''}`;
    } else {
      return `${DontForget.TITLE} - ${game.user.name}`;
    }
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
   * @param context Application context.
   * @param options Additional application options.
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
   * @param event Event triggering checkbox change
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
   * @returns Application context
   */
  _prepareContext() {
    this.viewingUserId = game.user.id;
    const rawReminders = ReminderManager.getReminders(this.viewingUserId);

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
   * Create a new reminder for the currently viewed user
   * @param event Event triggering reminder creation dialog
   * @param target Target button class.
   */
  static async createReminder(event, target) {
    const app = DontForget.reminderApp;
    const targetUserId = app.viewingUserId;
    await ReminderApp.createReminderForUser(event, target, targetUserId);
  }

  /**
   * Create a new reminder for a specific user
   * @param _event Event triggering reminder creation dialog
   * @param _target Target button class.
   * @param targetUserId Intended user to create reminder for.
   */
  static async createReminderForUser(_event, _target, targetUserId) {
    const placeholderText = game.i18n.localize('DONT-FORGET.reminder-placeholder');
    const targetUser = game.users.get(targetUserId);

    // Prepare template data
    const templateData = {
      isGM: game.user.isGM,
      placeholderText: placeholderText,
      labels: {
        reminderText: game.i18n.localize('DONT-FORGET.reminder-text'),
        reminderOwner: game.i18n.localize('DONT-FORGET.reminder-owner')
      },
      users: []
    };

    // Add user options for GMs
    if (game.user.isGM) {
      templateData.users = game.users.contents.map((user) => ({
        id: user.id,
        name: user.name,
        selected: user.id === targetUserId
      }));
    }

    // Render the form template
    const content = await renderTemplate(DontForget.TEMPLATES.CREATE_REMINDER_FORM, templateData);

    const result = await DialogV2.prompt({
      window: {
        title: `${game.i18n.localize('DONT-FORGET.create-reminder-title')}${targetUser ? ` for ${targetUser.name}` : ''}`,
        icon: 'fas fa-plus'
      },
      content: content,
      ok: {
        label: game.i18n.localize('DONT-FORGET.create'),
        callback: (_event, button, _dialog) => {
          const reminderText = button.form.elements.reminderText.value.trim();
          const reminderOwner = button.form.elements.reminderOwner?.value;

          return {
            reminderText: reminderText || placeholderText,
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

      const ownerId = game.user.isGM && result.reminderOwner ? result.reminderOwner : targetUserId;

      await ReminderManager.createReminder(ownerId, reminderData);
      ui.notifications.info(game.i18n.localize('DONT-FORGET.reminder-created'));

      // Get the app instance and render it
      if (DontForget.reminderApp && DontForget.reminderApp.rendered) {
        DontForget.reminderApp.render();
      }
    }
  }

  /**
   * Delete a reminder
   * @param _event Event triggering delete dialog
   * @param target Target of dialog button
   */
  static async deleteReminder(_event, target) {
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
   * @param _event Event triggering event dialog
   * @param target Target of dialog button
   */
  static async editReminder(_event, target) {
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

    // Prepare template data
    const templateData = {
      isGM: game.user.isGM,
      editMode: true,
      initialText: reminder.label,
      labels: {
        reminderText: game.i18n.localize('DONT-FORGET.reminder-text'),
        reminderOwner: game.i18n.localize('DONT-FORGET.reminder-owner')
      },
      users: []
    };

    // Add user options for GMs
    if (game.user.isGM) {
      templateData.users = game.users.contents.map((user) => ({
        id: user.id,
        name: user.name,
        selected: user.id === reminder.userId
      }));
    }

    // Render the form template
    const content = await renderTemplate(DontForget.TEMPLATES.CREATE_REMINDER_FORM, templateData);

    const result = await DialogV2.prompt({
      window: {
        title: game.i18n.localize('DONT-FORGET.edit-reminder'),
        icon: 'fas fa-edit'
      },
      content: content,
      ok: {
        label: game.i18n.localize('DONT-FORGET.save'),
        callback: (_event, button, _dialog) => {
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
   * Delete all completed reminders for the currently viewed user
   */
  static async deleteCompletedReminders() {
    const app = DontForget.reminderApp;
    const reminders = ReminderManager.getReminders(app.viewingUserId);
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
