// The flow of setup (SPEC §2 and §3): which screen and sub-state the window shows for a state
// snapshot S (CONTRACT.md §2) and the local place L, and what that frame looks like.
//
//   observe(S, L)   first-seen marks and latches (PC copy only)
//   route(S, L)     -> [screen, sub]; every time-dependent difference is encoded in sub
//   settle(next, L) debounces moves back to an earlier screen
//   view(S, L)      -> the frame for L.screen / L.sub (pure: no clock, no DOM; the Mac's copy runs
//                      only this, from the mirrored S and L)
//
// Effects (commands, Mac actions) live in app.js. Every clock read goes through D.now(), so the
// preview can run a scenario faster (?speed=N, preview/mock.js).
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});
  D.now = D.now || (() => Date.now());
  const now = () => D.now();

  // ---------- Order of the screens ----------
  const RANK = {
    incomplete: 0, unsupported: 0, welcome: 1, 'install-error': 2, 'allow-pc': 2,
    connect: 3, unreachable: 3, 'get-app': 4, 'open-app': 5, move: 6, login: 7,
    'allow-screen': 8, keyboard: 9, 'allow-control': 9, ready: 10,
  };

  // Every [screen, sub] of SPEC §3, in flow order (shoot.sh, the copy lint, the fit check).
  const SUBS = [
    ['welcome', 'idle'], ['unsupported', 'idle'], ['incomplete', 'idle'],
    ['install-error', 'in-use'], ['install-error', 'other'],
    ['allow-pc', 'installing'], ['allow-pc', 'waiting'], ['allow-pc', 'pending'], ['allow-pc', 'pending-hint'],
    ['allow-pc', 'working'], ['allow-pc', 'done'], ['allow-pc', 'ask'], ['allow-pc', 'refused'], ['allow-pc', 'failed'],
    ['connect', 'cable'], ['connect', 'cable-hint'], ['connect', 'no-cable'], ['connect', 'reconnect'],
    ['connect', 'finding'], ['connect', 'no-mac'], ['connect', 'no-server'], ['connect', 'port-busy'],
    ['unreachable', 'waiting'], ['unreachable', 'help'],
    ['get-app', 'address'], ['get-app', 'address-hint'], ['get-app', 'address-ip'], ['get-app', 'download'],
    ['get-app', 'download-hint'], ['get-app', 'allow-downloads'], ['get-app', 'downloading'],
    ['open-app', 'steps'], ['open-app', 'downloads'], ['open-app', 'confirm'], ['open-app', 'setting-up'], ['open-app', 'setting-up-late'],
    ['move', 'idle'], ['move', 'moving'], ['move', 'failed'],
    ['login', 'settings'], ['login', 'asking'],
    ['allow-screen', 'prompt'], ['allow-screen', 'settings'], ['allow-screen', 'reopen'], ['allow-screen', 'reopen-late'], ['allow-screen', 'off'],
    ['keyboard', 'offer'],
    ['allow-control', 'prompt'], ['allow-control', 'settings'], ['allow-control', 'off'],
    ['ready', 'starting'], ['ready', 'cut'], ['ready', 'showing'], ['ready', 'hidden'], ['ready', 'manual'],
    ['ready', 'elsewhere'], ['ready', 'error'], ['ready', 'error-files'],
  ];

  // ---------- Time ----------
  const secs = (t) => (t ? (now() - t) / 1000 : 0);
  const sinceOf = (L) => (k) => secs(L.marks[k]);  // 0 when the mark isn't set
  const hostOf = (u) => String(u || '').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const fallbackDiffers = (S) => !!S.server.fallbackUrl && hostOf(S.server.fallbackUrl) !== hostOf(S.server.url);
  const appCurrent = (S) => S.mac.reachable && !S.mac.outdated && +S.mac.appVersion >= 4;

  // ---------- observe(S, L): marks and latches (§2.6) ----------
  function observe(S, L) {
    const t = now();
    const mark = (k, c) => { if (c) { if (!L.marks[k]) L.marks[k] = t; } else delete L.marks[k]; };
    const lap = S.laptop, ln = S.link, sv = S.server, ms = S.mac.status, d = sv.download;
    const appNow = appCurrent(S);
    if (appNow) L.appSeen = true;
    if (ln.adapterUp && ln.macFound) L.wasLinked = true;
    mark('pending', lap.elevation === 'pending');
    mark('noCable', !ln.adapterUp && L.screen === 'connect');
    mark('noServer', ln.macFound && !sv.running && L.screen === 'connect');
    mark('urlReady', ln.macFound && sv.urlReady);
    mark('macAway', L.appSeen && !appNow);
    mark('address', !sv.pageVisited && L.screen === 'get-app');
    mark('dlWait', sv.pageVisited && d.sent === 0 && L.screen === 'get-app');
    mark('clicked', sv.downloadClicked && d.sent === 0);
    mark('bytes', d.sent > 0 && !d.done);
    mark('opened', sv.appOpened);
    // Opening the un-notarized app (open-app steps): rows 1-2 are done once the page has reported
    // Open Privacy & Security. Latched: whatever Safari's focus and blur say afterwards (a focus
    // clears settingsOpened on the host), no row goes back. Only Download Again (the page's
    // 'download', a new download) starts the list over.
    if (sv.downloadClicked) L.stepsDone = 0;
    else if (sv.settingsOpened || sv.leftForSettings) L.stepsDone = Math.max(+L.stepsDone || 0, 2);
    mark('needsRelaunch', ms.screenNeedsRelaunch);
    mark('login', ms.loginItemNeedsApproval && !ms.settingsFront);
    if ((L.screen === 'allow-screen' || L.screen === 'allow-control') && (ms.promptUp || ms.settingsFront || ms.authUp)) {
      L.lastSeen[L.screen === 'allow-screen' ? 'screen' : 'accessibility'] = t;
    }
    // The Mac's prompt has been up on this screen: from now on Settings in front is its pane.
    if ((L.screen === 'allow-screen' || L.screen === 'allow-control') && ms.promptUp) {
      L.promptSeen = L.promptSeen || {};
      L.promptSeen[L.screen === 'allow-screen' ? 'screen' : 'accessibility'] = true;
    }
    // The handover's cut: these are PC timers; the Mac's copy gets the result as mirrored flags.
    if (S.screen.showing && !L.cut) { L.cut = true; L.shownOnce = true; L.starting = false; L.marks.cut = t; }
    if (L.cut && L.marks.cut) {
      if (!L.cutCheck && t - L.marks.cut >= 800) L.cutCheck = true;
      if (!L.settled && t - L.marks.cut >= 1400) L.settled = true;
    }
  }

  // ---------- route(S, L) (§2.4) ----------
  function route(S, L) {
    const lap = S.laptop, set = S.setup, ln = S.link, sv = S.server, m = S.mac, ms = m.status, sc = S.screen;
    const since = sinceOf(L);
    if (!lap.checked) return null;                                           // the window stays cloaked
    if (set.hold) return [set.hold.screen, set.hold.sub];                    // the installed copy's first frames (§4.2)
    if (lap.missingPayload && lap.missingPayload.length) return ['incomplete', 'idle'];
    // Continue answers at once (§4.2: the buttons vanish, Allow Changes crossfades in), before the
    // host's next snapshot says started.
    const started = set.started || S.setupDone || !!L.sent.setUp;
    if (!started) return lap.usb4 === 'missing' ? ['unsupported', 'idle'] : ['welcome', 'idle'];
    if (sc.showing || L.starting) return ['ready', readySub(S, L)];          // pinned from startScreen to the end

    // ---- This PC ----
    const elevOk = lap.elevation === 'done' || (lap.elevation === 'failed' && lap.firewallOk);  // tasks-only failure: silent, logged
    // Handing off to the installed copy: this frame becomes its hold, so it must already say how
    // Windows answered (a No is never held as "click Yes").
    if (set.handingOff) {
      if (L.screen && L.screen !== 'allow-pc') return [L.screen, L.sub];
      return ['allow-pc', elevOk ? 'done' : lap.elevation === 'refused' ? 'refused' : lap.elevation === 'failed' ? 'failed' : (L.sub || 'done')];
    }
    if (lap.installError) return ['install-error', lap.installError === 'inUse' ? 'in-use' : 'other'];
    if (!elevOk) {
      if (lap.installing || !lap.installed) return ['allow-pc', 'installing'];
      switch (lap.elevation) {
        case 'pending': return ['allow-pc', since('pending') >= 5 ? 'pending-hint' : 'pending'];
        case 'working': return ['allow-pc', 'working'];
        case 'refused': return ['allow-pc', 'refused'];
        case 'failed': return ['allow-pc', 'failed'];
        default: return ['allow-pc', set.elevationAsked && !L.sent.setUp ? 'ask' : 'waiting'];
      }
    }

    // ---- The cable and your Mac ----
    const appNow = appCurrent(S);
    const appOk = appNow || (L.appSeen && (busyOnMac(S, L) || since('macAway') < 4));   // latched across relaunch and move
    if (!ln.adapterUp) {
      return ['connect', since('noCable') >= 90 ? 'no-cable'
        : L.wasLinked ? 'reconnect'
          : since('noCable') >= 15 ? 'cable-hint' : 'cable'];
    }
    if (!ln.macFound) return ['connect', ln.secondsSincePlug >= 40 ? 'no-mac' : 'finding'];
    if (!appOk && L.appSeen) return ['unreachable', since('macAway') >= 40 ? 'help' : 'waiting'];
    if (!appOk && !sv.urlReady) {                                            // never show a dead address
      return ['connect', since('noServer') >= 20 ? (sv.error === 'port' ? 'port-busy' : 'no-server') : 'finding'];
    }
    // The address is ready the moment the Mac is found; the Mac app, when it is there, answers the
    // probe a moment later. On Connect (or the first frame), give it that moment before asking for
    // the app, so someone who set up before never sees Get USB-C Display flash by.
    if (!appOk && (!L.screen || L.screen === 'connect') && since('urlReady') < 1.5) return ['connect', 'finding'];

    // ---- The app on your Mac ----
    if (!appOk) return sv.download.done ? ['open-app', openSub(S, L)] : ['get-app', getSub(S, L)];
    if (!ms.inApplications) {
      return ['move', !L.sent.moveToApplications ? 'idle'
        : secs(L.sentAt.moveToApplications) < 20 ? 'moving' : 'failed'];
    }
    if (ms.loginItemNeedsApproval && !set.loginSkip) {
      return ['login', ms.settingsFront || since('login') < 5 ? 'settings' : 'asking'];
    }

    // ---- Permissions ----
    if (!ms.screenOk || ms.screenNeedsRelaunch) return ['allow-screen', permSub(S, L, 'screen')];
    if (!ms.axOk && set.axChoice !== 'no') {
      return set.axChoice === 'yes' ? ['allow-control', permSub(S, L, 'accessibility')] : ['keyboard', 'offer'];
    }

    // ---- The display ----
    return ['ready', readySub(S, L)];
  }

  function busyOnMac(S, L) {                                // grace windows where silence is expected
    const ms = S.mac.status, since = sinceOf(L);
    return (ms.screenNeedsRelaunch && since('macAway') < 20)                 // relaunching itself
      || (L.sent.relaunch && secs(L.sentAt.relaunch) < 20)
      || (L.sent.moveToApplications && secs(L.sentAt.moveToApplications) < 20)
      || (S.server.appOpened && since('opened') < 25);
  }

  function getSub(S, L) {
    const sv = S.server, d = sv.download, since = sinceOf(L);
    if (!sv.pageVisited) {
      return since('address') >= 45 && fallbackDiffers(S) ? 'address-ip'
        : since('address') >= 15 ? 'address-hint' : 'address';
    }
    if (d.sent === 0 && sv.downloadClicked && since('clicked') >= 1) return 'allow-downloads';
    if (d.sent === 0) return since('dlWait') >= 40 ? 'download-hint' : 'download';
    if (since('bytes') >= 1) return 'downloading';
    // The first second of bytes, right after Allow: never "click Download" again.
    return L.screen === 'get-app' && L.sub === 'allow-downloads' ? 'allow-downloads' : 'download';
  }

  // Un-notarized, one screen ('steps') from the download until the Mac app answers: Safari's focus
  // and blur are too noisy to follow (a blur under 0.8 s after Open Privacy & Security, a focus
  // that clears it). What the page has reported shows only in its rows (L.stepsDone, observe).
  function openSub(S, L) {
    const sv = S.server, since = sinceOf(L);
    if (sv.appOpened) return since('opened') >= 40 ? 'setting-up-late' : 'setting-up';  // only with the Mac ping (§7.3 M6)
    if (sv.appNotarized) return sv.pageBlurs > 0 && !sv.pageFocused ? 'confirm' : 'downloads';
    return 'steps';
  }

  function permSub(S, L, kind) {                            // kind: 'screen' | 'accessibility'
    const ms = S.mac.status, since = sinceOf(L);
    if (kind === 'screen' && (ms.screenNeedsRelaunch || (L.sent.relaunch && secs(L.sentAt.relaunch) < 20))) {
      return since('needsRelaunch') >= 25 ? 'reopen-late' : 'reopen';
    }
    if (ms.promptUp) return 'prompt';
    // Settings in front is the permission's pane only once the prompt was seen here, or after 4 s
    // with no prompt (the Mac opened the pane itself). On entry it is usually still the pane of the
    // step before (§3.11: prompt = promptUp, or just asked).
    const here = L.screen === (kind === 'screen' ? 'allow-screen' : 'allow-control');
    const paneLikely = (L.promptSeen && L.promptSeen[kind]) || (here && secs(L.enteredAt) >= 4);
    if (ms.authUp || (ms.settingsFront && paneLikely)) return 'settings';
    const seen = L.lastSeen[kind];
    if (seen && secs(seen) >= 6) return 'off';              // seen, then gone for 6 s, still off
    if (!seen && L.sent[kind] && secs(L.sentAt[kind]) >= 20) return 'off';   // nothing ever appeared
    return L.screen === (kind === 'screen' ? 'allow-screen' : 'allow-control') && L.sub === 'settings' ? 'settings' : 'prompt';
  }

  function readySub(S, L) {
    const sc = S.screen, since = sinceOf(L);
    if (sc.showing) return L.settled ? 'showing' : 'cut';
    // A refusal the person has since fixed (Screen Recording was off on the Mac, now on): the
    // host keeps the old code until the next start, so it no longer counts (app.js act()).
    const error = sc.error === 'screen-recording-off' && L.refusedOff && S.mac.status.screenOk ? '' : sc.error;
    if (error === 'receiver-missing') return 'error-files';
    if (error) return 'error';                              // 'screen-recording-off' also lands here, then route moves to allow-screen
    if (L.starting) return since('startScreen') >= 30 ? 'error' : 'starting';
    if (L.shownOnce) return 'hidden';
    if (sc.running) return 'elsewhere';                     // started by the watcher, not by this window
    if (L.manual) return 'manual';
    return 'starting';
  }

  // ---------- settle(next, L) (§2.5) ----------
  function settle(next, L) {
    if (!L.screen) return next;
    const back = RANK[next[0]] < RANK[L.screen];
    if (!back || next[0] === 'install-error') { L.backSince = 0; return next; }
    L.backSince = L.backSince || now();
    const need = next[0] === 'unreachable' ? 0 : 3000;      // unreachable has already waited 4 s (macAway)
    return now() - L.backSince >= need ? next : [L.screen, L.sub];
  }

  // ---------- view(S, L) (§3, §6.6) ----------
  // Pure: reads S and the mirrored part of L (screen, sub, sheet, cut, cutCheck, settled, input)
  // and D.STR. Never the clock: the Mac's copy draws the same frame from the same input.
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function T(key, vars) {
    const s = D.STR && D.STR[key];
    if (s == null) return '';
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? esc(vars[k]) : m)) : s;
  }
  const P = (html) => '<p>' + html + '</p>';
  const DONE_KEYS = { 'status.installed': 1, 'status.pcReady': 1, 'status.downloaded': 1, 'status.extended': 1 };
  const busy = (key, doneKey, spinner) => ({
    key, text: T(key), state: 'busy', spinner: spinner !== false,
    doneKey: doneKey || '', doneText: doneKey ? T(doneKey) : '',
  });
  const done = (key) => ({ key, text: T(key), state: 'done', spinner: false, doneKey: '', doneText: '' });
  const statusFromKey = (key) => (!key || D.STR[key] == null ? null : DONE_KEYS[key] ? done(key) : busy(key, key === 'status.installing' ? 'status.installed' : key === 'status.settingUpPc' ? 'status.pcReady' : key === 'status.extending' ? 'status.extended' : ''));
  const btn = (labelKey, act, more) => Object.assign({ label: T(labelKey), act, esc: false }, more || {});
  const caption = (key, vars, sheet) => ({ type: 'caption', html: key ? T(key, vars) : '', sheet: sheet || '' });
  const link = (sheet) => ({ type: 'link', sheet });
  const mb = (n) => { const v = (+n || 0) / 1e6; return T('common.mb', { n: v < 10 ? v.toFixed(1) : v.toFixed(0) }); };
  const inputOn = (S) => !!(S.mac.status.axOk && S.setup.axChoice !== 'no');
  const EDGE = { right: 'right', left: 'left', above: 'top', below: 'bottom', top: 'top', bottom: 'bottom' };
  const isUpdate = (S) => S.mac.reachable && (S.mac.outdated || +S.mac.appVersion < 4);

  // The open-app story ('gk-story'): its chapters, as tl.chapters lists them, teach rows 1, 2, 2, 3.
  // The first chapter (0-based) of each row, for opt.fromChapter once the rows before it are done.
  const STEP_ROWS = 3;
  const STORY_FIRST_CHAPTER = { 1: 0, 2: 1, 3: 3 };

  // A picture of the Mac's screen (WP2, macos.js): the Mac's own look as soon as it is known.
  function scene(S, L, name, more) {
    const theme = S.mac.appearance || S.server.pageAppearance || (L.look && L.look.theme) || 'light';
    let accent = S.mac.accent || S.server.pageAccent || (L.look && L.look.accent) || 'blue';
    if (accent === 'multicolor') accent = 'blue';
    const size = S.server.appSize || S.server.download.size;
    return {
      name,
      opts: Object.assign({
        dark: theme === 'dark', accent,
        host: hostOf(S.server.url) || 'usbc.local',
        appName: 'USB-C Display',
        appSize: size ? mb(size) : '',
        appBytes: +size || 0,                                  // Safari's own size format (macos.js)
        appVersion: String(S.server.appVersion || ''),
        notarized: !!S.server.appNotarized,                    // the page's line in state B (§8)
        frame: 'band', still: false, off: false,
      }, more || {}),
    };
  }

  const VIEWS = {
    welcome(v, S) {
      v.glyph = 'displays';
      v.title = T('welcome.idle.title');
      v.body = [P(T('welcome.idle.p1')), P(T(S.laptop.isAdminUser === false ? 'welcome.idle.p2-standard' : 'welcome.idle.p2-admin'))];
      v.secondary = btn('common.cancel', 'close', { esc: true });
      v.primary = btn('common.continue', 'setUp');
    },
    unsupported(v) {
      v.glyph = 'displays';
      v.title = T('unsupported.idle.title');
      v.body = [P(T('unsupported.idle.body'))];
      v.content = [caption('unsupported.idle.caption')];
      v.primary = btn('common.quit', 'close', { esc: true });
    },
    incomplete(v) {
      v.glyph = 'displays';
      v.title = T('incomplete.idle.title');
      v.body = [P(T('incomplete.idle.body'))];
      v.primary = btn('common.quit', 'close', { esc: true });
    },
    'install-error'(v, S, L, sub) {
      v.glyph = 'displays';
      v.title = T('install-error.title');
      v.body = [P(T(sub === 'in-use' ? 'install-error.in-use.body' : 'install-error.other.body'))];
      v.secondary = btn('common.cancel', 'close', { esc: true });
      v.primary = btn('common.tryAgain', 'retryInstall');
    },
    'allow-pc'(v, S, L, sub) {
      const admin = S.laptop.isAdminUser !== false;
      v.glyph = 'hand';
      v.title = T(sub === 'refused' ? 'allow-pc.refused.title' : sub === 'failed' ? 'allow-pc.failed.title' : 'allow-pc.title');
      const shared = T(!admin ? 'allow-pc.body.standard' : S.laptop.signed ? 'allow-pc.body.admin-signed' : 'allow-pc.body.admin-unsigned');
      const std = admin ? '' : '-standard';                   // a standard account: an administrator answers
      const body = {
        'pending-hint': T('allow-pc.pending-hint.body' + std), ask: T('allow-pc.ask.body' + std),
        refused: T('allow-pc.refused.body' + std), failed: T('allow-pc.failed.body'),
        working: T('allow-pc.working.body'), done: T('allow-pc.working.body'),     // after Yes: nothing more to click
      }[sub];
      v.body = [P(body || shared)];
      v.content = [link('permission')];
      if (sub === 'installing') v.status = busy('status.installing', 'status.installed');
      else if (sub === 'waiting') v.status = busy('status.waitingWindows');
      else if (sub === 'pending' || sub === 'pending-hint') v.status = busy(admin ? 'status.pendingAdmin' : 'status.pendingStandard');
      else if (sub === 'working') v.status = busy('status.settingUpPc', 'status.pcReady');
      else if (sub === 'done') v.status = done('status.pcReady');
      if (sub === 'ask') v.primary = btn('common.continue', 'elevate');
      if (sub === 'refused' || sub === 'failed') v.primary = btn('common.tryAgain', 'elevate');
    },
    connect(v, S, L, sub) {
      v.glyph = 'plug';
      v.title = T({ 'no-cable': 'connect.no-cable.title', 'no-mac': 'connect.no-mac.title', 'no-server': 'connect.no-server.title', 'port-busy': 'connect.port-busy.title' }[sub] || 'connect.title');
      v.body = [P(T('connect.' + sub + '.body' + (sub === 'no-server' && S.laptop.isAdminUser === false ? '-standard' : '')))];
      if (sub === 'cable' || sub === 'cable-hint' || sub === 'no-cable') v.content = [caption('connect.caption', null, 'cable')];
      if (sub === 'no-mac') v.content = [link('mac-connect')];
      if (sub === 'cable' || sub === 'cable-hint' || sub === 'no-cable' || sub === 'reconnect') v.status = busy('status.lookingForMac');
      if (sub === 'finding' || sub === 'no-mac') v.status = busy('status.connecting');
      if (sub === 'no-server') v.primary = btn('common.tryAgain', 'elevate');
      if (sub === 'port-busy') v.primary = btn('common.quit', 'close', { esc: true });   // a way out, as on every "open again" screen
    },
    unreachable(v, S, L, sub) {
      v.glyph = 'plug';
      v.title = T('unreachable.title');
      v.body = [P(T('unreachable.body'))];
      if (sub === 'help') v.content = [link('mac-respond')];
      v.status = busy('status.connecting');
    },
    'get-app'(v, S, L, sub) {
      const host = hostOf(S.server.url) || 'usbc.local';
      v.variant = 'picture';
      v.title = T(isUpdate(S) ? 'get-app.title-update' : 'get-app.title');
      v.status = sub === 'downloading' ? busy('status.downloading', 'status.downloaded', false) : busy('status.waitingMac');
      if (sub === 'address' || sub === 'address-hint' || sub === 'address-ip') {
        v.scene = scene(S, L, 'safari-type');
        v.body = [P(T(isUpdate(S) ? 'get-app.address.body-update' : 'get-app.address.body'))];
        v.content = [{ type: 'address', text: host },
          sub === 'address-hint' ? caption('get-app.address-hint.caption', { host }, 'safari')
            : sub === 'address-ip' ? caption('get-app.address-ip.caption', { fallback: hostOf(S.server.fallbackUrl) }, 'safari')
              : caption('', null, 'safari')];
      } else if (sub === 'allow-downloads') {
        v.scene = scene(S, L, 'safari-allow-dl');
        v.body = [P(T('get-app.allow-downloads.body', { host }))];
      } else if (sub === 'downloading') {
        const d = S.server.download, size = d.size || S.server.appSize || 0;
        v.scene = scene(S, L, 'safari-download', { still: true });
        v.body = [P(T('get-app.downloading.body'))];
        v.content = [{ type: 'progress', value: size ? Math.min(1, d.sent / size) : 0, label: size ? T('common.progress', { sent: mb(d.sent), size: mb(size) }) : '' }];
      } else {
        v.scene = scene(S, L, 'safari-download');
        v.body = [P(T('get-app.download.body'))];
        if (sub === 'download-hint') v.content = [caption('get-app.download-hint.caption')];
      }
    },
    'open-app'(v, S, L, sub) {
      v.variant = 'picture';
      v.title = T('open-app.title');
      v.status = sub === 'setting-up' ? busy('status.settingUpApp') : busy('status.waitingMac');
      if (sub === 'steps') {
        // One story under the title: the picture plays the chapters of the rows not yet done
        // (tl.chapters, macos.js), and the rows never change their words (§3.8).
        const done = Math.max(0, Math.min(STEP_ROWS, Math.round(+L.stepsDone || 0)));
        const from = done ? STORY_FIRST_CHAPTER[done + 1] : undefined;
        v.scene = scene(S, L, 'gk-story', from != null ? { fromChapter: from } : null);
        if (from != null) v.scene.fromRow = done + 1;          // app.js checks the chapters the scene plays
        const rows = [];
        for (let i = 1; i <= STEP_ROWS; i++) rows.push(T('open-app.steps.' + i));
        v.content = [{ type: 'steps', rows, done }];
        v.contentTop = 384.5;                                  // fixed: 6 pt under the title
        // No room for a caption under the rows: why the Mac asks, Open Anyway gone missing, and Move
        // to Trash are behind the help button (?) in the tray's empty right corner.
        v.help = 'gatekeeper';
        return;
      }
      const name = { downloads: 'safari-open', confirm: 'gk-open', 'setting-up': 'bg-items', 'setting-up-late': 'bg-items' }[sub] || 'safari-open';
      v.scene = scene(S, L, name, sub === 'setting-up-late' ? { still: true } : null);
      v.body = [P(T('open-app.' + sub + '.body'))];
      if (sub === 'setting-up') v.content = [caption('open-app.setting-up.caption')];
      if (sub === 'setting-up-late') v.content = [link('mac-respond')];
    },
    move(v, S, L, sub) {
      v.glyph = 'folder';
      v.title = T(sub === 'failed' ? 'move.failed.title' : 'move.title');
      v.body = [P(T('move.' + sub + '.body'))];
      if (sub === 'moving') v.status = busy('status.moving');
      else v.primary = btn(sub === 'failed' ? 'common.tryAgain' : 'common.moveToApps', 'mac:moveToApplications');
    },
    login(v, S, L, sub) {
      v.variant = 'picture';
      v.scene = scene(S, L, 'login-list');
      v.title = T('login.title');
      v.body = [P(T('login.' + sub + '.body'))];
      v.content = [caption('login.caption')];
      v.third = btn('common.notNow', 'loginLater', { esc: true });
      if (sub === 'asking') v.primary = btn('common.openSettings', 'mac:loginItems');
    },
    'allow-screen'(v, S, L, sub) {
      v.variant = 'picture';
      v.title = T('allow-screen.title');
      v.body = [P(T('allow-screen.' + sub + '.body'))];
      v.content = [caption('allow-screen.caption', null, 'screen')];
      const name = { prompt: 'screen-prompt', settings: 'screen-list', reopen: 'screen-reopen', 'reopen-late': 'screen-reopen', off: 'screen-list' }[sub] || 'screen-prompt';
      v.scene = scene(S, L, name, sub === 'reopen-late' ? { still: true } : sub === 'off' ? { still: true, off: true } : null);
      if (sub === 'prompt' || sub === 'settings') v.status = busy('status.waitingMac');
      if (sub === 'reopen') v.status = busy('status.reopening');
      if (sub === 'reopen-late') v.primary = btn('common.tryAgain', 'mac:relaunch');
      if (sub === 'off') v.primary = btn('common.openSettings', 'mac:screen');
    },
    keyboard(v) {
      v.glyph = 'keyboard';
      v.title = T('keyboard.offer.title');
      v.body = [P(T('keyboard.offer.body'))];
      v.content = [link('control')];
      v.third = btn('common.notNow', 'axNo', { esc: true });
      v.primary = btn('common.continue', 'axYes');
    },
    'allow-control'(v, S, L, sub) {
      v.variant = 'picture';
      v.title = T('allow-control.title');
      v.body = [P(T('allow-control.' + sub + '.body'))];
      v.content = [caption('allow-control.caption', null, 'control')];
      v.scene = scene(S, L, sub === 'prompt' ? 'ax-prompt' : 'ax-list', sub === 'off' ? { still: true, off: true } : null);
      v.third = btn('common.notNow', 'axNo', { esc: true });
      if (sub === 'off') v.primary = btn('common.openSettings', 'mac:accessibility');
    },
    ready(v, S, L, sub) {
      const err = sub === 'error' || sub === 'error-files';
      v.glyph = err ? 'displays' : 'check';                  // never the success check above "Unable to…"
      v.title = T(err ? 'ready.' + sub + '.title' : 'ready.title');
      // From startScreen until the cut nothing may change (§10.4): starting and cut read the same.
      const frozen = sub === 'starting' || sub === 'cut';
      const input = frozen && typeof L.input === 'boolean' ? L.input : inputOn(S);
      let body;
      if (frozen) body = T('ready.starting.body');
      else if (sub === 'showing') {
        const edge = EDGE[S.mac.status.displaySide] || '';
        body = S.screen.pointerOnLaptop ? T('ready.showing.body-pointer')
          : input ? T('ready.showing.body-input')
            : edge ? T('ready.showing.body-edge', { edge: T('common.edge.' + edge) })
              : T('ready.showing.body-noedge');
      } else body = T('ready.' + sub + '.body');
      v.body = [P(body)];
      if (!err) {
        const items = [{ glyph: 'escape', title: T('ready.list.escape.title'), text: T('ready.list.escape.text') },
          { glyph: 'plug', title: T('ready.list.plug.title'), text: T('ready.list.plug.text') }];
        if (input) items.push({ glyph: 'keyboard', title: T('ready.list.keyboard.title'), text: T('ready.list.keyboard.text') });
        v.content = [{ type: 'list', items }];
        v.contentTop = 332;                                  // fixed: never moves when the body changes
      }
      if (sub === 'error') v.content = [link('desktop')];
      if (sub === 'starting') v.status = busy('status.extending', 'status.extended');
      if (sub === 'cut') v.status = L.cutCheck ? done('status.extended') : busy('status.extending', 'status.extended');
      if (sub === 'showing') {
        v.secondary = btn('common.returnToWindows', 'stopScreen', { esc: true });
        v.primary = btn('common.done', 'finish');
      }
      if (sub === 'hidden') {
        v.secondary = btn('common.showMacDesktop', 'show');
        v.primary = btn('common.done', 'finish');
      }
      if (sub === 'manual') v.primary = btn('common.showMacDesktop', 'show');
      if (sub === 'elsewhere') v.primary = btn('common.done', 'finish');
      if (sub === 'error') v.primary = btn('common.tryAgain', 'show');
      if (sub === 'error-files') v.primary = btn('common.quit', 'close', { esc: true });
    },
  };

  function view(S, L) {
    const scr = L.screen, sub = L.sub;
    const v = {
      screen: scr, sub, variant: 'glyph', glyph: '', scene: null, title: '', body: [], bodyKey: '',
      content: [], contentTop: 0, status: null, primary: null, secondary: null, third: null, help: '', closeEnabled: true,
    };
    if (VIEWS[scr]) VIEWS[scr](v, S, L, sub);
    // Handing off to the installed copy, and that copy's held frame: no buttons (a click would act
    // on a copy that is about to close); they fade in when the hold is released.
    if (S.setup.handingOff || S.setup.hold) { v.primary = v.secondary = v.third = null; v.help = ''; }
    if (S.laptop.installing || S.setup.handingOff || S.setup.hold || (scr === 'allow-pc' && sub === 'working')) v.closeEnabled = false;
    // The busy statuses whose work is done in this state (§4.5): only one of these, when it is
    // replaced, shows its check with the done text first; any other replacement just crossfades.
    const lap = S.laptop;
    v.completed = [];
    if (lap.installed && !lap.installing) v.completed.push('status.installing');
    if (lap.elevation === 'done' || (lap.elevation === 'failed' && lap.firewallOk)) v.completed.push('status.settingUpPc');
    if (S.server.download.done) v.completed.push('status.downloading');
    if (L.cutCheck) v.completed.push('status.extending');
    // The downloaded copy run again after Continue: it installs (and hands off) by itself (§4.2).
    if (!S.laptop.runningInstalled && S.setup.started && (S.laptop.installing || !S.laptop.installed) && !S.laptop.installError && scr !== 'allow-pc') {
      v.status = busy('status.installing', 'status.installed');
      v.statusOverride = 'status.installing';
    }
    // The installed copy's first frames paint the frame the old copy handed over, status included.
    if (S.setup.hold && S.setup.hold.status !== undefined) v.status = statusFromKey(S.setup.hold.status);
    v.bodyKey = v.body.join('');
    return v;
  }

  Object.assign(D, { RANK, SUBS, route, settle, observe, view, readySub, hostOf, inputOn });
})();
