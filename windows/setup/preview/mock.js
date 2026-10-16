// Preview harness (SPEC §9 WP6). It stands in for the setup app's host when ui/index.html runs
// in a normal browser: app.js loads it before its first render. Nothing here ships to people.
//
//   ?step=<screen>&sub=<sub>   one still frame; the state comes from D.mock.stateFor(screen, sub, flags)
//   ?scenario=<name>           the host and the world play that scenario (SPEC §10.3); the clicks
//                              on this PC are left to you
//   &play=1                    ...and this PC's clicks are made too, so it plays to its end by itself
//                              (no ?step and no ?scenario: the first-run world, clicks left to you)
//   ?speed=N                   the clock runs N times faster: D.now(), and every timer here
//   ?theme=light|dark ?accent= the Mac's appearance and accent, once the Mac is known (dark, purple)
//   flags (stills and the scenarios' first state):
//     ?acct=standard ?signed=1 ?notarized=1 ?update=1 ?input=1 ?edge=left|right|top|bottom|unknown ?pointer=1
//   ?active=0                  this window is not the active one (the host's {type:'active', on:false})
//   ?log=1                     keeps the scenario's log in <pre id="mock-log"> (JSON, for shoot.sh)
//   ?list=subs                 writes every [screen, sub] (D.SUBS) into <pre id="mock-subs"> (for shoot.sh)
//
// What it needs from app.js: D.receive(msg) takes every host message ({type:'state'|'active'|
// 'remoteAct'|'mirror'}); every command goes to D.mock.receive(cmd); the local place is readable
// as D.local (L.screen, L.sub) for the log; buttons are real [data-act] elements.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});
  const P = new URLSearchParams(location.search);
  const has = (k) => P.has(k) && P.get(k) !== '0' && P.get(k) !== 'false';

  // ---------- Clock (OVERRIDE O4) ----------
  // app.js and steps.js read every time through D.now(), so a faster clock here makes every
  // threshold come sooner. The spinner keeps the wall clock.
  const speed = Math.max(0.05, Number(P.get('speed')) || 1);
  const wall0 = Date.now();
  if (speed !== 1) D.now = () => wall0 + (Date.now() - wall0) * speed;
  else D.now = D.now || (() => Date.now());
  const now = () => D.now();
  const t0 = now();
  const later = (sec, fn) => setTimeout(fn, Math.max(0, (sec * 1000) / speed));
  const sleep = (sec) => new Promise((r) => later(sec, r));
  const clock = () => Math.round((now() - t0) / 100) / 10;  // seconds since load, on the scenario clock

  // ---------- Every screen and sub-state (SPEC §3), used when steps.js has no D.SUBS ----------
  const SUBS_SPEC = {
    welcome: ['idle'],
    unsupported: ['idle'],
    incomplete: ['idle'],
    'install-error': ['in-use', 'other'],
    'allow-pc': ['installing', 'waiting', 'pending', 'pending-hint', 'working', 'done', 'ask', 'refused', 'failed'],
    connect: ['cable', 'cable-hint', 'no-cable', 'reconnect', 'finding', 'no-mac', 'no-server', 'port-busy'],
    unreachable: ['waiting', 'help'],
    'get-app': ['address', 'address-hint', 'address-ip', 'download', 'download-hint', 'allow-downloads', 'downloading'],
    'open-app': ['downloads', 'confirm', 'not-opened', 'page-button', 'safari-allow', 'open-anyway', 'setting-up', 'setting-up-late'],
    move: ['idle', 'moving', 'failed'],
    login: ['settings', 'asking'],
    'allow-screen': ['prompt', 'settings', 'reopen', 'reopen-late', 'off'],
    keyboard: ['offer'],
    'allow-control': ['prompt', 'settings', 'off'],
    ready: ['starting', 'cut', 'showing', 'hidden', 'manual', 'elsewhere', 'error', 'error-files'],
  };
  const RANK_SPEC = { incomplete: 0, unsupported: 0, welcome: 1, 'install-error': 2, 'allow-pc': 2,
    connect: 3, unreachable: 3, 'get-app': 4, 'open-app': 5, move: 6, login: 7,
    'allow-screen': 8, keyboard: 9, 'allow-control': 9, ready: 10 };
  const rankOf = (screen) => { const r = (D.RANK || RANK_SPEC)[screen]; return r == null ? RANK_SPEC[screen] : r; };

  // D.SUBS as a list of [screen, sub], whatever shape steps.js gives it.
  function normSubs(x) {
    if (Array.isArray(x)) {
      return x.map((e) => {
        if (Array.isArray(e)) return [String(e[0]), String(e[1] || '')];
        if (typeof e === 'string') { const m = /^([^/.:|]+)[/.:|](.*)$/.exec(e); return m ? [m[1], m[2]] : [e, '']; }
        if (e && e.screen) return [e.screen, e.sub || ''];
        return null;
      }).filter(Boolean);
    }
    if (x && typeof x === 'object') {
      const out = [];
      Object.keys(x).forEach((k) => (Array.isArray(x[k]) ? x[k] : []).forEach((s) => out.push([k, s])));
      return out;
    }
    return null;
  }
  const specSubs = () => { const out = []; Object.keys(SUBS_SPEC).forEach((k) => SUBS_SPEC[k].forEach((s) => out.push([k, s]))); return out; };
  const subsList = () => { const n = normSubs(D.SUBS); return n && n.length ? n : specSubs(); };
  const firstSub = (screen) => { const e = subsList().find((x) => x[0] === screen); return e ? e[1] : (SUBS_SPEC[screen] || [''])[0]; };

  // ---------- Snapshots ----------
  const ACCENTS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];
  const APP_SIZE = 734003;  // the zip: "0.7 MB"
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const lookFrom = (f) => ({
    theme: f.theme === 'light' ? 'light' : 'dark',
    accent: ACCENTS.indexOf(f.accent) >= 0 || f.accent === 'multicolor' ? f.accent : 'purple',
    // Safari reports the appearance but not the accent (WebKit gives AccentColor its default blue,
    // measured on macOS 27.0.1), so the page's accent is known only when ?accent= asks for one.
    pageAccent: ACCENTS.indexOf(f.accent) >= 0 ? f.accent : '',
  });

  function base() {
    return {
      type: 'state',
      laptop: { windowsBuild: 26200, arch: 'arm64', isAdminUser: true, usb4: 'ok', checked: true, installed: false, installing: false,
        installError: '', missingPayload: [], elevation: 'none', firewallOk: false, recoveryTasksOk: false, runningInstalled: false, signed: false },
      setup: { started: false, axChoice: '', loginSkip: false, elevationAsked: false, handingOff: false, hold: null },
      link: { adapterUp: false, adapterName: '', secondsSincePlug: 0, macFound: false, macV6: '', macV4: '', laptopV4: '' },
      server: { running: false, url: 'http://usbc.local', fallbackUrl: 'http://169.254.29.64', urlReady: false, pageVisited: false,
        pageFocused: false, pageBlurs: 0, settingsOpened: false, leftForSettings: false, downloadClicked: false, appOpened: false,
        download: { sent: 0, size: 0, done: false }, appNotarized: false, appSize: APP_SIZE, appVersion: '5',
        pageAppearance: '', pageAccent: '', error: '' },
      mac: { reachable: false, outdated: false, appVersion: '', macOS: '', appearance: '', accent: '',
        status: { screenOk: false, axOk: false, screenPrompted: false, axPrompted: false, loginItemEnabled: false, loginItemNeedsApproval: false,
          sessionActive: false, runningAsAgent: false, inApplications: false, screenNeedsRelaunch: false, settingsFront: false, promptUp: false,
          displaySide: '', authUp: false } },
      screen: { running: false, showing: false, pointerOnLaptop: false, inputOk: false, error: '' },
      settings: {
        scaleOptions: [
          { id: 125, label: 'Default', detail: 'Looks like 1536 × 960', recommended: true },
          { id: 150, label: 'Larger Text', detail: 'Looks like 1280 × 800', recommended: false },
          { id: 100, label: 'More Space', detail: 'Looks like 1920 × 1200', recommended: false },
        ],
        scale: 125, matchColors: true, useLaptopInput: false,
      },
      setupDone: false,
    };
  }

  // Stages: each brings a snapshot one step further, as the host would report it.
  const W = {
    started(s) { s.setup.started = true; },
    installed(s) { s.laptop.installed = true; s.laptop.installing = false; },
    elevated(s) {
      s.laptop.installed = true; s.laptop.elevation = 'done'; s.laptop.firewallOk = true; s.laptop.recoveryTasksOk = true;
      s.setup.elevationAsked = true; s.server.running = true;
    },
    installedCopy(s) { s.laptop.runningInstalled = true; s.laptop.installed = true; },
    plugged(s, secs) {
      s.link.adapterUp = true; s.link.adapterName = 'USB4 P2P Network Adapter'; s.link.secondsSincePlug = secs || 0;
      if (s.laptop.usb4 !== 'ok') s.laptop.usb4 = 'ok';  // the cable proves USB4
    },
    unplugged(s) {
      Object.assign(s.link, { adapterUp: false, adapterName: '', secondsSincePlug: 0, macFound: false, macV6: '', macV4: '' });
      s.server.urlReady = false;
    },
    found(s) {
      Object.assign(s.link, { macFound: true, macV6: 'fe80::1c2a:5bff:fe3d:9a10', macV4: '169.254.112.7', laptopV4: '169.254.29.64' });
      s.server.running = true; s.server.urlReady = true;
    },
    visited(s, look) {
      s.server.pageVisited = true; s.server.pageFocused = true;
      s.server.pageAppearance = look.theme; s.server.pageAccent = look.pageAccent || '';
    },
    downloaded(s) {
      s.server.download = { sent: APP_SIZE, size: APP_SIZE, done: true };
      s.server.downloadClicked = false; s.server.pageBlurs = 0;
    },
    // The app answers the probe. A current app (4 or later) has already moved itself to
    // Applications and registered its login agent by then (SPEC §3.8).
    appUp(s, look, version) {
      const v = String(version || '5');
      Object.assign(s.mac, { reachable: true, outdated: false, appVersion: v, macOS: '27.0.1',
        appearance: +v >= 4 ? look.theme : '', accent: +v >= 4 ? look.accent : '' });
      Object.assign(s.mac.status, { inApplications: true, runningAsAgent: true, loginItemEnabled: true });
    },
    screenOk(s) {
      Object.assign(s.mac.status, { screenOk: true, screenPrompted: true, screenNeedsRelaunch: false, promptUp: false, settingsFront: false, authUp: false });
    },
  };
  const appCurrent = (s) => s.mac.reachable && !s.mac.outdated && +s.mac.appVersion >= 4;
  const elevOk = (s) => s.laptop.elevation === 'done' || (s.laptop.elevation === 'failed' && s.laptop.firewallOk);

  // Flags from an object (true/'1'/'left'…) or, when missing, from the URL.
  function normFlags(flags) {
    const f = {};
    const src = flags instanceof URLSearchParams ? Object.fromEntries(flags) : (flags || {});
    const pick = (k) => (src[k] !== undefined && src[k] !== null ? src[k] : P.get(k));
    const on = (k) => { const v = pick(k); return v === true || (v != null && v !== false && v !== '0' && v !== 'false' && v !== ''); };
    f.acct = pick('acct') === 'standard' || src.admin === false ? 'standard' : 'admin';
    f.signed = on('signed');
    f.notarized = on('notarized');
    f.update = on('update');
    f.input = on('input');
    f.pointer = on('pointer');
    const e = pick('edge');
    f.edge = e == null || e === true || e === '' ? 'right' : String(e);
    f.theme = pick('theme') || '';
    f.accent = pick('accent') || '';
    return f;
  }
  const SIDES = { right: 'right', left: 'left', top: 'above', above: 'above', bottom: 'below', below: 'below', unknown: '', none: '' };

  // ---------- D.mock.stateFor(screen, sub, flags) ----------
  // A plausible snapshot for any [screen, sub] (SPEC §3): every stage before the screen is done,
  // and the sub-state's own signal is set. Time-dependent subs (…-hint, …-late, help) get the
  // same snapshot as their base sub: the time lives in sub, never in the state.
  function stateFor(screen, sub, flags) {
    const f = normFlags(flags);
    const look = lookFrom(f);
    const s = base();
    const st = s.mac.status, sv = s.server;
    screen = screen || 'welcome';
    sub = sub || firstSub(screen);
    const r = rankOf(screen) == null ? 10 : rankOf(screen);
    const fin = () => {
      if (f.acct === 'standard') s.laptop.isAdminUser = false;
      if (f.signed) s.laptop.signed = true;
      if (f.notarized) sv.appNotarized = true;
      return s;
    };

    if (screen === 'unsupported') { s.laptop.usb4 = 'missing'; return fin(); }
    if (screen === 'incomplete') { s.laptop.missingPayload = ['UsbcDisplay.exe']; return fin(); }
    if (screen === 'welcome') return fin();
    W.started(s);
    if (screen === 'install-error') { s.laptop.installError = sub === 'in-use' ? 'inUse' : 'other'; return fin(); }
    if (screen === 'allow-pc') {
      const lap = s.laptop;
      W.installed(s);
      switch (sub) {
        case 'installing': lap.installed = false; lap.installing = true; break;
        case 'waiting': break;
        case 'pending': case 'pending-hint': lap.elevation = 'pending'; s.setup.elevationAsked = true; break;
        case 'working': lap.elevation = 'working'; s.setup.elevationAsked = true; break;
        case 'done': W.elevated(s); s.setup.handingOff = true; break;
        case 'ask': lap.runningInstalled = true; s.setup.elevationAsked = true; break;
        case 'refused': lap.elevation = 'refused'; s.setup.elevationAsked = true; break;
        case 'failed': lap.elevation = 'failed'; s.setup.elevationAsked = true; break;
        default: break;
      }
      return fin();
    }
    W.elevated(s); W.installedCopy(s);
    if (screen === 'connect') {
      switch (sub) {
        case 'finding': W.plugged(s, 6); break;
        case 'no-mac': W.plugged(s, 45); break;
        case 'no-server': W.plugged(s, 30); W.found(s); sv.running = false; sv.urlReady = false; break;
        case 'port-busy': W.plugged(s, 30); W.found(s); sv.running = false; sv.urlReady = false; sv.error = 'port'; break;
        default: break;  // cable, cable-hint, no-cable, reconnect: no adapter
      }
      return fin();
    }
    W.plugged(s, 30); W.found(s);
    if (screen === 'get-app') {
      if (f.update) { W.appUp(s, look, '3'); }
      if (!/^address/.test(sub)) W.visited(s, look);
      if (sub === 'allow-downloads') sv.downloadClicked = true;
      if (sub === 'downloading') { sv.downloadClicked = true; sv.download = { sent: 314573, size: APP_SIZE, done: false }; }
      return fin();
    }
    W.visited(s, look); W.downloaded(s);
    if (screen === 'open-app') {
      if (f.update) W.appUp(s, look, '3');
      switch (sub) {
        case 'downloads': sv.pageFocused = true; break;
        case 'confirm': sv.appNotarized = true; sv.pageBlurs = 1; sv.pageFocused = false; break;
        case 'not-opened': sv.pageBlurs = 1; sv.pageFocused = false; break;
        case 'page-button': sv.pageBlurs = 1; sv.pageFocused = true; break;
        case 'safari-allow': sv.pageBlurs = 1; sv.pageFocused = true; sv.settingsOpened = true; break;
        case 'open-anyway': sv.pageBlurs = 2; sv.pageFocused = false; sv.settingsOpened = true; sv.leftForSettings = true; break;
        case 'setting-up': case 'setting-up-late': sv.pageBlurs = 2; sv.pageFocused = false; sv.appOpened = true; break;
        default: break;
      }
      return fin();
    }
    sv.pageBlurs = 2; sv.pageFocused = false;
    W.appUp(s, look, '5');
    if (screen === 'unreachable') {
      W.screenOk(s);
      s.mac.reachable = false;  // asleep, or the app quit; the host keeps the last status
      return fin();
    }
    if (screen === 'move') {
      Object.assign(st, { inApplications: false, runningAsAgent: false, loginItemEnabled: false });
      return fin();
    }
    if (screen === 'login') {
      st.loginItemNeedsApproval = true; st.loginItemEnabled = false;
      st.settingsFront = sub === 'settings';
      return fin();
    }
    if (screen === 'allow-screen') {
      st.screenPrompted = true;
      if (sub === 'prompt') st.promptUp = true;
      if (sub === 'settings') st.settingsFront = true;
      if (sub === 'reopen' || sub === 'reopen-late') { st.screenNeedsRelaunch = true; st.settingsFront = true; }
      return fin();
    }
    W.screenOk(s);
    // After Quit & Reopen, System Settings is still in front on Screen Recording (engineering-1),
    // so keyboard-yes enters allow-control with it there, as on a real Mac.
    if (screen === 'keyboard') { st.settingsFront = true; return fin(); }
    if (screen === 'allow-control') {
      s.setup.axChoice = 'yes'; st.axPrompted = true;
      if (sub === 'prompt') st.promptUp = true;
      if (sub === 'settings') st.settingsFront = true;
      return fin();
    }
    // ready (and anything ranked after it)
    if (f.input) { s.setup.axChoice = 'yes'; st.axOk = true; st.axPrompted = true; s.settings.useLaptopInput = true; } else s.setup.axChoice = 'no';
    if (r >= rankOf('ready') || screen === 'ready') {
      const scr = s.screen;
      const side = SIDES[f.edge] !== undefined ? SIDES[f.edge] : 'right';
      const show = () => {
        Object.assign(scr, { running: true, showing: true, inputOk: f.input, pointerOnLaptop: f.pointer });
        st.sessionActive = true; st.displaySide = side; s.setupDone = true;
      };
      switch (sub) {
        case 'starting': scr.running = true; break;
        case 'cut': show(); break;
        case 'showing': show(); break;
        case 'hidden': s.setupDone = true; break;
        case 'manual': break;
        case 'elsewhere': scr.running = true; break;
        case 'error': scr.error = 'other'; break;
        case 'error-files': scr.error = 'receiver-missing'; break;
        default: break;
      }
    }
    return fin();
  }

  // ======================================================================================
  // The host and the world, played (?scenario=, or no ?step)
  // ======================================================================================
  const stepParam = P.get('step');
  const scName = P.get('scenario') || (stepParam ? '' : 'default');
  const live = !stepParam || has('play');                   // the world plays (?step=…&play=1: from that frame)
  const auto = live && (has('play') || has('autoplay'));    // and this PC's clicks are made too
  const look = lookFrom(normFlags());

  let S = null;              // the host's snapshot
  let started = false;       // 'ready' arrived
  let stopped = false;       // the world froze (end reached, Done, close)
  let lastFrame = null;      // {cmd:'frame'} from the page, for the hand-off hold
  const cmds = [];           // every command, with its time
  const busy = {};
  const logLines = [];
  const transitions = [];    // [{t, place}]
  const report = { scenario: scName, speed, auto, end: null, expected: null, done: false, ok: null, flashes: [], back: [], welcomeAfterStart: false, problems: [], transitions, log: logLines, cmds: [] };
  const found = [];          // problems seen while playing (the hand-off hold, the status line)

  function log(text) {
    const line = clock().toFixed(1).padStart(6) + 's  ' + text;
    logLines.push(line);
    if (has('log') || has('verbose')) console.log('[mock] ' + line);
    writeLog();
  }

  // Host → page. app.js takes every host message through D.receive (or D.onHostMessage).
  const pending = [];
  let flushTimer = 0;
  function deliver(msg) {
    if (msg) pending.push(msg);
    const fn = D.onHostMessage || D.receive;
    if (typeof fn !== 'function') {
      if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = 0; deliver(null); }, 50);
      return;
    }
    while (pending.length) fn(pending.shift());
  }
  let pushQueued = false;
  function push() {
    if (!S || pushQueued) return;
    pushQueued = true;
    setTimeout(() => { pushQueued = false; deliver(clone(S)); }, 0);
  }
  function set(fn, note) { fn(S); if (note) log(note); push(); }

  // ---------- What the page shows (for the log, the end check and the flash check) ----------
  function place() {
    const L = D.local || (D.debug && (D.debug.L || D.debug.local)) || null;
    if (L && L.screen) return L.screen + '/' + (L.sub || '');
    const el = document.querySelector('#app [data-screen], [data-screen]');
    if (el && el.dataset.screen) return el.dataset.screen + '/' + (el.dataset.sub || '');
    const rd = document.documentElement.dataset;
    if (rd.screen) return rd.screen + '/' + (rd.sub || '');
    return '';
  }
  let lastPlace = '';
  function watchPlace() {
    const p = place();
    if (p && p !== lastPlace) {
      lastPlace = p;
      transitions.push({ t: clock(), place: p });
      log('screen ' + p);
      if (p.split('/')[0] === 'welcome' && cmds.some((c) => c.cmd === 'setUp')) report.welcomeAfterStart = true;
    }
    watchStatus();
  }
  // The status line's check (a done text with its tick) only when that work has really completed:
  // a busy status replaced by something else (the "Installing…" override, an error) just goes
  // (hardware, HW2). Reads app.js's status line (.st-line, .status-check); quiet if those change.
  const DONE_WORK = {
    'status.installed': (s) => s.laptop.installed && !s.laptop.installing,
    'status.pcReady': (s) => elevOk(s),
    'status.downloaded': (s) => s.server.download.done,
    'status.extended': (s) => s.screen.showing,
  };
  let checkShown = '';
  function watchStatus() {
    if (!S || !D.STR) return;
    const line = document.querySelector('.st-line:not(.going)');
    const text = line && line.querySelector('.status-check') ? (line.textContent || '').trim() : '';
    if (text === checkShown) return;
    checkShown = text;
    if (!text) return;
    const key = Object.keys(DONE_WORK).find((k) => D.STR[k] === text);
    const ok = !key || DONE_WORK[key](S);
    log('status check “' + text + '”' + (ok ? '' : ' WITHOUT ITS WORK'));
    if (!ok) found.push('check without its work: “' + text + '” at ' + place() + ' (' + clock() + 's)');
  }
  // The first frame (hardware, HW1). As the host, the first snapshots come before this PC is
  // checked (laptop.checked false) and the window stays cloaked until the page says 'shown'.
  // Nothing may be built before route() gives a screen; the first screen (the installed copy's
  // held frame too) appears whole, with no fade of the screen, its buttons or its status; and
  // 'shown' comes only once that frame is whole: fonts in, no fade running. Reads app.js's
  // #page > .scr and the Web Animations it starts.
  const firstFrame = { at: null, place: '', fades: 0, shownAt: null, shownOk: null };
  report.firstFrame = firstFrame;
  // windowOnly: the window's own fades (screen, buttons, status), not the picture's motion in the
  // band (a dialog appearing in the drawn Mac screen is part of the picture; 'shown' still waits
  // for it, so it is in before the window is).
  function fadesIn(el, windowOnly) {
    if (!el || typeof el.getAnimations !== 'function') return [];
    return el.getAnimations({ subtree: true }).filter((a) => {
      if (!(a.playState === 'running' || a.pending) || !a.effect) return false;
      const tg = a.effect.target;
      if (windowOnly && tg && tg.closest && tg.closest('.band')) return false;
      if (!isFinite(a.effect.getComputedTiming().endTime)) return false;       // loops, the spinner
      try { return a.effect.getKeyframes().some((k) => 'opacity' in k); } catch (e) { return true; }
    });
  }
  const pageChecked = () => { const s = D.debug && D.debug.state ? D.debug.state() : S; return !!(s && s.laptop && s.laptop.checked); };
  function watchFirstFrame() {
    const page = document.getElementById('page');
    if (!page || !window.MutationObserver) return;
    const mo = new MutationObserver(() => {
      const scr = page.querySelector('.scr');
      if (!scr || firstFrame.at !== null) return;
      mo.disconnect();
      firstFrame.at = clock();
      firstFrame.place = place();
      if (!pageChecked()) found.push('a screen before this PC was checked (HW1): ' + firstFrame.place);
      const fades = fadesIn(document.getElementById('app'), true);
      firstFrame.fades = fades.length;
      const op = getComputedStyle(scr).opacity;
      if (fades.length || op !== '1') found.push('the first frame fades in (HW1): ' + fades.length + ' fade(s), opacity ' + op + ' at ' + firstFrame.place);
      log('first frame ' + firstFrame.place + (fades.length ? ' (' + fades.length + ' fades)' : ' (whole)'));
      // Frames the browser has drawn since: 'shown' needs a few. (A headless run on virtual time
      // draws hardly any, so a missing 'shown' only counts once frames did go by.)
      firstFrame.frames = 0;
      const count = () => { firstFrame.frames++; if (firstFrame.shownAt === null && firstFrame.frames < 1000) requestAnimationFrame(count); };
      requestAnimationFrame(count);
    });
    mo.observe(page, { childList: true });
  }
  function onShown() {
    if (firstFrame.shownAt !== null) { found.push('shown sent twice'); return; }
    firstFrame.shownAt = clock();
    const scr = document.querySelector('#page > .scr:not(.leaving)');
    const fades = fadesIn(document.getElementById('app'));
    const fontsIn = !document.fonts || (document.fonts.status === 'loaded' && document.fonts.check('13px Inter'));
    const op = scr ? getComputedStyle(scr).opacity : '';
    firstFrame.shownOk = !!scr && !fades.length && fontsIn && op === '1';
    log('shown' + (firstFrame.shownOk ? ' (the frame is whole)' : ''));
    if (!firstFrame.shownOk) found.push('shown before the frame was whole (HW1): ' + (scr ? '' : 'no screen, ') + fades.length + ' fade(s), fonts ' + (fontsIn ? 'in' : 'loading') + ', opacity ' + op);
  }
  if (live) { if (document.getElementById('page')) watchFirstFrame(); else document.addEventListener('DOMContentLoaded', watchFirstFrame); }

  // A move back to an earlier screen that lasted under 3 s, then went forward again (SPEC §10.3).
  function analyse() {
    const segs = [];
    transitions.forEach((x) => {
      const scr = x.place.split('/')[0];
      if (!segs.length || segs[segs.length - 1].screen !== scr) segs.push({ screen: scr, t: x.t, place: x.place });
    });
    report.flashes = []; report.back = [];
    for (let i = 1; i < segs.length; i++) {
      const a = rankOf(segs[i - 1].screen), b = rankOf(segs[i].screen);
      if (a == null || b == null || b >= a) continue;
      report.back.push(segs[i - 1].place + ' -> ' + segs[i].place + ' at ' + segs[i].t + 's');
      const next = segs[i + 1];
      if (!next || next.t - segs[i].t >= 3 || rankOf(next.screen) <= b) continue;
      const what = segs[i].place + " for " + (next.t - segs[i].t).toFixed(1) + "s at " + segs[i].t + "s";
      // A back move the scenario causes on purpose (the world changed for longer than the 3 s debounce).
      if ((report.allowBack || []).some((p) => segs[i].place.indexOf(p) === 0)) report.back.push("(expected) " + what); else report.flashes.push(what);
    }
    // A permission screen that says "turn it on in System Settings" and then "click Open System
    // Settings": it opened on settings because System Settings was in front from the step
    // before, and the prompt came after (engineering-1).
    report.problems = found.slice();
    for (let i = 1; i < transitions.length; i++) {
      const a = transitions[i - 1].place.split('/'), b = transitions[i].place.split('/');
      if (a[0] === b[0] && (a[0] === 'allow-screen' || a[0] === 'allow-control') && a[1] === 'settings' && b[1] === 'prompt') {
        report.problems.push('prompt after settings: ' + transitions[i - 1].place + ' -> ' + transitions[i].place + ' at ' + transitions[i].t + 's');
      }
    }
    // A place the scenario must never show (e.g. a silent failure that must stay silent).
    (report.never || []).forEach((p) => {
      const hit = transitions.find((x) => x.place.indexOf(p) === 0);
      if (hit) report.problems.push('showed ' + hit.place + ' at ' + hit.t + 's');
    });
    // The window must be revealed: 'shown' once the first frame is whole (HW1).
    if (firstFrame.at !== null && firstFrame.shownAt === null && firstFrame.frames >= 60) {
      report.problems.push('never shown (the window would stay cloaked), first frame at ' + firstFrame.at + 's, ' + firstFrame.frames + ' frames since');
    }
  }
  function writeLog() {
    if (!has('log')) return;
    let pre = document.getElementById('mock-log');
    if (!pre) {
      if (!document.body) return;
      pre = document.createElement('pre');
      pre.id = 'mock-log';
      pre.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
      document.body.appendChild(pre);
    }
    analyse();
    report.cmds = cmds.map((c) => c.t + 's ' + c.cmd + (c.action ? ':' + c.action : '') + (c.axChoice ? ':' + c.axChoice : ''));
    pre.textContent = JSON.stringify(report);
  }

  // ---------- This PC's clicks ----------
  const CMD_OF = {
    setUp: (c) => c.cmd === 'setUp', retryInstall: (c) => c.cmd === 'setUp', elevate: (c) => c.cmd === 'elevate',
    axYes: (c) => c.cmd === 'place' && placeArgs(c).axChoice === 'yes', axNo: (c) => c.cmd === 'place' && placeArgs(c).axChoice === 'no',
    loginLater: (c) => c.cmd === 'place' && placeArgs(c).loginSkip, show: (c) => c.cmd === 'startScreen',
    stopScreen: (c) => c.cmd === 'stopScreen', finish: (c) => c.cmd === 'finish', close: (c) => c.cmd === 'close' || c.cmd === 'finish',
  };
  const placeArgs = (c) => Object.assign({}, c.data || {}, c);
  function findAct(act) {
    const els = document.querySelectorAll('[data-act="' + act + '"]');
    for (const el of els) {
      if (el.disabled || el.closest('.leaving') || el.closest('[hidden]') || el.closest('[aria-hidden="true"]')) continue;
      if (el.getClientRects().length === 0) continue;
      return el;
    }
    return null;
  }
  async function until(pred, timeoutSec) {
    const end = now() + (timeoutSec || 600) * 1000;
    while (!stopped) {
      let ok = false;
      try { ok = pred(S); } catch (e) { ok = false; }
      if (ok) return true;
      if (now() > end) { log('gave up waiting (' + (pred.label || 'condition') + ')'); return false; }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }
  const at = (p) => { const f = () => place().indexOf(p) === 0; f.label = 'screen ' + p; return f; };
  const sawCmd = (pred, from) => cmds.slice(from || 0).some(pred);
  // A click on this PC: made here when playing (?play=1), otherwise left to you.
  async function click(act, delay) {
    const from = cmds.length;
    const pred = CMD_OF[act] || ((c) => c.cmd === 'macAction' && 'mac:' + c.action === act);
    if (!auto) { await until(() => sawCmd(pred, from)); return; }
    await until(() => !!findAct(act));
    if (delay) await sleep(delay);
    if (stopped) return;
    const el = findAct(act);
    log('click ' + act);
    if (el) el.click(); else deliver({ type: 'remoteAct', act, data: {} });
  }

  // ---------- The host (SPEC §7.1), as far as the page can tell ----------
  let o = {};  // the scenario's options for the host and the person
  const defaults = {
    installSecs: 2, yesAfter: 2, refuse: 0, fail: 0, failKeepsFirewall: false, workSecs: 2, holdSecs: 0.5,
    continueAt: 2, plugAt: 3, findAt: 2, typeAt: 4, downloadAt: 3, allowDownloadsAt: null, bytesSecs: 0.6,
    openAt: 3, confirmAt: 3, doneAt: 4, pageButtonAt: 3, allowAt: 2.5, anywayAt: 8,
    focusAfterDone: false,  // Safari gets the focus back when the Not Opened alert closes (it often doesn't)
    promptClickAt: 3, closePrompt: 0, grantAt: 3, authSecs: 2, authHidesSettings: false, ignoreSettings: 0,
    relaunchSecs: 2.5, ignoreRelaunch: 0, moveSecs: 3,
    keyboardAt: 2.5, axChoice: 'yes', showAfter: 3, display: [], pointerAt: 3, finishAt: 3, inactive: false,
    prompted: {},  // macOS has asked before (it won't show the prompt again): {screen, ax}
  };
  const world = { pane: '', prompt: '' };  // what System Settings shows; which prompt is up
  // The person gets and opens the app only until a current app has answered once: a Mac that
  // sleeps or relaunches later doesn't send them back to Safari.
  const needApp = () => { if (appCurrent(S)) world.appSeen = true; return !world.appSeen; };

  async function hostSetUp() {
    if (busy.setUp) return;
    busy.setUp = true;
    const start = now();
    set((s) => { s.setup.started = true; });
    if (!S.laptop.runningInstalled || !S.laptop.installed) {
      set((s) => { s.laptop.installing = true; s.laptop.installError = ''; }, 'host: installing');
      await sleep(o.installSecs);
      if (o.installError) {
        set((s) => { s.laptop.installing = false; s.laptop.installError = o.installError; }, 'host: install error ' + o.installError);
        o.installError = '';
        busy.setUp = false;
        return;
      }
      set((s) => { s.laptop.installing = false; s.laptop.installed = true; }, 'host: installed');
    }
    const installEnd = now();
    // As Wizard.SetUpWork: ask Windows once (no earlier than 3 s after Continue), then a copy
    // outside the install folder hands over to the installed copy, whatever Windows answered:
    // ElevateSync(handOff: !installed) sets the result and handingOff in one snapshot, and the
    // installed copy shows refused or failed (with Try Again) once the hold is released.
    const downloaded = !S.laptop.runningInstalled;
    if (!elevOk(S) && !S.setup.elevationAsked) {
      const wait = Math.max(start + 3000, installEnd + 700) - now();
      if (wait > 0) await sleep(wait / 1000);
      await hostElevate(downloaded);
    }
    if (downloaded && !S.laptop.installError && !stopped) await handOff();
    busy.setUp = false;
  }
  // handsOver: from setUp in the downloaded copy only. Wizard.Elevate (the page's 'elevate': Try
  // Again, or Continue on 'ask') never hands over.
  async function hostElevate(handsOver) {
    if (busy.elevate) return;
    busy.elevate = true;
    set((s) => { s.setup.elevationAsked = true; s.laptop.elevation = 'pending'; }, 'host: Windows asks (UAC)');
    const refuse = o.refuse > 0;
    await sleep(refuse ? 2 : o.yesAfter);
    if (refuse) {
      o.refuse--;
      set((s) => { s.laptop.elevation = 'refused'; if (handsOver) s.setup.handingOff = true; },  // the same snapshot (H6)
        'person: No' + (handsOver ? ' (this copy hands over all the same)' : ''));
      busy.elevate = false;
      return;
    }
    set((s) => { s.laptop.elevation = 'working'; }, 'person: Yes');
    await sleep(o.workSecs);
    if (o.fail > 0) {
      // Windows didn't finish the changes (ElevationResult 3). With the firewall rules in, only
      // the recovery tasks failed: silent and logged, setup goes on (SPEC §3.4).
      o.fail--;
      const fw = !!o.failKeepsFirewall;
      set((s) => {
        s.laptop.elevation = 'failed'; s.laptop.firewallOk = fw; s.laptop.recoveryTasksOk = false;
        if (fw) s.server.running = true;
        if (handsOver) s.setup.handingOff = true;  // the same snapshot (H6)
      }, fw ? 'host: the recovery tasks failed; the firewall rules are in (silent)' : 'host: Windows didn’t finish the changes (failed)');
      busy.elevate = false;
      return;
    }
    set((s) => {
      s.laptop.elevation = 'done'; s.laptop.firewallOk = true; s.laptop.recoveryTasksOk = true; s.server.running = true;
      if (handsOver) s.setup.handingOff = true;  // the same snapshot (H6)
    }, 'host: this PC is ready');
    busy.elevate = false;
  }
  async function handOff() {
    if (busy.handOff) return;
    busy.handOff = true;
    set((s) => { s.setup.handingOff = true; });
    await sleep(0.6);
    // The installed copy opens underneath with the same frame (--hold), the old one closes. The
    // page posts {cmd:'frame'} only to a real host, so here the frame is read from the page. As
    // Wizard.cs: the page's frame is passed on as it is (an empty status stays empty); only with
    // no frame at all does the hold fall back to "This PC is ready".
    const f = lastFrame || pageFrame();
    const hold = f.screen ? Object.assign({ sub: '', status: '', theme: '', accent: '' }, f)
      : { screen: 'allow-pc', sub: 'done', status: 'status.pcReady', theme: look.theme, accent: 'blue' };
    // The held frame is on screen for seconds: after No (or a failure) it must not still ask
    // for Yes (engineering-3); a silent failure (firewall rules in) holds "This PC is ready".
    const el = S.laptop.elevation;
    const want = elevOk(S) ? 'done' : el === 'refused' || el === 'failed' ? el : '';
    if (want && hold.screen === 'allow-pc' && hold.sub !== want) {
      found.push('hold after ' + el + ': ' + hold.screen + '/' + hold.sub + (hold.status ? ' (' + hold.status + ')' : '') + ', not allow-pc/' + want);
    }
    set((s) => {
      s.setup.handingOff = false; s.laptop.runningInstalled = true; s.laptop.installed = true;
      s.setup.hold = hold;
    }, 'host: the installed copy takes over (hold ' + hold.screen + '/' + hold.sub + (hold.status ? ', ' + hold.status : '') + ')');
    await sleep(o.holdSecs);
    set((s) => { s.setup.hold = null; }, 'host: hold released');
    busy.handOff = false;
  }
  function pageFrame() {
    const L = D.local, v = D.debug && D.debug.view ? D.debug.view() : null, rd = document.documentElement.dataset;
    if (!L || !L.screen) return {};
    return { screen: L.screen, sub: L.sub, status: v && v.status ? v.status.key : '', theme: rd.theme || '', accent: rd.accent || '',
      active: L.active !== false };   // as app.js postFrame: the window's own active state (the hold draws it)
  }
  function canStart(s) {
    const st = s.mac.status;
    return appCurrent(s) && st.screenOk && !st.screenNeedsRelaunch && s.link.adapterUp && !s.screen.running && s.laptop.runningInstalled;
  }
  async function hostStart() {
    // As Wizard.StartScreen: a display that never showed (Try Again after 30 s) is stopped first.
    if (S.screen.running && !S.screen.showing) hostStop('host: the display that never showed is stopped first');
    if (!canStart(S)) { set((s) => { s.screen.error = 'other'; }, 'host: startScreen refused by the guard'); return; }
    const mode = o.display.length ? o.display.shift() : 'ok';
    set((s) => { Object.assign(s.screen, { running: true, showing: false, error: '', pointerOnLaptop: false, inputOk: false }); }, 'host: receiver started (' + mode + ')');
    if (mode === 'fail') return;  // never shows: Ready says "Unable to Show…" 30 s after the start
    if (mode === 'refuse') {
      await sleep(1.5);
      set((s) => { Object.assign(s.screen, { running: false, error: 'screen-recording-off' }); s.mac.status.screenOk = false; }, 'receiver: refused (screen recording off)');
      return;
    }
    if (mode === 'exit') { await sleep(2); set((s) => { Object.assign(s.screen, { running: false, error: 'exited' }); }, 'receiver: exited'); return; }
    await sleep(o.showAfter);
    if (!S.screen.running) return;
    set((s) => {
      const st = s.mac.status;
      Object.assign(s.screen, { showing: true, inputOk: st.axOk && s.setup.axChoice !== 'no' });
      st.sessionActive = true; st.displaySide = o.side !== undefined ? o.side : 'right';
      s.setupDone = true;
    }, 'receiver: picture on screen');
  }
  function hostStop(note) {
    set((s) => {
      Object.assign(s.screen, { running: false, showing: false, pointerOnLaptop: false, inputOk: false });
      s.mac.status.sessionActive = false; s.mac.status.displaySide = '';
    }, note || 'host: receiver stopped');
  }
  async function relaunch() {
    if (busy.relaunch) return;
    busy.relaunch = true;
    await sleep(0.3);
    set((s) => { s.mac.reachable = false; }, 'mac: the app relaunches (unreachable)');
    await sleep(o.relaunchSecs);
    // System Settings stays in front, still on Screen Recording: the app is LSUIElement and
    // relaunches in the background, so nothing takes the foreground from it (engineering-1).
    set((s) => {
      s.mac.reachable = true;
      const st = s.mac.status;
      if (st.screenNeedsRelaunch) { st.screenOk = true; st.screenNeedsRelaunch = false; }
    }, 'mac: the app is back' + (S.mac.status.settingsFront ? ' (System Settings still in front)' : ''));
    busy.relaunch = false;
  }
  function macAction(a) {
    if (!S.mac.reachable) { log('mac: ' + a + ' not delivered (unreachable)'); return; }
    const st = S.mac.status;
    switch (a) {
      case 'screen': case 'accessibility': {
        const kind = a === 'screen' ? 'screen' : 'ax';
        if (kind === 'screen' ? st.screenOk : st.axOk) return;
        if (!o.prompted[kind]) {
          o.prompted[kind] = true;
          later(0.5, () => set((s) => { s.mac.status.promptUp = true; s.mac.status[kind + 'Prompted'] = true; world.prompt = kind; }, 'mac: prompt up (' + kind + ')'));
        } else {
          later(1.2, () => set((s) => { s.mac.status.settingsFront = true; world.pane = kind; }, 'mac: System Settings opens (' + kind + ')'));
        }
        return;
      }
      case 'loginItems':
        later(0.6, () => set((s) => { s.mac.status.settingsFront = true; world.pane = 'login'; }, 'mac: Login Items & Extensions opens'));
        return;
      case 'relaunch':
        if (o.ignoreRelaunch > 0) { o.ignoreRelaunch--; log('mac: relaunch does nothing this time'); return; }
        relaunch();
        return;
      case 'moveToApplications':
        later(0.3, () => set((s) => { s.mac.reachable = false; }, 'mac: moving to Applications'));
        later(0.3 + o.moveSecs, () => set((s) => { s.mac.reachable = true; Object.assign(s.mac.status, { inApplications: true, runningAsAgent: true, loginItemEnabled: true }); }, 'mac: reopened from Applications'));
        return;
      default: log('mac: unknown action ' + a);
    }
  }

  // Commands from the page (CONTRACT §3 + SPEC §7.4).
  function receive(cmd) {
    if (!cmd || !cmd.cmd) return;
    const c = cmd.cmd;
    if (c !== 'mirror' && c !== 'chrome' && c !== 'frame' && c !== 'startDrag') {
      cmds.push(Object.assign({ t: clock() }, cmd));
      log('cmd ' + c + (cmd.action ? ' ' + cmd.action : '') + (cmd.axChoice || (cmd.data && cmd.data.axChoice) ? ' axChoice=' + (cmd.axChoice || cmd.data.axChoice) : '') + (placeArgs(cmd).loginSkip ? ' loginSkip' : ''));
    }
    switch (c) {
      case 'ready': onReady(); return;
      case 'frame': lastFrame = Object.assign({}, cmd); delete lastFrame.cmd; return;  // every field, as the host passes it on
      case 'shown': if (live) onShown(); return;
      case 'chrome': case 'mirror': case 'startDrag': case 'copy': case 'minimize': case 'attention': case 'saveSettings': return;
      default: break;
    }
    if (!live || stopped || !S) return;
    switch (c) {
      case 'setUp': case 'install': hostSetUp(); break;
      case 'elevate': hostElevate(); break;
      case 'place': {
        const a = placeArgs(cmd);
        set((s) => {
          if (a.axChoice !== undefined) s.setup.axChoice = a.axChoice;
          if (a.loginSkip !== undefined) s.setup.loginSkip = !!a.loginSkip;
        });
        break;
      }
      case 'macAction': macAction(cmd.action || (cmd.data && cmd.data.action)); break;
      case 'startScreen': hostStart(); break;
      case 'stopScreen': hostStop(); break;
      case 'finish': set((s) => { s.setupDone = true; }, 'host: Done, setup closes (the display keeps running)'); finishWorld('finish'); break;
      case 'close':
        if (S.laptop.installing || S.setup.handingOff || S.setup.hold) { log('host: close ignored (busy)'); break; }
        log('host: the window closes'); finishWorld('close'); break;
      default: break;
    }
  }

  // ---------- The person (and the cable, and the Mac), reacting to what is on screen ----------
  // Each rule: when its condition holds for `after` seconds, it acts once (until the condition
  // drops). `after: null` turns a rule off.
  const rules = [];
  const rule = (id, when, after, act) => rules.push({ id, when, after, act, since: 0 });
  function defineRules() {
    const st = () => S.mac.status, sv = () => S.server;
    // This PC (only with ?play=1)
    rule('continue', () => auto && !!findAct('setUp') && !S.setup.started, () => o.continueAt, () => click('setUp'));
    rule('keyboard', () => auto && !!findAct(o.axChoice === 'no' ? 'axNo' : 'axYes'), () => o.keyboardAt, () => click(o.axChoice === 'no' ? 'axNo' : 'axYes'));
    rule('done', () => auto && S.screen.showing && S.screen.pointerOnLaptop && !!findAct('finish'), () => o.finishAt, () => click('finish'));
    // A headless browser may report this window inactive: Ready then waits for Show Mac Desktop.
    rule('show-manual', () => auto && !o.inactive && place().indexOf('ready/manual') === 0 && !!findAct('show'), () => 2, () => click('show'));
    // The cable
    rule('plug', () => S.setup.started && elevOk(S) && S.laptop.runningInstalled && !S.setup.hold && !S.setup.handingOff && !S.link.adapterUp && !world.plugged,
      () => o.plugAt, () => { world.plugged = true; set((s) => W.plugged(s, 0), 'cable: connected'); });
    rule('find', () => S.link.adapterUp && !S.link.macFound, () => o.findAt, () => set((s) => W.found(s), 'link: Mac found, address ready'));
    // Safari on the Mac
    rule('type', () => S.link.macFound && sv().urlReady && !sv().pageVisited && needApp(), () => o.typeAt, () => set((s) => W.visited(s, look), 'person: types the address; the page opens'));
    rule('download', () => sv().pageVisited && !sv().download.done && !sv().downloadClicked && sv().download.sent === 0 && needApp() && !busy.download,
      () => o.downloadAt, () => download());
    rule('open', () => sv().download.done && needApp() && sv().pageBlurs === 0 && sv().pageFocused && !sv().settingsOpened && !busy.download,
      () => o.openAt, () => set((s) => { s.server.pageFocused = false; s.server.pageBlurs = 1; }, sv().appNotarized ? 'person: opens the app; macOS asks to confirm' : 'person: opens the app; macOS says “Not Opened”'));
    rule('confirm', () => sv().appNotarized && sv().pageBlurs > 0 && !sv().pageFocused && needApp(), () => o.confirmAt,
      () => { log('person: Open'); later(1.5, () => set((s) => W.appUp(s, look, '5'), 'mac: the app answers (moved, login agent on)')); });
    // Done in the Not Opened alert. On a real Mac, Safari often doesn't get the focus back (or the
    // app was opened from Finder): the page then sends nothing, and the person goes on to the
    // page's Open Privacy & Security button, which the page already shows.
    rule('gk-done', () => !sv().appNotarized && sv().download.done && sv().pageBlurs > 0 && !sv().pageFocused && !sv().settingsOpened && needApp(),
      () => o.doneAt, () => {
        if (o.focusAfterDone) set((s) => { s.server.pageFocused = true; }, 'person: Done (Safari comes back)');
        else { world.gkDone = true; log('person: Done (Safari stays in the background; the page sends nothing)'); }
      });
    // Clicking the page's button brings Safari forward (focus), then the click (settings).
    rule('page-button', () => !sv().appNotarized && sv().download.done && sv().pageBlurs > 0 && (sv().pageFocused || world.gkDone) && !sv().settingsOpened && needApp(),
      () => o.pageButtonAt, () => set((s) => { s.server.pageFocused = true; s.server.settingsOpened = true; }, 'person: Open Privacy & Security on the page (Safari comes forward and asks)'));
    rule('safari-allow', () => sv().settingsOpened && !sv().leftForSettings && sv().pageFocused && needApp(), () => o.allowAt,
      () => set((s) => { s.server.pageFocused = false; s.server.pageBlurs++; s.server.leftForSettings = true; }, 'person: Allow (System Settings in front)'));
    // Privacy & Security stays in front: the app moves itself and its agent starts from launchd,
    // so nothing takes the foreground from System Settings (engineering-1). Not in W.appUp: the
    // notarized Open never involves System Settings.
    rule('open-anyway', () => sv().leftForSettings && needApp(), () => o.anywayAt,
      () => set((s) => { W.appUp(s, look, '5'); s.mac.status.settingsFront = true; world.pane = 'security'; },
        'person: Open Anyway ×2, Touch ID; the app answers (Privacy & Security still in front)'));
    // Prompts and System Settings on the Mac
    rule('prompt', () => st().promptUp, () => o.promptClickAt, () => {
      if (o.closePrompt > 0) { o.closePrompt--; set((s) => { s.mac.status.promptUp = false; world.prompt = ''; }, 'person: closes the prompt'); return; }
      set((s) => { s.mac.status.promptUp = false; s.mac.status.settingsFront = true; world.pane = world.prompt; world.prompt = ''; }, 'person: Open System Settings');
    });
    rule('grant', () => st().settingsFront && !st().authUp && !busy.grant && (
      (world.pane === 'screen' && !st().screenOk && !st().screenNeedsRelaunch) || (world.pane === 'ax' && !st().axOk) || (world.pane === 'login' && st().loginItemNeedsApproval)),
    () => o.grantAt, () => grant());
    rule('self-relaunch', () => st().screenNeedsRelaunch && S.mac.reachable && +S.mac.appVersion >= 5 && !busy.relaunch, () => 2, () => { log('mac: the app relaunches itself (M2)'); relaunch(); });
    // The display
    rule('pointer', () => S.screen.showing && !S.screen.pointerOnLaptop, () => o.pointerAt, () => set((s) => { s.screen.pointerOnLaptop = true; }, 'person: the pointer is on this display'));
  }
  async function download() {
    busy.download = true;
    set((s) => { s.server.downloadClicked = true; }, 'person: Download');
    if (o.allowDownloadsAt != null) {
      await sleep(o.allowDownloadsAt);
      log('person: Allow (downloads)');
    } else await sleep(0.3);
    const steps = Math.max(1, Math.round(o.bytesSecs / 0.2));
    set((s) => { s.server.download = { sent: 0, size: APP_SIZE, done: false }; });
    for (let i = 1; i <= steps && !stopped; i++) {
      await sleep(o.bytesSecs / steps);
      const sent = Math.round((APP_SIZE * i) / steps);
      set((s) => {
        s.server.download = { sent, size: APP_SIZE, done: sent >= APP_SIZE };
        if (sent >= APP_SIZE) { s.server.downloadClicked = false; s.server.pageBlurs = 0; s.server.pageFocused = true; world.gkDone = false; }
      });
    }
    log('host: download done');
    busy.download = false;
  }
  async function grant() {
    busy.grant = true;
    const pane = world.pane;
    if (o.ignoreSettings > 0 && pane !== 'login') {
      o.ignoreSettings--;
      set((s) => { s.mac.status.settingsFront = false; world.pane = ''; }, 'person: leaves System Settings without turning it on');
      busy.grant = false;
      return;
    }
    if (pane === 'login') {
      set((s) => { Object.assign(s.mac.status, { loginItemNeedsApproval: false, loginItemEnabled: true, settingsFront: false }); world.pane = ''; }, 'person: turns on USB-C Display (login item)');
      busy.grant = false;
      return;
    }
    set((s) => { s.mac.status.authUp = true; if (o.authHidesSettings) s.mac.status.settingsFront = false; }, 'person: turns on the switch; Touch ID');
    await sleep(o.authSecs);
    set((s) => {
      const st = s.mac.status;
      st.authUp = false;
      if (pane === 'screen') { st.screenNeedsRelaunch = true; st.settingsFront = true; }
      else { st.axOk = true; st.settingsFront = false; world.pane = ''; }
    }, pane === 'screen' ? 'mac: granted; “Quit & Reopen”' : 'mac: granted (device control)');
    busy.grant = false;
  }
  function tickRules() {
    if (stopped || !S) return;
    needApp();  // latch "a current app answered" on every tick, whatever the rules look at
    const t = now();
    rules.forEach((r) => {
      const after = r.after();
      let on = false;
      try { on = after != null && r.when(); } catch (e) { on = false; }
      if (!on) { r.since = 0; return; }
      if (!r.since) r.since = t;
      if (r.fired === r.since) return;
      if (t - r.since >= after * 1000) { r.fired = r.since; r.act(); }
    });
  }
  // The host's seconds-since-plug counter.
  let plugTick = 0;
  function tickHost() {
    if (stopped || !S) return;
    if (S.link.adapterUp) {
      const secs = Math.floor((now() - (plugTick || now())) / 1000);
      if (!plugTick) plugTick = now() - S.link.secondsSincePlug * 1000;
      else if (secs !== S.link.secondsSincePlug) { S.link.secondsSincePlug = secs; push(); }
    } else plugTick = 0;
  }

  // ---------- Scenarios (SPEC §10.3) ----------
  // init: the first snapshot (from a stage, as stateFor gives it); o: the host's and the person's
  // timing; script: what else happens; end: where it must end ('finish' = Done was clicked).
  const stage = (screen, sub, flags) => () => stateFor(screen, sub, Object.assign({ theme: look.theme }, flags || {}));
  const atConnect = (s) => { W.started(s); W.elevated(s); W.installedCopy(s); return s; };
  const SC = {
    default: { init: () => base(), o: { yesAfter: 6.5 } },
    'first-run': { init: () => base(), o: { yesAfter: 6.5 }, end: 'finish' },
    'first-run-standard': { init: () => { const s = base(); s.laptop.isAdminUser = false; return s; }, o: { yesAfter: 6.5 }, end: 'connect' },
    'uac-refused': { init: () => base(), o: { refuse: 1, plugAt: null },
      script: async () => { await until((s) => s.laptop.elevation === 'refused'); await sleep(8); await click('elevate'); }, end: 'connect' },
    // Beyond §10.3: Windows didn't finish the changes during the hand-off (held as "failed",
    // engineering-3); and a failure of the recovery tasks only, which stays silent.
    'uac-failed': { init: () => base(), o: { fail: 1, plugAt: null },
      script: async () => { await until((s) => s.laptop.elevation === 'failed'); await sleep(8); await click('elevate'); }, end: 'connect' },
    'tasks-failed': { init: () => base(), o: { fail: 1, failKeepsFirewall: true, plugAt: null }, end: 'connect',
      never: ['allow-pc/failed', 'allow-pc/ask', 'allow-pc/refused'] },
    'rerun-downloaded': { init: () => { const s = base(); W.started(s); W.elevated(s); s.laptop.runningInstalled = false; return s; }, o: { plugAt: 4 }, end: 'get-app' },
    // Beyond §10.3, as found on hardware (HW2): the downloaded copy run again with everything
    // set up, so it opens on Ready ("Extending your Mac desktop…"); its own install replaces that
    // status with "Installing…", which must not show the "Desktop extended" check first. Then
    // the hand-off, and the installed copy shows the desktop.
    'rerun-downloaded-ready': { init: () => { const s = stateFor('ready', 'starting', { theme: look.theme }); s.laptop.runningInstalled = false; return s; },
      end: 'finish', prep: readyPrep },
    'cable-late': { init: () => atConnect(base()), o: { plugAt: 95 }, end: 'get-app' },
    'mac-not-found': { init: () => atConnect(base()), o: { plugAt: 2, findAt: null },
      script: async () => { await until((s) => s.link.secondsSincePlug >= 50); set((s) => W.found(s), 'link: Mac found, address ready'); }, end: 'get-app' },
    'unplug-blip': { init: stage('get-app', 'address'), o: { typeAt: null, plugAt: null, findAt: null },
      script: async () => {
        await sleep(3);
        set((s) => W.unplugged(s), 'cable: out (2 s)'); await sleep(2); set((s) => { W.plugged(s, 0); W.found(s); }, 'cable: back');
        await sleep(5);
        set((s) => W.unplugged(s), 'cable: out (4 s)'); await sleep(4); set((s) => W.plugged(s, 0), 'cable: back');
        await sleep(1.5); set((s) => W.found(s), 'link: Mac found');
        await sleep(2); o.typeAt = 4;
      }, end: 'get-app/download', allowBack: ['connect/reconnect'] },
    'search-page': { init: stage('get-app', 'address'), o: { typeAt: 50 }, end: 'get-app/download' },
    'allow-downloads': { init: stage('get-app', 'download'), o: { allowDownloadsAt: 3, bytesSecs: 4, openAt: null }, end: 'open-app/downloads' },
    'move-to-trash': { init: stage('open-app', 'downloads'), o: { pageButtonAt: null, doneAt: 3 },
      script: async () => {
        await until((s) => s.server.pageBlurs > 0 && (s.server.pageFocused || world.gkDone));
        log('person: clicked Move to Trash, not Done'); o.openAt = null;
        await sleep(2);
        set((s) => { s.server.pageFocused = true; }, 'person: back in Safari');
        await sleep(4); await download();
      }, end: 'open-app/downloads' },
    'done-focus': { init: stage('open-app', 'downloads'), o: { focusAfterDone: true, pageButtonAt: 5 }, end: 'allow-screen' },
    'back-to-safari': { init: stage('open-app', 'open-anyway'), o: { anywayAt: null, pageButtonAt: null },
      script: async () => {
        await sleep(4);
        set((s) => { s.server.pageFocused = true; s.server.settingsOpened = false; s.server.leftForSettings = false; }, 'person: back to Safari (the host clears settingsOpened and leftForSettings)');
        await sleep(6);
      }, end: 'open-app/page-button' },
    notarized: { init: stage('open-app', 'downloads', { notarized: true }), end: 'allow-screen' },
    relaunch: { init: stage('allow-screen', 'prompt'), o: { relaunchSecs: 15 }, end: 'keyboard/offer',
      prep: (s) => { s.mac.status.promptUp = false; s.mac.status.screenPrompted = false; } },
    'relaunch-late': { init: stage('allow-screen', 'prompt'), o: { ignoreRelaunch: 1 }, end: 'keyboard/offer',
      prep: (s) => { s.mac.appVersion = '4'; s.mac.status.promptUp = false; s.mac.status.screenPrompted = false; },
      script: async () => { await until(at('allow-screen/reopen-late')); await click('mac:relaunch', 3); } },
    'prompt-closed': { init: stage('allow-screen', 'prompt'), o: { closePrompt: 1, authHidesSettings: true, authSecs: 9 }, end: 'keyboard/offer',
      prep: (s) => { s.mac.status.promptUp = false; s.mac.status.screenPrompted = false; },
      script: async () => { await until(at('allow-screen/off')); await click('mac:screen', 3); } },
    'keyboard-yes': { init: stage('keyboard', 'offer'), o: { axChoice: 'yes' }, end: 'finish' },
    'keyboard-no': { init: stage('keyboard', 'offer'), o: { axChoice: 'no' }, end: 'finish' },
    'mac-asleep': { init: stage('keyboard', 'offer'), o: { keyboardAt: null },
      script: async () => {
        await sleep(3); set((s) => { s.mac.reachable = false; }, 'mac: asleep');
        await sleep(50); set((s) => { s.mac.reachable = true; }, 'mac: awake');
        await sleep(3);
      }, end: 'keyboard/offer' },
    'ready-inactive': { init: stage('ready', 'manual'), o: { inactive: true }, end: 'finish',
      prep: readyPrep,
      script: async () => {
        await until(at('ready/manual'));
        await sleep(2); deliver({ type: 'active', on: true }); log('person: clicks this window (active)');
        await click('show', 1);
      } },
    'ctrl-alt-esc': { init: stage('ready', 'starting', { input: true }), o: { finishAt: null }, end: 'finish', prep: readyPrep,
      script: async () => {
        await until((s) => s.screen.showing && s.screen.pointerOnLaptop); await sleep(3);
        hostStop('person: Ctrl-Alt-Esc (the receiver stops, this window is back)');
        await until(at('ready/hidden')); await click('show', 3);
        await until((s) => s.screen.showing); o.finishAt = 3;
      } },
    'display-error': { init: stage('ready', 'starting'), o: { display: ['fail', 'ok'] }, end: 'finish', prep: readyPrep,
      script: async () => {
        // The receiver keeps waiting; Try Again stops it and starts a new one (the host does both).
        await until(at('ready/error'));
        await click('show', 3);
      } },
    'refused-black': { init: stage('ready', 'starting'), o: { display: ['refuse', 'ok'], ignoreSettings: 1, prompted: { screen: true } }, end: 'finish', prep: readyPrep,
      script: async () => {
        await until(at('allow-screen/off')); await click('mac:screen', 3);
        // Turned on: Ready hands over by itself again (the desktop never showed); Try Again only
        // if the window says it couldn't.
        await until(at('ready/')); await sleep(2); if (place().indexOf('ready/error') === 0) await click('show', 3);
      } },
    'second-mac': { init: () => { const s = atConnect(base()); s.setupDone = true; s.setup.axChoice = 'yes'; return s; }, end: 'get-app' },
    'outdated-mac': { init: () => atConnect(base()), o: { findAt: 2 }, end: 'allow-screen',
      script: async () => { await until((s) => s.link.macFound); set((s) => W.appUp(s, look, '3'), 'mac: USB-C Display 3 answers'); } },
    incomplete: { init: () => { const s = base(); s.laptop.missingPayload = ['UsbcDisplay.exe']; return s; }, end: 'incomplete/idle' },
    unsupported: { init: () => { const s = base(); s.laptop.usb4 = 'missing'; return s; }, o: { continueAt: null },
      script: async () => { await sleep(4); set((s) => { W.plugged(s, 0); }, 'cable: a link appears (USB4 proven)'); await sleep(2); }, end: 'welcome/idle' },
    // Beyond §10.3: the other recovery screens, played.
    'install-error': { init: () => base(), o: { installError: 'inUse', plugAt: null },
      script: async () => { await until(at('install-error/in-use')); await click('retryInstall', 3); }, end: 'connect' },
    'login-off': { init: stage('login', 'asking'), end: 'allow-screen',
      prep: (s) => { s.mac.status.settingsFront = false; } },
    move: { init: stage('move', 'idle'), end: 'allow-screen',
      script: async () => { await until(at('move/idle')); await click('mac:moveToApplications', 2); } },
    returning: { init: () => { const s = atConnect(base()); s.setupDone = true; s.setup.axChoice = 'yes'; return s; }, end: 'finish',
      script: async () => { await until((s) => s.link.macFound); set((s) => { W.appUp(s, look, '5'); W.screenOk(s); s.mac.status.axOk = true; }, 'mac: everything is set up already'); } },
    // Beyond §10.3 (HW1, engineering-2): the installed copy as the hand-off opens it (--hold). Its
    // first frame is the held one, whole and with no fade, drawn in the old window's active state
    // (hold.active) whatever this window's own; no buttons; after the release, its own state.
    // handoff-hold: the old window was in front, this one opens without activation (the host
    // says inactive). handoff-hold-inactive: the old window was not in front, this one is.
    'handoff-hold': { init: () => holdInit(true), o: { plugAt: null, inactive: true }, end: 'connect/cable', script: () => holdScript(true) },
    'handoff-hold-inactive': { init: () => holdInit(false), o: { plugAt: null }, end: 'connect/cable', script: () => holdScript(false) },
  };
  function holdInit(active) {
    const s = atConnect(base());
    s.setup.hold = { screen: 'allow-pc', sub: 'done', status: 'status.pcReady', theme: look.theme, accent: 'blue', active };
    return s;
  }
  async function holdScript(activeHeld) {
    const lights = () => !document.documentElement.classList.contains('inactive');
    await until(at('allow-pc/done'));
    await sleep(0.3);
    if (!S.setup.hold) found.push('the hold went before it was checked');
    if (lights() !== activeHeld) found.push('the held frame is drawn ' + (lights() ? 'active' : 'inactive') + '; the old window was ' + (activeHeld ? 'active' : 'inactive'));
    if (document.querySelector('#buttons button, #slot .btn-third')) found.push('the held frame has buttons');
    const st = document.querySelector('.st-line:not(.going)');
    if (!st || (st.textContent || '').trim() !== D.STR['status.pcReady']) found.push('the held frame’s status is “' + (st ? st.textContent.trim() : '') + '”');
    log('held frame: ' + (lights() ? 'active' : 'inactive') + ', status “' + (st ? st.textContent.trim() : '') + '”');
    await sleep(1);
    set((s) => { s.setup.hold = null; }, 'host: hold released');
    await until(at('connect/'));
    await sleep(0.5);
    const own = !o.inactive;
    if (lights() !== own) found.push('after the hold the window is drawn ' + (lights() ? 'active' : 'inactive') + ', but the host says ' + (own ? 'active' : 'inactive'));
    log('after the hold: ' + (lights() ? 'active' : 'inactive'));
  }
  function readyPrep(s) { s.screen.running = false; s.screen.showing = false; s.screen.error = ''; }
  D.mock = D.mock || {};

  function onReady() {
    if (started) { if (S) push(); return; }
    started = true;
    const flags = normFlags();
    if (!live) {
      // A still: app.js has drawn the frame from stateFor() already, and nothing moves.
      S = stateFor(stepParam, P.get('sub') || '', flags);
      if (P.get('active') === '0') deliver({ type: 'active', on: false });
      return;
    }
    // ?step=…&play=1 plays the default world from that frame.
    const sc = stepParam ? { init: () => stateFor(stepParam, P.get('sub') || '', flags) } : SC[scName] || SC.default;
    if (!stepParam && !SC[scName]) log('unknown scenario ' + scName + ', playing the first run');
    o = Object.assign({}, defaults, clone(Object.assign({}, sc.o || {}, { display: (sc.o && sc.o.display) || [] })));
    o.prompted = Object.assign({}, (sc.o && sc.o.prompted) || {});
    S = sc.init();
    if (sc.prep) sc.prep(S);
    needApp();
    if (flags.acct === 'standard') S.laptop.isAdminUser = false;
    if (flags.signed) S.laptop.signed = true;
    if (flags.notarized) S.server.appNotarized = true;
    if (S.mac.status.screenPrompted) o.prompted.screen = true;
    if (S.mac.status.axPrompted) o.prompted.ax = true;
    report.expected = sc.end || null;
    report.allowBack = sc.allowBack || [];
    report.never = sc.never || [];
    log((stepParam ? 'from ' + stepParam + '/' + (P.get('sub') || firstSub(stepParam)) : 'scenario ' + (SC[scName] ? scName : 'default')) +
      (auto ? ' (playing)' : ' (your clicks)') + ', speed ' + speed);
    const begin = () => {
      defineRules();
      push();
      later(0, () => deliver({ type: 'active', on: !o.inactive && P.get('active') !== '0' }));
      setInterval(() => { tickRules(); tickHost(); }, Math.max(20, 250 / speed));
      setInterval(watchPlace, 50);
      const done = sc.script ? sc.script().catch((e) => log('script error ' + e.message)) : Promise.resolve();
      done.then(() => { if (sc.script) log('script done'); watchEnd(sc.end, !!sc.script); });
    };
    // As the host: the first snapshots come before this PC is checked (CheckLaptop takes a
    // moment), and the page must build nothing until then (HW1). The scenario starts after it.
    if (!stepParam && S.laptop.checked) {
      S.laptop.checked = false;
      log('host: checking this PC');
      push();
      setTimeout(() => { S.laptop.checked = true; log('host: this PC checked'); begin(); }, 300);
    } else begin();
  }
  async function watchEnd(end, afterScript) {
    if (!end) return;
    if (end === 'finish') return;  // finishWorld() ends it
    await until(at(end), 900);
    await sleep(1.5);
    finishWorld('end');
  }
  function finishWorld(why) {
    if (stopped) return;
    watchPlace();
    report.end = why === 'finish' ? 'finish' : lastPlace;
    report.done = true;
    const exp = report.expected;
    report.ok = !!exp && (exp === 'finish' ? why === 'finish' : lastPlace.indexOf(exp) === 0 || (why === 'finish' && exp === 'finish'));
    analyse();
    log('END ' + report.end + (exp ? ' (expected ' + exp + ': ' + (report.ok ? 'ok' : 'NOT OK') + ')' : '') +
      (report.flashes.length ? ', flashes: ' + report.flashes.join('; ') : ', no backward flash') + (report.welcomeAfterStart ? ', WELCOME AFTER CONTINUE' : '') +
      (report.problems.length ? ', PROBLEMS: ' + report.problems.join('; ') : ''));
    stopped = true;
    // Time stops too, so the page keeps showing the end (no hint or error a minute later).
    const frozenAt = now();
    D.now = () => frozenAt;
    writeLog();
  }

  // ---------- Exports ----------
  Object.assign(D.mock, {
    receive,
    stateFor,
    subs: subsList,
    SUBS_SPEC,
    scenarios: Object.keys(SC),
    flags: () => normFlags(),
    state: () => clone(S),
    set: (fn, note) => { if (S) set(fn, note || 'console change'); },
    report: () => { analyse(); return clone(report); },
    speed,
  });
  D.previewParams = { step: stepParam, sub: P.get('sub'), scenario: scName, play: auto, speed };
  D.previewScenarios = SC;

  // ?fit=all (with ?step=, so nothing plays): D.debug.fit() for every [screen, sub] in both
  // themes at this --mpt, into <pre id="mock-fit"> (SPEC §10.2.5, for shoot.sh).
  if (P.get('fit') === 'all') {
    const measure = () => {
      if (!D.debug || typeof D.debug.show !== 'function' || !started) { setTimeout(measure, 100); return; }
      const out = [];
      subsList().forEach(([s, u]) => ['light', 'dark'].forEach((theme) => {
        let r;
        try { r = D.debug.show(s, u, { theme }); } catch (e) { r = { error: String(e && e.message || e) }; }
        out.push(Object.assign({ screen: s, sub: u, theme }, r || { error: 'no measure' }));
      }));
      const pre = document.createElement('pre');
      pre.id = 'mock-fit';
      pre.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0';
      pre.textContent = JSON.stringify(out);
      document.body.appendChild(pre);
    };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(measure, 200));
  }

  // ?list=subs: every [screen, sub] for shoot.sh.
  if (P.get('list') === 'subs') {
    const write = () => {
      const pre = document.createElement('pre');
      pre.id = 'mock-subs';
      pre.dataset.source = normSubs(D.SUBS) && normSubs(D.SUBS).length ? 'D.SUBS' : 'SPEC';
      pre.textContent = subsList().map((e) => e[0] + ' ' + e[1]).join('\n');
      document.body.appendChild(pre);
    };
    if (document.body) setTimeout(write, 0); else document.addEventListener('DOMContentLoaded', write);
  }
})();
