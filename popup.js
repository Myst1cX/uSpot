async function refresh() {
    const { blockedCount = 0 } = await browser.storage.local.get('blockedCount');
    document.getElementById('count').textContent = blockedCount;
}

document.getElementById('reset').addEventListener('click', async () => {
    // Tell the background script directly, in addition to writing storage.
    // See background.js for why this is a message rather than relying on
    // storage.onChanged.
    await browser.runtime.sendMessage({ type: 'resetBlockedCount' });
    await browser.storage.local.set({ blockedCount: 0 });
    refresh();
});

refresh();
