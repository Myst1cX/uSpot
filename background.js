// uSpot - Spotify Adblocker (uBlock method) - MV2 variant
//
// Attribution:
// - AD_URL_PATTERNS below and the noop-1s.mp4 redirect target are taken
//   directly from uBlock Origin's own bundled filter list
//   (assets/ublock/filters.min.txt), specifically its open.spotify.com
//   ad-blocking rules:
//     ||scdn.co/audio/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
//     ||scdn.co/mp3-ad/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
//     ||scdn.co/mp3/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
//     ||spotifycdn.com/audio/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
//     ||adstudio-assets.scdn.co^$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
// - noop-1s.mp4 is the same file, byte-for-byte, as uBlock Origin's
//   web_accessible_resources/noop-1s.mp4.
// - The webRequest.onBeforeRequest + redirectUrl mechanism that applies
//   these rules is this extension's own code, not copied from uBlock
//   Origin's traffic.js.
//
// Later layers (see README.md, "How it works"): the first-party ad-host list,
// the downloaded host list, the never-block whitelist (lib/hosts.js), ad
// audio file IDs and the page hook are ported from the Spotify Web app,
// which in turn follows SpotiDuck (GPL-3.0) - see CREDITS.md.
//
// uBlock Origin: Copyright (C) Raymond Hill and contributors. GPLv3.
// https://github.com/gorhill/uBlockOrigin
// Full attribution and license text: CREDITS.md, LICENSE.txt.
//
// Compat shim: `browser` is Firefox's WebExtensions global and doesn't
// exist in Chrome at all (referencing it there throws
// "ReferenceError: browser is not defined" before anything else in this
// file runs) - Chrome only has `chrome`. Same shim content_script.js
// already uses; every browser.* call below goes through `api` instead so
// this build works on both.
const api = typeof browser !== 'undefined' ? browser : chrome;

// `browser.storage.local.get/set` (real Firefox) is Promise-only and
// throws if you pass it a callback. `chrome.storage.local.get/set` is
// callback-based at heart - it does NOT reliably support the bare-Promise
// form (calling it with no callback) across every Chrome/Chromium build.
// On some it silently returns a Promise; on others it throws
// "Error in invocation of storage.get(...): No matching signature" the
// instant you call it without one, because that build's binding just
// never registered a Promise-returning overload for this method. Rather
// than gamble on which behavior the current browser has, these two
// helpers branch explicitly: real Promise API for Firefox, always-callback
// (wrapped in our own Promise) for Chrome - the callback form has been
// supported everywhere since forever, so it's the safe common denominator.
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

// Set to false to quiet this back down once you're done digging - it's
// purely diagnostic, doesn't affect blocking behavior either way.
let DEBUG = true;

// UspotHosts comes from lib/hosts.js (listed before this file in manifest.json).
const U = UspotHosts;

// --- settings -----------------------------------------------------------
// Stored under one storage.local key ("settings"), separate from the counters
// on purpose: the only storage.onChanged listener below reacts to this key
// alone, so it can never feed back into the counter increment path.
const DEFAULT_SETTINGS = {
    hook: true,       // page hook: leave ads out of the playback state (hook.js, MAIN world)
    recovery: true,   // hook's recovery watchdog (only loads a song if a break is stuck)
    fullList: false,  // downloaded host list (needs the optional <all_urls> permission)
    podcast: false,   // podcast ad hosts (omny.fm etc.), same permission
    canvas: false,    // empty-200 Canvas videos, as the app does
    debug: true       // console logging (was the DEBUG constant)
};
let settings = Object.assign({}, DEFAULT_SETTINGS);

// background.js has no DOM of its own (it's the extension process, not the
// page) - it only ever sees request metadata (url/type/tabId/etc). To get
// the outerHTML of whatever's on-screen at the moment a request gets
// blocked, we have to ask the *page's* content script to grab it and log
// it there, since that's the only context with document access. Fire-and-
// forget: if content_script.js isn't listening yet (e.g. right after an
// extension reload before the page re-injects it), sendMessage rejects and
// we just swallow it - this is debug-only, never load-bearing.
function requestBlockedAreaSnapshot(details) {
    if (!DEBUG || typeof details.tabId !== 'number' || details.tabId < 0) {
        return;
    }
    const send = api.tabs.sendMessage(details.tabId, {
        type: 'uspotCaptureBlockedArea',
        blockedUrl: details.url
    });
    // Chrome: callback-style send returns undefined, errors surface via
    // api.runtime.lastError instead of a rejected promise - nothing to
    // .catch there. Firefox: send returns a real promise that rejects if
    // no listener is present - catch it so it doesn't show as an unhandled
    // rejection in the background console.
    if (send && typeof send.catch === 'function') {
        send.catch(() => {});
    }
}

// Logs raw request metadata to the background console. Used by every
// block site - even the ones that skip the DOM snapshot below, since the
// request details themselves (type, method, timing) are useful
// regardless of whether there's an on-screen ad element to correlate them
// with.
function logBlockedRequestDetails(details) {
    if (!DEBUG) {
        return;
    }
    console.log('[uSpot] Blocked request details:', {
        url: details.url,
        type: details.type,
        method: details.method,
        frameId: details.frameId,
        tabId: details.tabId,
        requestId: details.requestId,
        timeStamp: details.timeStamp
    });
}

// Same as above, plus the page-side outerHTML snapshot. Only meaningful
// for requests that actually correspond to something visible on-screen
// (the ad-audio block paths) - the instant-mode telemetry hosts
// (sentry.io, fastly-insights, etc.) fire independently of whether an ad
// is currently showing, so snapshotting there just dumps whatever the
// panel happens to contain at that instant (often nothing ad-related at
// all) and adds noise rather than signal.
function logBlockedRequestDebug(details) {
    logBlockedRequestDetails(details);
    if (DEBUG) {
        requestBlockedAreaSnapshot(details);
    }
}

const AD_URL_PATTERNS = [
    '*://*.scdn.co/mp3/*',
    '*://adstudio-assets.scdn.co/audio/*',
    '*://*.scdn.co/mp3-ad/*',
    '*://adstudio-assets.spotifycdn.com/audio/*'
];

// Same intent as AD_URL_PATTERNS above, written as plain checks so the
// webRequest callback below can classify a URL as "known ad host" without
// re-deriving it from webRequest's own match-pattern syntax.
function isKnownAdHost(url) {
    return (
        /:\/\/[^/]*\.scdn\.co\/mp3\//.test(url) ||
        url.includes('://adstudio-assets.scdn.co/audio/') ||
        /:\/\/[^/]*\.scdn\.co\/mp3-ad\//.test(url) ||
        url.includes('://adstudio-assets.spotifycdn.com/audio/')
    );
}

const SILENT_MP4_URL = api.runtime.getURL('noop-1s.mp4');

// Zero-byte bundled resource. Used instead of {cancel: true} for
// instant-mode ad-network hosts on non-media requests - see the comment
// on that listener below for why: cancelling makes the request visibly
// fail (network error the page can see/react to), where the original
// smali's emptyOkResponse() makes it silently succeed with nothing in it.
// Redirecting to a real, empty, always-200 resource is the closest
// available match to that in a browser extension.
const EMPTY_URL = api.runtime.getURL('empty.txt');

let blockedAdCount = 0;
let blockedOtherCount = 0;

// True while content_script.js's ad-break DOM fallback currently sees ad
// UI on the page. Set/cleared by the muteTab/Unmute messages below. Used
// to gate the fallback redirect further down - it's what lets us tell
// "this unlisted media request is probably an ad from a host we haven't
// catalogued yet" apart from "this unlisted media request is just the
// next track loading". Also doubles as the "ad" vs "other" split below -
// see incrementBlockedCount().
let adBreakActive = false;

// FIX: the stored count used to be loaded with a plain
// `blockedCount = result.blockedCount`, which is a race - if a request got
// blocked (incrementing blockedCount) before this async storage.local.get
// resolved, that increment was silently discarded the moment the load
// callback ran, since it unconditionally overwrote the in-memory value
// with the (older) stored one. `countLoaded`/`pendingIncrements` below
// close that window: increments that happen before the load resolves are
// buffered and merged in, instead of being clobbered.
let countLoaded = false;
let pendingAdIncrements = 0;
let pendingOtherIncrements = 0;

// category: 'ad' for a request that corresponds to an actual ad playing
// (known scdn.co ad-audio host, the DOM-fallback path, or an instant-mode
// request firing while adBreakActive is true) vs 'other' for ad-network/
// telemetry traffic blocked with no ad currently detected as showing
// (e.g. a Sentry/fastly-insights beacon firing on a normal track). This
// reads adBreakActive - background.js's own live state, set by
// content_script.js's DOM detection - rather than guessing from a static
// per-domain list, since the same domain (e.g. doubleclick.net) can fire
// both during and outside an actual ad break.
function incrementBlockedCount(category) {
    if (!countLoaded) {
        if (category === 'ad') {
            pendingAdIncrements += 1;
        } else {
            pendingOtherIncrements += 1;
        }
        return;
    }
    if (category === 'ad') {
        blockedAdCount += 1;
    } else {
        blockedOtherCount += 1;
    }
    storageSet({ blockedAdCount, blockedOtherCount });
}

storageGet(['blockedAdCount', 'blockedOtherCount']).then((result) => {
    const storedAd = typeof result.blockedAdCount === 'number' ? result.blockedAdCount : 0;
    const storedOther = typeof result.blockedOtherCount === 'number' ? result.blockedOtherCount : 0;
    blockedAdCount = storedAd + pendingAdIncrements;
    blockedOtherCount = storedOther + pendingOtherIncrements;
    countLoaded = true;
    storageSet({ blockedAdCount, blockedOtherCount });
});

// Keep in sync with the popup's reset - without this, resetting the counter
// only updates storage.local while this script's in-memory blockedCount
// stays stale, so the next block overwrites the reset with old_count + 1.
//
// NOTE: this is deliberately a runtime message from the popup, not a
// browser.storage.onChanged listener. onChanged fires for every write to
// blockedCount, including this script's own writes from the increment path
// below. Under bursty conditions (several ad-asset requests firing close
// together, which is common during an ad pod) that creates a feedback loop:
// an onChanged event for an *older* increment can resolve after a *newer*
// increment has already happened, snapping blockedCount back down and
// silently dropping counts. Listening for an explicit "reset" message
// instead means only the popup's reset button can zero the counter -
// the increment path is untouched by it.
//
// Also handles muteTab/Unmute from content_script.js's ad-break DOM
// fallback - same listener, no new one. This both mutes/unmutes the tab
// and toggles adBreakActive, which the webRequest listener below reads.
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'resetBlockedCount') {
        blockedAdCount = 0;
        blockedOtherCount = 0;
        pendingAdIncrements = 0;
        pendingOtherIncrements = 0;
        return;
    }
    if (message && message.type === 'uspotAdIds' && sender.tab) {
        setAdIds(message.ids);
        return;
    }
    if (message && message.type === 'refreshHostLists') {
        refreshLists().then((meta) => sendResponse(meta));
        return true; // keep the channel open for the async reply
    }
    if (message && message.muteTab && sender.tab) {
        adBreakActive = true;
        api.tabs.update(sender.tab.id, { muted: true });
        console.log(
            '[uSpot] Ad break started (' + (message.reason || 'unknown reason') + ') -',
            'tab muted, fallback redirect now covers any media request under',
            'scdn.co / spotifycdn.com / open.spotify.com, not just the known ad hosts'
        );
        return;
    }
    if (message && message.Unmute && sender.tab) {
        adBreakActive = false;
        api.tabs.update(sender.tab.id, { muted: false });
        console.log('[uSpot] Ad break ended - tab unmuted, fallback redirect narrowed back to known ad hosts only');
    }
});

// Single listener, broadened beyond AD_URL_PATTERNS to any media request
// under Spotify's own domains, restricted with { types: ['media'] } so it
// never sees non-media traffic (page scripts, API calls, images, etc.) on
// open.spotify.com. Inside, known ad hosts are always redirected; anything
// else is only redirected while adBreakActive is true (content_script.js
// has detected ad UI on the page right now).
//
// Trade-off, accepted deliberately: during that window, a real track that
// happens to start loading from one of these domains right as the ad ends
// could also get silently redirected. Narrower than that and unknown-host
// ads go un-redirected (mute-only); broader than that and this would also
// catch real playback outside an ad break. This is the middle point.
api.webRequest.onBeforeRequest.addListener(
    (details) => {
        const known = isKnownAdHost(details.url);

        // Canvas videos (opt-in, popup setting): the app answers them with an
        // empty 200 after the whitelist check, so media hosts the app
        // whitelists (video-fa.scdn.co etc.) are never touched.
        if (!known && settings.canvas && U.isCanvasUrl(details.url) &&
            !U.isWhitelisted(U.hostFromUrl(details.url))) {
            return { redirectUrl: EMPTY_URL };
        }

        // First-party ad hosts have their own listener further down; skipping
        // them here keeps one request from being redirected/counted twice.
        if (!known && U.hostBlocklistMatch(FIRST_PARTY_SET, U.hostFromUrl(details.url))) {
            return {};
        }

        if (!known && !adBreakActive) {
            return {};
        }

        incrementBlockedCount('ad');

        if (known) {
            console.log(
                '[uSpot] Blocked ad audio - known ad host -',
                details.url,
                '- resource type:', details.type
            );
        } else {
            console.log(
                '[uSpot] Blocked ad audio - ad-state fallback (unlisted host, but an ad break is active) -',
                details.url,
                '- resource type:', details.type
            );
        }

        logBlockedRequestDebug(details);

        return { redirectUrl: SILENT_MP4_URL };
    },
    {
        urls: [
            '*://*.scdn.co/*',
            '*://*.spotifycdn.com/*',
            '*://open.spotify.com/*'
        ],
        types: ['media']
    },
    ['blocking']
);

// --- "instant" mode port -----------------------------------------------
//
// Ported from the request interceptor of the author's Spotify Web app, v1.0 (smali/e/f.smali,
// matchesHardcodedAdDomain(), MODE = "instant"). That method checks a URL
// against 10 hardcoded ad-network/ad-path substrings, unconditionally,
// with no remote list and no live probing - see
// Spotify_Web_1_0_AdBlock_Port.md for the full writeup of all three modes.
//
// Three of the ten (adstudio-assets.scdn.co, scdn.co/mp3-ad/, /mp3-ad/)
// are already covered above by AD_URL_PATTERNS/isKnownAdHost, so they're
// not repeated here. The other seven are ad-network/telemetry hosts that
// don't fall under scdn.co/spotifycdn.com/open.spotify.com at all, so they
// need their own host permissions and their own listener rather than
// folding into isKnownAdHost - that function, and the listener above it,
// stay exactly as they were.
const INSTANT_MODE_AD_DOMAINS = [
    'doubleclick.net',
    'googlesyndication.com',
    'fastly-insights.com',
    'sentry.io',
    '2mdn.net',
    'adxcel.com',
    'amillionads.com'
];

function matchesInstantModeAdDomain(url) {
    return INSTANT_MODE_AD_DOMAINS.some((needle) => url.includes(needle));
}

// These seven hosts (doubleclick.net, sentry.io, etc.) are generic
// ad/telemetry domains used far outside Spotify, so this listener is
// deliberately scoped to requests whose document/initiator is
// open.spotify.com - unlike the scdn.co listener above, matching these
// URL patterns everywhere would make this a general-purpose blocker,
// which isn't this extension's job.
function isFromSpotifyTab(details) {
    // Hostname comparison, not a substring test: a substring test would also
    // accept e.g. https://evil.example/?open.spotify.com.
    const origin = details.documentUrl || details.originUrl || details.initiator || '';
    return U.hostFromUrl(origin) === 'open.spotify.com';
}

api.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (!matchesInstantModeAdDomain(details.url) || !isFromSpotifyTab(details)) {
            return {};
        }

        const category = adBreakActive ? 'ad' : 'other';
        incrementBlockedCount(category);

        // Mirrors the smali: audio/video-shaped requests get the silent
        // clip so playback doesn't stall. Everything else (scripts, xhr,
        // beacons, images) gets redirected to a zero-byte bundled
        // resource - a real request that really succeeds empty, matching
        // emptyOkResponse()'s "let it through with nothing in it" rather
        // than making it visibly fail (which {cancel: true} would).
        if (details.type === 'media') {
            console.log(
                '[uSpot] Blocked ad audio (instant-mode ad-network host) -',
                details.url, '- resource type:', details.type,
                '- counted as:', category
            );
            logBlockedRequestDebug(details);
            return { redirectUrl: SILENT_MP4_URL };
        }

        console.log(
            '[uSpot] Emptied request to instant-mode ad-network host -',
            details.url, '- resource type:', details.type,
            '- counted as:', category
        );
        logBlockedRequestDetails(details);
        return { redirectUrl: EMPTY_URL };
    },
    {
        urls: [
            '*://*.doubleclick.net/*',
            '*://*.googlesyndication.com/*',
            '*://*.fastly-insights.com/*',
            '*://*.sentry.io/*',
            '*://*.2mdn.net/*',
            '*://*.adxcel.com/*',
            '*://*.amillionads.com/*'
        ]
    },
    ['blocking']
);

// --- Layer 3b: first-party Spotify ad hosts (built in, no extra permission) -
//
// The 11 first-party ad/tracking hosts the Spotify Web app hardcodes and
// lists in hosts/extra_hosts.txt. They sit under spotify.com / scdn.co, which
// the manifest already has host permission for, so this works on a default
// install. Same order of checks as the app's shouldIntercept():
//   whitelist -> static-asset exit -> match -> media: silent clip / else: empty
// (the canvas step is Layer 1's opt-in branch above).
const FIRST_PARTY_AD_HOSTS = [
    'audio-ads.spotify.com',
    'ads-akp.spotify.com',
    'ads-fa.spotify.com',
    'ads-fa.scdn.co',
    'mp3ad.scdn.co',
    'adstudio-assets.scdn.co',
    'adstudio.spotify.com',
    'adeventtracker.spotify.com',
    'pixel.spotify.com',
    'pixel-static.spotify.com',
    'aet.spotify.com'
];
const FIRST_PARTY_SET = new Set(FIRST_PARTY_AD_HOSTS);

// Hosts covered by the built-in listeners (Layer 3 + 3b). The downloaded-list
// listener skips these so a request is never handled twice.
function matchesBuiltinHost(url, host) {
    return matchesInstantModeAdDomain(url) || U.hostBlocklistMatch(FIRST_PARTY_SET, host);
}

// Shared body for host-based blocking (Layer 3b and the downloaded list).
// `matches(host, url)` decides whether the host is on the list in question.
function blockByHost(details, matches) {
    if (!isFromSpotifyTab(details)) {
        return {};
    }
    const host = U.hostFromUrl(details.url);
    // Whitelist first, exactly like the app: core Spotify hosts (19 exact +
    // the "-spclient.spotify.com" suffix family) are never blocked by host.
    if (!host || U.isWhitelisted(host)) {
        return {};
    }
    // The app lets static assets through (.js .css .png ...) - same here.
    if (U.isStaticAsset(details.url)) {
        return {};
    }
    // Known ad-audio paths are Layer 1's job.
    if (details.type === 'media' && isKnownAdHost(details.url)) {
        return {};
    }
    if (!matches(host, details.url)) {
        return {};
    }
    const category = adBreakActive ? 'ad' : 'other';
    incrementBlockedCount(category);
    if (DEBUG) {
        console.log('[uSpot] Blocked by host list -', details.url, '- type:', details.type, '- counted as:', category);
    }
    return { redirectUrl: details.type === 'media' ? SILENT_MP4_URL : EMPTY_URL };
}

api.webRequest.onBeforeRequest.addListener(
    (details) => blockByHost(details, (host) => U.hostBlocklistMatch(FIRST_PARTY_SET, host)),
    { urls: U.hostsToPatterns(FIRST_PARTY_AD_HOSTS) },
    ['blocking']
);

// --- Layer 4: downloaded host list (+ podcast hosts), optional permission ---
//
// hosts/adblock_hosts.txt is compiled daily by the GitHub workflow and
// downloaded here. The bundled copy in the package is the offline fallback.
// Needs the optional <all_urls> host permission (requested from the popup),
// because the listed hosts are arbitrary third parties. Still scoped to
// requests that originate from open.spotify.com tabs (isFromSpotifyTab).
//
// Trust model: this is DATA, never code. The client checks what the app
// doesn't: a minimum size, a parse-error ceiling, a shrink guard, and it drops
// any entry that could block a whitelisted host or a bare Spotify root
// (U.isProtectedEntry). The repository owner still decides what is listed.
const REMOTE_LIST_URL = 'https://raw.githubusercontent.com/Myst1cX/uSpot/main/hosts/adblock_hosts.txt';
const REMOTE_PODCAST_URL = 'https://raw.githubusercontent.com/Myst1cX/uSpot/main/hosts/podcast_ad_hosts.txt';
const MAX_LIST_BYTES = 2 * 1024 * 1024;
const REFRESH_ALARM = 'uspot-refresh-hosts';
const REFRESH_MINUTES = 12 * 60;

let listHosts = [];
let podcastHosts = [];
let activeSet = new Set();
let hostListener = null;
let listMeta = { source: 'bundled', count: 0, podcastCount: 0, fetchedAt: 0, error: '', dropped: 0 };

function permContains(perms) {
    if (IS_FIREFOX_NATIVE) {
        return browser.permissions.contains(perms).catch(() => false);
    }
    return new Promise((resolve) => {
        chrome.permissions.contains(perms, (ok) => resolve(Boolean(ok)));
    });
}

async function fetchText(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
        // no-cache = always revalidate with the server (conditional GET), so a
        // 304 costs almost nothing; credentials omitted, nothing is sent but the request.
        const res = await fetch(url, { cache: 'no-cache', credentials: 'omit', signal: ctl.signal });
        if (res.status !== 200) {
            throw new Error('HTTP ' + res.status);
        }
        const text = await res.text();
        if (text.length > MAX_LIST_BYTES) {
            throw new Error('response too large');
        }
        return text;
    } finally {
        clearTimeout(timer);
    }
}

async function bundledHosts(file) {
    const res = await fetch(api.runtime.getURL(file));
    return U.parseHostsText(await res.text()).hosts;
}

async function initLists() {
    const st = await storageGet(['hostsList', 'podcastList', 'hostsMeta']);
    let source = 'cached';
    if (Array.isArray(st.hostsList) && st.hostsList.length) {
        listHosts = st.hostsList.filter((h) => U.isValidHostname(h));
    } else {
        listHosts = await bundledHosts('hosts/adblock_hosts.txt');
        source = 'bundled';
    }
    if (Array.isArray(st.podcastList) && st.podcastList.length) {
        podcastHosts = st.podcastList.filter((h) => U.isValidHostname(h));
    } else {
        podcastHosts = await bundledHosts('hosts/podcast_ad_hosts.txt');
    }
    listMeta = Object.assign(
        { source, fetchedAt: 0, error: '' },
        st.hostsMeta || {},
        { source: st.hostsMeta && st.hostsMeta.source ? st.hostsMeta.source : source }
    );
    rebuildActive();
}

function rebuildActive() {
    const hosts = [];
    if (settings.fullList) {
        Array.prototype.push.apply(hosts, listHosts);
    }
    if (settings.podcast) {
        Array.prototype.push.apply(hosts, podcastHosts);
    }
    const built = U.buildSet(hosts);
    activeSet = built.set;
    listMeta.count = listHosts.length;
    listMeta.podcastCount = podcastHosts.length;
    listMeta.dropped = built.dropped;
}

// Serialised so two overlapping triggers (settings change + refresh +
// permission event) can never leave two listeners registered.
let syncChain = Promise.resolve();
function syncHostListener() {
    syncChain = syncChain.then(doSyncHostListener).catch((e) => console.error('[uSpot] host listener sync failed:', e));
    return syncChain;
}

async function doSyncHostListener() {
    if (hostListener) {
        try {
            api.webRequest.onBeforeRequest.removeListener(hostListener);
        } catch (e) { /* already gone */ }
        hostListener = null;
    }
    if (!activeSet.size) {
        return;
    }
    if (!(await permContains({ origins: ['<all_urls>'] }))) {
        console.log('[uSpot] Host list is enabled but the extra permission has not been granted - open the popup and allow it');
        return;
    }
    const listener = (details) => blockByHost(
        details,
        (host, url) => !matchesBuiltinHost(url, host) && U.hostBlocklistMatch(activeSet, host)
    );
    try {
        // Only requests to listed hosts reach the callback.
        api.webRequest.onBeforeRequest.addListener(listener, { urls: U.hostsToPatterns(Array.from(activeSet)) }, ['blocking']);
        console.log('[uSpot] Host list active -', activeSet.size, 'hosts');
    } catch (e) {
        // Fallback if the browser rejects that many patterns: every request
        // reaches the callback, which does the host check itself.
        console.warn('[uSpot] Pattern filter rejected (' + e + '), falling back to <all_urls> with an in-callback check');
        api.webRequest.onBeforeRequest.addListener(listener, { urls: ['<all_urls>'] }, ['blocking']);
        console.log('[uSpot] Host list active (fallback) -', activeSet.size, 'hosts');
    }
    hostListener = listener;
}

let refreshing = null;
function refreshLists() {
    if (!refreshing) {
        refreshing = doRefresh().finally(() => { refreshing = null; });
    }
    return refreshing;
}

async function doRefresh() {
    const meta = Object.assign({}, listMeta);
    try {
        const parsed = U.parseHostsText(await fetchText(REMOTE_LIST_URL));
        const verdict = U.validateList(parsed, { minCount: 500, previousCount: listHosts.length });
        if (!verdict.ok) {
            throw new Error('list rejected: ' + verdict.reason);
        }
        listHosts = parsed.hosts;
        await storageSet({ hostsList: listHosts });
        meta.source = 'remote';
        meta.fetchedAt = Date.now();
        meta.error = '';
    } catch (e) {
        meta.error = String((e && e.message) || e);
        console.warn('[uSpot] Host list refresh failed, keeping the current list:', meta.error);
    }
    if (settings.podcast) {
        try {
            const parsed = U.parseHostsText(await fetchText(REMOTE_PODCAST_URL));
            const verdict = U.validateList(parsed, { minCount: 1 });
            if (!verdict.ok || parsed.hosts.length > 200) {
                throw new Error('podcast list rejected: ' + (verdict.reason || 'too many entries'));
            }
            podcastHosts = parsed.hosts;
            await storageSet({ podcastList: podcastHosts });
        } catch (e) {
            meta.error = (meta.error ? meta.error + '; ' : '') + String((e && e.message) || e);
        }
    }
    listMeta = meta;
    rebuildActive();
    await storageSet({ hostsMeta: listMeta });
    await syncHostListener();
    return listMeta;
}

// --- Layer 5: ad audio file IDs (from the page hook) ----------------------
//
// hook.js reads Spotify's player state and reports the audio file IDs of
// tracks flagged as ads. A request whose URL contains one of those IDs is
// answered with the silent clip, even when it comes from a CDN host that
// looks like music. Runs BEFORE any whitelist, like the app: ad audio can be
// served from whitelisted audio CDN hosts. Known to be inert for ads that
// carry no IDs (the app's own logs showed 0 IDs on every ad it saw).
//
// The listener is only registered while IDs exist, so normal playback does
// not pay for a callback on every scdn.co request.
let adIds = [];
let idListener = null;

function setAdIds(ids) {
    const clean = U.sanitizeAdIds(ids, 32);
    if (clean.length === adIds.length && clean.every((id, i) => id === adIds[i])) {
        return;
    }
    adIds = clean;
    syncIdListener();
    if (DEBUG) {
        console.log('[uSpot] Ad audio IDs from the page hook:', adIds.length);
    }
}

function syncIdListener() {
    if (idListener) {
        try {
            api.webRequest.onBeforeRequest.removeListener(idListener);
        } catch (e) { /* already gone */ }
        idListener = null;
    }
    if (!adIds.length) {
        return;
    }
    idListener = (details) => {
        if (details.url.length < 8) {
            return {};
        }
        // Media from known ad hosts / during a detected break is Layer 1's.
        if (details.type === 'media' && (isKnownAdHost(details.url) || adBreakActive)) {
            return {};
        }
        if (!adIds.some((id) => details.url.indexOf(id) !== -1)) {
            return {};
        }
        incrementBlockedCount('ad');
        console.log('[uSpot] Blocked ad audio - matched an ad file ID -', details.url, '- type:', details.type);
        return { redirectUrl: SILENT_MP4_URL };
    };
    api.webRequest.onBeforeRequest.addListener(
        idListener,
        {
            urls: ['*://*.scdn.co/*', '*://*.spotifycdn.com/*', '*://*.spotify.com/*'],
            types: ['media', 'xmlhttprequest', 'other']
        },
        ['blocking']
    );
}

// --- settings + lifecycle ---------------------------------------------------
function applySettings(stored) {
    settings = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    DEBUG = Boolean(settings.debug);
}

function listsWanted() {
    return Boolean(settings.fullList || settings.podcast);
}

api.storage.onChanged.addListener((changes, area) => {
    // Only the settings key. Counter writes (blockedAdCount etc.) never reach
    // the code below, see the note on the reset handler.
    if (area !== 'local' || !changes.settings) {
        return;
    }
    const before = settings;
    applySettings(changes.settings.newValue);
    const turnedOn =
        (settings.fullList && !before.fullList) ||
        (settings.podcast && !before.podcast);
    if (turnedOn) {
        refreshLists();
    } else {
        rebuildActive();
        syncHostListener();
    }
});

if (api.permissions && api.permissions.onAdded) {
    // Granted from the popup (the popup may close while the prompt is up, so
    // the background reacts to the permission itself, not to the popup).
    api.permissions.onAdded.addListener(() => syncHostListener());
    api.permissions.onRemoved.addListener(() => syncHostListener());
}

if (api.alarms) {
    api.alarms.create(REFRESH_ALARM, { delayInMinutes: 1, periodInMinutes: REFRESH_MINUTES });
    api.alarms.onAlarm.addListener((alarm) => {
        // Nothing is downloaded unless the person opted in to a list.
        if (alarm.name === REFRESH_ALARM && listsWanted()) {
            refreshLists();
        }
    });
}

storageGet(['settings'])
    .then((r) => {
        applySettings(r.settings);
        return initLists();
    })
    .then(() => {
        syncHostListener();
        if (listsWanted()) {
            refreshLists();
        }
    })
    .catch((e) => console.error('[uSpot] startup failed:', e));

console.log('[uSpot] Ready - watching media requests on scdn.co / spotifycdn.com / open.spotify.com');
console.log('[uSpot] First-party ad hosts (Layer 3b) active; downloaded host list (Layer 4) and ad file IDs (Layer 5) start on demand');
console.log('[uSpot] Instant-mode port active - also watching for doubleclick.net / googlesyndication.com / fastly-insights.com / sentry.io / 2mdn.net / adxcel.com / amillionads.com on Spotify tabs');
