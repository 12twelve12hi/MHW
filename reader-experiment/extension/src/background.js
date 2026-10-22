// The background service worker (Chrome) or non-persistent background page (Safari). Listeners are registered at the
// top level so the browser can wake the worker for them.

import { api } from './api.js';
import { TARGET } from './target.js';
import { createApp } from './core.js';

const app = createApp({ api, target: TARGET });
globalThis.sendToDaylight = app; // handy from the devtools console, and used by the end-to-end test

api.runtime.onInstalled.addListener(() => { app.start(); });
api.runtime.onStartup?.addListener(() => { app.start(); });
api.runtime.onMessage.addListener(app.handleMessage);
(api.contextMenus ?? api.menus)?.onClicked?.addListener((info, tab) => { app.onMenu(info, tab); });
api.commands?.onCommand?.addListener((command, tab) => { app.onCommand(command, tab); });
api.alarms?.onAlarm?.addListener((alarm) => { app.onAlarm(alarm); });
api.permissions?.onAdded?.addListener((perms) => { app.onPermissionsAdded(perms); });

// Every wake-up: make sure the 15-minute alarm exists (browsers may drop alarms on restart), and that the Lab switch
// has its default (on, LAB-PLAN 1.2; a stored value stays). Safari's background page is not told about installs
// reliably on iOS, so it also sets up its menus and asks the app for a pairing here.
app.ensureAlarms();
app.lab.ensureDefault().catch(() => {});
if (TARGET === 'safari') { app.setupMenus(); app.pairFromApp(); }
