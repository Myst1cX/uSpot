# uSpot
> A browser extension that blocks Spotify web audio ads using the uBlock mv2 approach: blocked ads are replaced with a silent 1-second placeholder.
> 
> `AD_URL_PATTERNS` in `background.js` are just uBlock Origin's own filter list (`assets/ublock/filters.min.txt`) for open.spotify.com, translated into `webRequest` match patterns. `noop-1s.mp4` is lifted straight from [uBlock's repo](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/noop-1s.mp4).  

# Installation on a computer device
> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file 
> 2. Firefox > Manage Extensions Settings (abot:addons page) > Install Add-on From File... > Select your signed .xpi file  

# Installation on a mobile device
> 1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file 
> 2. Firefox > Open Settings > About Firefox > Enable the hidden developer/debug menu (tap the Firefox logo 5 times)   
> 3. Go back one screen > Choose Install extension from file > Select your signed .xpi file   

# uSpot vs Ublock Origin (What is the difference?)
> uSpot essentially employs the same trick uBlock uses to block Spotify ads:   
> it takes uBlock's own filter rules for Spotify's ad-audio CDN, and swaps the ad out for the same silent 1-second mp4 that uBlock uses.   
> Both extensions are limited to manifest v2 because the redirect relies on the blocking webRequest API, which Chrome's manifest v3 strips out in favor of declarativeNetRequest - that's why this solution only works on Firefox and other non-Chromium forks, which still allow it.    
> The key difference is that uSpot only focuses on intercepting audio ads. It doesn't detect ad banners or have cosmetic filtering that could remove the "Get Premium" button or other premium nagging elements.   
> This also means uBlock Origin will still prevail as the first choice for most people, since uBlock's list gets updated by the community while this extension has to be manually updated if Spotify
> changes CDN paths.   
> Where uSpot makes sense is if you don't want or can't run a full ad blocker but still want the Spotify audio ads gone.

> **Keep in mind you can get still rid of the premium nags:**
> 1. Download a userscript manager (Recommended: [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/))
> 2. Couple the uSpot extension with one of the following userscripts:   
> a) SpotiwebJS (Desktop, visual premium spoof only): [install](https://raw.githubusercontent.com/Myst1cX/SpotiKit/main/SpotiwebJS.js)      
> b) SpotiKitMobileDesktop (my 7.31.fork, mobile-like layout + visual premium spoof): [install](https://raw.githubusercontent.com/Myst1cX/SpotiKit/main/SpotiKitMobileDesktop.user.js)       
> c) SpotiKitUI (the successor of SpotiKitMobileDesktop): [install](https://raw.githubusercontent.com/kitbodega/SpotiKit/main/SpotiKitUI.user.js)    
> d) Spotifuck Userscript (mobile-like layout + visual premium spoof): [install](https://raw.githubusercontent.com/Myst1cX/spotifuck-userscript/main/spotifuck-v6.user.js)   
> 3. On mobile, you will require a few more steps - tricking the browser with a User Agent:   
> 4. Install [Chameleon](https://addons.mozilla.org/en-US/android/addon/chameleon-ext/) extension    
> 5. Chameleon extension settings > Profile Panel (globe icon) > Select Random Profile (Desktop)   
> 6. Chameleon extension settings > Options Panel > Select the 'Profile' option under the 'Screen size' option   
> 7. Go back to Firefox browser > Firefox Settings > Site settings > Click on "DRM-controlled content" and select "Allowed"   
> 8. Restart Firefox    
> 9. Open Spotify Web and login to your account    
> 10. The interface should be mobile-friendly > If it ever resets, try redoing the Chameleon extension configuration and refreshing the Spotify page   
> 11. NOTE: Keep Desktop Mode (browser setting) disabled.  

# See the extension in action:

(Attaching a video soon)


