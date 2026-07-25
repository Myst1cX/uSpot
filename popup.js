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
