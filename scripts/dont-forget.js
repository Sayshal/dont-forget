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
  static FLAGS = { REMINDERS: 'reminders' };
  static TEMPLATES = { REMINDER_LIST: `modules/${this.ID}/templates/reminder-list.hbs`, CREATE_REMINDER_FORM: `modules/${this.ID}/templates/create-reminder.hbs` };
  static SETTINGS = { INJECT_BUTTON: 'inject-button' };
  static HOOKS = { REMINDER_CREATED: 'dontForget.reminderCreated', REMINDER_COMPLETED: 'dontForget.reminderCompleted', REMINDER_DELETED: 'dontForget.reminderDeleted' };
  static atlas;
  static #lastSeen = new Map();

  /** Initialize the module */
  static initialize() {
    this.atlas = ATLAS.register('dont-forget', {
      title: this.TITLE,
      github: 'Sayshal/dont-forget',
      events: [{ name: NOTE_SYNC, gmAuthoritative: true }],
      theme: { scope: '.dont-forget' }
    });
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
    const seeded = this.#lastSeen.has(user.id);
    const previous = this.#lastSeen.get(user.id) ?? {};
    const current = ReminderManager.getUserReminders(user.id);
    this.#lastSeen.set(user.id, foundry.utils.deepClone(current));

    // A user first seen after startup has no baseline, so record one rather than reporting its whole list as new
    if (!seeded) return;

    for (const reminder of Object.values(current)) {
      const before = previous[reminder.id];
      if (!before) Hooks.callAll(this.HOOKS.REMINDER_CREATED, reminder, { remote });
      else if (reminder.isDone && !before.isDone) Hooks.callAll(this.HOOKS.REMINDER_COMPLETED, reminder, { remote });
    }
    for (const reminder of Object.values(previous)) {
      if (!current[reminder.id]) Hooks.callAll(this.HOOKS.REMINDER_DELETED, reminder, { remote });
    }
  }
}

Hooks.once('init', () => {
  DontForget.initialize();
});

Hooks.once('ready', () => {
  DontForget.seedReminderCache();
});

Hooks.on('updateUser', (user, changes, _options, userId) => {
  if (!changes.flags?.[DontForget.ID]) return;
  DontForget.syncReminders(user, userId !== game.user.id);
  const app = DontForget.reminderApp;
  if (app?.rendered && !app.isTyping) app.render();
});

Hooks.on('renderPlayers', (_app, html, _data) => {
  if (!game.settings.get(DontForget.ID, DontForget.SETTINGS.INJECT_BUTTON)) return;
  const existingButtons = html.querySelectorAll(`.${DontForget.ID}-header-button`);
  existingButtons.forEach((button) => button.remove());
  const playersToProcess = game.user.isGM ? html.querySelectorAll('.player') : html.querySelectorAll('.player.self');
  playersToProcess.forEach((playerElement) => {
    const userId = playerElement.dataset.userId;
    const playerNameSpan = playerElement.querySelector('.player-name');
    if (playerNameSpan && userId) {
      const reminderButton = document.createElement('i');
      reminderButton.className = `${DontForget.ID}-header-button fas fa-sticky-note`;
      reminderButton.setAttribute('data-tooltip', _loc('DONT-FORGET.button-title'));
      reminderButton.setAttribute('data-tooltip-direction', 'LEFT');
      reminderButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        DontForget.reminderApp.setViewingUser(userId);
        DontForget.reminderApp.render(true);
      });
      reminderButton.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await ReminderApp.createReminderForUser(event, event.target, userId);
      });
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
    this.viewingUserId = game?.user?.isGM ? null : game?.user?.id;
  }

  /** @type {string} Text filter applied to the list without re-rendering */
  filter = '';

  /** @type {boolean} Whether completed reminders are hidden */
  hideCompleted = false;

  static DEFAULT_OPTIONS = {
    id: `${DontForget.ID}-app`,
    tag: 'div',
    actions: {
      create: ReminderApp.createReminder,
      delete: ReminderApp.deleteReminder,
      edit: ReminderApp.editReminder,
      'inline-edit': ReminderApp.inlineEdit,
      'toggle-completed': ReminderApp.toggleCompleted,
      'delete-completed': ReminderApp.deleteCompletedReminders
    },
    position: { height: 'auto', width: 460 },
    window: { icon: 'fas fa-sticky-note', resizable: true },
    classes: [DontForget.ID]
  };

  /**
   * Set which user's reminders to view
   * @param {string|null} userId - The user ID whose reminders to view, or null for every user
   */
  setViewingUser(userId) {
    this.viewingUserId = userId;
  }

  /**
   * Whether the user is mid-keystroke, in which case a remote change must not re-render under them
   * @returns {boolean} True while a text field inside the window holds focus
   */
  get isTyping() {
    const active = document.activeElement;
    if (!active || !this.element?.contains(active)) return false;
    return active.matches('input:not([type="checkbox"]), textarea');
  }

  /** @inheritdoc */
  get title() {
    if (!this.viewingUserId) return `${DontForget.TITLE} - ${_loc('DONT-FORGET.all-users')}`;
    return `${DontForget.TITLE} - ${game.users.get(this.viewingUserId)?.name ?? ''}`;
  }

  /**
   * The reminders visible in the current view
   * @returns {Object<string, object>} Dictionary of reminders
   */
  #visibleReminders() {
    if (this.viewingUserId) return ReminderManager.getUserReminders(this.viewingUserId);
    if (game.user.isGM) return ReminderManager.getAllReminders();
    return ReminderManager.getUserReminders(game.user.id);
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
    this.element.querySelectorAll('.reminder-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', this.#onCheckboxChange.bind(this));
    });
    this.element.querySelector('input[name="filter"]')?.addEventListener('input', this.#onFilter.bind(this));
    this.element.querySelector('input[name="quickAdd"]')?.addEventListener('keydown', this.#onQuickAdd.bind(this));
    this.element.querySelector('select[name="viewUser"]')?.addEventListener('change', (event) => {
      this.setViewingUser(event.target.value || null);
      this.render();
    });
    this.#applyFilter();
  }

  /**
   * Toggle a reminder's completion state
   * @param {Event} event - The checkbox change event
   */
  async #onCheckboxChange(event) {
    const reminderId = event.target.closest('[data-reminder-id]')?.dataset.reminderId;
    if (reminderId) await ReminderManager.updateReminder(reminderId, { isDone: event.target.checked });
  }

  /**
   * Store the filter term and apply it to the rendered rows
   * @param {Event} event - The search input event
   */
  #onFilter(event) {
    this.filter = event.target.value;
    this.#applyFilter();
  }

  /**
   * Hide rows that do not match the current filter term. Runs on the DOM so typing never re-renders
   */
  #applyFilter() {
    const term = this.filter.trim().toLowerCase();
    this.element.querySelectorAll('.reminder').forEach((row) => {
      row.hidden = !!term && !row.textContent.toLowerCase().includes(term);
    });
  }

  /**
   * Create a reminder from the quick-add field
   * @param {KeyboardEvent} event - The keydown event
   */
  async #onQuickAdd(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const label = event.target.value.trim();
    if (!label) return;
    event.target.value = '';
    await ReminderManager.createReminder(this.viewingUserId || game.user.id, { label });
    this.render();
  }

  /**
   * Prepare context data for rendering the template
   * @returns {object} Application context
   */
  _prepareContext() {
    const processedReminders = Object.values(this.#visibleReminders()).map((reminder) => {
      const user = game.users.get(reminder.userId);
      return {
        ...reminder,
        creatorName: user ? user.name : '',
        createdTime: reminder.createdAt ? foundry.utils.timeSince(reminder.createdAt) : '',
        dueText: formatDueDate(reminder.dueDate),
        isDue: reminder.isDue && !reminder.isDone
      };
    });

    const sortedReminders = processedReminders.sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
      if (game.user.isGM && a.userId !== b.userId) return a.creatorName.localeCompare(b.creatorName);
      if (a.createdAt && b.createdAt) return b.createdAt - a.createdAt;
      return a.id.localeCompare(b.id);
    });
    return {
      reminders: sortedReminders,
      isGM: game.user.isGM,
      showCreator: game.user.isGM && !this.viewingUserId,
      showDueDate: isCalendariaActive(),
      hasReminders: sortedReminders.length > 0,
      hideCompleted: this.hideCompleted,
      filter: this.filter,
      viewingUserId: this.viewingUserId ?? '',
      users: game.user.isGM ? game.users.contents.map((user) => ({ id: user.id, name: user.name, selected: user.id === this.viewingUserId })) : []
    };
  }

  /**
   * Toggle whether completed reminders are listed
   */
  static toggleCompleted() {
    const app = DontForget.reminderApp;
    app.hideCompleted = !app.hideCompleted;
    app.render();
  }

  /**
   * Swap a reminder's label for an input, committing on Enter or blur and cancelling on Escape
   * @param {Event} _event - Event triggering the inline edit
   * @param {HTMLElement} target - The clicked label
   */
  static inlineEdit(_event, target) {
    const app = DontForget.reminderApp;
    const reminderId = target.closest('[data-reminder-id]')?.dataset.reminderId;
    if (!reminderId) return;

    const original = target.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'reminder-label-input';
    input.value = original;

    let closed = false;
    const commit = async (save) => {
      if (closed) return;
      closed = true;

      const label = input.value.trim();
      if (save && label && label !== original) await ReminderManager.updateReminder(reminderId, { label });
      app.render();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commit(true);
      else if (event.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));

    target.replaceWith(input);
    input.focus();
    input.select();
  }

  /**
   * Create a new reminder for the currently viewed user
   * @param {Event} event - Event triggering the reminder creation dialog
   * @param {HTMLElement} target - The clicked button
   */
  static async createReminder(event, target) {
    const app = DontForget.reminderApp;
    const quickAdd = app.element.querySelector('input[name="quickAdd"]');
    const initialText = quickAdd?.value.trim() ?? '';
    if (quickAdd) quickAdd.value = '';

    await ReminderApp.createReminderForUser(event, target, app.viewingUserId || game.user.id, initialText);
  }

  /**
   * Create a new reminder for a specific user
   * @param {Event} _event - Event triggering the reminder creation dialog
   * @param {HTMLElement} _target - The clicked button
   * @param {string} targetUserId - The user the reminder is created for
   * @param {string} [initialText] - Text to seed the reminder field with
   */
  static async createReminderForUser(_event, _target, targetUserId, initialText = '') {
    const placeholderText = _loc('DONT-FORGET.reminder-placeholder');
    const targetUser = game.users.get(targetUserId);
    const templateData = {
      isGM: game.user.isGM,
      initialText,
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

    if (game.user.isGM) templateData.users = game.users.contents.map((user) => ({ id: user.id, name: user.name, selected: user.id === targetUserId }));
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
      if (DontForget.reminderApp && DontForget.reminderApp.rendered) DontForget.reminderApp.render();
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
      window: { title: 'DONT-FORGET.confirms.deleteConfirm.Title' },
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
    const completedReminders = Object.values(app.#visibleReminders()).filter((r) => r.isDone);

    if (completedReminders.length === 0) {
      ui.notifications.info('DONT-FORGET.no-completed-reminders');
      return;
    }

    const confirmed = await DialogV2.confirm({
      window: { title: 'DONT-FORGET.confirms.deleteCompletedConfirm.Title' },
      content: _loc('DONT-FORGET.confirms.deleteCompletedConfirm.Content'),
      modal: true
    });

    if (confirmed) {
      await ReminderManager.deleteReminders(completedReminders);
      for (const reminder of completedReminders) {
        if (reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
      }
      this.render();
    }
  }
}
