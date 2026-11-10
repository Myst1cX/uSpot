// Run: node tests/hook_relay.test.js   (from the repo root)
// Exercises hook.js (page side) and relay.js (content-script side) with a fake window and fake extension API.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
let passed = 0;
async function t(name, fn) { await fn(); passed += 1; console.log('ok  ' + name); }
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = () => new Promise((r) => setTimeout(r, 30));

function fakeWindow(extra) {
    const listeners = [];
    const posted = [];
    const win = {
        location: { origin: 'https://open.spotify.com', hostname: 'open.spotify.com' },
        addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
        postMessage: (data, origin) => { posted.push({ data, origin }); },
        // deliver a message "from the page itself" (event.source === window)
        deliver: (data, source) => listeners.forEach((f) => f({ source: source === undefined ? win : source, data })),
        posted
    };
    win.window = win;
    Object.assign(win, extra || {});
    return win;
}

function run(file, win, extraGlobals) {
    const ctx = Object.assign({
        window: win, console, setInterval: () => 0, setTimeout, clearTimeout, Response, JSON, Date, Math, Object, Array, String, Number, Boolean,
        Promise, RegExp, Error, parseInt, parseFloat, isNaN, Blob, ArrayBuffer, TextDecoder, Set, Map, Symbol,
        localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null }, document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
        location: win.location
    }, extraGlobals || {});
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
    return ctx;
}

(async () => {
    await t('hook: reports ad file IDs through postMessage (no AndBridge needed)', async () => {
        const state = { state_machine: { tracks: [
            { metadata: { content_type: 'AD', uri: 'spotify:ad:123' }, manifest: { file_ids_mp3: [{ file_id: 'AAAAaaaa1111' }, { file_id: 'BBBBbbbb2222' }] } },
            { metadata: { content_type: 'AUDIO', uri: 'spotify:track:1' }, manifest: { file_ids_mp3: [{ file_id: 'SONGsong3333' }] } }
        ] } };
        const win = fakeWindow({
            fetch: async () => new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } }),
            WebSocket: class {}
        });
        run('hook.js', win);
        await win.fetch('https://gew1-spclient.spotify.com/connect-state/v1/devices/abc');
        await tick();
        const ids = win.posted.map((p) => p.data).filter((d) => d.kind === 'ids');
        assert.strictEqual(ids.length, 1);
        assert.deepStrictEqual(Array.from(ids[0].ids), ['AAAAaaaa1111', 'BBBBbbbb2222']);
        assert.strictEqual(ids[0].__uspot, 1);
        assert.ok(win.posted.every((p) => p.origin === 'https://open.spotify.com'), 'always posted to the page origin');
        assert.ok(win.posted.some((p) => p.data.kind === 'log'), 'log lines go over the bridge');
    });

    await t('hook: popup switch sets the kill switch, spoofed sources are ignored', async () => {
        const win = fakeWindow({ fetch: async () => new Response('{}'), WebSocket: class {} });
        run('hook.js', win);
        const installLine = () => win.posted.map((p) => p.data).filter((d) => d.kind === 'log').map((d) => d.msg).join('\n');
        assert.ok(/rewrite on/.test(installLine()), installLine());
        // a different window (iframe) must not be able to flip it
        const win2 = fakeWindow({ fetch: async () => new Response('{}'), WebSocket: class {} });
        const ctx2 = run('hook.js', win2);
        win2.deliver({ __uspotCfg: 1, rewriteOff: true }, {});
        assert.strictEqual(ctx2.window.__adStateHook, 1);
    });

    await t('hook: installs once per page', async () => {
        const win = fakeWindow({ fetch: async () => new Response('{}'), WebSocket: class {} });
        run('hook.js', win);
        const before = win.posted.length;
        run('hook.js', win);
        assert.strictEqual(win.posted.length, before);
    });

    function relayEnv(settings) {
        const win = fakeWindow();
        const sent = [];
        const logs = [];
        const changed = [];
        const browser = {
            runtime: { sendMessage: (m) => { sent.push(m); return Promise.resolve(); } },
            storage: { local: { get: async () => (settings ? { settings } : {}) }, onChanged: { addListener: (f) => changed.push(f) } }
        };
        run('relay.js', win, { browser, console: { log: (...a) => logs.push(['log', ...a]), warn: (...a) => logs.push(['warn', ...a]) } });
        return { win, sent, logs, changed };
    }

    await t('relay: forwards validated IDs only, from the page window only', async () => {
        const r = relayEnv();
        r.win.deliver({ __uspot: 1, kind: 'ids', ids: ['goodID_12345', 'bad id', 7, 'short'] });
        r.win.deliver({ __uspot: 1, kind: 'ids', ids: ['spoofedID123'] }, {});       // other window
        r.win.deliver({ kind: 'ids', ids: ['nomarkerID123'] });                       // no marker
        assert.deepStrictEqual(plain(r.sent), [{ type: 'uspotAdIds', ids: ['goodID_12345'] }]);
    });

    await t('relay: sends popup settings to the page, and again when they change', async () => {
        const r = relayEnv({ hook: false, recovery: true, debug: true });
        await tick();
        const cfg = () => r.win.posted.map((p) => p.data).filter((d) => d.__uspotCfg === 1);
        assert.deepStrictEqual(plain(cfg()[0]), { __uspotCfg: 1, rewriteOff: true, recoveryOff: false });
        r.changed.forEach((f) => f({ settings: { newValue: { hook: true, recovery: false } } }, 'local'));
        assert.deepStrictEqual(plain(cfg()[1]), { __uspotCfg: 1, rewriteOff: false, recoveryOff: true });
        r.changed.forEach((f) => f({ blockedAdCount: { newValue: 3 } }, 'local'));
        assert.strictEqual(cfg().length, 2, 'counter writes do not trigger a config message');
        const r2 = relayEnv();
        await tick();
        assert.deepStrictEqual(plain(r2.win.posted.map((p) => p.data).filter((d) => d.__uspotCfg === 1)[0]), { __uspotCfg: 1, rewriteOff: false, recoveryOff: false });
    });

    await t('relay: hook log lines only reach the console when debug is on, and are length-capped', async () => {
        const on = relayEnv({ debug: true });
        await tick();
        on.win.deliver({ __uspot: 1, kind: 'log', level: 'w', msg: 'x'.repeat(2000) });
        const line = on.logs.find((l) => l[1] === '[uSpot hook]');
        assert.ok(line && line[2].length === 500 && line[0] === 'warn');
        const off = relayEnv({ debug: false });
        await tick();
        off.win.deliver({ __uspot: 1, kind: 'log', level: 'i', msg: 'hidden' });
        assert.ok(!off.logs.some((l) => l[1] === '[uSpot hook]'));
    });

    console.log('\n' + passed + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
