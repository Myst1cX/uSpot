// uSpot - host list helpers (pure functions, no browser APIs).
//
// Loaded as a background script before background.js (exposes `UspotHosts`)
// and also require()-able from Node for the tests in tests/hosts.test.js.
//
// What lives here:
//  - the never-block whitelist, mirrored from the Spotify Web app's
//    isWhitelisted() (smali/e/f.smali): 19 exact hosts plus ONE suffix rule,
//    any host ending in "-spclient.spotify.com" (regional shards such as
//    gew1-spclient / gae-spclient / guc-spclient). The suffix rule cannot be
//    written in hosts/allow_hosts.txt, so this file is the real protection.
//  - the parser for the downloaded list (hosts-file lines, bare hosts and
//    ||host^ lines, same formats the app's parser accepts),
//  - client-side validation of a downloaded list (the app trusts any HTTP
//    200; the extension does not),
//  - host matching (exact host, then every parent domain, like the app),
//  - the static-asset and canvas URL checks used by the app's pipeline.
(function (root) {
    'use strict';

    // Exact hosts the app never blocks (isWhitelisted). Keep in sync with
    // hosts/allow_hosts.txt by hand.
    const WHITELIST_EXACT = [
        'spclient.spotify.com',
        'login5.spotify.com',
        'spclient.wg.spotify.com',
        'open.spotify.com',
        'api-partner.spotify.com',
        'partners.wg.spotify.com',
        'api.spotify.com',
        'audio4-fa.scdn.co',
        'seektables.scdn.co',
        'cast.scdn.co',
        'audio4-ak.spotifycdn.com',
        'pickasso.spotifycdn.com',
        'mosaic.scdn.co',
        'audio-fa.scdn.co',
        'shared.akamai.steamstatic.com',
        'cdn2.smoot.apple.com',
        'video-fa.scdn.co',
        'video-ak.scdn.co',
        'video-ak.spotifycdn.com'
    ];
    const WHITELIST_SET = new Set(WHITELIST_EXACT);

    // The app's one suffix rule. endsWith on the full hostname, so
    // "x-spclient.spotify.com.evil.com" does not match, and neither does
    // "evilspclient.spotify.com" (no hyphen).
    const WHITELIST_SUFFIXES = ['-spclient.spotify.com'];

    // Spotify's own domains. A downloaded-list entry equal to one of these
    // roots would block whole families, so it is always dropped.
    const SPOTIFY_FAMILY_ROOTS = ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spotifycdn.net'];

    const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
    const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

    function normalizeHost(h) {
        if (typeof h !== 'string') {
            return '';
        }
        h = h.trim().toLowerCase();
        while (h.endsWith('.')) {
            h = h.slice(0, -1);
        }
        return h;
    }

    function hostFromUrl(url) {
        try {
            return normalizeHost(new URL(url).hostname);
        } catch (e) {
            return '';
        }
    }

    // True for hosts the extension must never block by host rule.
    function isWhitelisted(host) {
        host = normalizeHost(host);
        if (!host) {
            return false;
        }
        if (WHITELIST_SET.has(host)) {
            return true;
        }
        for (let i = 0; i < WHITELIST_SUFFIXES.length; i++) {
            if (host.endsWith(WHITELIST_SUFFIXES[i])) {
                return true;
            }
        }
        return false;
    }

    function isValidHostname(h) {
        return (
            typeof h === 'string' &&
            h.length <= 253 &&
            h.indexOf('.') > 0 &&
            h.indexOf('..') < 0 &&
            HOST_RE.test(h) &&
            !IP_RE.test(h)
        );
    }

    // Parses one line. Returns { host } for a usable entry, { skip: true }
    // for blank/comment lines, { bad: true } for anything unparseable.
    function parseLine(raw) {
        let line = raw.trim();
        if (!line || line[0] === '#' || line[0] === '!') {
            return { skip: true };
        }
        const hash = line.indexOf('#');
        if (hash > 0) {
            line = line.slice(0, hash).trim();
        }
        if (line.startsWith('||')) {
            line = line.slice(2);
            const caret = line.indexOf('^');
            if (caret >= 0) {
                line = line.slice(0, caret);
            } else if (line.indexOf('/') >= 0 || line.indexOf('*') >= 0) {
                return { bad: true };
            }
        } else {
            const parts = line.split(/\s+/);
            if (parts.length >= 2 && (parts[0] === '0.0.0.0' || parts[0] === '127.0.0.1')) {
                line = parts[1];
            } else if (parts.length === 1) {
                line = parts[0];
            } else {
                return { bad: true };
            }
        }
        line = normalizeHost(line);
        return isValidHostname(line) ? { host: line } : { bad: true };
    }

    // Returns { hosts: string[] (deduped), dataLines, bad }.
    function parseHostsText(text) {
        const seen = new Set();
        const hosts = [];
        let dataLines = 0;
        let bad = 0;
        const lines = String(text).split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const r = parseLine(lines[i]);
            if (r.skip) {
                continue;
            }
            dataLines += 1;
            if (r.bad) {
                bad += 1;
                continue;
            }
            if (!seen.has(r.host)) {
                seen.add(r.host);
                hosts.push(r.host);
            }
        }
        return { hosts, dataLines, bad };
    }

    // True if blocking `entry` (which also blocks all its subdomains, via the
    // parent-domain walk) could cut a whitelisted host off: the entry IS a
    // whitelisted host, IS a parent of one, is a bare Spotify family root, or
    // sits under the "-spclient.spotify.com" suffix.
    function isProtectedEntry(entry) {
        if (isWhitelisted(entry)) {
            return true;
        }
        if (SPOTIFY_FAMILY_ROOTS.indexOf(entry) >= 0) {
            return true;
        }
        for (let i = 0; i < WHITELIST_EXACT.length; i++) {
            if (WHITELIST_EXACT[i].endsWith('.' + entry)) {
                return true;
            }
        }
        // parents of the suffix family (e.g. "spotify.com") are covered above;
        // an entry such as "x.gew1-spclient.spotify.com" is covered by
        // isWhitelisted's suffix check.
        return false;
    }

    // Builds the lookup Set, dropping protected entries. `dropped` reports how many.
    function buildSet(hosts) {
        const set = new Set();
        let dropped = 0;
        for (let i = 0; i < hosts.length; i++) {
            const h = normalizeHost(hosts[i]);
            if (!isValidHostname(h)) {
                continue;
            }
            if (isProtectedEntry(h)) {
                dropped += 1;
                continue;
            }
            set.add(h);
        }
        return { set, dropped };
    }

    // The app's host walk: exact host, then strip the leftmost label and check
    // again while the rest still contains a dot. A bare TLD is never checked.
    function hostBlocklistMatch(set, host) {
        host = normalizeHost(host);
        if (!host) {
            return false;
        }
        let h = host;
        for (;;) {
            if (set.has(h)) {
                return true;
            }
            const dot = h.indexOf('.');
            if (dot < 0) {
                return false;
            }
            h = h.slice(dot + 1);
            if (h.indexOf('.') < 0) {
                return false;
            }
        }
    }

    // Client-side checks on a downloaded list. The app only checks HTTP 200.
    //  - at least minCount usable entries (an error page or truncated file fails),
    //  - at most 5% of the data lines unparseable,
    //  - not smaller than 70% of the list currently in use.
    function validateList(parsed, opts) {
        opts = opts || {};
        const minCount = typeof opts.minCount === 'number' ? opts.minCount : 500;
        const prev = typeof opts.previousCount === 'number' ? opts.previousCount : 0;
        if (parsed.hosts.length < minCount) {
            return { ok: false, reason: 'only ' + parsed.hosts.length + ' entries (< ' + minCount + ')' };
        }
        if (parsed.dataLines > 0 && parsed.bad / parsed.dataLines > 0.05) {
            return { ok: false, reason: parsed.bad + ' of ' + parsed.dataLines + ' lines unparseable' };
        }
        if (prev && parsed.hosts.length < prev * 0.7) {
            return { ok: false, reason: 'shrank from ' + prev + ' to ' + parsed.hosts.length };
        }
        return { ok: true };
    }

    // webRequest match patterns for a host list. "*://*.example.com/*" matches
    // example.com and every subdomain, the same semantics as the host walk.
    function hostsToPatterns(hosts) {
        const out = [];
        for (let i = 0; i < hosts.length; i++) {
            out.push('*://*.' + hosts[i] + '/*');
        }
        return out;
    }

    // The app's static-asset exit: path (lowercased) ends in one of these.
    const STATIC_EXT_RE = /\.(jpg|jpeg|png|js|css|svg|json|woff|woff2)$/;
    function isStaticAsset(url) {
        try {
            return STATIC_EXT_RE.test(new URL(url).pathname.toLowerCase());
        } catch (e) {
            return false;
        }
    }

    // The app's canvas rule: URL ends with .mp4 / .webm, or contains /canvaz/.
    function isCanvasUrl(url) {
        const u = String(url).toLowerCase().split('#')[0].split('?')[0];
        return u.endsWith('.mp4') || u.endsWith('.webm') || String(url).indexOf('/canvaz/') >= 0;
    }

    // Ad audio file IDs reported by the page hook (same rule as the hook/app).
    const AD_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;
    function sanitizeAdIds(ids, max) {
        const out = [];
        if (!Array.isArray(ids)) {
            return out;
        }
        for (let i = 0; i < ids.length && out.length < (max || 32); i++) {
            if (typeof ids[i] === 'string' && AD_ID_RE.test(ids[i]) && out.indexOf(ids[i]) < 0) {
                out.push(ids[i]);
            }
        }
        return out;
    }

    const api = {
        WHITELIST_EXACT,
        WHITELIST_SUFFIXES,
        SPOTIFY_FAMILY_ROOTS,
        normalizeHost,
        hostFromUrl,
        isWhitelisted,
        isValidHostname,
        parseHostsText,
        isProtectedEntry,
        buildSet,
        hostBlocklistMatch,
        validateList,
        hostsToPatterns,
        isStaticAsset,
        isCanvasUrl,
        sanitizeAdIds
    };

    root.UspotHosts = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof self !== 'undefined' ? self : this);
