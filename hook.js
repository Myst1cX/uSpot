/*
 * uSpot adaptation of the Spotify Web app's ad_state_hook.js (v2).
 *
 * Runs in the page's own JavaScript world (manifest content_scripts "world": "MAIN", document_start),
 * so it can wrap the page's fetch / WebSocket. It has no access to extension APIs: everything that used to
 * go to the Android app's AndBridge now goes through window.postMessage to relay.js (an isolated content
 * script), which forwards to background.js:
 *   - AndBridge.dbgt(level, 'adblock', msg)  ->  postMessage {__uspot:1, kind:'log', level, msg}
 *   - AndBridge.recAdContentIds(json)        ->  postMessage {__uspot:1, kind:'ids', ids:[...]}
 * and relay.js sends the popup settings back as {__uspotCfg:1, rewriteOff, recoveryOff} (the popup's
 * "Skip ads in the player" / "Recovery watchdog" switches). The localStorage / sessionStorage kill switches
 * documented below still work as well.
 * Everything else is unchanged from the app's hook; the original header follows. Credits: SpotiDuck
 * (GPL-3.0), myspoti (GPL-3.0), see CREDITS.md.
 */
/*
 * !!! THE AD-CURRENT REPLY FIX (66f) WAS REMOVED IN v2. DO NOT BRING IT BACK. !!!
 * What it was: when a state reply made an ad current, followAdChain pointed updated_state_ref at the first real song after the ad chain,
 * hoping the page would never show the break. Why it is gone (tested on the phone, v1.67-v1.71 logs):
 *  - It saved only about 0.3-0.5 s. The ad UI is up 2.3-3.7 s with it and 4.4-4.8 s without it, and the song starts about as fast.
 *  - It broke the page. The page's player still held the last ad's 1 s silent audio, so the page SHOWED the song but sat on the ad's audio
 *    (logged as "current, 1.0s long" in every break): a stuck song with a pause icon and no sound.
 *  - Getting out of that state needed a recovery "watcher" (66g, reworked in v1.68-v1.70): wait until the ad UI is gone, then load the song
 *    through PlayerAPI (play in context; skipToNext stepped past the song). A play REBUILDS the playlist's upcoming songs: "next from
 *    playlist" was reset after every break (the user queue survived), and once the play made Spotify serve the remaining ad again.
 *  - Without the fix (v1.70 with the switch off, confirmed on the phone: a skip, a song that ends on its own, and one that ends on its own
 *    after a queue change) the page moves to the SAME song by itself after the last ad, with its real duration, and the playlist is unchanged.
 *  - Rules: do not add a reply fix again. Do not call play / skipToNext in the normal path. The only code that may load a song is the
 *    recovery watchdog, and only for a stuck break.
 *  - THE RECOVERY WATCHDOG CAN LOSE THE "NEXT FROM PLAYLIST" LIST. It is for a STUCK break only (still on an ad 12 s into the break, or on
 *    the planned song with the ad's length). When it does load the planned song it uses play-in-context, and a play REBUILDS the playlist's
 *    upcoming songs (the user queue survives). In a normal break it does not load anything; it only logs "recovery check: ... left alone".
 *    It is omittable: localStorage.setItem('adRecoveryOff','1') (removeItem to undo). Without it a break that hangs on its last ad stays hung
 *    until the user presses next, but the playlist's next songs are never touched.
 *  - Tested without the fix (v1.70 + the old adCurrentOff switch, confirmed on the phone): a skip (Tokyo -> Deja Vu), a song that ends on its
 *    own (Plot Twist -> No Reason) and a song that ends on its own after songs were added to the queue (the plan followed the queue change,
 *    Wach -> Memories). In all three the planned song played, the playlist's upcoming songs were unchanged and the queue was kept. No hang.
 *  - v2 on the phone (5 breaks, confirmed by you): in every normal break the watchdog only logged "recovery check: ... left alone" and
 *    loaded nothing, and the order of Next up, the queue and next from the playlist was kept. Still untested on the phone: the stuck path
 *    (an actual load). It is only covered by a mock test, because no break has been stuck since the reply fix was removed.
 *  - The old switches adCurrentOn / adCurrentOff are ignored now; a value left in localStorage does nothing.
 */
/*
 * Ad-state hook (v2, app 1.67). Injected at page start on open.spotify.com.
 * Watches Spotify's player-state traffic (fetch responses for /state and connect-state,
 * and WebSocket messages), finds tracks flagged as ads, collects their audio file IDs and
 * hands the latest set to the app via AndBridge.recAdContentIds(jsonArray).
 * The app then silences any media request whose URL contains one of those IDs, which
 * catches ad audio served from CDN hosts that look like music by host/path alone.
 * Adapted from SpotiDuck's assets/ad_state_hook.js (github.com/23fpsz/SpotiDuck-Releases, GPL-3.0): same approach, same
 * file-ID rules, same list of fields and manifest groups it reads, and the same limits (32 IDs, 8 MB). Functions are renamed
 * and the publish step is merged into the payload handler. SpotiDuck's file in turn credits Blockify (blockify-desktop)
 * and Spotilol.
 *
 * What it does now:
 *  - First ad try: the ad is left out of the playback state (the song's "advance" is pointed at the song its "skip_next" leads to).
 *  - Second ad try (advance and skip_next both lead to the ad): nothing can be rewritten, so it stores a plan (the song after the ad) and lets
 *    the ad run out. The app answers the ad audio host with silent.mp3, so each ad lasts about 1 s and the page moves on to the planned song
 *    by itself. The hook does not hide the ad UI; it logs it.
 *  - Ad UI watcher and plan watch: diagnostics in the Logger (tag adblock, only stored while Debug Logging is on).
 *  - Recovery watchdog: armed when an ad UI shows and a plan exists; checks the page's player once the ad UI is gone and loads the planned
 *    song only if the break is stuck.
 *  - Switches (localStorage persists across app restarts, sessionStorage lasts for the page session; set to '1', removeItem to undo):
 *    adRewriteOff turns off the leave-out, the plan and the watchdog (ID collection and the UI watchers keep running);
 *    adRecoveryOff turns off only the watchdog. The install line in the log shows what is on.
 *
 * History:
 *  - 66b (kept): extra ad markers (metadata.is_advertisement, metadata.ad_id, a spotify:ad: uri, next to content_type "AD"); the leave-out
 *    rewrite, the same rule as myspoti's withoutAds (kota-zo/myspoti, GPL-3.0, docs/api/ADS.md and BridgeHost.kt; this JS is a
 *    re-implementation); a circuit breaker that switches the rewrite off if state reports start failing right after a rewrite; the kill
 *    switch adRewriteOff; the Logger lines; the ad UI watcher.
 *  - 66c-66e (removed in 66f): an early play of the next song before the playing song ends, a next-button guard on PlayerAPI.skipToNext,
 *    an active-device check. The page player lookup from this item is kept (it is read by the plan watch and the watchdog).
 *  - 66f (removed in v2): the ad-current reply fix, its put-back (insertIntoQueue / addToQueue when the page landed on another song) and
 *    the adCurrentOn / adCurrentOff switches. See the banner at the top.
 *  - 66g (replaced): the recovery after the fix. Its trigger (an ad-length media element firing 'ended', or the ad UI going away) and its
 *    DOM check were later found blind in the app (the page's audio is not in the DOM); the DOM code was removed in v2.
 *  - v1.68: the plan is not cleared by a reply whose current state is the ad; the ad UI poll runs every 250 ms; the recovery grace is 400 ms.
 *  - v1.69: the recovery asks the page's player (getState) instead of the DOM; the plan watch was added.
 *  - v1.70: a recovery whose load brought the ad back can be armed once more (at most 2 tries per song).
 *  - v1.71: the reply fix off by default; the recovery became a watchdog for a stuck break only, with its own switch adRecoveryOff.
 *  - v2 (called v1.72 while in development; ships in app 1.67; v1.67-v1.71 above were development iterations, never released): the reply fix, the put-back and the DOM media code removed; stale log text and comments fixed (the "ad due" line, the page
 *    player API warning, comments about the plan, the breaker and the ids).
 */
(function () {
  if (window.__adStateHook) return;
  window.__adStateHook = 1;

  // ---- uSpot: popup settings, sent by relay.js (default: everything on) ----
  var cfg = { rewriteOff: false, recoveryOff: false };
  try {
    window.addEventListener('message', function (e) {
      if (e.source !== window) return;
      var d = e.data;
      if (!d || d.__uspotCfg !== 1) return;
      cfg.rewriteOff = d.rewriteOff === true;
      cfg.recoveryOff = d.recoveryOff === true;
    });
  } catch (e) {}
  function toExt(msg) {
    try { msg.__uspot = 1; window.postMessage(msg, location.origin); } catch (e) {}
  }

  var MAX_IDS = 32, MAX_TEXT = 8000000;
  var ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;
  var order = [], seen = {}, lastSent = '';

  // ---- Logger (tag "adblock"); the native side keeps lines only while Debug Logging is on ----
  function log(level, msg) {
    toExt({ kind: 'log', level: level, msg: String(msg) });
  }

  function add(v) {
    if (typeof v !== 'string' || !ID_RE.test(v) || seen[v]) return false;
    seen[v] = 1; order.push(v);
    while (order.length > MAX_IDS) delete seen[order.shift()];
    return true;
  }

  // Names of the markers that flag a state-machine track as an ad (empty array = not an ad).
  function adFlags(t) {
    var m = (t.metadata && typeof t.metadata === 'object') ? t.metadata : {};
    var f = [];
    var c = [
      ['content_type', t.content_type], ['contentType', t.contentType], ['type', t.type],
      ['metadata.content_type', m.content_type], ['metadata.contentType', m.contentType],
      ['metadata.is_ad', m.is_ad], ['metadata.isAd', m.isAd], ['is_ad', t.is_ad], ['isAd', t.isAd]
    ];
    for (var i = 0; i < c.length; i++) {
      var v = c[i][1];
      if (v === true) { f.push(c[i][0]); continue; }
      if (typeof v === 'string') {
        var u = v.toUpperCase();
        if (u === 'AD' || u === 'ADVERTISEMENT' || u === 'TRUE') f.push(c[i][0]);
      }
    }
    // markers from myspoti's notes: all of them were present on every ad it captured, none on a song
    var adv = m.is_advertisement;
    if (adv === true || (typeof adv === 'string' && adv.toLowerCase() === 'true')) f.push('metadata.is_advertisement');
    var uri = typeof m.uri === 'string' ? m.uri : (typeof t.uri === 'string' ? t.uri : '');
    if (uri.indexOf('spotify:ad:') === 0) f.push('spotify:ad: uri');
    if ((typeof m.ad_id === 'string' && m.ad_id) || (typeof t.ad_id === 'string' && t.ad_id)) f.push('ad_id');
    return f;
  }

  function flaggedAd(t) { return adFlags(t).length > 0; }

  function addAll(list) {
    var n = false;
    if (!list || !list.length) return n;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (typeof e === 'string') n = add(e) || n;
      else if (e) n = (add(e.file_id) | add(e.fileId) | add(e.id)) || n;
    }
    return n;
  }

  // One Logger line per ad the first time it is seen in the player state.
  var loggedAds = {};
  function logAd(t, flags, ids) {
    try {
      var m = (t.metadata && typeof t.metadata === 'object') ? t.metadata : {};
      var key = m.uri || t.uri || m.ad_id || t.ad_id || ids;
      if (loggedAds[key]) return;
      loggedAds[key] = 1;
      var name = m.name || m.title || t.name || t.title || '?';
      var who = m.advertiser || t.advertiser || '';
      var dur = m.duration || t.duration || '';
      log('i', 'ad in player state: "' + name + '"' + (who ? ' by ' + who : '') + (dur ? ', ' + dur + ' ms' : '') +
        ', flagged by ' + flags.join(' + ') + ', ' + ids + ' audio file id(s)');
    } catch (e) {}
  }

  function tracks(list) {
    var n = false;
    if (!list || !list.length) return n;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || typeof t !== 'object') continue;
      var flags = adFlags(t);
      if (!flags.length) continue;
      var before = order.length, any = false;
      var man = t.manifest;
      if (man && typeof man === 'object') {
        any = addAll(man.file_ids_mp3) || any;
        any = addAll(man.file_ids_external) || any;
        any = addAll(man.file_ids) || any;
        any = addAll(man.alternatives) || any;
      }
      any = (add(t.file_id) | add(t.fileId)) || any;
      n = any || n;
      logAd(t, flags, order.length - before);
    }
    return n;
  }

  function machine(sm) {
    if (!sm || typeof sm !== 'object') return false;
    var n = tracks(sm.tracks);
    n = tracks(sm.track_list) || n;
    if (sm.queue && typeof sm.queue === 'object') n = tracks(sm.queue.tracks) || n;
    return n;
  }

  function payload(p) {
    if (!p || typeof p !== 'object') return;
    var n = machine(p.state_machine);
    n = machine(p.stateMachine) || n;
    if (p.payloads && p.payloads.length) {
      for (var i = 0; i < p.payloads.length; i++) {
        var e = p.payloads[i];
        if (e && typeof e === 'object') { n = machine(e.state_machine) || n; n = machine(e.stateMachine) || n; }
      }
    }
    if (!n) return;
    var s;
    try { s = JSON.stringify(order); } catch (e) { return; }
    if (s === lastSent) return;
    lastSent = s;
    toExt({ kind: 'ids', ids: order.slice() });
  }

  function fromText(v) {
    if (typeof v !== 'string') return;
    if (v.length > MAX_TEXT) return;
    if (v.indexOf('state_machine') < 0 && v.indexOf('stateMachine') < 0) return;
    try { payload(JSON.parse(v)); } catch (e) {}
  }

  function fromSocket(d) {
    if (typeof d === 'string') { fromText(d); return; }
    if (typeof Blob === 'function' && d instanceof Blob) {
      if (d.size <= MAX_TEXT) d.text().then(fromText).catch(function () {});
      return;
    }
    if (typeof ArrayBuffer === 'function' && d instanceof ArrayBuffer && d.byteLength <= MAX_TEXT) {
      try { fromText(new TextDecoder().decode(d)); } catch (e) {}
    }
  }

  // ---- Ad left out of the playback state (item 66b) ----
  var rewrites = 0, lastRewrite = 0, lateFails = 0, breakerOff = false, lastNote = '';

  // The same queued ad comes back in every state reply for minutes: log a note only when its text changes.
  function logOnce(level, text) {
    if (text === lastNote) return;
    lastNote = text;
    log(level, text);
  }

  function rewriteOn() {
    if (breakerOff) return false;
    if (cfg.rewriteOff) return false;
    try { if (localStorage.getItem('adRewriteOff') === '1') return false; } catch (e) {}
    try { if (sessionStorage.getItem('adRewriteOff') === '1') return false; } catch (e) {}
    return true;
  }

  function stateIdx(o) {
    if (!o || typeof o !== 'object') return -1;
    var v = parseInt(o.state_index, 10);
    return v >= 0 ? v : -1;
  }

  // Lookups on a state machine: state index -> track, ad flag, name, uri, metadata.
  function smTools(sm) {
    var tracksArr = sm.tracks, states = sm.states;
    function trackOf(i) {
      var st = i >= 0 ? states[i] : null;
      if (!st || typeof st !== 'object') return null;
      var ti = parseInt(st.track, 10);
      var tr = ti >= 0 ? tracksArr[ti] : null;
      return tr && typeof tr === 'object' ? tr : null;
    }
    function metaOf(i) { var tr = trackOf(i); return (tr && tr.metadata && typeof tr.metadata === 'object') ? tr.metadata : {}; }
    return {
      trackOf: trackOf,
      metaOf: metaOf,
      isAd: function (i) { var tr = trackOf(i); return !!tr && flaggedAd(tr); },
      nameOf: function (i) {
        var tr = trackOf(i), m = metaOf(i);
        return m.name || m.title || (tr && (tr.name || tr.title)) || ('state ' + i);
      },
      uriOf: function (i) { var tr = trackOf(i), m = metaOf(i); return (typeof m.uri === 'string' && m.uri) || (tr && typeof tr.uri === 'string' && tr.uri) || ''; }
    };
  }

  // Points "advance" of every song whose skip leads to a song, but whose natural end leads to an ad, at that song.
  // Same rule as myspoti's withoutAds: the ad state itself is left alone, "paused" of the old transition is kept, and a
  // song whose skip also leads to an ad is not touched (nothing safe to point at). Returns true when something changed.
  function leaveAdOut(root, notes) {
    var sm = root && root.state_machine;
    if (!sm || typeof sm !== 'object' || !sm.tracks || !sm.states || !sm.tracks.length) return false;
    var states = sm.states, changed = false;
    var T = smTools(sm), isAd = T.isAd, nameOf = T.nameOf;

    for (var i = 0; i < states.length; i++) {
      var st = states[i];
      if (!st || typeof st !== 'object' || isAd(i)) continue;
      var tr = st.transitions;
      if (!tr || typeof tr !== 'object') continue;
      var skip = tr.skip_next, skipIdx = stateIdx(skip);
      var target = (skipIdx >= 0 && !isAd(skipIdx)) ? skip : null;
      var keys = ['advance', 'skip_next'];
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k], t = tr[key];
        var ti = stateIdx(t);
        if (ti < 0 || !isAd(ti)) continue;
        if (!target) { notes.push(key + ' after "' + nameOf(i) + '" leads to an ad and there is no song to send it to'); continue; }
        var nt = {};
        for (var p in target) if (Object.prototype.hasOwnProperty.call(target, p)) nt[p] = target[p];
        if (t && t.paused !== undefined) nt.paused = t.paused;
        tr[key] = nt;
        changed = true;
        notes.push(key + ' after "' + nameOf(i) + '": "' + nameOf(stateIdx(target)) + '" instead of the ad "' + nameOf(ti) + '"');
      }
    }
    return changed;
  }

  // ---- Plan (diagnostics and the watchdog's target): nothing is sent to Spotify ----
  // The plan is whatever the latest state reply says. It has no timer: every later reply replaces or clears it (handleState, trackAhead).
  var ahead = null, lastAheadKey = '';

  // ---- The page's own player API (found like myspoti's bridge does); read by the plan watch and the recovery watchdog ----
  var API = { player: null, tried: 0, nextTry: 0, warned: false };

  function findPlatform() {
    var host = (document.getElementById && document.getElementById('main')) || document.body;
    if (!host) return null;
    var roots = [host];
    try { var all = host.querySelectorAll('*'); for (var i = 0; i < all.length; i++) roots.push(all[i]); } catch (e) {}
    for (var r = 0; r < roots.length; r++) {
      var el = roots[r], key = null;
      try { var ks = Object.keys(el); for (var k = 0; k < ks.length; k++) if (ks[k].indexOf('__reactContainer$') === 0) { key = ks[k]; break; } } catch (e) {}
      if (!key) continue;
      var stack = [el[key]], guard = 0;
      while (stack.length && guard++ < 200000) {
        var f = stack.pop();
        if (!f) continue;
        var v = f.memoizedProps && f.memoizedProps.value;
        if (v && typeof v === 'object' && typeof v.getRegistry === 'function') return v;
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    }
    return null;
  }

  // The page's PlayerAPI (getState, getQueue, skipToNext, play) or null; cached once found. Read by the plan watch and the recovery watchdog.
  function resolveApi(force) {
    if (API.player) return API.player;
    var now = Date.now();
    if (!force && now < API.nextTry) return null;
    API.tried++;
    API.nextTry = now + (API.tried < 5 ? 1500 : 15000);
    try {
      var platform = findPlatform();
      var registry = platform && platform.getRegistry();
      if (registry && registry._map) {
        var keys = Array.from(registry._map.keys()), sym = null, n = 0;
        for (var i = 0; i < keys.length; i++) { if (keys[i] && keys[i].description) { n++; if (keys[i].description === 'PlayerAPI') sym = keys[i]; } }
        var pl = sym ? registry.resolve(sym) : null;
        if (pl && typeof pl.getState === 'function' && typeof pl.skipToNext === 'function' && typeof pl.play === 'function') {
          API.player = pl; API.registry = registry;
          log('i', 'page player API found: PlayerAPI among ' + n + ' services (try ' + API.tried + ')');
          return pl;
        }
      }
    } catch (e) { logOnce('w', 'page player API lookup failed: ' + e); }
    if (API.tried === 5 && !API.warned) { API.warned = true; log('w', 'page player API not found after 5 tries: the plan watch and the recovery watchdog cannot read the page player'); }
    return null;
  }

  function isAdItem(it) {
    var m = (it && it.metadata && typeof it.metadata === 'object') ? it.metadata : {};
    return !!it && (it.type === 'ad' || it.provider === 'ad' || !!it.advertiser || /^spotify:ad:/.test(it.uri || '') ||
      m.is_advertisement === 'true' || m.is_advertisement === true || !!m.ad_id);
  }

  // v1.69: the page player's state as it is, never null for a sanity reason: raw paused / buffering, extrapolated position (-1 unknown).
  function snap(api) {
    try {
      var s = api.getState();
      if (!s || !s.item) return null;
      var it = s.item, now = Date.now();
      var dur = +s.duration || (it.duration && +it.duration.milliseconds) || 0;
      var base = +s.positionAsOfTimestamp, ts = +s.timestamp;
      var paused = !!s.isPaused, buffering = !!s.isBuffering, pos = base >= 0 ? base : -1;
      if (pos >= 0 && !paused && !buffering && ts > 0) { var el = now - ts; if (el > -2000 && el < 3600000) pos = base + Math.max(0, el); }
      return { uri: it.uri || '', uid: it.uid || '', name: it.name || it.title || '', ad: isAdItem(it), dur: dur, pos: pos, paused: paused, buffering: buffering };
    } catch (e) { return null; }
  }
  function sec(ms) { return ms >= 0 ? (ms / 1000).toFixed(1) + 's' : '?'; }

  function inQueue(q, uri) {
    var lists = q ? [q.nextUp, q.queued] : [];
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      if (!l || !l.length) continue;
      for (var j = 0; j < l.length; j++) if (l[j] && l[j].uri === uri) return l[j];
    }
    return null;
  }

  // True when the reply's current state (updated_state_ref) is an ad. Such a reply has no ad AHEAD, so it must not clear the plan.
  function currentIsAd(root) {
    try {
      var sm = root && root.state_machine;
      if (!sm || typeof sm !== 'object' || !sm.tracks || !sm.states || !sm.tracks.length) return false;
      var cur = stateIdx(root.updated_state_ref);
      return cur >= 0 && smTools(sm).isAd(cur);
    } catch (e) { return false; }
  }

  // The playing song whose \"advance\" leads to an ad while its \"skip_next\" does too (or is missing): same test as myspoti's adAhead.
  // Runs on the reply AFTER leaveAdOut, so a song that was rewritten (skip leads to a song) is not found here.
  function findAdAhead(root) {
    var sm = root && root.state_machine;
    if (!sm || typeof sm !== 'object' || !sm.tracks || !sm.states || !sm.tracks.length) return null;
    var T = smTools(sm), cur = stateIdx(root.updated_state_ref);
    if (cur < 0 || T.isAd(cur)) return null;
    var st = sm.states[cur], tr = st && st.transitions;
    if (!tr || typeof tr !== 'object') return null;
    var adv = stateIdx(tr.advance);
    if (adv < 0 || !T.isAd(adv)) return null;
    var sk = stateIdx(tr.skip_next);
    if (sk >= 0 && !T.isAd(sk)) return null;
    var nx = stateIdx(tr.show_next);
    if (nx < 0 || T.isAd(nx)) return null;
    var next = T.uriOf(nx), uri = T.uriOf(cur);
    if (!/^spotify:(track|episode):/.test(next)) return null;
    var dur = parseInt(T.metaOf(cur).duration, 10);
    return { key: (st.track_uid || uri) + '>' + next, uid: st.track_uid || '', uri: uri, name: T.nameOf(cur), next: next, nextName: T.nameOf(nx),
      dur: dur > 0 ? dur : 0, t0: 0 };
  }

  // Called with every state reply that has no ad as its current state: the plan is whatever the latest such reply says (null = no ad ahead
  // of the playing song). handleState does not call this for a reply whose current state is an ad: it has no ad ahead by definition and
  // must not clear the plan.
  function trackAhead(ah) {
    if (!ah) { ahead = null; return; }
    if (ahead && ahead.key === ah.key) return;
    ahead = ah; ah.t0 = Date.now();
    resolveApi();
    if (lastAheadKey !== ah.key) {
      lastAheadKey = ah.key;
      log('i', 'ad due after "' + ah.name + '": advance and skip_next both lead to an ad, the planned song after it is "' + ah.nextName + '"');
    }
  }

  // ---- Switches ----
  function killSwitch(name) {
    if (name === 'adRewriteOff' && cfg.rewriteOff) return 'uSpot popup setting';
    if (name === 'adRecoveryOff' && cfg.recoveryOff) return 'uSpot popup setting';
    try { if (localStorage.getItem(name) === '1') return 'localStorage, persists across restarts'; } catch (e) {}
    try { if (sessionStorage.getItem(name) === '1') return 'sessionStorage'; } catch (e) {}
    return '';
  }
  // The recovery watchdog is on unless adRecoveryOff (or adRewriteOff) is set.
  function recoveryOn() { return !killSwitch('adRecoveryOff') && !killSwitch('adRewriteOff'); }

  // ---- Recovery watchdog (v1.71): the only code that can load a song ----
  // Armed when an ad UI shows and a plan exists. Once the ad UI is gone it reads the page's player: it does nothing when the page is on the
  // planned song with its real duration or on another song, and loads the planned song only when the break is stuck (see doRecover).
  var RECOVER_MAX_MS = 30000, RECOVER_GRACE_MS = 400, STUCK_MS = 12000, REAL_SONG_MS = 12000, recArm = null, lastRecover = 0;

  // Arms the watchdog for the song f ({uri, name}). Returns the active record, or null when it was not armed.
  function armRecover(f) {
    if (!f || !f.uri || !recoveryOn()) return null;
    var now = Date.now(), attempt = 1;
    if (recArm && recArm.uri === f.uri && now - recArm.t0 < 30000) {
      if (!recArm.done) { if (now - recArm.t0 < 5000) return recArm; }   // the same break seen twice: one arm
      else {
        attempt = (recArm.attempt || 1) + 1;   // a recovery already ran for this song and the ad UI is back: its load brought the ad back
        if (attempt > 2) { log('w', 'recovery watchdog: "' + f.name + '" was already tried twice: not armed again'); return null; }
        log('i', 'recovery watchdog: the ad UI is back for "' + f.name + '" after a recovery: armed again (try ' + attempt + ')');
      }
    }
    if (recArm && recArm.timer) { try { clearTimeout(recArm.timer); } catch (e) {} }
    recArm = { uri: f.uri, name: f.name, t0: now, done: false, timer: 0, attempt: attempt, force: false, waits: 0 };
    return recArm;
  }

  // The ad is gone. Give the page a moment, then check (and, if the break is stuck, load the song).
  function startRecover(r, why) {
    if (!r || r.done || r !== recArm || Date.now() - r.t0 > RECOVER_MAX_MS) return;
    r.done = true;
    try { r.timer = setTimeout(function () { r.timer = 0; try { doRecover(r, why); } catch (e) { log('w', 'stuck recovery failed: ' + e); } }, RECOVER_GRACE_MS); } catch (e) {}
  }

  function retryLater(r, why) { try { setTimeout(function () { startRecover(r, why); }, 1000); } catch (e) {} }

  // Called when an ad UI shows: arm the watchdog on the plan's song. Returns the armed record or null.
  function watchBreak() {
    if (!recoveryOn()) return null;
    var a = ahead;
    if (!a || !a.next) { log('i', 'recovery watchdog: no plan for this break, nothing to watch'); return null; }
    return armRecover({ uri: a.next, name: a.nextName });
  }

  function doRecover(r, why) {
    // an ad still there 12 s after the break began is stuck: waiting no longer helps
    var force = !!r.force || Date.now() - r.t0 > STUCK_MS;
    var wait = function (msg) {
      r.done = false; r.waits = (r.waits || 0) + 1;
      if (r.waits <= 2) log('i', 'recovery check: ' + why + ', ' + msg + ': waiting');
      retryLater(r, why);
    };
    // the ad UI poll can miss for a moment between two ads; do not act while an ad is still on screen
    if (!force) { try { if (document.querySelector(AD_SEL)) { wait('the ad UI is back'); return; } } catch (e) {} }
    // what the page's player says decides (the page's audio is not in the DOM in the app)
    var api = resolveApi(true);
    var sn = api ? snap(api) : null;
    if (sn) {
      var real = sn.dur > REAL_SONG_MS;
      if (sn.ad && !force) { wait('the page is still on an ad ("' + sn.name + '")'); return; }
      if (!sn.ad && sn.uri !== r.uri) { log('i', 'recovery check: ' + why + ', the page is on "' + sn.name + '", not "' + r.name + '": left alone'); return; }
      if (!sn.ad && real) { log('i', 'recovery check: ' + why + ', the page already has "' + r.name + '" (' + sec(sn.pos) + '/' + sec(sn.dur) + (sn.paused ? ', paused' : '') + (sn.buffering ? ', buffering' : '') + '): left alone'); return; }
      if (!sn.ad && !(sn.dur > 0) && !force) { wait('"' + r.name + '" has no duration yet'); return; }
    }
    var now = Date.now();
    if (now - lastRecover < 1000) return;
    lastRecover = now;
    if (!api) { log('w', 'stuck recovery: ' + why + ', "' + r.name + '" is stuck but the page player API is not available'); return; }
    // the page already names the song as current but with the ad's length: a skip to it would step past it, so it is played in its context
    var cur = !!sn && sn.uri === r.uri;
    var ctx = '', q = null, qi = null;
    try { var s = api.getState(); ctx = (s && ((s.context && s.context.uri) || s.contextUri || s.contextURI)) || ''; } catch (e) {}
    if (!cur) { try { q = api.getQueue(); qi = q ? inQueue(q, r.uri) : null; } catch (e) {} }
    var p, how;
    if (qi) { how = 'skipToNext from the queue'; p = api.skipToNext({ uri: qi.uri, uid: qi.uid }); }
    else if (ctx) { how = 'play in its context'; p = api.play({ uri: ctx }, {}, { skipTo: { uri: r.uri } }); }
    else { how = 'play alone'; p = api.play({ uri: r.uri }, {}, {}); }
    log('w', 'stuck recovery: ' + why + ', "' + r.name + '" not playing' + (cur ? ' (current, ' + sec(sn.dur) + ' long)' : (sn && sn.ad ? ' (the page is still on an ad)' : '')) + ' -> ' + how + ' (rebuilds the playlist\'s upcoming songs)');
    Promise.resolve(p).then(function () {
      log('i', 'stuck recovery: "' + r.name + '" loaded');
      try {
        setTimeout(function () {
          try {
            var s2 = snap(api);
            if (!s2) return;
            if (s2.uri === r.uri) log('i', 'stuck recovery: after load the page is on "' + r.name + '" ' + sec(s2.pos) + '/' + sec(s2.dur) + (s2.paused ? ' paused' : '') + (s2.buffering ? ' buffering' : ''));
            else log('w', 'stuck recovery: after load the page is on "' + s2.name + '", not on "' + r.name + '"');
          } catch (e) {}
        }, 1500);
      } catch (e) {}
    }, function (e) { log('w', 'stuck recovery: "' + r.name + '" refused: ' + e); });
  }

  function isPlaybackState(url) { return url.indexOf('track-playback') >= 0 && url.indexOf('/state') >= 0; }

  // Circuit breaker: a rewrite that sends the page somewhere the server does not know makes the next state reports fail.
  // Two failed reports within 20 s of an advance rewrite switch the rewrite (and the plan) off for the page.
  function noteStatus(status) {
    if (status < 400 || status === 429) return;
    var now = Date.now();
    if (lastRewrite && now - lastRewrite < 20000) {
      lateFails++;
      log('w', 'state report answered HTTP ' + status + ' ' + Math.round((now - lastRewrite) / 1000) + ' s after a rewrite (' + lateFails + ')');
      if (lateFails >= 2 && !breakerOff) {
        breakerOff = true;
        log('w', 'ad rewrite switched off for this page: state reports keep failing after it');
      }
    }
  }

  function handleState(res) {
    try {
      if (!res) return res;
      if (res.status >= 400) { noteStatus(res.status); return res; }
      return res.clone().text().then(function (txt) {
        try {
          if (!txt || txt.length > MAX_TEXT) return res;
          var obj;
          try { obj = JSON.parse(txt); } catch (e) { return res; }
          payload(obj);
          if (!rewriteOn()) { ahead = null; return res; }
          // cheap pre-check, the same markers the detection above looks for
          if (txt.indexOf('"AD"') < 0 && txt.indexOf('spotify:ad:') < 0 && txt.indexOf('"is_advertisement"') < 0 &&
              txt.indexOf('"ad_id"') < 0 && txt.indexOf('ADVERTISEMENT') < 0) { ahead = null; return res; }
          var notes = [];
          var changed = leaveAdOut(obj, notes);
          var ah = findAdAhead(obj);
          // a reply whose current state is an ad has no ad ahead by definition: it must not clear the plan
          if (ah || !currentIsAd(obj)) trackAhead(ah);
          if (!changed) {
            if (notes.length && !ah) logOnce('w', 'ad stays in the playback state: ' + notes.join('; '));
            return res;
          }
          var out = new Response(JSON.stringify(obj), { status: res.status, statusText: res.statusText, headers: res.headers });
          try { Object.defineProperty(out, 'url', { value: res.url }); } catch (e) {}
          rewrites++; lastRewrite = Date.now();
          logOnce('i', 'ad left out of the playback state: ' + notes.join('; '));
          return out;
        } catch (e) { log('w', 'state rewrite failed, reply passed on untouched: ' + e); return res; }
      }, function () { return res; });
    } catch (e) { return res; }
  }

  var lastRep = { t: 0, status: 0, method: '' };   // the page's latest playback state report (for the plan watch)
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      var p = nativeFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : ((input && (input.url || input.href)) || '');
        if (isPlaybackState(url)) {
          var meth = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          return p.then(function (res) {
            try { lastRep.t = Date.now(); lastRep.status = res ? res.status : 0; lastRep.method = meth; } catch (e) {}
            return handleState(res);
          });
        }
        if (url.indexOf('/state') >= 0 || url.indexOf('connect-state') >= 0) {
          Promise.resolve(p).then(function (res) {
            try { res.clone().json().then(payload).catch(function () {}); } catch (e) {}
          }).catch(function () {});
        }
      } catch (e) {}
      return p;
    };
  }

  var NativeWS = window.WebSocket;
  if (typeof NativeWS === 'function' && !NativeWS.__adWrapped) {
    var Wrapped = function (url, protocols) {
      var s = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
      s.addEventListener('message', function (ev) { try { fromSocket(ev.data); } catch (e) {} });
      return s;
    };
    Wrapped.prototype = NativeWS.prototype;
    Wrapped.CONNECTING = NativeWS.CONNECTING; Wrapped.OPEN = NativeWS.OPEN;
    Wrapped.CLOSING = NativeWS.CLOSING; Wrapped.CLOSED = NativeWS.CLOSED;
    Wrapped.__adWrapped = true;
    window.WebSocket = Wrapped;
  }

  // ---- Ad UI watcher (item 66b): what actually reached the screen, and for how long ----
  // Markers from a captured ad: the ad bar (aria-label "Advertisement"), data-testid ad-link /
  // context-item-info-ad-subtitle (player bar + now playing view), ad-countdown-timer and like/dislike-ad (now playing view only).
  var AD_SEL = '[data-testid="ad-link"],[data-testid="context-item-info-ad-subtitle"],[data-testid="ad-countdown-timer"],' +
    '[data-context-item-type="ad"],[data-testid="now-playing-widget-v2"][aria-label="Advertisement"]';
  var ui = null, miss = 0;

  function textOf(sel) {
    var e = document.querySelector(sel);
    return e ? String(e.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function pollUi() {
    var hit = null;
    try { hit = document.querySelector(AD_SEL); } catch (e) { return; }
    if (hit) {
      miss = 0;
      var who = textOf('[data-testid="ad-link"]');
      var sub = textOf('[data-testid="context-item-info-ad-subtitle"]');
      var left = textOf('[data-testid="ad-countdown-timer"]');
      var npv = !!document.querySelector('[data-testid="ad-countdown-timer"],[data-testid="button-like-ad"]');
      var line = '"' + who + '" ' + sub + (left ? ', ' + left : '') + (npv ? ', now playing view open' : ', player bar only');
      if (!ui) {
        ui = { t0: Date.now(), last: line, shown: 1, rw0: rewrites, rec: null };
        try { ui.rec = watchBreak(); } catch (e) {}
        log('w', 'ad UI shown (not prevented): ' + line + ' | rewrites so far ' + rewrites + (!rewriteOn() ? ' (rewrite off)' : ''));
      } else if (sub && sub !== ui.sub) {
        ui.sub = sub; ui.shown++;
        log('i', 'ad UI next: ' + line);
      }
      if (ui && !ui.sub) ui.sub = sub;
      if (ui && ui.rec && ui.rec === recArm && !ui.rec.force && Date.now() - ui.t0 > STUCK_MS) {   // the break is stuck on an ad
        ui.rec.force = true;
        log('w', 'recovery watchdog: the ad UI has been up for ' + (STUCK_MS / 1000) + ' s: the break is stuck');
        if (!ui.rec.done) startRecover(ui.rec, 'ad UI up for ' + (STUCK_MS / 1000) + ' s');
      }
    } else if (ui) {
      if (++miss < 2) return;
      var secs = ((Date.now() - ui.t0) / 1000).toFixed(1);
      if (ui.rec && ui.rec === recArm && !ui.rec.done) startRecover(ui.rec, 'ad UI gone');
      log('i', 'ad UI gone after ' + secs + ' s, ' + ui.shown + ' ad(s) shown, rewrites during the break ' + (rewrites - ui.rw0));
      ui = null; miss = 0;
    }
  }

  // ---- Plan watch (v1.69, diagnostics only): while an ad is due, what the page's player does, esp. at the end of the song ----
  var pw = { key: '', near: '', stallAt: 0, stallLogged: false };
  function pollPlan() {
    try {
      var a = ahead;
      if (!a || !API.player) { pw.key = ''; pw.stallAt = 0; return; }
      var sn = snap(API.player);
      if (!sn) return;
      var line = '"' + sn.name + '" ' + sec(sn.pos) + '/' + sec(sn.dur) + (sn.paused ? ' paused' : '') + (sn.buffering ? ' buffering' : '') + (sn.ad ? ' AD' : '');
      var key = sn.uri + '|' + sn.paused + '|' + sn.buffering;
      if (key !== pw.key) { pw.key = key; pw.stallAt = 0; pw.stallLogged = false; log('i', 'plan watch: ' + line + ' (plan: "' + a.nextName + '" after "' + a.name + '")'); return; }
      var left = (sn.dur > 0 && sn.pos >= 0) ? sn.dur - sn.pos : null;
      if (left === null) return;
      if (left < 3000 && left > 0 && pw.near !== sn.uri) { pw.near = sn.uri; log('i', 'plan watch: song ends in ' + sec(left) + ': ' + line); }
      if (left < -500 && !sn.paused && !sn.buffering && !sn.ad) {
        if (!pw.stallAt) pw.stallAt = Date.now();
        else if (!pw.stallLogged && Date.now() - pw.stallAt > 4000) {
          pw.stallLogged = true;
          log('w', 'plan watch: past the end for ' + sec(-left) + ' and the page is still on the song: ' + line + ' | last state report ' + (lastRep.t ? sec(Date.now() - lastRep.t) + ' ago (' + lastRep.method + ' HTTP ' + lastRep.status + ')' : 'never seen'));
        }
      } else { pw.stallAt = 0; }
    } catch (e) {}
  }

  try { setInterval(pollUi, 250); } catch (e) {}
  try { setInterval(pollPlan, 1000); } catch (e) {}
  if (killSwitch('adRewriteOff')) log('w', 'kill switch adRewriteOff is set (' + killSwitch('adRewriteOff') + '): the rewrite, the plan and the recovery watchdog are off for this page');
  else if (killSwitch('adRecoveryOff')) log('w', 'switch adRecoveryOff is set (' + killSwitch('adRecoveryOff') + '): the recovery watchdog is off for this page');
  log('i', 'ad hook installed on ' + location.hostname + ' (rewrite ' + (rewriteOn() ? 'on' : 'off') + ', recovery watchdog ' + (rewriteOn() && recoveryOn() ? 'on' : 'off') + ', page player API looked up when an ad is due)');
})();
