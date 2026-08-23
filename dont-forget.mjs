import { exposeApi } from './scripts/api.mjs';
import { MODULE } from './scripts/constants.mjs';
import { registerDueDates } from './scripts/due-dates.mjs';
import { registerHooks, seedReminderCache } from './scripts/hooks.mjs';
import { registerSettings } from './scripts/settings.mjs';
import './styles/dont-forget.css';

Hooks.once('init', () => {
  const atlas = ATLAS.register(MODULE.ID, { title: MODULE.TITLE, github: 'Sayshal/dont-forget', events: [{ name: MODULE.NOTE_SYNC, gmAuthoritative: true }], theme: { scope: '.dont-forget' } });
  ATLAS.log(3, 'Initializing module');
  registerSettings();
  registerDueDates(atlas);
  registerHooks();
  exposeApi();
});

Hooks.once('ready', () => {
  seedReminderCache();
});
