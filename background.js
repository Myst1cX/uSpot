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
// FIX vs the v1.0 extension: the URL pattern list now matches uBlock
// Origin's actual shipped filter rules for open.spotify.com (see above)
// instead of one guessed hostname, so a different ad-serving subdomain
// won't silently slip past the filter the way *://adstudio-assets.scdn.co/*
// alone could.
const AD_URL_PATTERNS = [
    '*://*.scdn.co/mp3/*',
    '*://adstudio-assets.scdn.co/audio/*',
    '*://*.scdn.co/mp3-ad/*',
    '*://adstudio-assets.spotifycdn.com/audio/*'
];

const SILENT_MP4_URL = browser.runtime.getURL('noop-1s.mp4');

let blockedCount = 0;

browser.storage.local.get('blockedCount').then((result) => {
    if (typeof result.blockedCount === 'number') {
        blockedCount = result.blockedCount;
    }
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
browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'resetBlockedCount') {
        blockedCount = 0;
    }
});

browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        blockedCount += 1;
        browser.storage.local.set({ blockedCount });
        console.log(
            '[Spotify Adblock Ext - MV2] Redirected ad request:',
            details.url,
            '(type:', details.type + ')'
        );
        return { redirectUrl: SILENT_MP4_URL };
    },
    { urls: AD_URL_PATTERNS },
    ['blocking']
);

console.log('[Spotify Adblock Ext - MV2] Ready - watching for ad-asset requests at the network layer');
