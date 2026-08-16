import { formatDueDate, isCalendariaActive, NOTE_SYNC, readDueDate, registerDueDates, requestNote, wireDueDate } from './due-dates.js';
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

  static HOOKS = {
    REMINDER_CREATED: 'dontForget.reminderCreated',
    REMINDER_COMPLETED: 'dontForget.reminderCompleted'
  };

  /** @type {object} ATLAS registration handle, used to relay backing-note requests to the GM */
  static atlas;

  /** @type {Map<string, object>} Last-seen reminders per user, used to classify flag changes */
  static #lastSeen = new Map();

  /**
   * Initialize the module
   */
  static initialize() {
    this.atlas = ATLAS.register('dont-forget', { title: this.TITLE, github: 'Sayshal/dont-forget', events: [{ name: NOTE_SYNC, gmAuthoritative: true }] });
    ATLAS.log(3, 'Initializing module');
    registerSettings();
    registerDueDates();
    this.reminderApp = new ReminderApp();
    game.modules.get(this.ID).api = ReminderManager;
    globalThis.DONTFORGET = { api: ReminderManager };
  }

  /**
   * Record the current reminder state for every user without firing hooks
   */
  static seedReminderCache() {
    game.users.forEach((user) => this.#lastSeen.set(user.id, foundry.utils.deepClone(ReminderManager.getUserReminders(user.id))));
  }

  /**
   * Fire reminder hooks for whatever changed in a user's reminder flags
   * @param {object} user - The updated user document
   * @param {boolean} remote - Whether another client authored the change
   */
  static syncReminders(user, remote) {
    const previous = this.#lastSeen.get(user.id) ?? {};
    const current = ReminderManager.getUserReminders(user.id);
    this.#lastSeen.set(user.id, foundry.utils.deepClone(current));

    for (const reminder of Object.values(current)) {
      const before = previous[reminder.id];
      if (!before) Hooks.callAll(this.HOOKS.REMINDER_CREATED, reminder, { remote });
      else if (reminder.isDone && !before.isDone) Hooks.callAll(this.HOOKS.REMINDER_COMPLETED, reminder, { remote });
    }
  }
}

/**
 * Hook initialization
 */
Hooks.once('init', () => {
  DontForget.initialize();
});

Hooks.once('ready', () => {
  DontForget.seedReminderCache();
});

/**
 * Fire reminder hooks and refresh the open app whenever reminder flags change on any client
 */
Hooks.on('updateUser', (user, changes, _options, userId) => {
  if (!changes.flags?.[DontForget.ID]) return;

  DontForget.syncReminders(user, userId !== game.user.id);
  if (DontForget.reminderApp?.rendered) DontForget.reminderApp.render();
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
      reminderButton.setAttribute('data-tooltip', _loc('DONT-FORGET.button-title'));
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
   * @param {string} userId - The user ID whose reminders to view
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
   * @param {object} context - Application context
   * @param {object} options - Additional application options
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
   * @param {Event} event - Event triggering the checkbox change
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
   * @returns {object} Application context
   */
  _prepareContext() {
    const rawReminders = ReminderManager.getReminders(this.viewingUserId);

    // Process and enhance reminder data
    const processedReminders = Object.values(rawReminders).map((reminder) => {
      const user = game.users.get(reminder.userId);

      return {
        ...reminder,
        creatorName: user ? user.name : '',
        createdTime: reminder.createdAt ? foundry.utils.timeSince(reminder.createdAt) : '',
        completed: reminder.isDone,
        dueText: formatDueDate(reminder.dueDate),
        isDue: reminder.isDue && !reminder.isDone
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
      showDueDate: isCalendariaActive(),
      hasReminders: sortedReminders.length > 0
    };
  }

  /**
   * Create a new reminder for the currently viewed user
   * @param {Event} event - Event triggering the reminder creation dialog
   * @param {HTMLElement} target - The clicked button
   */
  static async createReminder(event, target) {
    const app = DontForget.reminderApp;
    const targetUserId = app.viewingUserId;
    await ReminderApp.createReminderForUser(event, target, targetUserId);
  }

  /**
   * Create a new reminder for a specific user
   * @param {Event} _event - Event triggering the reminder creation dialog
   * @param {HTMLElement} _target - The clicked button
   * @param {string} targetUserId - The user the reminder is created for
   */
  static async createReminderForUser(_event, _target, targetUserId) {
    const placeholderText = _loc('DONT-FORGET.reminder-placeholder');
    const targetUser = game.users.get(targetUserId);

    // Prepare template data
    const templateData = {
      isGM: game.user.isGM,
      placeholderText: placeholderText,
      showDueDate: isCalendariaActive(),
      dueDateLabel: _loc('DONT-FORGET.due-date.pick'),
      labels: {
        reminderText: _loc('DONT-FORGET.reminder-text'),
        reminderOwner: _loc('DONT-FORGET.reminder-owner'),
        dueDate: _loc('DONT-FORGET.due-date.label'),
        clearDueDate: _loc('DONT-FORGET.due-date.clear')
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
        title: `${_loc('DONT-FORGET.create-reminder-title')}${targetUser ? ` for ${targetUser.name}` : ''}`,
        icon: 'fas fa-plus'
      },
      content: content,
      ok: {
        label: _loc('DONT-FORGET.create'),
        callback: (_event, button, _dialog) => {
          const reminderText = button.form.elements.reminderText.value.trim();
          const reminderOwner = button.form.elements.reminderOwner?.value;

          return {
            reminderText: reminderText || placeholderText,
            reminderOwner: reminderOwner,
            dueDate: readDueDate(button.form)
          };
        }
      },
      render: (_event, dialog) => wireDueDate(dialog.element),
      rejectClose: false,
      classes: [DontForget.ID, 'create-reminder-dialog']
    });

    if (result && result.reminderText) {
      const reminderData = {
        label: result.reminderText,
        dueDate: result.dueDate
      };

      const ownerId = game.user.isGM && result.reminderOwner ? result.reminderOwner : targetUserId;

      const reminder = await ReminderManager.createReminder(ownerId, reminderData);
      if (reminder?.dueDate) requestNote({ action: 'create', reminderId: reminder.id, userId: ownerId, label: reminder.label, dueDate: reminder.dueDate });
      ui.notifications.info('DONT-FORGET.reminder-created');

      // Get the app instance and render it
      if (DontForget.reminderApp && DontForget.reminderApp.rendered) {
        DontForget.reminderApp.render();
      }
    }
  }

  /**
   * Delete a reminder
   * @param {Event} _event - Event triggering the delete dialog
   * @param {HTMLElement} target - The clicked button
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
        title: _loc('DONT-FORGET.confirms.deleteConfirm.Title')
      },
      content: _loc('DONT-FORGET.confirms.deleteConfirm.Content'),
      modal: true
    });

    if (confirmed) {
      await ReminderManager.deleteReminder(reminderId, reminder.userId);
      if (reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
      this.render();
    }
  }

  /**
   * Edit an existing reminder using DialogV2
   * @param {Event} _event - Event triggering the edit dialog
   * @param {HTMLElement} target - The clicked button
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
      showDueDate: isCalendariaActive(),
      initialDueDate: reminder.dueDate ? JSON.stringify(reminder.dueDate) : '',
      dueDateLabel: formatDueDate(reminder.dueDate) || _loc('DONT-FORGET.due-date.pick'),
      labels: {
        reminderText: _loc('DONT-FORGET.reminder-text'),
        reminderOwner: _loc('DONT-FORGET.reminder-owner'),
        dueDate: _loc('DONT-FORGET.due-date.label'),
        clearDueDate: _loc('DONT-FORGET.due-date.clear')
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
        title: _loc('DONT-FORGET.edit-reminder'),
        icon: 'fas fa-edit'
      },
      content: content,
      ok: {
        label: _loc('DONT-FORGET.save'),
        callback: (_event, button, _dialog) => {
          const reminderText = button.form.elements.reminderText.value.trim();
          const reminderOwner = button.form.elements.reminderOwner?.value;

          return {
            reminderText: reminderText,
            reminderOwner: reminderOwner,
            dueDate: readDueDate(button.form)
          };
        }
      },
      render: (_event, dialog) => wireDueDate(dialog.element),
      rejectClose: false,
      classes: [DontForget.ID, 'edit-reminder-dialog']
    });

    if (result && result.reminderText) {
      const dueDate = result.dueDate;
      const dateChanged = JSON.stringify(dueDate) !== JSON.stringify(reminder.dueDate ?? null);

      if (game.user.isGM && result.reminderOwner && result.reminderOwner !== reminder.userId) {
        // The backing note delivers to the old owner, so it is replaced rather than carried over
        const newOwnerId = result.reminderOwner;
        await ReminderManager.deleteReminder(reminderId, reminder.userId);
        if (reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
        const newReminderData = {
          label: result.reminderText,
          isDone: reminder.isDone,
          dueDate
        };
        const created = await ReminderManager.createReminder(newOwnerId, newReminderData);
        if (created?.dueDate) requestNote({ action: 'create', reminderId: created.id, userId: newOwnerId, label: created.label, dueDate });
      } else {
        const updateData = { label: result.reminderText, dueDate };
        if (dateChanged) updateData.isDue = false;
        if (!dueDate) updateData.noteId = null;
        await ReminderManager.updateReminder(reminderId, updateData);

        if (!dueDate && reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
        else if (dueDate && reminder.noteId) requestNote({ action: 'update', noteId: reminder.noteId, label: result.reminderText, dueDate });
        else if (dueDate) requestNote({ action: 'create', reminderId, userId: reminder.userId, label: result.reminderText, dueDate });
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
      ui.notifications.info('DONT-FORGET.no-completed-reminders');
      return;
    }

    const confirmed = await DialogV2.confirm({
      window: {
        title: _loc('DONT-FORGET.confirms.deleteCompletedConfirm.Title')
      },
      content: _loc('DONT-FORGET.confirms.deleteCompletedConfirm.Content'),
      modal: true
    });

    if (confirmed) {
      for (const reminder of completedReminders) {
        await ReminderManager.deleteReminder(reminder.id, reminder.userId);
        if (reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
      }
      this.render();
    }
  }
}
