# uSpot host lists

Source of the ad/tracker host list used by the extension. Same layout and safety rules as the
Spotify Web app's list, but this folder is uSpot's own: edits here do not affect the app.

## Files

| File | Edited by | Purpose |
|---|---|---|
| `adblock_hosts.txt` | the workflow (never by hand) | Compiled list. One `0.0.0.0 <domain>` per line. Fetched by the extension and bundled in each release as the offline fallback. |
| `extra_hosts.txt` | you | Always merged in. Exempt from the Spotify-family and podcast filters, so Spotify's own ad hosts live here. |
| `allow_hosts.txt` | you | Never in the compiled list (and their subdomains). Applied last, wins over upstream and `extra_hosts.txt`. |
| `podcast_ad_hosts.txt` | you | Opt-in list, **not compiled**. Used only when the popup's podcast toggle is on. Also stripped from the compiled list. |

Hand-edited files: one domain per line, `#` starts a comment. A listed domain also blocks its subdomains.

## Workflow

`.github/workflows/update-adblock-hosts.yml` runs `scripts/compile_hosts.py` daily at 03:00 UTC, on manual
dispatch, and on pushes to `main` that touch the workflow, the script, or the three hand-edited files. It commits
`hosts/adblock_hosts.txt` through the GitHub API (verified, `github-actions[bot]`) only if the file changed.

Compile steps: download Brave first-party, uBlock Origin `filters.txt`, AdGuard Mobile `adservers.txt` -> keep plain host
rules only (skip `$domain=` and other narrowing options) -> drop `spotify.com`, `scdn.co`, `spotifycdn.com`,
`spotifycdn.net` and podcast hosts from upstream -> add `extra_hosts.txt` -> remove `allow_hosts.txt` -> sort, write.

The old list is kept if a source fails, fewer than 1000 domains result, or the list shrinks more than 20%.

## URLs the extension uses

- `https://raw.githubusercontent.com/Myst1cX/uSpot/main/hosts/adblock_hosts.txt`
- `https://raw.githubusercontent.com/Myst1cX/uSpot/main/hosts/podcast_ad_hosts.txt`

## Common tasks

- **Block one more host:** add to `extra_hosts.txt`, push.
- **Unblock an upstream host:** add to `allow_hosts.txt`, push (allow the parent domain if the parent is listed).
- **Test locally:** `OUT_FILE=/tmp/test.txt python3 scripts/compile_hosts.py` from the repo root.

## Releases

Because the workflow commits the compiled list to `main`, every release zip already contains a current
`hosts/adblock_hosts.txt`. No manual copy step. The release workflow leaves out `scripts/`, `hosts/README.md`,
`extra_hosts.txt` and `allow_hosts.txt`.
