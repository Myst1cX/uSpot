// uSpot - relay between the page hook (hook.js, MAIN world) and the extension.
//
// Runs in the normal isolated content-script world at document_start.
//  - page -> extension: ad audio file IDs and log lines posted by hook.js
//    (window.postMessage {__uspot:1, ...}) are forwarded to background.js.
//  - extension -> page: the popup switches (stored in storage.local "settings")
//    are posted to the hook as {__uspotCfg:1, rewriteOff, recoveryOff}.
//
// The page can post messages too, so nothing coming from it is trusted:
// only same-window messages with the marker are read, IDs are re-validated
// here and again in background.js, and log text is length-capped.
(function () {
    'use strict';

    const api = typeof browser !== 'undefined' ? browser : chrome;
    const ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;
    const DEFAULTS = { hook: true, recovery: true, debug: true };
    let debug = DEFAULTS.debug;

    function sendConfig(s) {
        s = Object.assign({}, DEFAULTS, s || {});
        debug = Boolean(s.debug);
        window.postMessage(
            { __uspotCfg: 1, rewriteOff: !s.hook, recoveryOff: !s.recovery },
            window.location.origin
        );
    }

    function loadConfig() {
        try {
            const done = (r) => sendConfig(r && r.settings);
            if (typeof browser !== 'undefined') {
                browser.storage.local.get('settings').then(done, () => sendConfig(null));
            } else {
                chrome.storage.local.get('settings', done);
            }
        } catch (e) {
            sendConfig(null);
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) {
            return;
        }
        const d = event.data;
        if (!d || d.__uspot !== 1) {
            return;
        }
        if (d.kind === 'ids' && Array.isArray(d.ids)) {
            const ids = d.ids.filter((x) => typeof x === 'string' && ID_RE.test(x)).slice(0, 32);
            try {
                api.runtime.sendMessage({ type: 'uspotAdIds', ids });
            } catch (e) { /* extension reloaded: stale content script */ }
        } else if (d.kind === 'log' && debug) {
            const level = d.level === 'w' ? 'warn' : 'log';
            console[level]('[uSpot hook]', String(d.msg).slice(0, 500));
        }
    });

    // Settings changed in the popup while the page is open.
    try {
        api.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.settings) {
                sendConfig(changes.settings.newValue);
            }
        });
    } catch (e) { /* ignore */ }

    loadConfig();
})();
