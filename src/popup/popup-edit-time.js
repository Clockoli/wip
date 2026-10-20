import { mountAddTime } from '../ui/add-time.js';

// The popup has no Add time action; it mounts the same form for entry edits.
const anchor = document.createElement('button');
anchor.type = 'button';
anchor.hidden = true;
document.body.append(anchor);
const dialog = mountAddTime(anchor, { send: () => { throw new Error('Add time is available in Activity.'); } });
globalThis.ClockoliTimeEntryForm = dialog;
