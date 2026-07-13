# uSpot
> A browser extension that blocks Spotify web audio ads using the uBlock mv2 approach: blocked ads are replaced with a silent 1-second placeholder.
> 
> `AD_URL_PATTERNS` in `background.js` are just uBlock Origin's own filter list (`assets/ublock/filters.min.txt`) for open.spotify.com, translated into `webRequest` match patterns. `noop-1s.mp4` is lifted straight from [uBlock's repo](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/noop-1s.mp4).  

# Installation on a computer
a) Firefox:
> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file 
> 2. Firefox > Manage Extensions Settings (abot:addons page) > Install Add-on From File... > Select the downloaded signed .xpi file  

# Installation on a mobile device

a) Quetta Browser: 
> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file
> 2. Quetta Browser > Press on the three dots next to the search bar's tab counter. > Click on the Extensions tab > Manage Extensions > Developer options... > (from .zip/.crx/.user.js) > Select the downloaded signed .xpi file   
>
b) Firefox:
> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file 
> 2. Firefox > Open Settings > About Firefox > Enable the hidden developer/debug menu (tap the Firefox logo 5 times)   
> 3. Go back one screen > Choose Install extension from file > Select the downloaded signed .xpi file   

# uSpot vs Ublock Origin (What is the difference?)
> uSpot essentially employs the same trick uBlock uses to block Spotify ads:   
> it takes uBlock's own filter rules for Spotify's ad-audio CDN, and swaps the ad out for the same silent 1-second mp4 that uBlock uses.   
> Both extensions are limited to manifest v2 because the redirect relies on the blocking webRequest API, which Chrome's manifest v3 strips out in favor of declarativeNetRequest - that's why this solution will only work on non-Chromium browsers and Chromium forks that still allow manifest v2.    
> The key difference is that uSpot only focuses on intercepting audio ads. It doesn't detect ad banners or have cosmetic filtering that could remove the "Get Premium" button or other premium nagging elements.   
> This also means uBlock Origin will still prevail as the first choice for most people, since uBlock's list gets updated by the community while this extension has to be manually updated if Spotify
> changes CDN paths.   
> Where uSpot makes sense is if you don't want a full adblock extension but only a solution to Spotify's audio ads.

> **Keep in mind you can get still rid of the premium nags:**
> MORE INFO HERE: [SpotiKit](https://github.com/Myst1cX/SpotiKit#installation)
> Recommended setup: Spotifuck Mobile (mobile) + SpotiwebJS (desktop)

# See the extension in action:

(Attaching a video soon)


