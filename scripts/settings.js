import { Reminder } from './dont-forget.js';

export function registerSettings() {
  game.settings.register(Reminder.ID, Reminder.SETTINGS.INJECT_BUTTON, {
    name: `DONT-FORGET.settings.${Reminder.SETTINGS.INJECT_BUTTON}.Name`,
    default: true,
    type: Boolean,
    scope: 'client',
    config: true,
    hint: `DONT-FORGET.settings.${Reminder.SETTINGS.INJECT_BUTTON}.Hint`,
    onChange: () => ui.players.render(),
  });
}
