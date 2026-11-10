# Credits

This extension is licensed under GPLv3 (see `LICENSE.txt`) because it
directly reuses two things from **uBlock Origin** (Copyright (C) Raymond
Hill and contributors — https://github.com/gorhill/uBlockOrigin, GPLv3):

## 1. The ad-blocking rules

The domains/paths in `AD_URL_PATTERNS` (background.js) are copied from
uBlock Origin's own bundled filter list, `assets/ublock/filters.min.txt`,
which as of 8.7.'26 contained these rules for `open.spotify.com`:

```
||scdn.co/audio/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
||scdn.co/mp3-ad/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
||scdn.co/mp3/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
||spotifycdn.com/audio/$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
||adstudio-assets.scdn.co^$media,redirect=noop-1s.mp4:10,domain=open.spotify.com
```

This extension's `AD_URL_PATTERNS` array is these same domains, translated
into `webRequest` match-pattern syntax.

## 2. The replacement file

`noop-1s.mp4` is an exact, byte-for-byte copy of uBlock Origin's
`src/web_accessible_resources/noop-1s.mp4` — the same file that list's
`redirect=noop-1s.mp4` rules point to. (obtained on 8.7.'26)

## What is NOT from uBlock Origin

The code that applies the rules — a `webRequest.onBeforeRequest` listener
returning `{ redirectUrl: ... }` — is this extension's own implementation.
It does not come from uBlock Origin's `traffic.js`.

## Added in 3.2: ported from the Spotify Web app

These parts come from the author's own Spotify Web app (a separate project that wraps the Spotify web player; it is not an official Spotify app), which in turn
follows SpotiDuck and Myspoti (see that app's `THIRD_PARTY_NOTICES.txt`).

- **`hook.js`** is the app's `ad_state_hook.js` (version 2), adapted to run in
  a browser extension: the two calls to the app's AndBridge were replaced with
  `window.postMessage` to `relay.js`, and the popup switches were added. As the
  app's own credits say, it draws on two projects:
  - **SpotiDuck** by 23fpsz (https://github.com/23fpsz/SpotiDuck-Releases,
    GPL-3.0): the ad-ID hook itself, adapted from SpotiDuck's
    `ad_state_hook.js`. It reads Spotify's player state and collects the audio
    file IDs of tracks flagged as ads. SpotiDuck's file credits Blockify
    (blockify-desktop) and Spotilol, and SpotiDuck is itself built on
    Spotifuck by deviato.
  - **Myspoti** by kota-zo (https://github.com/kota-zo/myspoti, GPL-3.0): the
    ad markers, the idea of leaving an ad out of the playback state, and the
    way the page's own player is reached (read-only, to watch the playing
    song and to recover a stuck break). These follow what Myspoti documents
    about Spotify's web player; the code is new JavaScript, not a copy.
- **Host list, whitelist and request order** (`lib/hosts.js`, the Layer 3b/4/5
  code in `background.js`): ported from the app, which takes these from
  SpotiDuck: the hosts-list handling (hosts-file and AdBlock-style parsing,
  host then parent-domain matching), the built-in ad host set, and checking
  ad audio file IDs before the whitelist. The compiled list's sources and
  format also follow SpotiDuck. The 19-host whitelist and
  its `-spclient.spotify.com` suffix rule mirror the app's `isWhitelisted()`.
- **`hosts/adblock_hosts.txt`** is compiled by `scripts/compile_hosts.py` from
  three upstream lists (only plain host rules are taken): Brave Shields
  first-party list (https://github.com/brave/adblock-lists), uBlock Origin
  `filters.txt` (https://github.com/uBlockOrigin/uAssets) and AdGuard Mobile
  Filter `adservers.txt` (https://github.com/AdguardTeam/AdguardFilters),
  plus `hosts/extra_hosts.txt` minus `hosts/allow_hosts.txt`. The lists stay
  under their own licenses; check each project for the current terms.

## License text

- `LICENSE.txt` — this extension's own GPLv3 license.
- `THIRD_PARTY_LICENSES/uBlock-Origin-GPLv3.txt` — uBlock Origin's GPLv3, as
  distributed with uBlock Origin.
