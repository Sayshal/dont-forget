import { MODULE } from '../constants.mjs';
import { dueDatesEnabled, formatDueDate, readDueDate, requestNote, wireDueDate } from '../due-dates.mjs';
import { ReminderManager } from '../reminder-manager.mjs';
import { buildRows, ownerOptions } from '../utils.mjs';

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * Build the context the shared reminder form renders from
 * @param {object} options - Form seed
 * @param {boolean} [options.editMode] - Whether the form edits an existing reminder
 * @param {string} [options.initialText] - Text to prefill
 * @param {object|null} [options.dueDate] - Due date to prefill
 * @param {string} [options.ownerId] - User to preselect as owner
 * @returns {object} Template context
 */
function formContext({ editMode = false, initialText = '', dueDate = null, ownerId } = {}) {
  return {
    editMode,
    initialText,
    showDueDate: dueDatesEnabled(),
    initialDueDate: dueDate ? JSON.stringify(dueDate) : '',
    dueDateLabel: formatDueDate(dueDate) || _loc('DONTFORGET.Due.Pick'),
    users: ownerOptions(ownerId)
  };
}

/**
 * Show the reminder form and return what was entered. Create and edit differ only in their chrome
 * @param {object} options - Dialog chrome
 * @param {string} options.title - Window title
 * @param {string} options.icon - Window icon
 * @param {string} options.submitLabel - Confirm button label
 * @param {string} options.dialogClass - Extra class scoping the dialog's styles
 * @param {object} options.context - Form context, as built by formContext
 * @returns {Promise<{label: string, ownerId: string|undefined, dueDate: object|null}|null>} The entry, or null when dismissed or left blank
 */
async function promptReminder({ title, icon, submitLabel, dialogClass, context }) {
  const result = await DialogV2.prompt({
    window: { title, icon },
    content: await renderTemplate(MODULE.TEMPLATES.REMINDER_FORM, context),
    ok: {
      label: submitLabel,
      callback: (_event, button) => ({
        label: button.form.elements.reminderText.value.trim(),
        ownerId: button.form.elements.reminderOwner?.value,
        dueDate: readDueDate(button.form)
      })
    },
    render: (_event, dialog) => wireDueDate(dialog.element),
    rejectClose: false,
    classes: [MODULE.ID, dialogClass]
  });

  return result?.label ? result : null;
}

/**
 * The reminder list: one window showing either a single user's reminders or, for a GM, everyone's.
 */
export class ReminderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @inheritdoc */
  constructor(options = {}) {
    super(options);
    this.viewingUserId = game?.user?.isGM ? null : game?.user?.id;
  }

  /** @type {string} Text filter applied to the rendered rows without re-rendering. */
  filter = '';

  /** @type {boolean} Whether completed reminders are hidden. */
  hideCompleted = false;

  static DEFAULT_OPTIONS = {
    id: MODULE.APP_ID,
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
    classes: [MODULE.ID]
  };

  static PARTS = { main: { template: MODULE.TEMPLATES.REMINDER_LIST } };

  /**
   * Set whose reminders the window shows
   * @param {string|null} userId - The user ID to view, or null for every user
   * @returns {void}
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
    if (!this.viewingUserId) return `${MODULE.TITLE} - ${_loc('DONTFORGET.Window.AllUsers')}`;
    return `${MODULE.TITLE} - ${game.users.get(this.viewingUserId)?.name ?? ''}`;
  }

  /**
   * The reminders the current view covers
   * @returns {Object<string, object>} Dictionary of reminders
   */
  get visibleReminders() {
    if (this.viewingUserId) return ReminderManager.getUserReminders(this.viewingUserId);
    if (game.user.isGM) return ReminderManager.getAllReminders();
    return ReminderManager.getUserReminders(game.user.id);
  }

  /** @inheritdoc */
  _prepareContext() {
    const rows = buildRows(this.visibleReminders);
    return {
      reminders: rows,
      hasReminders: rows.length > 0,
      isGM: game.user.isGM,
      showCreator: game.user.isGM && !this.viewingUserId,
      showDueDate: dueDatesEnabled(),
      hideCompleted: this.hideCompleted,
      filter: this.filter,
      viewingUserId: this.viewingUserId ?? '',
      users: ownerOptions(this.viewingUserId)
    };
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);

    this.element.querySelectorAll('.reminder-checkbox').forEach((checkbox) => checkbox.addEventListener('change', this.#onToggleDone.bind(this)));
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
   * @returns {Promise<void>}
   */
  async #onToggleDone(event) {
    const reminderId = event.target.closest('[data-reminder-id]')?.dataset.reminderId;
    if (reminderId) await ReminderManager.updateReminder(reminderId, { isDone: event.target.checked });
  }

  /**
   * Store the filter term and apply it to the rendered rows
   * @param {Event} event - The search input event
   * @returns {void}
   */
  #onFilter(event) {
    this.filter = event.target.value;
    this.#applyFilter();
  }

  /**
   * Hide rows that do not match the current filter term. Runs on the DOM so typing never re-renders
   * @returns {void}
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
   * @returns {Promise<void>}
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
   * Toggle whether completed reminders are listed
   * @returns {void}
   */
  static toggleCompleted() {
    this.hideCompleted = !this.hideCompleted;
    this.render();
  }

  /**
   * Swap a reminder's label for an input, committing on Enter or blur and cancelling on Escape
   * @param {Event} _event - Event triggering the inline edit
   * @param {HTMLElement} target - The clicked label
   * @returns {void}
   */
  static inlineEdit(_event, target) {
    const app = this;
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
   * Open the full create dialog, carrying over whatever is already typed in the quick-add field
   * @returns {Promise<void>}
   */
  static async createReminder() {
    const quickAdd = this.element.querySelector('input[name="quickAdd"]');
    const initialText = quickAdd?.value.trim() ?? '';
    if (quickAdd) quickAdd.value = '';

    await ReminderApp.promptCreate(this.viewingUserId || game.user.id, initialText);
    this.render();
  }

  /**
   * Create a reminder for a specific user through the full dialog
   * @param {string} targetUserId - The user the reminder is created for
   * @param {string} [initialText] - Text to prefill the reminder field with
   * @returns {Promise<void>}
   */
  static async promptCreate(targetUserId, initialText = '') {
    const targetUser = game.users.get(targetUserId);
    const entry = await promptReminder({
      title: targetUser ? _loc('DONTFORGET.Dialog.CreateFor', { name: targetUser.name }) : _loc('DONTFORGET.Dialog.CreateTitle'),
      icon: 'fas fa-plus',
      submitLabel: _loc('ATLAS.Common.Create'),
      dialogClass: 'create-reminder-dialog',
      context: formContext({ initialText, ownerId: targetUserId })
    });
    if (!entry) return;

    const ownerId = entry.ownerId || targetUserId;
    const reminder = await ReminderManager.createReminder(ownerId, { label: entry.label, dueDate: entry.dueDate });
    if (reminder?.dueDate) requestNote({ action: 'create', reminderId: reminder.id, userId: ownerId, label: reminder.label, dueDate: reminder.dueDate });

    if (reminder) ui.notifications.info('DONTFORGET.Reminder.Created');
  }

  /**
   * Delete a reminder after confirmation
   * @param {Event} _event - Event triggering the delete dialog
   * @param {HTMLElement} target - The clicked button
   * @returns {Promise<void>}
   */
  static async deleteReminder(_event, target) {
    const reminderId = target.closest('[data-reminder-id]')?.dataset.reminderId;
    const reminder = reminderId ? this.visibleReminders[reminderId] : null;
    if (!reminder) {
      ui.notifications.error('DONTFORGET.Reminder.NotFound');
      return;
    }

    const confirmed = await DialogV2.confirm({ classes: ['dont-forget'], window: { title: 'DONTFORGET.Confirm.DeleteTitle' }, content: _loc('DONTFORGET.Confirm.Delete'), modal: true });
    if (!confirmed) return;

    await ReminderManager.deleteReminder(reminderId, reminder.userId);
    if (reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
    this.render();
  }

  /**
   * Edit a reminder's text, due date and owner
   * @param {Event} _event - Event triggering the edit dialog
   * @param {HTMLElement} target - The clicked button
   * @returns {Promise<void>}
   */
  static async editReminder(_event, target) {
    const reminderId = target.closest('[data-reminder-id]')?.dataset.reminderId;
    const reminder = reminderId ? this.visibleReminders[reminderId] : null;
    if (!reminder) {
      ui.notifications.error('DONTFORGET.Reminder.NotFound');
      return;
    }

    const entry = await promptReminder({
      title: _loc('DONTFORGET.Dialog.EditTitle'),
      icon: 'fas fa-edit',
      submitLabel: _loc('ATLAS.Common.Apply'),
      dialogClass: 'edit-reminder-dialog',
      context: formContext({ editMode: true, initialText: reminder.label, dueDate: reminder.dueDate, ownerId: reminder.userId })
    });
    if (!entry) return;

    if (entry.ownerId && entry.ownerId !== reminder.userId) await ReminderApp.#transferReminder(reminder, entry);
    else await ReminderApp.#applyEdit(reminder, entry);

    ui.notifications.info('DONTFORGET.Reminder.Updated');
    this.render();
  }

  /**
   * Move a reminder to a different owner.
   * @param {object} reminder - The reminder being moved
   * @param {object} entry - The submitted form entry
   * @returns {Promise<void>}
   */
  static async #transferReminder(reminder, entry) {
    await ReminderManager.deleteReminder(reminder.id, reminder.userId);
    if (reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });

    const created = await ReminderManager.createReminder(entry.ownerId, { label: entry.label, isDone: reminder.isDone, dueDate: entry.dueDate });
    if (created?.dueDate) requestNote({ action: 'create', reminderId: created.id, userId: entry.ownerId, label: created.label, dueDate: entry.dueDate });
  }

  /**
   * Apply a text or due-date edit to a reminder the owner keeps
   * @param {object} reminder - The reminder being edited
   * @param {object} entry - The submitted form entry
   * @returns {Promise<void>}
   */
  static async #applyEdit(reminder, entry) {
    const { label, dueDate } = entry;
    const updateData = { label, dueDate };
    if (JSON.stringify(dueDate) !== JSON.stringify(reminder.dueDate ?? null)) updateData.isDue = false;
    if (!dueDate) updateData.noteId = null;
    await ReminderManager.updateReminder(reminder.id, updateData);

    if (!dueDate && reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
    else if (dueDate && reminder.noteId) requestNote({ action: 'update', noteId: reminder.noteId, label, dueDate });
    else if (dueDate) requestNote({ action: 'create', reminderId: reminder.id, userId: reminder.userId, label, dueDate });
  }

  /**
   * Delete every completed reminder in the current view after confirmation
   * @returns {Promise<void>}
   */
  static async deleteCompletedReminders() {
    const completed = Object.values(this.visibleReminders).filter((reminder) => reminder.isDone);
    if (!completed.length) {
      ui.notifications.info('DONTFORGET.Confirm.NoCompleted');
      return;
    }

    const confirmed = await DialogV2.confirm({ classes: ['dont-forget'], window: { title: 'DONTFORGET.Confirm.DeleteAllTitle' }, content: _loc('DONTFORGET.Confirm.DeleteAll'), modal: true });
    if (!confirmed) return;

    await ReminderManager.deleteReminders(completed);
    for (const reminder of completed) if (reminder.noteId) requestNote({ action: 'delete', noteId: reminder.noteId });
    this.render();
  }
}
