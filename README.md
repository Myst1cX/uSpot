# uSpot
A browser extension that blocks Spotify web audio ads using the uBlock mv2 approach: blocked ads are replaced with a silent 1-second placeholder.   

# Installation on a computer device
1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file 
2. Firefox > Manage Extensions Settings (abot:addons page) > Install Add-on From File... > Select your signed .xpi file  

# Installation on a mobile device
1. uSpot repo > Click on the [Releases](https://github.com/Myst1cX/uSpot/releases/) tab > Download the signed xpi file 
2. Firefox > Open Settings > About Firefox > Enable the hidden developer/debug menu (tap the Firefox logo 5 times)   
3. Go back one screen > Choose Install extension from file > Select your signed .xpi file   

# uSpot vs Ublock Origin (What is the difference?)
uSpot essentially employs the same trick uBlock uses to block Spotify ads: 
it takes uBlock's own filter rules for Spotify's ad-audio CDN, and swaps the ad out for the same silent 1-second mp4 that uBlock uses.   
Both extensions are limited to manifest v2 because the redirect relies on the blocking webRequest API, which Chrome's manifest v3 strips out    
in favor of declarativeNetRequest — that's why this solution only works on Firefox and other non-Chromium forks, which still allow it.    
The key difference is that uSpot only focuses on intercepting audio ads. It doesn't detect ad banners or have cosmetic filtering   
that could remove the "Get Premium" button or other premium nagging elements. This also means uBlock Origin will still prevail    
as the first choice for most people, since uBlock's list gets updated by the community while this extension has to be manually updated if Spotify   changes CDN paths. Where uSpot makes sense is if you don't want or can't run a full ad blocker but still want the Spotify audio ads gone.
