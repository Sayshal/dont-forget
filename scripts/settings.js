import { DontForget } from './dont-forget.js';

/**
 * Register module settings
 */
export function registerSettings() {
  game.settings.register(DontForget.ID, DontForget.SETTINGS.INJECT_BUTTON, {
    name: `DONT-FORGET.settings.${DontForget.SETTINGS.INJECT_BUTTON}.Name`,
    hint: `DONT-FORGET.settings.${DontForget.SETTINGS.INJECT_BUTTON}.Hint`,
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ui.players.render()
  });
}
