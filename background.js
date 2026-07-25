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
const DEBUG = true;

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
api.runtime.onMessage.addListener((message, sender) => {
    if (message && message.type === 'resetBlockedCount') {
        blockedAdCount = 0;
        blockedOtherCount = 0;
        pendingAdIncrements = 0;
        pendingOtherIncrements = 0;
        return;
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
// Ported from Spotify_Web_1_0's native interceptor (smali/e/f.smali,
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
    const origin = details.documentUrl || details.originUrl || details.initiator || '';
    return origin.indexOf('open.spotify.com') !== -1;
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

console.log('[uSpot] Ready - watching media requests on scdn.co / spotifycdn.com / open.spotify.com');
console.log('[uSpot] Instant-mode port active - also watching for doubleclick.net / googlesyndication.com / fastly-insights.com / sentry.io / 2mdn.net / adxcel.com / amillionads.com on Spotify tabs');
