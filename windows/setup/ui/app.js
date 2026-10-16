// The setup window's shell (SPEC §2, §4, §6): talks to its host (CONTRACT.md §2, §3), runs the
// pipeline on this PC's copy, and draws the frame.
//
//   PC copy:  on every state message and a 250 ms tick:
//             observe -> route -> settle -> enter -> act -> render -> sendMirror -> postFrame
//   Mac copy: (window.usbcHost.mac) only render(view(S, L)) from the mirrored S and L; its clicks go
//             back to the PC copy ({cmd:'act'}); it never routes, never runs timers, never reads the
//             clock except for the spinner's phase.
//
// Without a host (a normal browser) it loads the preview harness (../preview/mock.js) first.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});
  D.now = D.now || (() => Date.now());
  const now = () => D.now();
  const host = window.chrome && window.chrome.webview;
  const params = new URLSearchParams(location.search);
  const P = (k) => params.get(k);
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const appEl = $('app');
  const pageEl = $('page'), statusEl = $('status'), slotEl = $('slot'), buttonsEl = $('buttons');
  const sheetEl = $('sheet'), dimEl = $('sheet-dim');
  const closeLight = appEl.querySelector('.tl.close');
  const hostInfo = () => window.usbcHost || {};
  const preview = !host;
  const mirrored = !!hostInfo().mac || (preview && P('mac') === '1');
  const shot = P('shot') === '1';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ACCENTS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];
  const SPRING = 'linear(0, .099, .286, .471, .625, .741, .826, .884, .924, .951, .968, .980, .987, .992, .995, .997, 1)';
  const FADE = 'cubic-bezier(.42, 0, .58, 1)';
  if (mirrored) root.classList.add('mac-window');
  if (preview) root.classList.add('preview');
  if (shot) root.classList.add('shot');
  let instant = shot;                                       // no motion at all (shots, the fit check)

  // ---------- State (CONTRACT.md §2) ----------
  const DEFAULTS = {
    laptop: {
      windowsBuild: 0, arch: '', isAdminUser: true, usb4: 'unknown', checked: false, installed: false, installing: false,
      installError: '', missingPayload: [], elevation: 'none', firewallOk: false, recoveryTasksOk: false,
      runningInstalled: false, signed: false,
    },
    link: { adapterUp: false, adapterName: '', secondsSincePlug: 0, macFound: false, macV6: '', macV4: '', laptopV4: '' },
    server: {
      running: false, url: 'http://usbc.local', fallbackUrl: '', urlReady: false, pageVisited: false, pageFocused: false,
      pageBlurs: 0, settingsOpened: false, leftForSettings: false, downloadClicked: false, appOpened: false,
      appSize: 0, appVersion: '', pageAppearance: '', pageAccent: '', error: '',
      download: { sent: 0, size: 0, done: false }, appNotarized: false,
    },
    mac: {
      reachable: false, outdated: false, appVersion: '', macOS: '', appearance: '', accent: '',
      status: {
        screenOk: false, axOk: false, screenPrompted: false, axPrompted: false, loginItemEnabled: false,
        loginItemNeedsApproval: false, sessionActive: false, runningAsAgent: false, inApplications: false,
        screenNeedsRelaunch: false, settingsFront: false, promptUp: false, authUp: false, displaySide: '',
      },
    },
    screen: { running: false, showing: false, pointerOnLaptop: false, inputOk: false, error: '' },
    setup: { started: false, axChoice: '', loginSkip: false, elevationAsked: false, handingOff: false, hold: null },
    settings: { scaleOptions: [], scale: 0, matchColors: true, useLaptopInput: false },
    setupDone: false,
  };
  function merge(base, over) {
    if (over === undefined || over === null) return base === null ? null : JSON.parse(JSON.stringify(base));
    if (typeof base !== 'object' || base === null || Array.isArray(base)) return over;
    if (typeof over !== 'object' || Array.isArray(over)) return JSON.parse(JSON.stringify(base));
    const out = {};
    Object.keys(base).forEach((k) => { out[k] = merge(base[k], over[k]); });
    Object.keys(over).forEach((k) => { if (!(k in base)) out[k] = over[k]; });
    return out;
  }
  let S = merge(DEFAULTS);
  let haveState = false;

  // The local place (§2.3). Mirrored to the Mac's copy: screen, sub, sheet, cut, cutCheck, settled
  // (and input, the keyboard row frozen at startScreen). The rest is this copy's own.
  const L = {
    screen: '', sub: '', sheet: '', cut: false, cutCheck: false, settled: false, input: undefined,
    look: { theme: 'light', accent: 'blue' }, active: true, enteredAt: 0,
    marks: {}, lastSeen: {}, sent: {}, sentAt: {}, sentN: {},
    appSeen: false, wasLinked: false, starting: false, autoStarted: false, shownOnce: false, manual: false, backSince: 0,
    refusedOff: false,       // the receiver was refused while Screen Recording was off (act, readySub)
    promptSeen: {},          // the Mac's permission prompt was up on its screen: { screen, accessibility } (permSub)
  };
  const force = { theme: P('theme') || '', accent: P('accent') || '', mpt: '' };   // ?theme= ?accent= ?mpt= (preview)
  L.look = computeLook(S);

  function hostDark() {
    const h = hostInfo();
    if (typeof h.dark === 'boolean') return h.dark;
    return preview && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // The window's look, frozen at each screen entry (§6.4): the Mac's own once known.
  function computeLook(s) {
    const hold = s.setup && s.setup.hold;
    let theme = hold && hold.theme ? hold.theme : (s.mac.appearance || s.server.pageAppearance || (hostDark() ? 'dark' : 'light'));
    let accent = hold && hold.accent ? hold.accent : (s.mac.accent || s.server.pageAccent || 'blue');
    if (force.theme === 'dark' || force.theme === 'light') theme = force.theme;
    if (preview && force.accent) accent = force.accent;
    if (ACCENTS.indexOf(accent) < 0) accent = 'blue';         // multicolor and '' are blue
    return { theme: theme === 'dark' ? 'dark' : 'light', accent };
  }

  // ---------- Host messages ----------
  function send(msg) {
    if (host) host.postMessage(msg);
    else if (D.mock && typeof D.mock.receive === 'function') D.mock.receive(msg);
  }
  const cmd = (name, extra) => send(Object.assign({ cmd: name }, extra || {}));

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'state') onState(msg);
    else if (msg.type === 'mirror') onMirror(msg);
    else if (msg.type === 'active') onActive(!!msg.on);
    else if (msg.type === 'remoteAct') { if (!mirrored) doAct(msg.act, msg.data || {}); }
  }
  D.receive = onMessage;

  let live = false;                                          // the PC copy's pipeline runs
  function onState(msg) {
    if (mirrored) return;                                    // the Mac's copy draws from the mirror only
    S = merge(DEFAULTS, msg);
    haveState = true;
    setMacPoint();
    if (live) tick(); else render();
  }

  // The Mac's copy: the PC copy's state, place and look, drawn as they are.
  let ownActiveSeen = false, ownActive = true, mirroredActive = true, drawnSent = false;
  function onMirror(msg) {
    if (!mirrored) return;
    S = merge(DEFAULTS, msg.state || {});
    haveState = true;
    const lo = msg.local || {};
    ['screen', 'sub', 'sheet', 'cut', 'cutCheck', 'settled', 'input'].forEach((k) => { if (k in lo) L[k] = lo[k]; });
    const look = msg.look || {};
    L.look = { theme: look.theme === 'dark' ? 'dark' : 'light', accent: ACCENTS.indexOf(look.accent) >= 0 ? look.accent : 'blue' };
    mirroredActive = look.active !== false;
    if (typeof look.style === 'string' && look.style && root.getAttribute('style') !== look.style) {
      root.setAttribute('style', look.style);
      mptSet = pointNow();
      shape();
    }
    applyActive();
    render();
    if (!drawnSent && L.screen) {
      drawnSent = true;
      whenPainted(() => setTimeout(() => send({ cmd: 'drawn' }), 100));
    }
  }

  function onActive(on) {
    if (mirrored) { if (on) ownActiveSeen = true; ownActive = on; }
    else L.active = on;
    applyActive();
    if (live) tick();
  }
  // The Mac's copy draws the PC copy's active state until its own host has said it is active once
  // (§4.6): the cut never turns the lights or Done grey. The installed copy's held frame draws the
  // old copy's active state (hold.active) until the hold is released (§4.2); L.active always keeps
  // the real state, which the host goes on posting. render() checks this again every time.
  function applyActive() {
    const hold = S.setup && S.setup.hold;
    const on = mirrored ? (ownActiveSeen ? ownActive : mirroredActive) : hold ? hold.active !== false : L.active;
    root.classList.toggle('inactive', !on);
  }

  // ---------- The window: Mac points, shape, edge ----------
  // One Mac point in CSS px: this PC shows the Mac's new display at the saved (or recommended) scale,
  // f panel px a point, and Windows draws a CSS px as devicePixelRatio panel px. The Mac's copy takes
  // this copy's value through the mirror (look.style), so both draw it alike.
  const pointNow = () => parseFloat(getComputedStyle(root).getPropertyValue('--mpt')) || 0.8333;
  let mptSet = 0;
  function setMacPoint() {
    if (mirrored && !preview) return;
    let v = parseFloat(force.mpt || P('mpt'));
    if (!(v > 0)) {
      const opts = S.settings.scaleOptions || [];
      const rec = opts.find((o) => o.recommended);
      const scale = +S.settings.scale >= 50 ? +S.settings.scale : rec && rec.id >= 50 ? rec.id : 125;
      v = scale / 100 / (window.devicePixelRatio || 1);
      // A work area smaller than 800 x 600 pt: the host shrank both sides alike; follow it.
      const fit = Math.min(window.innerWidth / 800, window.innerHeight / 600);
      if (fit > 0 && (preview ? fit < v : fit < v * 0.99)) v = fit;
    }
    v = Math.round(v * 10000) / 10000;
    if (v === mptSet) return;
    mptSet = v;
    root.style.setProperty('--mpt', v + 'px');
    root.style.setProperty('--mptn', String(v));
    shape();
  }
  // An older host put Windows' accent colours on <html>: they must not drive this window.
  function stripHostStyle() {
    const st = root.style;
    for (let i = st.length - 1; i >= 0; i--) { const p = st[i]; if (p.startsWith('--accent')) st.removeProperty(p); }
    root.classList.remove('no-mica');
  }

  // macOS's window corner: 16 pt with its continuous curve (Figma's corner smoothing 0.5).
  function squircle(w, h, R, smooth) {
    const rad = (d) => (d * Math.PI) / 180;
    R = Math.min(R, w / 2, h / 2);
    const p = Math.min((1 + smooth) * R, w / 2, h / 2);
    const arcMeasure = 90 * (1 - smooth);
    const arc = Math.sin(rad(arcMeasure / 2)) * R * Math.SQRT2;
    const p34 = R * Math.tan(rad((90 - arcMeasure) / 4));
    const beta = 45 * smooth;
    const c = p34 * Math.cos(rad(beta));
    const d = c * Math.tan(rad(beta));
    const b = (p - arc - c - d) / 3;
    const a = 2 * b;
    const n = (x) => +x.toFixed(3);
    const k = [a, a + b, a + b + c].map(n), A = n(arc), C = n(c), Dd = n(d), B = n(b + c), r = n(R);
    return 'M' + n(w - p) + ' 0c' + k[0] + ' 0 ' + k[1] + ' 0 ' + k[2] + ' ' + Dd + 'a' + r + ' ' + r + ' 0 0 1 ' + A + ' ' + A +
      'c' + Dd + ' ' + C + ' ' + Dd + ' ' + B + ' ' + Dd + ' ' + k[2] + 'L' + n(w) + ' ' + n(h - p) +
      'c0 ' + k[0] + ' 0 ' + k[1] + ' ' + -Dd + ' ' + k[2] + 'a' + r + ' ' + r + ' 0 0 1 ' + -A + ' ' + A +
      'c' + -C + ' ' + Dd + ' ' + -B + ' ' + Dd + ' ' + -k[2] + ' ' + Dd + 'L' + n(p) + ' ' + n(h) +
      'c' + -k[0] + ' 0 ' + -k[1] + ' 0 ' + -k[2] + ' ' + -Dd + 'a' + r + ' ' + r + ' 0 0 1 ' + -A + ' ' + -A +
      'c' + -Dd + ' ' + -C + ' ' + -Dd + ' ' + -B + ' ' + -Dd + ' ' + -k[2] + 'L0 ' + n(p) +
      'c0 ' + -k[0] + ' 0 ' + -k[1] + ' ' + Dd + ' ' + -k[2] + 'a' + r + ' ' + r + ' 0 0 1 ' + A + ' ' + -A +
      'c' + C + ' ' + -Dd + ' ' + B + ' ' + -Dd + ' ' + k[2] + ' ' + -Dd + 'Z';
  }
  D.squircle = squircle;

  // The window's shape and edge for its size; the Windows host gets them (and the theme) for its
  // shadow, which macOS draws the same way for the Mac's copy (borderless: one shadow, key or not).
  let shapeKey = '', chromeSent = '';
  function shape() {
    const w = appEl.clientWidth, h = appEl.clientHeight;
    if (!w || !h) return;
    const mpt = pointNow();
    const key = w + 'x' + h + '@' + mpt;
    if (key !== shapeKey) {
      shapeKey = key;
      const d = squircle(w, h, 16 * mpt, 0.5);
      appEl.style.clipPath = "path('" + d + "')";
      const edge = $('win-edge');
      edge.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      edge.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
      edge.querySelector('.out').setAttribute('stroke-width', String(mpt));     // half shows: 0.5 pt
      edge.querySelector('.hi').setAttribute('stroke-width', String(2 * mpt));  // 0.5 pt inside that
    }
    sendChrome();
  }
  function sendChrome() {
    if (!host || mirrored) return;
    const w = appEl.clientWidth, h = appEl.clientHeight;
    if (!w || !h) return;
    const m = { cmd: 'chrome', point: pointNow(), width: w, height: h, theme: root.dataset.theme === 'dark' ? 'dark' : 'light' };
    const j = JSON.stringify(m);
    if (j === chromeSent) return;
    chromeSent = j;
    send(m);
  }

  // ---------- The pipeline (PC copy) ----------
  function enter(next) {
    if (next[0] !== L.screen) {
      L.screen = next[0];
      L.enteredAt = now();
      L.look = computeLook(S);
      L.sheet = '';
    }
    L.sub = next[1];
  }

  let cutWake = 0;
  function tick() {
    if (!live || !haveState) return;
    D.observe(S, L);
    // The cut's flags (+800 ms, +1400 ms) are checked on every tick; wake the loop on time for them.
    if (L.marks.cut && cutWake !== L.marks.cut) { cutWake = L.marks.cut; setTimeout(tick, 810); setTimeout(tick, 1410); }
    let next = D.route(S, L);
    if (next) next = D.settle(next, L);
    if (next) enter(next);
    if (L.screen) act(S, L, [L.screen, L.sub]);
    render();
    sendMirror();
    postFrame();
    revealWhenReady();
  }
  // Every 250 ms; in the preview as often on the scenario's clock (?speed=N), so a sped-up scenario
  // still sees each threshold when it passes.
  let ticker = 0;
  function startTicker(ms) { clearInterval(ticker); ticker = setInterval(() => { if (live) tick(); }, ms); }
  startTicker(250);

  const secs = (t) => (t ? (now() - t) / 1000 : 0);
  const since = (k) => secs(L.marks[k]);

  // Effects (§2.7). Only the installed copy acts on the Mac or the display.
  function act(s, l, [scr, sub]) {
    const ms = s.mac.status, inst = s.laptop.runningInstalled;
    // The downloaded copy run again after Continue: install and hand off by itself.
    if (s.setup.started && !inst && !s.laptop.installing && !s.laptop.installError && !s.setup.handingOff && !l.sent.setUp) setUp();
    // An installed copy that never asked Windows (closed before the prompt): ask once, while in front.
    if (scr === 'allow-pc' && sub === 'waiting' && inst && !s.setup.elevationAsked && l.active && !l.sent.setUp) setUp();
    if (!inst || s.setup.hold) return;
    if (scr === 'login' && !l.sent.loginItems) sendMac('loginItems');
    if (scr === 'allow-screen' && s.mac.reachable && !ms.screenOk && !ms.screenNeedsRelaunch && !l.sent.screen) sendMac('screen');
    if (scr === 'allow-screen' && ms.screenNeedsRelaunch && s.mac.reachable && !l.sent.relaunch
      && since('needsRelaunch') >= (+s.mac.appVersion >= 5 ? 10 : 6)) sendMac('relaunch');
    if (scr === 'ready' && sub === 'starting' && !l.starting && !l.autoStarted && canStart(s)) {
      if (l.active && secs(l.enteredAt) >= 0.65) { l.autoStarted = true; startScreen(); }
      else if (!l.active && secs(l.enteredAt) >= 3) { if (!l.manual) cmd('attention'); l.manual = true; }  // never take the screen from someone using this PC
    }
    if (l.starting && !s.screen.running && l.sent.startScreen && secs(l.sentAt.startScreen) > 2 && !s.screen.showing) l.starting = false;  // the receiver ended before showing
    // The Mac refused to share its screen and says Screen Recording is off: the desktop never
    // showed, so once it is turned on, Ready hands over by itself again (once per refusal; a
    // second refusal with the permission on shows the error and Try Again).
    if (s.screen.error === 'screen-recording-off' && !ms.screenOk && !l.refusedOff) { l.refusedOff = true; l.autoStarted = false; }
  }
  const canStart = (s) => s.mac.reachable && !s.mac.outdated && +s.mac.appVersion >= 4 && s.mac.status.screenOk
    && !s.mac.status.screenNeedsRelaunch && s.link.adapterUp && !s.screen.running && s.laptop.runningInstalled;

  function setUp() {
    L.sent.setUp = true; L.sentAt.setUp = now();
    cmd('setUp');
  }
  function startScreen() {
    L.starting = true; L.manual = false; L.cut = L.cutCheck = L.settled = false; L.refusedOff = false;
    L.input = D.inputOn(S);                                  // the keyboard row, frozen until the cut
    delete L.marks.cut;
    L.marks.startScreen = now(); L.sent.startScreen = true; L.sentAt.startScreen = now();
    cmd('startScreen');
  }
  function sendMac(a) {
    L.sent[a] = true; L.sentAt[a] = now(); L.sentN[a] = (L.sentN[a] || 0) + 1;
    cmd('macAction', { action: a });
  }

  // ---------- Actions (§2.8) ----------
  const ACTS = {
    setUp() { setUp(); },
    retryInstall() { setUp(); },
    elevate() { cmd('elevate'); },
    close() {
      if (cur && !cur.closeEnabled) return;
      if (L.screen === 'ready' && (S.screen.showing || L.shownOnce)) cmd('finish');
      else cmd('close');
    },
    minimize() { cmd('minimize'); },
    axYes() { cmd('place', { axChoice: 'yes' }); sendMac('accessibility'); },
    axNo() { cmd('place', { axChoice: 'no' }); },
    loginLater() { cmd('place', { loginSkip: true }); },
    show() { startScreen(); },
    stopScreen() { cmd('stopScreen'); },
    finish() { cmd('finish'); },
    help(d) { L.sheet = String(d.sheet || ''); },
    sheetDone() { L.sheet = ''; },
  };
  function doAct(a, data) {
    if (!a) return;
    if (a.startsWith('mac:')) sendMac(a.slice(4));
    else if (ACTS[a]) ACTS[a](data || {});
    else return;
    if (live) tick();
    else { render(); sendMirror(); }
  }
  D.act = doAct;

  // Clicks: on the Mac's copy every click is the PC copy's to act on (its data goes along), except
  // minimise, which is this window's own (into the Mac's Dock).
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el || el.disabled || el.closest('.ghost, .leaving')) return;
    const a = el.dataset.act;
    if (mirrored) {
      if (a === 'minimize') send({ cmd: 'minimize' });
      else send({ cmd: 'act', act: a, data: Object.assign({}, el.dataset) });
      return;
    }
    doAct(a, Object.assign({}, el.dataset));
  });

  // Keyboard (§2.8): Return is the primary button, Esc the one marked as the way out; with a sheet
  // open both are its Done. Tab moves the focus. On this PC's copy, while the Mac desktop shows,
  // the receiver has the keyboard: every key is ignored here.
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  document.addEventListener('keydown', (e) => {
    if (!mirrored && S.screen.showing) { swallow(e); return; }
    const sheetOpen = !!L.sheet;
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.repeat) { swallow(e); return; }
      const b = sheetOpen ? sheetEl.querySelector('[data-act="sheetDone"]')
        : e.key === 'Enter' ? buttonsEl.querySelector('.btn-primary')
          : appEl.querySelector('.tray [data-esc="1"]');
      if (b) { swallow(e); b.click(); }
      return;
    }
    if (e.key === 'Tab' && sheetOpen) {                      // the focus stays in the sheet
      swallow(e);
      const b = sheetEl.querySelector('button');
      if (b) b.focus();
    }
  }, true);
  document.addEventListener('keyup', (e) => { if (!mirrored && S.screen.showing) swallow(e); }, true);

  // Drag fallback: a runtime without app-region (and the Mac's copy) moves the window from a press
  // anywhere that isn't a control. The Windows host may have installed the same fallback already.
  function installDragFallback() {
    const h = hostInfo();
    if (!host || h.appRegion || window.usbcDragFallback) return;
    window.usbcDragFallback = true;
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !e.target.closest) return;
      if (e.target.closest('button, a, input, .sheet, .link, [data-act]') || !e.target.closest('#app')) return;
      e.preventDefault();
      send({ cmd: 'startDrag' });
    }, true);
  }

  // ---------- Mirror and frame (PC copy) ----------
  let mirrorSent = '';
  function sendMirror() {
    if (mirrored || !host) return;
    const local = { screen: L.screen, sub: L.sub, sheet: L.sheet, cut: L.cut, cutCheck: L.cutCheck, settled: L.settled };
    if (typeof L.input === 'boolean') local.input = L.input;
    const look = { theme: root.dataset.theme, accent: root.dataset.accent, active: !!L.active, style: root.getAttribute('style') || '' };
    const j = JSON.stringify({ local, look });
    if (j === mirrorSent) return;
    mirrorSent = j;
    send({ cmd: 'mirror', json: j });
  }
  // The frame on screen, for the hand-off hold (§4.2): the installed copy paints the same one.
  let frameSent = '';
  function postFrame() {
    if (mirrored || !host || !cur) return;
    const f = { screen: cur.screen, sub: cur.sub, status: cur.status ? cur.status.key : '', theme: root.dataset.theme, accent: root.dataset.accent, active: !!L.active };
    const j = JSON.stringify(f);
    if (j === frameSent) return;
    frameSent = j;
    send(Object.assign({ cmd: 'frame' }, f));
  }

  // The reveal (§4.1): the host keeps the window cloaked until the first real frame is on screen.
  // Inter is asked for by name first: right after a render its load may not have started yet, and
  // document.fonts.ready alone would then already be settled while the text is still invisible.
  const fontsIn = () => {
    const f = document.fonts;
    if (!f || !f.ready) return Promise.resolve();
    const load = typeof f.load === 'function' ? f.load('16px Inter').catch(() => {}) : Promise.resolve();
    return load.then(() => f.ready);
  };
  function whenPainted(fn) {
    fontsIn().then(() => requestAnimationFrame(() => requestAnimationFrame(fn)));
  }
  // The frame the window is revealed with must be whole: fonts in, no fade still running in the
  // window, then painted and one more frame produced after it, so the compositor already holds it
  // when DWM uncloaks. Only fades count: the loops of the pictures and the spinner never end, and
  // the progress bar's fill moves on every update.
  const fadesOpacity = (a) => { try { return a.effect.getKeyframes().some((k) => 'opacity' in k); } catch (e) { return true; } };
  function fadesRunning() {
    let list = [];
    try { list = appEl.getAnimations({ subtree: true }); } catch (e) { list = document.getAnimations ? document.getAnimations() : []; }
    return list.filter((a) => (a.playState === 'running' || a.pending) && a.effect
      && isFinite(a.effect.getComputedTiming().endTime) && fadesOpacity(a));
  }
  function whenWhole(fn) {
    fontsIn().then(() => {
      const fades = fadesRunning();
      if (fades.length) { Promise.all(fades.map((a) => a.finished.catch(() => {}))).then(() => whenWhole(fn)); return; }
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => {
        if (fadesRunning().length) whenWhole(fn); else fn();
      }), 0)));
    });
  }
  let shownSent = false;
  function revealWhenReady() {
    if (shownSent || mirrored || !S.laptop.checked || !cur || !drawn) return;
    shownSent = true;
    whenWhole(() => send({ cmd: 'shown' }));
  }

  // ---------- Rendering ----------
  let cur = null;          // the view on screen
  let drawn = false;       // a real screen has been drawn: the first one appears whole, with no fade (§4.1, §4.2)
  let scrEl = null;        // its .scr
  let sceneNow = null;     // the picture in the band: {key, sc, el, anims, band}

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = (k) => (D.STR && D.STR[k]) || '';
  const div = (cls, html) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; return e; };
  // The pictures package (scenes.js, macos.js) is built alongside: a missing or failing function
  // leaves an empty box.
  const missing = [];
  function call(name, fn, args) {
    if (typeof fn !== 'function') { if (missing.indexOf(name) < 0) missing.push(name); return null; }
    try { return fn.apply(null, args); } catch (e) { if (missing.indexOf(name + ' (threw)') < 0) missing.push(name + ' (threw)'); return null; }
  }
  // Drawn sizes in pt (scenes.js draws them at these sizes); each is centred on y 145 at x 175.
  const GLYPH_SIZE = { displays: [126, 78.5], hand: [78, 93], plug: [26, 89], folder: [120, 93], keyboard: [146, 93], check: [93, 93] };

  // Motion: one place, so shots and reduced motion can switch it off.
  function fade(el, from, to, ms, extra) {
    if (instant || !el.animate) { el.style.opacity = ''; return Promise.resolve(); }
    const a = el.animate([{ opacity: from }, { opacity: to }], Object.assign({ duration: ms, easing: FADE, fill: 'forwards' }, extra || {}));
    return a.finished.catch(() => {});
  }
  function relRect(el, box) {
    const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height };
  }
  // A copy of what was there fades out where it was, over the new content fading in.
  function ghost(clone, rect, box, ms) {
    if (instant || !clone) return;
    clone.classList.add('ghost');
    clone.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    Object.assign(clone.style, { position: 'absolute', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', margin: '0' });
    box.appendChild(clone);
    fade(clone, 1, 0, ms).then(() => clone.remove());
  }

  function render() {
    stripHostStyle();
    applyActive();
    const v = L.screen && haveState ? D.view(S, L) : null;
    if (v && preview) debugText(v);
    // Until route() gives a screen nothing is built (the window stays cloaked); the first real
    // screen, the installed copy's held frame included, then appears whole: no crossfade, no fade
    // of its buttons or status (§4.1, §4.2).
    const first = !!v && !drawn;
    const screenChanged = !!v && (first || !cur || cur.screen !== v.screen);
    const oldScr = scrEl;
    applyLook(screenChanged && !first ? oldScr : null);
    renderLights(v);
    if (!v) {
      if (scrEl) { scrEl.remove(); scrEl = null; }
      renderStatus(null, true, true, []);
      syncButtons(buttonsEl, [], 0);
      syncThird(null, 0);
    } else {
      if (screenChanged) newScreen(v, first);
      else updateScreen(v);
      const fadeIn = first ? 0 : screenChanged ? 250 : 200;
      syncButtons(buttonsEl, [v.secondary && ['secondary', v.secondary], v.primary && ['primary', v.primary]].filter(Boolean), fadeIn);
      syncThird(v.third, fadeIn);
      renderStatus(v.third ? null : v.status, screenChanged, first, v.completed || []);
      drawn = true;
    }
    renderSheet();
    cur = v;
  }

  // The window's theme and accent change only at a screen change, inside its crossfade (§6.4): the
  // leaving screen keeps the look it was drawn with.
  let lookTimer = 0;
  function applyLook(leaving) {
    const t = L.look.theme === 'dark' ? 'dark' : 'light';
    const a = ACCENTS.indexOf(L.look.accent) >= 0 ? L.look.accent : 'blue';
    if (root.dataset.theme === t && root.dataset.accent === a) return;
    if (leaving && !instant) {
      leaving.dataset.theme = root.dataset.theme || 'light';
      leaving.dataset.accent = root.dataset.accent || 'blue';
      appEl.classList.add('look-fade');
      clearTimeout(lookTimer);
      lookTimer = setTimeout(() => appEl.classList.remove('look-fade'), 320);
    }
    root.dataset.theme = t;
    root.dataset.accent = a;
    sendChrome();
  }

  function renderLights(v) {
    const on = v ? v.closeEnabled !== false : true;
    if (closeLight.disabled === !on) return;
    closeLight.disabled = !on;
    closeLight.setAttribute('aria-disabled', String(!on));
  }

  function newScreen(v, first) {
    const old = scrEl;
    scrEl = buildScreen(v);
    pageEl.appendChild(scrEl);
    if (old) {
      old.classList.add('leaving');
      old.inert = true;
      if (instant || first) old.remove();
      else {
        fade(old, 1, 0, 250).then(() => old.remove());
        fade(scrEl, 0, 1, 250);
      }
    }
    sceneNow = null;
    mountScene(v, first ? 0 : 250);
  }

  function buildScreen(v) {
    const s = div('scr v-' + v.variant);
    s.dataset.screen = v.screen;
    s.dataset.sub = v.sub;
    if (v.variant === 'glyph') s.appendChild(heroGlyph(v.glyph));
    else if (!mirrored) { const b = div('band'); b.setAttribute('aria-hidden', 'true'); s.appendChild(b); }  // pictures only on this PC
    const col = div('col' + (v.body.length ? '' : ' no-body'));
    col.innerHTML = '<h1 class="title t-title">' + v.title + '</h1><div class="body t-lead">' + v.body.join('') + '</div>';
    const content = div('content' + (v.contentTop ? ' fixed' : ''));
    placeContent(content, v);
    content.innerHTML = contentHTML(v.content);
    col.appendChild(content);
    s.appendChild(col);
    return s;
  }
  function placeContent(el, v) {
    el.classList.toggle('fixed', !!v.contentTop);
    el.style.top = v.contentTop ? 'calc(' + (v.contentTop - (v.variant === 'picture' ? 358 : 218)) + ' * var(--pt))' : '';
  }

  function heroGlyph(name) {
    const g = div('hero-glyph');
    g.setAttribute('aria-hidden', 'true');
    const sz = GLYPH_SIZE[name] || [146, 93];
    g.style.setProperty('--gw', sz[0]);
    g.style.setProperty('--gh', sz[1]);
    g.innerHTML = (name && call('D.glyph', D.glyph, [name])) || '';
    return g;
  }

  const linkHTML = (sheet) => '<button class="link t-body" data-act="help" data-sheet="' + esc(sheet) + '">' + T('common.learnMore') + '</button>';
  function contentHTML(list) {
    return (list || []).map((c) => {
      if (c.type === 'address') return '<p class="address t-large-reg">' + esc(c.text) + '</p>';
      if (c.type === 'caption') return '<p class="caption t-body">' + (c.html || '') + (c.sheet ? (c.html ? ' ' : '') + linkHTML(c.sheet) : '') + '</p>';
      if (c.type === 'link') return '<p class="caption t-body">' + linkHTML(c.sheet) + '</p>';
      if (c.type === 'progress') {
        return '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round((c.value || 0) * 100) + '"><i style="width:' + ((c.value || 0) * 100).toFixed(2) + '%"></i></div>' +
          (c.label ? '<p class="caption t-body prog-label">' + esc(c.label) + '</p>' : '');
      }
      if (c.type === 'list') {
        return '<div class="obk-list">' + c.items.map((it) => '<div class="obk-item"><span class="obk-ic" aria-hidden="true">' +
          ((call('D.listGlyph', D.listGlyph, [it.glyph])) || '') + '</span><div class="obk-tx"><b class="t-body-sb">' + it.title + '</b><span class="t-body">' + it.text + '</span></div></div>').join('') + '</div>';
      }
      return '';
    }).join('');
  }
  // What the content shows, without the progress value (that moves in place).
  const contentKey = (v) => JSON.stringify((v.content || []).map((c) => (c.type === 'progress' ? { type: 'progress', l: !!c.label } : c))) + '@' + v.contentTop;

  // Within a screen only what changed moves (§4.3): title, body and caption crossfade over 200 ms;
  // something pushed down by a longer body crossfades to its new place.
  function updateScreen(v) {
    const s = scrEl;
    const col = s.querySelector('.col'), title = s.querySelector('.title'), body = s.querySelector('.body'), content = s.querySelector('.content');
    // The hero glyph changes with the title (Ready's error rows): it crossfades over the same 200 ms.
    if (v.variant === 'glyph' && cur.glyph !== v.glyph) {
      const g = s.querySelector('.hero-glyph:not(.ghost)');
      const ng = heroGlyph(v.glyph);
      if (g) {
        const rect = relRect(g, s), clone = g.cloneNode(true);
        s.replaceChild(ng, g);
        ghost(clone, rect, s, 200);
      } else s.prepend(ng);
      fade(ng, 0, 1, 200);
    }
    const parts = [
      [title, cur.title !== v.title, () => { title.innerHTML = v.title; }],
      [body, cur.bodyKey !== v.bodyKey, () => { body.innerHTML = v.body.join(''); col.classList.toggle('no-body', !v.body.length); }],
      [content, contentKey(cur) !== contentKey(v), () => { placeContent(content, v); content.innerHTML = contentHTML(v.content); }],
    ];
    const before = parts.map(([el]) => ({ rect: relRect(el, s), clone: el.cloneNode(true), empty: !el.textContent.trim() && !el.querySelector('svg, i') }));
    parts.forEach(([, changed, apply]) => { if (changed) apply(); });
    // The progress bar's fill moves in place (linear, 200 ms).
    const bar = content.querySelector('.progress > i'), pv = (v.content || []).find((c) => c.type === 'progress');
    if (bar && pv) {
      bar.style.width = ((pv.value || 0) * 100).toFixed(2) + '%';
      bar.parentNode.setAttribute('aria-valuenow', String(Math.round((pv.value || 0) * 100)));
      const lab = content.querySelector('.prog-label');
      if (lab && lab.textContent !== pv.label) lab.textContent = pv.label;
    }
    parts.forEach(([el, changed], i) => {
      const b = before[i];
      const r = relRect(el, s);
      const moved = Math.abs(r.top - b.rect.top) > 0.5 || Math.abs(r.left - b.rect.left) > 0.5;
      if (!changed && !moved) return;
      if (!b.empty) ghost(b.clone, b.rect, s, 200);
      if (el.textContent.trim() || el.querySelector('svg, i')) fade(el, 0, 1, 200);
    });
    s.dataset.sub = v.sub;
    mountScene(v, 0);
  }

  // ---------- The picture band (§3.0.3, §4.3, §6.3) ----------
  const camT = (cam) => (D.scenes && typeof D.scenes.camTransform === 'function' ? D.scenes.camTransform(cam)
    : 'scale(' + cam.s + ') translate(' + -cam.x + 'px,' + -cam.y + 'px)');
  function mountScene(v, enterMs) {
    const band = scrEl && scrEl.querySelector('.band');
    if (!band || !v.scene) { sceneNow = null; return; }
    const key = v.scene.name + '|' + JSON.stringify(v.scene.opts);
    const prev = sceneNow && sceneNow.band === band ? sceneNow : null;
    if (prev && prev.key === key) return;
    const sc = call('D.scenes.mac', D.scenes && D.scenes.mac, [v.scene.name, v.scene.opts]);
    const canvas = div('band-canvas');
    canvas.innerHTML = (sc && sc.html) || '';
    if (prev) band.insertBefore(canvas, prev.el); else band.appendChild(canvas);
    // Measure the teaching loop at the new camera, before anything pans.
    const pan = !!(prev && sc && prev.sc && sc.family && sc.family === prev.sc.family && sc.cam && prev.sc.cam && !reduced.matches && !instant);
    const land = prev ? (instant ? 0 : pan ? 900 : 440) : enterMs;
    const t0 = document.timeline ? document.timeline.currentTime + land + (instant ? 0 : 1000) : undefined;
    const anims = (sc && sc.tl && call('D.playScene', D.playScene, [canvas, sc.tl, t0])) || [];
    freeze(anims, sc, v.scene.opts);
    // The loop measured its targets (pointer, halo, ring) with the text as laid out now. Before
    // the web font has loaded (a copy that opens on a picture), that layout changes: measure again.
    if (sc && sc.tl && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => {
        const now = sceneNow;
        if (!now || now.el !== canvas) return;
        now.anims.forEach((a) => { try { a.cancel(); } catch (e) { /* gone */ } });
        now.anims = call('D.playScene', D.playScene, [canvas, sc.tl, t0]) || [];
        freeze(now.anims, sc, v.scene.opts);
      });
    }
    if (prev) {
      if (pan) {
        const from = camT(prev.sc.cam), to = camT(sc.cam);
        [prev.el, canvas].forEach((c) => {
          const m = c.querySelector('.mk-scr');
          if (m && m.animate) m.animate([{ transform: from }, { transform: to }], { duration: 900, easing: SPRING, fill: 'forwards' });
        });
      }
      const old = prev;
      const done = () => { old.anims.forEach((a) => { try { a.cancel(); } catch (e) { /* gone */ } }); old.el.remove(); };
      if (instant) done();
      else fade(old.el, 1, 0, 440, pan ? { delay: 90, easing: 'linear' } : { easing: FADE }).then(done);
    }
    sceneNow = { key, sc, el: canvas, anims, band };
  }
  // Hold the loop at one frame: ?f= for shots, the poster for reduced motion, shots and still scenes.
  function freeze(anims, sc, opts) {
    if (!sc || !anims || !anims.length) return;
    let frac = null;
    const f = P('f');
    if (f !== null && f !== '') frac = Number(f);
    else if (reduced.matches || shot || (opts && opts.still)) frac = sc.poster != null ? sc.poster : 0;
    if (frac === null) return;
    const dur = (sc.tl && sc.tl.dur) || 1000;
    anims.forEach((a) => { a.pause(); a.currentTime = frac * dur + (a._shift || 0); });
  }
  if (reduced.addEventListener) reduced.addEventListener('change', () => { if (sceneNow) { const k = sceneNow; sceneNow = null; k.el.remove(); } if (cur) mountScene(cur, 0); });

  // ---------- Tray (§3.0.4) ----------
  // Buttons are absent while waiting, never disabled. One that goes away goes at once; a new label
  // swaps at once; a button that appears fades in.
  function buttonEl(role, b) {
    const e = document.createElement('button');
    e.className = 'btn t-body btn-' + role;
    e.textContent = b.label;
    e.dataset.act = b.act;
    if (b.esc) e.dataset.esc = '1';
    Object.keys(b.data || {}).forEach((k) => { e.dataset[k] = b.data[k]; });
    return e;
  }
  const sameButton = (e, b) => e && e.textContent === b.label && e.dataset.act === b.act && JSON.stringify(b.data || {}) === JSON.stringify(Object.keys(b.data || {}).reduce((o, k) => { o[k] = e.dataset[k]; return o; }, {}));
  function syncButtons(box, want, fadeMs) {
    const have = Array.from(box.children);
    const roles = want.map((w) => w[0]);
    have.forEach((e) => { if (roles.indexOf(e.dataset.role) < 0) e.remove(); });
    want.forEach(([role, b], i) => {
      let e = box.querySelector('[data-role="' + role + '"]');
      if (e && sameButton(e, b)) { if (b.esc) e.dataset.esc = '1'; else delete e.dataset.esc; }
      else {
        const n = buttonEl(role, b);
        n.dataset.role = role;
        if (e) { const focused = document.activeElement === e; box.replaceChild(n, e); if (focused) n.focus(); }
        else { box.insertBefore(n, box.children[i] || null); if (fadeMs) fade(n, 0, 1, fadeMs, { fill: 'none' }); }
      }
    });
  }
  function syncThird(b, fadeMs) {
    let e = slotEl.querySelector('.btn-third');
    if (!b) { if (e) e.remove(); return; }
    if (e && sameButton(e, b)) { if (b.esc) e.dataset.esc = '1'; else delete e.dataset.esc; return; }
    const n = buttonEl('third', b);
    n.dataset.role = 'third';
    if (e) slotEl.replaceChild(n, e);
    else { slotEl.appendChild(n); if (fadeMs) fade(n, 0, 1, fadeMs, { fill: 'none' }); }
  }

  // ---------- Status line (§4.5) ----------
  // Appear and disappear: 200 ms fades; a new text crossfades. A busy status with a done text that is
  // replaced while the screen stays shows a check with that text for 600 ms first, but only when its
  // own work has completed (view.completed): replaced by anything else (the "Installing…" override,
  // an error), it simply crossfades.
  let stShown = null, stWant = null, stTimer = 0;
  const sameStatus = (a, b) => (!a && !b) || (!!a && !!b && a.key === b.key && a.state === b.state && a.text === b.text && a.spinner === b.spinner);
  function spinnerSVG() {
    const op = [0.75, 0.64, 0.53, 0.43, 0.33, 0.24, 0.17, 0.12];
    let lines = '';
    for (let i = 0; i < 8; i++) {
      const th = (-i * 45 * Math.PI) / 180, sn = Math.sin(th), cs = Math.cos(th);
      const x = (r) => (8 + r * sn).toFixed(3), y = (r) => (8 - r * cs).toFixed(3);
      // Spokes from radius 3.2 to 8 as drawn (round caps of 1 pt at both ends), the head at 12 o'clock.
      lines += '<line x1="' + x(4.2) + '" y1="' + y(4.2) + '" x2="' + x(7) + '" y2="' + y(7) + '" opacity="' + op[i] + '"/>';
    }
    // The phase comes from the wall clock, so this PC's and the Mac's copies turn alike (§4.2).
    return '<svg class="spinner" viewBox="0 0 16 16" aria-hidden="true" style="animation-delay:-' + (now() % 800) + 'ms">' + lines + '</svg>';
  }
  const CHECK = '<svg class="status-check" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8"/><path d="M4.7 8.3l2.2 2.2 4.4-4.6"/></svg>';
  function statusLine(st) {
    const e = div('st-line');
    // A closing "…" has its own span: this PC's heavier type spaces it apart from the letters (styles.css).
    const tx = esc(st.text).replace(/…$/, '<span class="st-ell">…</span>');
    e.innerHTML = '<span class="st-ic">' + (st.state === 'done' ? CHECK : st.spinner ? spinnerSVG() : '') + '</span><span class="st-tx t-body">' + tx + '</span>';
    return e;
  }
  function showStatus(st, quiet) {
    const old = statusEl.querySelector('.st-line:not(.going)');
    if (old) {
      old.classList.add('going');
      if (quiet || instant) old.remove(); else fade(old, 1, 0, 200).then(() => old.remove());
    }
    stShown = st;
    if (!st) return;
    const e = statusLine(st);
    statusEl.appendChild(e);
    if (!quiet && !instant) fade(e, 0, 1, 200, { fill: 'none' });
  }
  function renderStatus(want, screenChanged, first, completed) {
    stWant = want;
    if (stTimer) {
      if (!screenChanged) return;                            // the check finishes first, then the latest status shows
      clearTimeout(stTimer); stTimer = 0;
    }
    if (sameStatus(stShown, want)) return;
    const sh = stShown;
    if (sh && sh.state === 'busy' && sh.doneText && !screenChanged && !instant
      && (completed || []).indexOf(sh.key) >= 0
      && (!want || want.key !== sh.key) && !(want && want.state === 'done' && want.text === sh.doneText)) {
      showStatus({ key: sh.doneKey, text: sh.doneText, state: 'done', spinner: false }, false);
      stTimer = setTimeout(() => { stTimer = 0; if (!sameStatus(stShown, stWant)) showStatus(stWant, false); }, 600);
      return;
    }
    showStatus(want, !!first);                               // the first frame appears whole
  }

  // ---------- Sheets (§5) ----------
  let sheetShown = '';
  function sheetHTML(id) {
    const sv = S.server;
    const vars = { host: D.hostOf(sv.url) || 'usbc.local', fallback: D.hostOf(sv.fallbackUrl) || '', fallbackUrl: sv.fallbackUrl || '' };
    const fill = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? esc(vars[k]) : m));
    const ps = [1, 2, 3].map((i) => {
      let k = 'sheet.' + id + '.p' + i;
      if (id === 'permission' && i === 3 && S.laptop.signed) return '';
      if (id === 'safari' && i === 2 && !(sv.fallbackUrl && D.hostOf(sv.fallbackUrl) !== D.hostOf(sv.url))) k = 'sheet.safari.p2-nofallback';
      const s = T(k);
      return s ? '<p class="t-body">' + fill(s) + '</p>' : '';
    }).join('');
    return '<h2 class="t-head" id="sheet-title">' + T('sheet.' + id + '.title') + '</h2>' + ps +
      '<div class="sheet-buttons"><button class="btn-sheet t-body" data-act="sheetDone">' + T('common.done') + '</button></div>';
  }
  function renderSheet() {
    const id = L.sheet && D.STR['sheet.' + L.sheet + '.title'] ? L.sheet : '';
    if (id === sheetShown) return;
    const was = sheetShown;
    sheetShown = id;
    if (!id) {
      if (instant) { sheetEl.hidden = true; dimEl.hidden = true; return; }
      Promise.all([fade(sheetEl, 1, 0, 200), fade(dimEl, 1, 0, 200)]).then(() => {
        if (sheetShown) return;
        sheetEl.hidden = true; dimEl.hidden = true;
        sheetEl.getAnimations().forEach((a) => a.cancel()); dimEl.getAnimations().forEach((a) => a.cancel());
      });
      return;
    }
    sheetEl.innerHTML = sheetHTML(id);
    sheetEl.setAttribute('aria-labelledby', 'sheet-title');
    sheetEl.hidden = false; dimEl.hidden = false;
    sheetEl.getAnimations().forEach((a) => a.cancel()); dimEl.getAnimations().forEach((a) => a.cancel());
    const mpt = pointNow();
    sheetEl.style.top = Math.max(0, Math.round((600 * mpt - sheetEl.offsetHeight) / 2)) + 'px';
    if (!was && !instant) {
      fade(dimEl, 0, 1, 250, { fill: 'none' });
      if (reduced.matches) fade(sheetEl, 0, 1, 250, { fill: 'none' });
      else if (sheetEl.animate) sheetEl.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 250, easing: SPRING });
    }
  }

  // ---------- Preview (a normal browser: ui/index.html?step=&sub=… or ?scenario=…&play=1) ----------
  function previewFlags() {
    return {
      acct: P('acct') || '', signed: P('signed') === '1', notarized: P('notarized') === '1', update: P('update') === '1',
      input: P('input') === '1' ? true : P('input') === '0' ? false : undefined, edge: P('edge') || '', pointer: P('pointer') === '1',
      theme: P('theme') || '', accent: P('accent') || '', sheet: P('sheet') || '',
    };
  }
  // A plausible snapshot for one frame, when preview/mock.js has none to give.
  function minimalState(scr, sub) {
    const s = merge(DEFAULTS, {
      laptop: { checked: true, usb4: 'ok', installed: true, runningInstalled: true, elevation: 'done', firewallOk: true, recoveryTasksOk: true, isAdminUser: true },
      link: { adapterUp: true, adapterName: 'USB4 P2P Network Adapter', secondsSincePlug: 12, macFound: true },
      server: { running: true, url: 'http://usbc.local', fallbackUrl: 'http://169.254.29.64', urlReady: true, appSize: 700000, appVersion: '5', download: { sent: 0, size: 700000, done: false } },
      mac: { reachable: true, appVersion: '5', macOS: '27.0.1', status: { inApplications: true, screenOk: true, loginItemEnabled: true, runningAsAgent: true } },
      setup: { started: true, elevationAsked: true },
      settings: { scale: 125, scaleOptions: [{ id: 125, label: 'Default', detail: '', recommended: true }] },
    });
    const lap = s.laptop, ln = s.link, sv = s.server, m = s.mac, ms = m.status;
    const appGone = () => { m.reachable = false; m.appVersion = ''; ms.inApplications = false; ms.screenOk = false; };
    switch (scr) {
      case 'welcome': s.setup.started = false; s.setup.elevationAsked = false; lap.installed = false; lap.runningInstalled = false; lap.elevation = 'none'; break;
      case 'unsupported': s.setup.started = false; lap.usb4 = 'missing'; lap.installed = false; lap.runningInstalled = false; lap.elevation = 'none'; break;
      case 'incomplete': lap.missingPayload = ['receiver']; break;
      case 'install-error': lap.installError = sub === 'in-use' ? 'inUse' : 'other'; lap.installed = false; lap.runningInstalled = false; lap.elevation = 'none'; break;
      case 'allow-pc':
        lap.runningInstalled = false; lap.firewallOk = false; lap.elevation = { pending: 'pending', 'pending-hint': 'pending', working: 'working', refused: 'refused', failed: 'failed', done: 'done' }[sub] || 'none';
        if (sub === 'installing') { lap.installing = true; lap.installed = false; }
        if (sub === 'done') s.setup.handingOff = true;
        s.setup.elevationAsked = sub !== 'installing' && sub !== 'waiting';
        break;
      case 'connect':
        appGone();
        if (['cable', 'cable-hint', 'no-cable', 'reconnect'].indexOf(sub) >= 0) { ln.adapterUp = false; ln.macFound = false; }
        if (sub === 'finding' || sub === 'no-mac') { ln.macFound = false; ln.secondsSincePlug = sub === 'no-mac' ? 45 : 8; }
        if (sub === 'no-server' || sub === 'port-busy') { sv.running = false; sv.urlReady = false; sv.error = sub === 'port-busy' ? 'port' : ''; }
        break;
      case 'unreachable': m.reachable = false; break;
      case 'get-app':
        appGone();
        sv.pageVisited = sub.indexOf('address') < 0;
        if (sub === 'allow-downloads') sv.downloadClicked = true;
        if (sub === 'downloading') sv.download = { sent: 400000, size: 700000, done: false };
        break;
      case 'open-app':
        appGone();
        sv.pageVisited = true; sv.download = { sent: 700000, size: 700000, done: true };
        if (sub === 'confirm') sv.appNotarized = true;
        break;
      case 'move': ms.inApplications = false; break;
      case 'login': ms.loginItemNeedsApproval = true; ms.settingsFront = sub === 'settings'; break;
      case 'allow-screen': ms.screenOk = sub.indexOf('reopen') >= 0; ms.screenNeedsRelaunch = sub.indexOf('reopen') >= 0; ms.promptUp = sub === 'prompt'; ms.settingsFront = sub === 'settings'; break;
      case 'keyboard': ms.axOk = false; break;
      case 'allow-control': ms.axOk = false; s.setup.axChoice = 'yes'; ms.promptUp = sub === 'prompt'; ms.settingsFront = sub === 'settings'; break;
      case 'ready':
        ms.axOk = false; s.setup.axChoice = 'no';
        if (sub === 'cut' || sub === 'showing') { s.screen.running = true; s.screen.showing = true; ms.sessionActive = true; }
        if (sub === 'elsewhere') s.screen.running = true;
        if (sub === 'error') s.screen.error = 'other';
        if (sub === 'error-files') s.screen.error = 'receiver-missing';
        break;
      default: break;
    }
    return s;
  }
  function applyFlags(s, f) {
    if (f.acct === 'standard') s.laptop.isAdminUser = false;
    if (f.signed) s.laptop.signed = true;
    if (f.notarized) s.server.appNotarized = true;
    if (f.update) { s.mac.reachable = true; s.mac.outdated = true; s.mac.appVersion = '3'; }
    if (f.input === true) { s.mac.status.axOk = true; s.setup.axChoice = 'yes'; }
    if (f.input === false) { s.mac.status.axOk = false; s.setup.axChoice = 'no'; }
    if (f.edge) s.mac.status.displaySide = f.edge === 'unknown' ? '' : f.edge;
    if (f.pointer) s.screen.pointerOnLaptop = true;
    return s;
  }
  function stateFor(scr, sub, f) {
    let s = null;
    if (D.mock && typeof D.mock.stateFor === 'function') {
      try { s = D.mock.stateFor(scr, sub, f); } catch (e) { s = null; }
    }
    return applyFlags(merge(DEFAULTS, s || minimalState(scr, sub)), f);
  }
  const firstSub = (scr) => { const e = (D.SUBS || []).find((x) => x[0] === scr); return e ? e[1] : 'idle'; };
  // Draw one [screen, sub] directly (route bypassed), as this PC's copy or as the Mac's (?mac=1).
  function showFrame(scr, sub, f) {
    f = f || previewFlags();
    force.theme = f.theme || ''; force.accent = f.accent || ''; force.mpt = f.mpt || '';
    S = stateFor(scr, sub, f);
    haveState = true;
    sub = sub || firstSub(scr);
    L.screen = ''; enter([scr, sub]);
    L.cut = L.cutCheck = L.settled = false; L.shownOnce = false; L.input = undefined;
    if (scr === 'ready') {
      if (sub === 'cut' || sub === 'showing') { L.cut = true; L.shownOnce = true; }
      if (sub === 'cut') L.cutCheck = P('check') === '1';
      if (sub === 'showing') { L.cutCheck = true; L.settled = true; }
      if (sub === 'hidden') L.shownOnce = true;
      if (sub === 'starting' || sub === 'cut') L.input = D.inputOn(S);
    }
    L.sheet = f.sheet || '';
    const active = P('inactive') !== '1' && P('active') !== '0';
    if (mirrored) mirroredActive = active; else L.active = active;
    applyActive();
    setMacPoint();
    render();
  }
  function startPreview() {
    const speed = D.mock && +D.mock.speed > 1 ? +D.mock.speed : 1;
    if (speed > 1) startTicker(Math.max(25, 250 / speed));
    const scr = P('step');
    if (scr) {
      showFrame(scr, P('sub'));
      if (P('play') === '1' && !mirrored) live = true;
      revealWhenReady();
      send({ cmd: 'ready' });                                // the mock may add {type:'active'} (?active=0)
      return;
    }
    live = !mirrored;
    send({ cmd: 'ready' });                                  // the mock answers like the host, with states
  }

  // ?text= / ?body= (preview): another title or body in this frame, to compare line widths with an
  // Apple render of the same words. ¶ separates paragraphs.
  function debugText(v) {
    if (P('text')) v.title = esc(P('text'));
    if (P('body')) { v.body = P('body').split('¶').map((t) => '<p>' + esc(t.trim()) + '</p>'); v.bodyKey = v.body.join(''); }
  }

  // ---------- Checks (preview and reviewers) ----------
  // Measured line counts and bottoms of the frame on screen (SPEC §10.2.5), in pt.
  function fit() {
    if (!scrEl || !cur) return null;
    const mpt = pointNow();
    const box = appEl.getBoundingClientRect();
    const col = scrEl.querySelector('.col');
    const left = col.getBoundingClientRect().left + 2 * mpt;      // the letters start at x 175
    const pt = (px) => Math.round((px / mpt) * 10) / 10;
    const lines = (el, lh) => (el && el.textContent.trim() ? Math.round(el.getBoundingClientRect().height / (lh * mpt)) : 0);
    let widest = 0;
    scrEl.querySelectorAll('.title, .body p, .caption, .address, .obk-tx b, .obk-tx span').forEach((el) => {
      if (el.closest('.ghost')) return;
      const r = document.createRange();
      r.selectNodeContents(el);
      Array.from(r.getClientRects()).forEach((q) => { widest = Math.max(widest, q.right - left); });
    });
    const content = scrEl.querySelector('.content');
    const cb = content && content.textContent.trim() ? content.getBoundingClientRect().bottom - box.top : 0;
    const bodyLines = lines(scrEl.querySelector('.body'), 20.5);
    const maxBody = cur.variant === 'picture' ? 2 : cur.screen === 'ready' ? 3 : 4;
    const res = {
      screen: cur.screen, sub: cur.sub, variant: cur.variant, mpt,
      titleLines: lines(scrEl.querySelector('.title'), 20.5), bodyLines, maxBody,
      contentBottom: pt(cb), widest: pt(widest),
    };
    res.ok = res.titleLines <= 1 && bodyLines <= maxBody && res.contentBottom <= 521.5 && res.widest <= 450.5;
    return res;
  }
  D.debug = {
    fit,
    // Draw [screen, sub] now, with no motion, and measure it (preview only).
    show(scr, sub, flags) {
      const was = instant; instant = true;
      showFrame(scr, sub, Object.assign(previewFlags(), flags || {}));
      instant = was;
      return fit();
    },
    missing: () => missing.slice(),
    state: () => S,
    local: () => L,
    view: () => cur,
  };
  D.current = () => [L.screen, L.sub];
  D.local = L;

  // ---------- Boot ----------
  root.dataset.theme = L.look.theme;
  root.dataset.accent = L.look.accent;
  setMacPoint();
  shape();
  render();
  if (window.ResizeObserver) new ResizeObserver(() => { setMacPoint(); shape(); }).observe(document.documentElement);
  if (host) {
    live = !mirrored;
    installDragFallback();
    host.addEventListener('message', (e) => onMessage(e.data));
    send({ cmd: 'ready' });
  } else {
    // The preview harness stands in for the host; it may also speed the clock up (D.now, ?speed=).
    const s = document.createElement('script');
    s.src = '../preview/mock.js';
    s.onload = s.onerror = () => startPreview();
    document.body.appendChild(s);
  }
})();
