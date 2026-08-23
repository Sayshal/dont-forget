/** @type {object} Module-wide identifiers, storage keys and hook names. */
export const MODULE = {
  ID: 'dont-forget',
  TITLE: "Don't Forget!",

  /** User-flag key the reminder records live under. */
  FLAGS: { REMINDERS: 'reminders' },

  TEMPLATES: {
    REMINDER_LIST: 'modules/dont-forget/templates/reminder-list.hbs',
    REMINDER_FORM: 'modules/dont-forget/templates/reminder-form.hbs'
  },

  SETTINGS: {
    INJECT_BUTTON: 'inject-button',
    DUE_DATES: 'due-dates'
  },

  HOOKS: {
    REMINDER_CREATED: 'dontForget.reminderCreated',
    REMINDER_COMPLETED: 'dontForget.reminderCompleted',
    REMINDER_DELETED: 'dontForget.reminderDeleted'
  },

  /** ATLAS relay event carrying a backing-note request for the active GM to execute. */
  NOTE_SYNC: 'dontForget.noteSync',

  /** Application id of the reminder list, used to reach the open window from outside it. */
  APP_ID: 'dont-forget-app'
};

/**
 * The reminder list window, when one is open.
 * @returns {foundry.applications.api.ApplicationV2|undefined} The rendered application, or undefined when closed
 */
export function reminderApp() {
  return foundry.applications.instances.get(MODULE.APP_ID);
}
