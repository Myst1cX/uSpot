# Credits

This extension is licensed under GPLv3 (see `LICENSE.txt`) because it
directly reuses two things from **uBlock Origin** (Copyright (C) Raymond
Hill and contributors — https://github.com/gorhill/uBlockOrigin, GPLv3):

## 1. The ad-blocking rules

The domains/paths in `AD_URL_PATTERNS` (background.js) are copied from
uBlock Origin's own bundled filter list, `assets/ublock/filters.min.txt`,
which contains these rules for `open.spotify.com`:

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
`web_accessible_resources/noop-1s.mp4` — the same file that list's
`redirect=noop-1s.mp4` rules point to.

## What is NOT from uBlock Origin

The code that applies the rules — a `webRequest.onBeforeRequest` listener
returning `{ redirectUrl: ... }` — is this extension's own implementation.
It is not copied from uBlock Origin's `traffic.js`.

## License text

- `LICENSE.txt` — this extension's own GPLv3 license.
- `THIRD_PARTY_LICENSES/uBlock-Origin-GPLv3.txt` — uBlock Origin's GPLv3, as
  distributed with uBlock Origin.
