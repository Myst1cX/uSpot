// uSpot - Spotify Adblocker: ad-break DOM fallback (mute + redirect)
//
// Attribution:
// - The panel container ID (Desktop_PanelContainer_Id) and the three
//   selectors below (data-testid="ad-companion-card",
//   data-testid="ad-companion-card-tagline",
//   a[data-context-item-type="ad"]) were found in Blockify
//   (nfmlkliedggdodlbgghmmchhgckjoaml), where this exact detection shape
//   drives that extension's own tab-mute call. Confirmed live against the
//   current open.spotify.com web player before porting - both the panel
//   ID and the selectors hold up.
// - Blockify does not hide the ad-companion card with this detection;
//   that remains this project's own addition, done separately via
//   styles.css and unrelated to this file.
//
// This is a third, independent layer. It does not replace the
// network-layer redirect (background.js on MV2 / rules.json on MV3) and
// it does not hide the ad-companion card (styles.css). It exists purely
// as a backstop for ad requests coming from a host not in the known
// AD_URL_PATTERNS/rules.json list: while this script has detected an
// active ad break, background.js widens its redirect to any media
// request under scdn.co/spotifycdn.com/open.spotify.com (not just the
// four known patterns), and mutes the tab as a second line of defense
// for the brief window before that redirect rule takes effect.
//
// Deliberately scoped to the panel container, not document-wide:
// a[data-context-item-type="ad"] in particular could plausibly appear
// elsewhere in Spotify's UI (e.g. a sponsored playlist card), and a
// document-wide query would risk triggering the fallback based on
// something that isn't an active audio ad - a worse failure mode than
// the gap this closes.
//
// Identical file on both MV2 and MV3 - the compat shim below is only
// needed because MV3 ships on Chrome too, which has no `browser` global.
const api = typeof browser !== 'undefined' ? browser : chrome;

const PANEL_CONTAINER_ID = 'Desktop_PanelContainer_Id';
const AD_TEXT_FALLBACK = 'Your music will continue after the break';
const DEBOUNCE_MS = 500;

let lastAdState = false;
let debounceTimer = null;

// Answers background.js's post-block snapshot request (see
// requestBlockedAreaSnapshot() there for why this has to live here rather
// than in the background script - background.js has no DOM at all). Logs
// straight to the page console, same place the Ad break detected/ended
// lines already go, so it's easy to correlate the two by eye or by
// filtering on "[uSpot]".
api.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'uspotCaptureBlockedArea') {
        return;
    }
    const panel = document.getElementById(PANEL_CONTAINER_ID);
    if (panel) {
        console.log(
            '[uSpot] Blocked-area snapshot for', message.blockedUrl,
            '- panel outerHTML (truncated):', panel.outerHTML.slice(0, 3000)
        );
    } else {
        console.log(
            '[uSpot] Blocked-area snapshot for', message.blockedUrl,
            '- panel container not found (#' + PANEL_CONTAINER_ID + ') at block time,',
            'falling back to document.body outerHTML (truncated):',
            document.body.outerHTML.slice(0, 3000)
        );
    }
});

// Card-hide note: styles.css also carries a static
// `[data-testid="ad-companion-card"] { display: none !important; }` rule,
// but on the live web player that rule loses the cascade - Spotify's own
// design system ("Encore", the e-10451-* classes below) appears to use
// CSS cascade layers, and a layered !important declaration beats an
// unlayered one regardless of specificity. Confirmed via a live capture:
// selector and markup both matched exactly, card still rendered visibly.
// Setting display via inline style from JS sits above layers entirely, so
// that's the actual hide mechanism now - styles.css is left in place as a
// zero-cost first frame of defense, not the thing doing the real work.
function hideAdCompanionCard(panel) {
    if (!panel) {
        return;
    }
    const card = panel.querySelector('[data-testid="ad-companion-card"]');
    if (card && card.style.display !== 'none') {
        card.style.setProperty('display', 'none', 'important');
        console.log('[uSpot] Hid ad-companion-card via inline style (static CSS rule was being lost to Spotify\'s own cascade layers)');
    }
}

// Returns { reason, element } if the panel shows ad-break state, or null
// if it doesn't. Returning the actual element (not just a description) is
// what lets you jump to it in DevTools - the ad-break window is short
// enough (esp. with the redirect cutting real ad audio to ~1s) that
// manually right-clicking the live page during an ad isn't reliable.
function detectAdBreak(panel) {
    if (!panel) {
        return null;
    }
    let el = panel.querySelector('[data-testid="ad-companion-card"]');
    if (el) {
        return { reason: 'ad-companion-card element present', element: el };
    }
    el = panel.querySelector('[data-testid="ad-companion-card-tagline"]');
    if (el) {
        return { reason: 'ad-companion-card-tagline element present', element: el };
    }
    el = panel.querySelector('a[data-context-item-type="ad"]');
    if (el) {
        return { reason: 'ad context-item link present', element: el };
    }
    // Secondary, English-only fallback - only checked if none of the
    // data-testid/data-context-item-type selectors above matched.
    if (panel.textContent.includes(AD_TEXT_FALLBACK)) {
        return { reason: 'text fallback matched: "' + AD_TEXT_FALLBACK + '"', element: panel };
    }
    return null;
}

function checkAdState() {
    const panel = document.getElementById(PANEL_CONTAINER_ID);

    // Runs every debounced check, independent of the state-change gate
    // below - the card should get hidden the moment it appears, not only
    // when it flips overall ad-break state.
    hideAdCompanionCard(panel);

    const detected = detectAdBreak(panel);
    const isAdBreak = Boolean(detected);

    // Only message the background script on a state change, not on every
    // debounced mutation batch - avoids spamming tabs.update/rule-update
    // calls while an ad break (or a normal track) is just sitting there.
    if (isAdBreak === lastAdState) {
        return;
    }
    lastAdState = isAdBreak;

    if (isAdBreak) {
        // Logged as two arguments on purpose: DevTools renders an element
        // argument as an inspectable/clickable node, not just text - click
        // it (or right-click > "Reveal in Elements panel") to see exactly
        // what matched, while it's still in the DOM.
        console.log('[uSpot] Ad break detected -', detected.reason, '- matched element:', detected.element);
        // Also logged as plain text (outerHTML, truncated) so it can be
        // copy-pasted straight out of the console - the clickable element
        // reference above doesn't survive a copy/paste.
        console.log('[uSpot] Matched element outerHTML:', detected.element.outerHTML.slice(0, 2000));
    } else {
        console.log('[uSpot] Ad break ended - panel no longer shows ad-break state');
    }

    api.runtime.sendMessage(
        isAdBreak ? { muteTab: true, reason: detected.reason } : { Unmute: true }
    );
}

const observer = new MutationObserver(() => {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(checkAdState, DEBOUNCE_MS);
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true
});

console.log('[uSpot] Ad-break DOM fallback watching for state changes');
