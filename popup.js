// Compat shim: `browser` doesn't exist in Chrome - see background.js for
// the full explanation. Same fix, same reasoning, applied here since the
// popup is its own separate script context.
const api = typeof browser !== 'undefined' ? browser : chrome;

// Same storage.local promise-signature mismatch as background.js (see the
// comment there) - popup.js is its own script context so it needs its own
// copy of the wrapper rather than sharing the one in background.js.
const IS_FIREFOX_NATIVE = typeof browser !== 'undefined';

function storageGet(keys) {
    if (IS_FIREFOX_NATIVE) {
        return browser.storage.local.get(keys);
    }
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
    });
}

function storageSet(items) {
    if (IS_FIREFOX_NATIVE) {
        return browser.storage.local.set(items);
    }
    return new Promise((resolve) => {
        chrome.storage.local.set(items, resolve);
    });
}

const DEFAULT_SETTINGS = { hook: true, recovery: true, fullList: false, podcast: false, canvas: false, debug: true };
const ALL_URLS = { origins: ['<all_urls>'] };

function permContains(p) {
    if (IS_FIREFOX_NATIVE) {
        return browser.permissions.contains(p).catch(() => false);
    }
    return new Promise((resolve) => chrome.permissions.contains(p, (ok) => resolve(Boolean(ok))));
}

// Must be CALLED synchronously from the click handler (user gesture rule), so
// callers invoke this before any await.
function permRequest(p) {
    if (IS_FIREFOX_NATIVE) {
        return browser.permissions.request(p).catch(() => false);
    }
    return new Promise((resolve) => chrome.permissions.request(p, (ok) => resolve(Boolean(ok))));
}

function permRemove(p) {
    if (IS_FIREFOX_NATIVE) {
        return browser.permissions.remove(p).catch(() => false);
    }
    return new Promise((resolve) => chrome.permissions.remove(p, (ok) => resolve(Boolean(ok))));
}

async function loadSettings() {
    const { settings } = await storageGet(['settings']);
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
}

function ago(ts) {
    if (!ts) {
        return 'never';
    }
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 2) {
        return 'just now';
    }
    if (m < 120) {
        return m + ' min ago';
    }
    if (m < 60 * 48) {
        return Math.round(m / 60) + ' h ago';
    }
    return Math.round(m / 1440) + ' d ago';
}

async function renderSettings() {
    const s = await loadSettings();
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        document.getElementById(key).checked = Boolean(s[key]);
    }
    document.getElementById('recovery').disabled = !s.hook;

    const wantsList = s.fullList || s.podcast;
    const status = document.getElementById('listStatus');
    const update = document.getElementById('updateNow');
    update.hidden = !wantsList;
    status.className = 'status';
    if (!wantsList) {
        status.textContent = '';
        return;
    }
    const granted = await permContains(ALL_URLS);
    const { hostsMeta } = await storageGet(['hostsMeta']);
    if (!granted) {
        status.className = 'status warn';
        status.textContent = 'Waiting for the extra permission. Tick the box again to be asked.';
        return;
    }
    const meta = hostsMeta || {};
    let text = (meta.count || 0) + ' hosts (' + (meta.source || 'bundled') + ', updated ' + ago(meta.fetchedAt) + ')';
    if (meta.error) {
        status.className = 'status warn';
        text += '. Last update failed: ' + meta.error;
    }
    status.textContent = text;
}

async function onToggle(key, checked) {
    const s = await loadSettings();
    s[key] = checked;
    await storageSet({ settings: s });
    await renderSettings();
}

// Checkboxes that need <all_urls>: the request is started first, in the
// click's own tick. Settings are stored right away as well, because Firefox
// can close the popup while its permission prompt is open; the background
// script reacts to the settings and to the permission by itself.
async function onToggleNeedingPermission(key, box) {
    const checked = box.checked;
    let granted = true;
    if (checked) {
        const asked = permRequest(ALL_URLS);
        const stored = onToggle(key, true);
        granted = await asked;
        await stored;
        if (!granted) {
            await onToggle(key, false);
        }
        return;
    }
    await onToggle(key, false);
    // Least privilege: drop the permission once nothing needs it.
    const s = await loadSettings();
    if (!s.fullList && !s.podcast) {
        await permRemove(ALL_URLS);
        await renderSettings();
    }
}

for (const key of ['hook', 'recovery', 'canvas', 'debug']) {
    document.getElementById(key).addEventListener('change', (e) => onToggle(key, e.target.checked));
}
for (const key of ['fullList', 'podcast']) {
    document.getElementById(key).addEventListener('change', (e) => onToggleNeedingPermission(key, e.target));
}

document.getElementById('updateNow').addEventListener('click', async () => {
    const status = document.getElementById('listStatus');
    status.className = 'status';
    status.textContent = 'Updating...';
    try {
        await api.runtime.sendMessage({ type: 'refreshHostLists' });
    } catch (e) { /* background restarting */ }
    await renderSettings();
});

async function refresh() {
    const { blockedAdCount = 0, blockedOtherCount = 0 } = await storageGet(['blockedAdCount', 'blockedOtherCount']);
    document.getElementById('adCount').textContent = blockedAdCount;
    document.getElementById('otherCount').textContent = blockedOtherCount;
}

document.getElementById('reset').addEventListener('click', async () => {
    // Tell the background script directly, in addition to writing storage.
    // See background.js for why this is a message rather than relying on
    // storage.onChanged.
    await api.runtime.sendMessage({ type: 'resetBlockedCount' });
    await storageSet({ blockedAdCount: 0, blockedOtherCount: 0 });
    refresh();
});

refresh();
renderSettings();
