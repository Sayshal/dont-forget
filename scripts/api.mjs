import { MODULE } from './constants.mjs';
import { ReminderManager } from './reminder-manager.mjs';

/**
 * Publish the reminder API on the module entry and on the global namespace other 3DS modules read.
 * @returns {void}
 */
export function exposeApi() {
  game.modules.get(MODULE.ID).api = ReminderManager;
  globalThis.DONTFORGET = { api: ReminderManager };
}
