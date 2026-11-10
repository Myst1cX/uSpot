// Run: node tests/hosts.test.js   (from the repo root)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const U = require('../lib/hosts.js');

let n = 0;
function t(name, fn) { fn(); n += 1; console.log('ok  ' + name); }

t('whitelist: all 19 exact hosts', () => {
    assert.strictEqual(U.WHITELIST_EXACT.length, 19);
    U.WHITELIST_EXACT.forEach((h) => assert.ok(U.isWhitelisted(h), h));
});
t('whitelist: -spclient.spotify.com suffix family', () => {
    ['gew1-spclient.spotify.com', 'gae-spclient.spotify.com', 'guc-spclient.spotify.com',
     'future-region9-spclient.spotify.com', 'GEW1-SPCLIENT.SPOTIFY.COM', 'gew1-spclient.spotify.com.'
    ].forEach((h) => assert.ok(U.isWhitelisted(h), h));
});
t('whitelist: suffix cannot be spoofed', () => {
    ['x-spclient.spotify.com.evil.com', 'evilspclient.spotify.com', 'spclient.spotify.com.evil.com',
     '-spclient.spotify.com.attacker.io', 'notspotify.com', 'aet.spotify.com', 'ads-fa.scdn.co', ''
    ].forEach((h) => assert.ok(!U.isWhitelisted(h), h));
});
t('whitelist: from URL host extraction', () => {
    assert.ok(U.isWhitelisted(U.hostFromUrl('https://gew1-spclient.spotify.com/x?y=1')));
    assert.ok(!U.isWhitelisted(U.hostFromUrl('https://gew1-spclient.spotify.com@evil.com/x')));
    assert.ok(!U.isWhitelisted(U.hostFromUrl('https://evil.com/gew1-spclient.spotify.com')));
});
t('parser: formats', () => {
    const p = U.parseHostsText('# c\n! c\n0.0.0.0 A.example.com\n127.0.0.1 b.example.com # x\nc.example.com\n||d.example.com^\n||e.example.com^$third-party\n\n0.0.0.0 a.example.com\n');
    assert.deepStrictEqual(p.hosts, ['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com', 'e.example.com']);
    assert.strictEqual(p.bad, 0);
});
t('parser: bad lines counted, not crashing', () => {
    const p = U.parseHostsText('<html>\n0.0.0.0 localhost\n1.2.3.4\nfoo bar baz\n||x.com/path\nok.example.com\n');
    assert.deepStrictEqual(p.hosts, ['ok.example.com']);
    assert.ok(p.bad >= 4);
});
t('protected entries dropped from the set', () => {
    const { set, dropped } = U.buildSet(['spotify.com', 'scdn.co', 'spotifycdn.com', 'spotifycdn.net', 'wg.spotify.com',
        'open.spotify.com', 'gew1-spclient.spotify.com', 'x.gew1-spclient.spotify.com', 'smoot.apple.com', 'apple.com',
        'steamstatic.com', 'aet.spotify.com', 'ads-fa.scdn.co', 'doubleclick.net']);
    assert.strictEqual(dropped, 11);
    assert.deepStrictEqual([...set].sort(), ['ads-fa.scdn.co', 'aet.spotify.com', 'doubleclick.net']);
});
t('host walk: host, then parents, never a bare TLD', () => {
    const set = new Set(['example.com', 'a.other.org', 'com']);
    assert.ok(U.hostBlocklistMatch(set, 'example.com'));
    assert.ok(U.hostBlocklistMatch(set, 'x.y.example.com'));
    assert.ok(!U.hostBlocklistMatch(set, 'other.org'));
    assert.ok(U.hostBlocklistMatch(set, 'a.other.org'));
    assert.ok(!U.hostBlocklistMatch(set, 'foo.com'));
    assert.ok(!U.hostBlocklistMatch(set, ''));
});
t('validation', () => {
    const big = U.parseHostsText(Array.from({ length: 600 }, (_, i) => '0.0.0.0 h' + i + '.example.com').join('\n'));
    assert.ok(U.validateList(big).ok);
    assert.ok(!U.validateList(U.parseHostsText('<html>404</html>')).ok);
    assert.ok(!U.validateList(big, { previousCount: 1000 }).ok);
    assert.ok(U.validateList(big, { previousCount: 700 }).ok);
    const junk = U.parseHostsText(Array.from({ length: 600 }, (_, i) => (i % 5 ? 'x y z' : '0.0.0.0 h' + i + '.example.com')).join('\n'));
    assert.ok(!U.validateList(junk, { minCount: 10 }).ok);
});
t('patterns', () => {
    assert.deepStrictEqual(U.hostsToPatterns(['a.com', 'b.example.org']), ['*://*.a.com/*', '*://*.b.example.org/*']);
});
t('static assets and canvas', () => {
    assert.ok(U.isStaticAsset('https://x.com/a/B.JS?v=1'));
    assert.ok(U.isStaticAsset('https://x.com/a.woff2'));
    assert.ok(!U.isStaticAsset('https://x.com/a.mp3'));
    assert.ok(!U.isStaticAsset('https://x.com/script?file=a.js'));
    assert.ok(U.isCanvasUrl('https://canvaz.scdn.co/upload/x.mp4'));
    assert.ok(U.isCanvasUrl('https://x.scdn.co/canvaz/abc'));
    assert.ok(U.isCanvasUrl('https://x.scdn.co/a.webm?x=1'));
    assert.ok(!U.isCanvasUrl('https://x.scdn.co/a.mp3'));
});
t('ad id sanitising', () => {
    assert.deepStrictEqual(U.sanitizeAdIds(['abcdefgh', 'short', 'ab cdefgh', 'abcdefgh', 5, 'a'.repeat(129), 'ok_ok-ok1']), ['abcdefgh', 'ok_ok-ok1']);
    assert.strictEqual(U.sanitizeAdIds(Array.from({ length: 50 }, (_, i) => 'id-number-' + i)).length, 32);
    assert.deepStrictEqual(U.sanitizeAdIds('nope'), []);
});
t('real compiled list: parses, validates, protected entries, first-party ad hosts kept', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'hosts', 'adblock_hosts.txt'), 'utf8');
    const p = U.parseHostsText(text);
    assert.ok(U.validateList(p, { minCount: 1000 }).ok, 'validate');
    assert.strictEqual(p.bad, 0);
    const { set, dropped } = U.buildSet(p.hosts);
    assert.strictEqual(dropped, 0, 'nothing in the real list should be protected');
    ['aet.spotify.com', 'pixel.spotify.com', 'adstudio-assets.scdn.co', 'mp3ad.scdn.co', 'doubleclick.net'].forEach((h) => assert.ok(U.hostBlocklistMatch(set, h), h));
    U.WHITELIST_EXACT.forEach((h) => assert.ok(!U.hostBlocklistMatch(set, h) || U.isWhitelisted(h), h));
    ['gew1-spclient.spotify.com', 'open.spotify.com', 'i.scdn.co', 'audio-fa.scdn.co'].forEach((h) => assert.ok(!U.hostBlocklistMatch(set, h), h));
});
console.log('\n' + n + ' tests passed');
