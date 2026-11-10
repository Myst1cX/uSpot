# uSpot

> A browser extension that blocks Spotify web audio ads using the uBlock mv2 approach: blocked ads are replaced with a silent 1-second placeholder.
> 
> `AD_URL_PATTERNS` in `background.js` are just uBlock Origin's own filter list (`assets/ublock/filters.min.txt`) for open.spotify.com, translated into `webRequest` match patterns. `noop-1s.mp4` is lifted straight from [uBlock's repo](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/noop-1s.mp4).
> 
> More layers back that up (all explained under **How it works** below): a DOM-based ad-break detector, a page hook that leaves ad tracks out of Spotify's playback state, first-party and third-party ad-host blocking (including an optional daily-updated host list), and ad audio file-ID matching.
> The popup shows two separate counts - ads blocked, and trackers/telemetry blocked - since not every blocked request is an audible one.


# Installation on a computer

a) Firefox and its forks:

> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file
> 2. Firefox > Manage Extensions Settings (abot:addons page) > Install Add-on From File... > Select the downloaded signed .xpi file

# Installation on a mobile device

a) Quetta Browser:

> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file
> 2. Quetta Browser > Press on the three dots next to the search bar's tab counter. > Click on the Extensions tab > Manage Extensions > Developer options... > (from .zip/.crx/.user.js) > Select the downloaded signed .xpi file

b) Firefox:

> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file
> 2. Firefox > Open Settings > About Firefox > Enable the hidden developer/debug menu (tap the Firefox logo 5 times)
> 3. Go back one screen > Choose Install extension from file > Select the downloaded signed .xpi file

# uSpot vs Ublock Origin (What is the difference?)

> uSpot essentially employs the same trick uBlock uses to block Spotify ads: it takes uBlock's own filter rules for Spotify's ad-audio CDN, and swaps the ad out for the same silent 1-second mp4 that uBlock uses. Both extensions are limited to manifest v2 because the redirect relies on the blocking webRequest API, which Chrome's manifest v3 strips out in favor of declarativeNetRequest - that's why this solution will only work on non-Chromium browsers and Chromium forks that still allow manifest v2.

> uSpot is no longer just a single-filter-list redirect, though: since 3.1 it adds an **instant mode** listener and a **DOM-based ad-break detector**, and 3.2 adds a page hook, first-party ad hosts, an optional downloaded host list and ad file-ID matching. See **How it works** below.

> The key difference from uBlock is scope: uSpot focuses solely on Spotify's audio ads and the network activity around them.   

> **Keep in mind you can still get rid of the premium nags without uBlock:**   
> MORE INFO HERE: [SpotiKit](https://github.com/Myst1cX/SpotiKit#installation)   
> Recommended setup: Spotifuck Mobile (mobile) or SpotiwebJS (desktop)

# How it works

> uSpot works in layers. They don't replace each other: each one catches something the others can miss. Every blocked request is answered in one of two ways. Audio/video requests get the silent 1-second `noop-1s.mp4`, so playback doesn't stall. Everything else (scripts, XHR, beacons) gets a bundled empty `empty.txt` with a normal 200, so the request succeeds with nothing in it instead of failing visibly.

| Layer | What it does | Permission / default |
|---|---|---|
| **1. Known ad-audio paths** | Redirects media requests on `*.scdn.co` / `*.spotifycdn.com` that match uBlock Origin's four Spotify ad-audio paths (`/mp3/`, `/mp3-ad/`, `adstudio-assets.../audio/`) to the silent clip. | always on |
| **2. Ad-break detector** | Watches the player for ad UI (`ad-companion-card` etc., selectors from Blockify), mutes the tab, hides the ad card, and **widens layer 1** to every media request on Spotify's domains until the break ends. Backstop for ads served from a host layer 1 doesn't list. | always on |
| **3. Instant mode** | Blocks ad-network/telemetry hosts (doubleclick.net, googlesyndication.com, fastly-insights.com, sentry.io, 2mdn.net, adxcel.com, amillionads.com), only for requests coming from open.spotify.com tabs. Ported from SpotiDuck. | always on |
| **3b. First-party ad hosts** | Blocks the 11 Spotify-owned ad/tracking hosts (`aet.`, `pixel.`, `ads-fa.`, `audio-ads.spotify.com`, `mp3ad.scdn.co`, ...). | always on |
| **4. Host list** | About 1,200 ad/tracker hosts, downloaded daily (see below). Optional podcast ad hosts (omny.fm etc.) use the same mechanism. | **off**, needs an extra permission |
| **5. Ad audio file IDs** | When the page hook sees an ad's audio file IDs, any request containing one of them gets the silent clip, even from a CDN host that looks like music. Does nothing for ads that carry no IDs. | on with the hook |
| **6. Page hook** | Runs inside the Spotify page, reads the player's state, and **leaves ad tracks out of it**, so the player skips the ad instead of waiting for the ad UI to appear and then muting it. Includes a watchdog that only acts if an ad break gets stuck. Ported from the author's Spotify Web app (itself adapted from SpotiDuck). | **on** |

> Layers 3, 3b and 4 only look at requests that come from open.spotify.com, so uSpot never turns into a general-purpose blocker for the rest of your browsing.

### Options (popup)

> | Option | Default | Notes |
> |---|---|---|
> | Skip ads in the player | on | the page hook (layer 6) |
> | Recovery watchdog | on | part of the hook; only acts on a stuck break |
> | Full ad-host list | off | layer 4; asks for the optional "access all sites" permission |
> | Podcast ad hosts | off | same permission and download |
> | Block Canvas videos | off | answers looping artist videos with an empty response; video hosts Spotify needs are never touched |
> | Debug logging | on | console output for troubleshooting |
>
> The permission is requested only when you tick the list or podcast option, and removed again when both are off.

### The host list and its updates

> `hosts/adblock_hosts.txt` is rebuilt every day by a GitHub workflow (`.github/workflows/update-adblock-hosts.yml`) from three public lists (Brave Shields, uBlock Origin, AdGuard Mobile), plus `hosts/extra_hosts.txt` (hand-maintained), minus `hosts/allow_hosts.txt` (hand-maintained). `hosts/README.md` explains the files and how to change them. When enabled, the extension downloads the list from this repo at startup and every 12 hours, keeps it in local storage, and falls back to the copy bundled in the extension if the download fails.
>
> The download is treated as data, never code, and is checked before use: at least 500 entries, almost all lines parseable, and not suddenly much smaller than the list in use. A rejected download keeps the previous list, and the popup shows why.

### Never-block whitelist

> Whatever a list says, uSpot never blocks Spotify's core hosts by host rule: `spclient`, `login5`, `open`, `api`, `api-partner` and `partners.wg` on `spotify.com`, the audio/video/metadata hosts on `scdn.co` and `spotifycdn.com` that playback needs, two non-Spotify hosts the app also protects, and **any host ending in `-spclient.spotify.com`** (the regional shards such as `gew1-`, `gae-`, `guc-spclient`). The suffix rule lives in the extension code, because a plain list file can't express it. List entries that would cover a whitelisted host (for example `spotify.com` itself) are dropped when the list loads. The whitelist is a port of the Spotify Web app's own `isWhitelisted()`.
>
> It guards host-based blocking only. Layer 1's path rules and layer 5's file IDs run before it on purpose, because ad audio can be served from audio hosts that are on the whitelist.

### Limits

> - Needs a browser that still supports manifest v2 blocking `webRequest` (Firefox and forks; Chromium forks that keep MV2).
> - Spotify can change its player or CDN paths at any time. The host list updates itself, but the hook and the built-in paths update only with a new extension release.
> - The hook rewrites what the player is told about its own state, and Spotify's terms don't allow ad blocking. Use at your own risk; it can be switched off in the popup.
> - Ads that carry no file IDs and come from an unlisted host are caught only by the ad-break detector (mute plus widened redirect).

# Privacy

> uSpot collects nothing. The only network request it makes itself is the optional host-list download from `raw.githubusercontent.com` (GitHub sees your IP address and the request, like any download), and only after you enable the list or podcast option.

# Development

> `node tests/hosts.test.js`, `node tests/background.test.js` and `node tests/hook_relay.test.js` run the unit tests (no dependencies). To change what the list blocks or allows, edit `hosts/extra_hosts.txt` or `hosts/allow_hosts.txt` and push; the workflow recompiles it.

# See the extension in action:

<img width="300" height="242" alt="image" src="https://github.com/user-attachments/assets/805d03e9-2470-4ba4-b07e-de3561a20fdc" />

