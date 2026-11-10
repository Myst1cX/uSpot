# uSpot

> A browser extension that blocks Spotify web audio ads using the uBlock mv2 approach: blocked ads are replaced with a silent 1-second placeholder.
> 
> `AD_URL_PATTERNS` in `background.js` are just uBlock Origin's own filter list (`assets/ublock/filters.min.txt`) for open.spotify.com, translated into `webRequest` match patterns. `noop-1s.mp4` is lifted straight from [uBlock's repo](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/noop-1s.mp4).
> 
> Two extra layers back that up: a DOM-based ad-break detector mutes the tab and widens the redirect to any unlisted host the moment ad UI shows up, and an "instant mode" listener (ported from Spotiduck app) blocks known ad-network/telemetry hosts on Spotify tabs.   
> The popup shows these as two separate counts - ads blocked, and trackers/telemetry blocked - since not every blocked request is an audible one.


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

> As of version 3.1, uSpot is no longer just a single-filter-list redirect, though. It now runs three layers: the original uBlock-derived CDN redirect, an **instant mode** listener (ported from Spotiduck) that blocks known ad-network/telemetry hosts on Spotify tabs (doubleclick.net, googlesyndication.com, fastly-insights.com, sentry.io, 2mdn.net, adxcel.com, amillionads.com), and a **DOM-based ad-break detector** (selectors sourced from Blockify) that mutes the tab and widens the redirect to any unlisted host the moment ad-break UI appears - a fallback for when Spotify serves an ad from a CDN not covered by the static filter list. The popup reflects this with two separate counters: ads blocked vs. trackers/telemetry blocked.

> The key difference from uBlock is scope: uSpot focuses solely on Spotify's audio ads and the network activity around them.   

> **Keep in mind you can still get rid of the premium nags without uBlock:**   
> MORE INFO HERE: [SpotiKit](https://github.com/Myst1cX/SpotiKit#installation)   
> Recommended setup: Spotifuck Mobile (mobile) or SpotiwebJS (desktop)

# See the extension in action:

<img width="300" height="242" alt="image" src="https://github.com/user-attachments/assets/6d3696f4-d850-41da-a38c-394d873e41d8" />


