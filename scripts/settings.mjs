import { MODULE, reminderApp } from './constants.mjs';

/**
 * Register the module's settings
 * @returns {void}
 */
export function registerSettings() {
  game.settings.register(MODULE.ID, MODULE.SETTINGS.INJECT_BUTTON, {
    name: 'DONTFORGET.Settings.InjectButton.Name',
    hint: 'DONTFORGET.Settings.InjectButton.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ui.players.render()
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.DUE_DATES, {
    name: 'DONTFORGET.Settings.DueDates.Name',
    hint: 'DONTFORGET.Settings.DueDates.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => reminderApp()?.render()
  });
}
