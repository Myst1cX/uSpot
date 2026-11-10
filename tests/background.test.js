// Run: node tests/background.test.js   (from the repo root)
// Loads lib/hosts.js + background.js in a vm with a fake `browser` and drives the registered webRequest listeners.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let passed = 0;
async function t(name, fn) { await fn(); passed += 1; console.log('ok  ' + name); }
const tick = () => new Promise((r) => setTimeout(r, 20));

function makeEnv(opts) {
    opts = opts || {};
    const store = Object.assign({}, opts.storage || {});
    const listeners = []; // { fn, filter, extra }
    const messageListeners = [];
    const storageChanged = [];
    const permEvents = { added: [], removed: [] };
    let hasAllUrls = Boolean(opts.hasAllUrls);
    const logs = [];
    const fetchLog = [];

    const browser = {
        runtime: {
            getURL: (p) => 'moz-extension://x/' + p,
            onMessage: { addListener: (f) => messageListeners.push(f) },
            sendMessage: () => Promise.resolve()
        },
        tabs: { sendMessage: () => Promise.resolve({}), update: () => {} },
        storage: {
            local: {
                get: async (keys) => { const o = {}; [].concat(keys).forEach((k) => { if (k in store) o[k] = store[k]; }); return o; },
                set: async (items) => {
                    const ch = {};
                    Object.keys(items).forEach((k) => { ch[k] = { newValue: items[k], oldValue: store[k] }; store[k] = items[k]; });
                    storageChanged.forEach((f) => f(ch, 'local'));
                }
            },
            onChanged: { addListener: (f) => storageChanged.push(f) }
        },
        webRequest: {
            onBeforeRequest: {
                addListener: (fn, filter, extra) => {
                    if (opts.rejectPatterns && filter.urls.length > 100 && filter.urls[0] !== '<all_urls>') { throw new Error('too many patterns'); }
                    listeners.push({ fn, filter, extra });
                },
                removeListener: (fn) => { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); }
            }
        },
        permissions: {
            contains: async () => hasAllUrls,
            onAdded: { addListener: (f) => permEvents.added.push(f) },
            onRemoved: { addListener: (f) => permEvents.removed.push(f) }
        },
        alarms: { create: () => {}, onAlarm: { addListener: () => {} } }
    };

    const remote = opts.remote || {};
    const ctx = {
        browser, console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
        URL, setTimeout, clearTimeout, AbortController, Promise, Set, Map, Array, Object, String, Number, Boolean, JSON, Date, Math, Error, RegExp,
        fetch: async (url) => {
            fetchLog.push(url);
            if (url.startsWith('moz-extension://x/hosts/')) {
                const f = url.replace('moz-extension://x/', '');
                return { status: 200, text: async () => fs.readFileSync(path.join(root, f), 'utf8') };
            }
            if (url in remote) {
                const r = remote[url];
                if (r instanceof Error) throw r;
                return { status: r.status || 200, text: async () => r.body };
            }
            throw new Error('unexpected fetch ' + url);
        }
    };
    ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'lib/hosts.js'), 'utf8'), ctx, { filename: 'hosts.js' });
    vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
    return {
        ctx, store, listeners, logs, fetchLog, messageListeners, permEvents,
        setPerm: (v) => { hasAllUrls = v; },
        // call every listener whose filter matches the url, return the first non-empty answer
        request: (details) => {
            const answers = [];
            listeners.forEach((l) => {
                const urls = l.filter.urls;
                const host = new URL(details.url).hostname;
                const match = urls.some((p) => p === '<all_urls>' || host === p.replace('*://*.', '').replace('/*', '') || host.endsWith('.' + p.replace('*://*.', '').replace('/*', '')) ||
                    (p.startsWith('*://') && !p.startsWith('*://*.') && host === p.slice(4).replace('/*', '')));
                const typeOk = !l.filter.types || l.filter.types.includes(details.type);
                if (match && typeOk) answers.push(l.fn(details));
            });
            return answers.filter((a) => a && (a.redirectUrl || a.cancel));
        },
        message: (m, sender) => new Promise((resolve) => {
            let responded = false;
            messageListeners.forEach((f) => { const r = f(m, sender || {}, (x) => { responded = true; resolve(x); }); if (r !== true && !responded) resolve(undefined); });
        })
    };
}

const FROM = 'https://open.spotify.com/';
const req = (url, type, from) => ({ url, type: type || 'xmlhttprequest', documentUrl: from === undefined ? FROM : from, tabId: 1 });
const SILENT = 'moz-extension://x/noop-1s.mp4';
const EMPTY = 'moz-extension://x/empty.txt';
const REMOTE_URL = 'https://raw.githubusercontent.com/Myst1cX/uSpot/main/hosts/adblock_hosts.txt';
const PODCAST_URL = 'https://raw.githubusercontent.com/Myst1cX/uSpot/main/hosts/podcast_ad_hosts.txt';
const realList = fs.readFileSync(path.join(root, 'hosts', 'adblock_hosts.txt'), 'utf8');

(async () => {
    await t('default install: only built-in listeners, no list, no download', async () => {
        const e = makeEnv();
        await tick();
        assert.strictEqual(e.fetchLog.filter((u) => u.startsWith('https://')).length, 0, 'no network at startup unless opted in');
        const r = e.request(req('https://aet.spotify.com/v1/event', 'xmlhttprequest'));
        assert.deepStrictEqual(r.map((x) => x.redirectUrl), [EMPTY]);
        const m = e.request(req('https://mp3ad.scdn.co/abc.mp3', 'media'));
        assert.deepStrictEqual(m.map((x) => x.redirectUrl), [SILENT]);
        assert.strictEqual(e.request(req('https://pixel-static.spotify.com/x.js', 'script')).length, 0, 'static asset exit');
        assert.strictEqual(e.request(req('https://aet.spotify.com/v1/event', 'xmlhttprequest', 'https://evil.example/?open.spotify.com')).length, 0, 'origin must be the host, not a substring');
        assert.strictEqual(e.request(req('https://aet.spotify.com/v1/event', 'xmlhttprequest', 'https://news.example/')).length, 0, 'other tabs untouched');
    });

    await t('known ad-audio path: one redirect, one count (Layer 1 owns it)', async () => {
        const e = makeEnv();
        await tick();
        const r = e.request(req('https://adstudio-assets.scdn.co/audio/x.mp3', 'media'));
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].redirectUrl, SILENT);
    });

    await t('whitelist: suffix family and exact hosts are never blocked by host rules', async () => {
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, remote: { [REMOTE_URL]: { body: realList + '\n0.0.0.0 gew1-spclient.spotify.com\n0.0.0.0 x.gew1-spclient.spotify.com\n' } } });
        await tick(); await tick();
        ['https://gew1-spclient.spotify.com/x', 'https://zz9-spclient.spotify.com/x', 'https://spclient.spotify.com/x', 'https://api.spotify.com/x'].forEach((u) => {
            assert.strictEqual(e.request(req(u, 'xmlhttprequest')).length, 0, u);
        });
    });

    await t('full list: opt-in downloads, validates, registers pattern listener, blocks scoped to Spotify tabs', async () => {
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, remote: { [REMOTE_URL]: { body: realList } } });
        await tick(); await tick();
        assert.ok(e.fetchLog.includes(REMOTE_URL));
        const l = e.listeners.find((x) => x.filter.urls.length > 100);
        assert.ok(l, 'pattern listener registered');
        assert.ok(l.filter.urls.every((p) => /^\*:\/\/\*\.[a-z0-9.-]+\/\*$/.test(p)));
        assert.strictEqual(e.store.hostsMeta.source, 'remote');
        const sample = realList.split('\n').find((x) => x.startsWith('0.0.0.0 023hysj.com'));
        assert.ok(sample);
        assert.deepStrictEqual(e.request(req('https://023hysj.com/p', 'xmlhttprequest')).map((x) => x.redirectUrl), [EMPTY]);
        assert.strictEqual(e.request(req('https://023hysj.com/p', 'xmlhttprequest', 'https://news.example/')).length, 0);
        assert.strictEqual(e.request(req('https://023hysj.com/a.js', 'script')).length, 0, 'static exit');
    });

    await t('no double handling: built-in hosts that are also in the list are handled once', async () => {
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, remote: { [REMOTE_URL]: { body: realList } } });
        await tick(); await tick();
        assert.strictEqual(e.request(req('https://doubleclick.net/x', 'xmlhttprequest')).length, 1);
        assert.strictEqual(e.request(req('https://aet.spotify.com/x', 'xmlhttprequest')).length, 1);
    });

    await t('full list on but permission missing: nothing registered, list not applied; granting it applies', async () => {
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: false, remote: { [REMOTE_URL]: { body: realList } } });
        await tick(); await tick();
        assert.ok(!e.listeners.some((x) => x.filter.urls.length > 100));
        e.setPerm(true);
        e.permEvents.added.forEach((f) => f());
        await tick();
        assert.ok(e.listeners.some((x) => x.filter.urls.length > 100));
    });

    await t('bad download is rejected, previous list kept', async () => {
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, remote: { [REMOTE_URL]: { body: '<html>Not Found</html>' } } });
        await tick(); await tick();
        assert.ok(e.store.hostsMeta.error.includes('rejected'), e.store.hostsMeta.error);
        assert.ok(e.listeners.some((x) => x.filter.urls.length > 100), 'bundled list still active');
        assert.notStrictEqual(e.store.hostsMeta.source, 'remote');
        const e2 = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, remote: { [REMOTE_URL]: { status: 404, body: '' } } });
        await tick(); await tick();
        assert.ok(/HTTP 404/.test(e2.store.hostsMeta.error));
    });

    await t('poisoned list: protected entries are dropped, core hosts keep working', async () => {
        const body = realList + '\n0.0.0.0 spotify.com\n0.0.0.0 scdn.co\n0.0.0.0 open.spotify.com\n0.0.0.0 spotifycdn.com\n';
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, remote: { [REMOTE_URL]: { body } } });
        await tick(); await tick();
        assert.ok(e.store.hostsMeta.dropped >= 4, 'dropped ' + e.store.hostsMeta.dropped);
        ['https://open.spotify.com/x', 'https://api.spotify.com/x', 'https://i.scdn.co/x', 'https://audio-fa.scdn.co/x', 'https://accounts.spotify.com/x'].forEach((u) => {
            assert.strictEqual(e.request(req(u, 'xmlhttprequest')).length, 0, u);
        });
    });

    await t('pattern limit: falls back to <all_urls> with in-callback check', async () => {
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, rejectPatterns: true, remote: { [REMOTE_URL]: { body: realList } } });
        await tick(); await tick();
        const fb = e.listeners.find((x) => x.filter.urls[0] === '<all_urls>');
        assert.ok(fb, 'fallback registered');
        assert.strictEqual(e.request(req('https://023hysj.com/p', 'xmlhttprequest')).length, 1);
        assert.strictEqual(e.request(req('https://harmless.example/p', 'xmlhttprequest')).length, 0);
    });

    await t('toggling settings at runtime: on downloads, off removes the listener (single listener, no leak)', async () => {
        const e = makeEnv({ hasAllUrls: true, remote: { [REMOTE_URL]: { body: realList }, [PODCAST_URL]: { body: '0.0.0.0 omny.fm\n0.0.0.0 podtrac.com\n' } } });
        await tick();
        assert.ok(!e.listeners.some((x) => x.filter.urls.length > 100));
        await e.ctx.browser.storage.local.set({ settings: { fullList: true } });
        await tick(); await tick();
        assert.strictEqual(e.listeners.filter((x) => x.filter.urls.length > 100).length, 1);
        await e.ctx.browser.storage.local.set({ settings: { fullList: true, podcast: true } });
        await tick(); await tick();
        assert.strictEqual(e.listeners.filter((x) => x.filter.urls.length > 100).length, 1, 'still one');
        assert.ok(e.fetchLog.includes(PODCAST_URL));
        await e.ctx.browser.storage.local.set({ settings: { fullList: false, podcast: false } });
        await tick(); await tick();
        assert.strictEqual(e.listeners.filter((x) => x.filter.urls.length > 100).length, 0);
    });

    await t('ad file IDs: listener exists only while IDs exist; matches before whitelist; validates input', async () => {
        const e = makeEnv();
        await tick();
        const idFilter = (l) => l.filter.types && l.filter.types.includes('xmlhttprequest');
        assert.ok(!e.listeners.some(idFilter));
        await e.message({ type: 'uspotAdIds', ids: ['abcdEFGH1234', 'bad id', 'x'] }, { tab: { id: 1 } });
        assert.strictEqual(e.listeners.filter(idFilter).length, 1);
        const hit = e.request({ url: 'https://audio-fa.scdn.co/audio/abcdEFGH1234?x=1', type: 'xmlhttprequest', documentUrl: FROM });
        assert.deepStrictEqual(hit.map((x) => x.redirectUrl), [SILENT], 'whitelisted host, ID still wins');
        assert.strictEqual(e.request({ url: 'https://audio-fa.scdn.co/audio/otherTRACKid99', type: 'xmlhttprequest', documentUrl: FROM }).length, 0);
        assert.strictEqual(e.request({ url: 'https://i.scdn.co/abcdEFGH1234', type: 'image', documentUrl: FROM }).length, 0, 'images not intercepted');
        await e.message({ type: 'uspotAdIds', ids: [] }, { tab: { id: 1 } });
        assert.ok(!e.listeners.some(idFilter));
        await e.message({ type: 'uspotAdIds', ids: ['abcdEFGH1234'] }, {});
        assert.ok(!e.listeners.some(idFilter), 'messages without a tab are ignored');
    });

    await t('canvas: off by default; on blocks canvas videos but not whitelisted video hosts', async () => {
        const e = makeEnv();
        await tick();
        assert.strictEqual(e.request(req('https://canvaz.scdn.co/upload/a.mp4', 'media')).length, 0);
        const e2 = makeEnv({ storage: { settings: { canvas: true } } });
        await tick();
        assert.deepStrictEqual(e2.request(req('https://canvaz.scdn.co/upload/a.mp4', 'media')).map((x) => x.redirectUrl), [EMPTY]);
        assert.strictEqual(e2.request(req('https://video-fa.scdn.co/a.mp4', 'media')).length, 0);
        assert.strictEqual(e2.request(req('https://audio-fa.scdn.co/a.mp3', 'media')).length, 0);
    });

    await t('refresh message returns status', async () => {
        const e = makeEnv({ storage: { settings: { fullList: true } }, hasAllUrls: true, remote: { [REMOTE_URL]: { body: realList } } });
        await tick(); await tick();
        const meta = await e.message({ type: 'refreshHostLists' });
        assert.strictEqual(meta.source, 'remote');
        assert.ok(meta.count > 1000);
    });

    console.log('\n' + passed + ' tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
