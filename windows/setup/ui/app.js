// Wizard shell: talks to the setup app (CONTRACT.md sections 2 and 3),
// keeps the user's place in the steps, and renders from the latest state.
// Without the host (a normal browser) it loads the preview harness.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});
  const host = window.chrome && window.chrome.webview;
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  // ---------- Theme ----------
  const forced = params.get('theme');
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const setTheme = () => { root.dataset.theme = forced || (mq.matches ? 'dark' : 'light'); };
  setTheme();
  if (mq.addEventListener) mq.addEventListener('change', () => { setTheme(); });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- State ----------
  const DEFAULTS = {
    laptop: { windowsBuild: 0, arch: '', isAdminUser: true, usb4: 'unknown', installed: false, elevation: 'none', firewallOk: false, recoveryTasksOk: false, installError: '', installing: false },
    link: { adapterUp: false, adapterName: '', secondsSincePlug: 0, macFound: false, macV6: '', macV4: '', laptopV4: '' },
    server: { running: false, url: 'http://usbc.local', fallbackUrl: '', urlReady: false, pageVisited: false, download: { sent: 0, size: 0, done: false }, appNotarized: false, usingFallback: false },
    mac: {
      reachable: false, outdated: false, appVersion: '', macOS: '',
      status: { screenOk: false, axOk: false, screenPrompted: false, axPrompted: false, loginItemEnabled: false, loginItemNeedsApproval: false, sessionActive: false, runningAsAgent: false, inApplications: false, screenNeedsRelaunch: false },
    },
    screen: { running: false, showing: false, pointerOnLaptop: false, error: '' },
    settings: { scaleOptions: [], scale: 125, matchColors: true, useLaptopInput: true },
    setupDone: false,
  };
  function merge(base, over) {
    if (over === undefined || over === null) return JSON.parse(JSON.stringify(base));
    if (typeof base !== 'object' || base === null || Array.isArray(base)) return over;
    const out = {};
    Object.keys(base).forEach((k) => { out[k] = merge(base[k], over[k]); });
    Object.keys(over).forEach((k) => { if (!(k in base)) out[k] = over[k]; });
    return out;
  }

  let S = merge(DEFAULTS);
  let haveState = false;
  // sent: commands sent on this step; sentAt/sentN: when and how often;
  // marks: per-step timestamps the steps keep for themselves.
  const L = { pos: 0, started: false, checkSeen: false, sizeSaved: false, skipAx: false, skipFind: false, sent: {}, sentAt: {}, sentN: {}, marks: {}, draft: null, enteredAt: Date.now(), since: 0, hold: false, advanceTimer: 0, unreachSince: 0 };
  const steps = D.steps;
  const idx = D.stepIndex;

  function send(msg) {
    if (host) host.postMessage(msg);
    else if (D.mock) D.mock.receive(msg);
  }

  // The user's place survives a reload (the setup app restarts itself from
  // the installed copy after Install). Browser storage only; never required.
  const PLACE = 'usbc-setup-place';
  const placeKeys = ['started', 'checkSeen', 'sizeSaved', 'skipAx'];
  let savedPlace = '';
  function loadPlace() {
    if (!host) return;
    try {
      const p = JSON.parse(localStorage.getItem(PLACE) || 'null');
      if (p) placeKeys.forEach((k) => { L[k] = !!p[k]; });
    } catch (e) { /* storage off: start from the top */ }
  }
  function savePlace() {
    if (!host) return;
    const p = {};
    placeKeys.forEach((k) => { p[k] = L[k]; });
    const j = JSON.stringify(p);
    if (j === savedPlace) return;
    savedPlace = j;
    try { localStorage.setItem(PLACE, j); } catch (e) { /* fine */ }
  }

  // ---------- Navigation ----------
  const applicable = (i) => !steps[i].skip || !steps[i].skip(S, L);
  const needed = (i) => applicable(i) && !steps[i].done(S, L);
  function nextFrom(i) {
    for (let j = i + 1; j < steps.length; j++) if (needed(j)) return j;
    return steps.length - 1;
  }
  function goTo(j) {
    clearTimeout(L.advanceTimer); L.advanceTimer = 0;
    if (j !== L.pos) { L.sent = {}; L.sentAt = {}; L.sentN = {}; L.marks = {}; L.enteredAt = Date.now(); L.since = 0; L.entering = true; }
    L.pos = j;
    render();
  }
  const goNext = () => goTo(nextFrom(L.pos));

  function sendMac(a) {
    L.sent[a] = true;
    L.sentAt[a] = Date.now();
    L.sentN[a] = (L.sentN[a] || 0) + 1;
    send({ cmd: 'macAction', action: a });
  }

  // Move on by itself when the current step is satisfied by the state.
  function autoAdvance() {
    if (L.hold) return;
    const st = steps[L.pos];
    if (!applicable(L.pos)) { goNext(); return; }
    if (st.id === 'screen') {
      const ms = S.mac.status;
      // A new Screen Recording grant needs a new process. Give the Mac's own
      // Quit & Reopen button a few seconds first, then restart it from here.
      if (ms.screenNeedsRelaunch && !L.sent.relaunch && S.mac.reachable) {
        if (!L.marks.needsRelaunch) L.marks.needsRelaunch = Date.now();
        else if (Date.now() - L.marks.needsRelaunch > 8000) sendMac('relaunch');
      }
      // The restarted app answered: back to the normal view (or done).
      if (L.sent.relaunch && S.mac.reachable && !ms.screenNeedsRelaunch && Date.now() - L.sentAt.relaunch > 2500) {
        L.sent.relaunch = false; L.marks.needsRelaunch = 0;
      }
    }
    if (st.done(S, L) && !L.advanceTimer && st.id !== 'done') {
      // Show the success state for a moment, then go on.
      L.advanceTimer = setTimeout(() => {
        L.advanceTimer = 0;
        if (steps[L.pos] === st && st.done(S, L)) goNext();
      }, 1200);
    }
  }

  function onState(msg) {
    if (!msg || msg.type !== 'state') return;
    S = merge(DEFAULTS, msg);
    if (!haveState) {
      haveState = true;
      const pp = D.previewParams || {};
      const forcedStep = params.get('step') || pp.step;
      if (forcedStep && idx(forcedStep) >= 0) {
        const p = idx(forcedStep);
        L.hold = params.get('play') !== '1';
        L.started = p > idx('welcome');
        L.checkSeen = p > idx('check');
        L.sizeSaved = p > idx('size');
        L.pos = p;
        L.since = Number(params.get('since') || pp.since || 0);
        L.enteredAt = Date.now() - L.since * 1000;
        if (!S.mac.reachable) L.unreachSince = L.enteredAt;
      } else {
        loadPlace();
        if (L.started) L.pos = nextFrom(idx('welcome'));
      }
    }
    if (S.mac.reachable) L.unreachSince = 0; else if (!L.unreachSince) L.unreachSince = Date.now();
    autoAdvance();
    render();
  }
  D.receive = onState;
  D.currentStep = () => steps[L.pos].id;
  D.local = L;

  // ---------- Rendering ----------
  const regions = {};
  function setHTML(id, html) {
    if (regions[id] === html) return false;
    regions[id] = html;
    $(id).innerHTML = html;
    return true;
  }

  function stepClass(i) {
    if (i < L.pos) return 'done';
    if (i === L.pos) return 'current';
    return haveState && !applicable(i) ? 'na' : 'todo';
  }

  function rail() {
    const rows = steps.map((st, i) => {
      const cls = stepClass(i);
      const node = cls === 'done' ? '<span class="node">' + D.icon('check') + '</span>' : '<span class="node"></span>';
      const where = st.lane === 'mac' ? 'on your Mac' : 'on this laptop';
      return '<div class="step-row ' + st.lane + ' ' + cls + '" role="listitem" title="' + st.rail + ' (' + where + ')" aria-label="' + st.rail + ', ' + where + (cls === 'done' ? ', done' : '') + '"' + (i === L.pos ? ' aria-current="step"' : '') + '>' + node + '<span class="label">' + st.rail + '</span></div>';
    }).join('');
    return '<div class="legend" aria-hidden="true">' +
      '<div class="lg pc"><span class="sw">' + D.icon('laptop') + '</span>On this laptop</div>' +
      '<div class="lg mac"><span class="sw">' + D.icon('mac') + '</span>On your Mac</div></div>' +
      '<div class="steps" role="list"><i class="track pc"><b></b></i><i class="track mac"><b></b></i>' + rows + '</div>' +
      '<div class="rail-foot">' + D.icon('shield') + '<span>Only over the cable</span></div>';
  }
  // Tracks run from the first step to the last; the filled part shows progress.
  function layoutTracks() {
    const box = $('rail').querySelector('.steps');
    if (!box) return;
    const rows = box.querySelectorAll('.step-row');
    if (!rows.length) return;
    const mid = (r) => r.offsetTop + r.offsetHeight / 2;
    const top = mid(rows[0]), bottom = mid(rows[rows.length - 1]), cur = mid(rows[Math.min(L.pos, rows.length - 1)]);
    box.querySelectorAll('.track').forEach((t) => {
      t.style.top = top + 'px';
      t.style.height = bottom - top + 'px';
      t.firstChild.style.height = cur - top + 'px';
    });
  }

  // Compact layout: a strip of segments, one per step, coloured by machine.
  function strip() {
    return '<span class="strip" aria-hidden="true">' + steps.map((st, i) => '<i class="' + st.lane + ' ' + stepClass(i) + '"></i>').join('') + '</span>';
  }

  function where(lane) {
    const n = '<span class="count">Step ' + (L.pos + 1) + ' of ' + steps.length + '</span>';
    let chip;
    if (lane === 'mac') chip = '<span class="where mac attn">' + D.icon('mac') + 'Look at your Mac' + n + '</span>';
    else if (lane === 'both') chip = '<span class="where both">' + D.icon('laptop') + 'This laptop and your Mac' + n + '</span>';
    else chip = '<span class="where pc">' + D.icon('laptop') + 'On this laptop' + n + '</span>';
    return '<div class="head-row">' + chip + strip() + '</div>';
  }

  // A problem that stops the step: shown in the footer in place of the buttons.
  function alertText() {
    const i = L.pos;
    if (S.setupDone || i >= idx('done') || i < idx('safari')) return '';
    if (!S.link.adapterUp) return '<b>The cable is unplugged.</b> Plug it back in to keep going. Your progress is saved.';
    const id = steps[i].id;
    const restarting = id === 'screen' && (S.mac.status.screenNeedsRelaunch || L.sent.relaunch);
    const t = L.sentAt.moveToApplications;
    const moving = id === 'move' && t && Date.now() - t < 20000;
    if (i > idx('download') && !S.mac.reachable && !restarting && !moving && L.unreachSince && Date.now() - L.unreachSince > 4000) {
      return '<b>Can’t reach USB-C Display on your Mac.</b> Wake and unlock your Mac. If you closed the app, open it again from Applications.';
    }
    return '';
  }

  function button(b, cls) {
    if (!b || b.disabled) return '';
    return '<button class="btn ' + cls + '"' + (b.act ? ' data-act="' + b.act + '"' : '') + '>' + b.label + '</button>';
  }

  let sceneKey = '', sceneAnims = [], sceneNow = null;
  function render() {
    if (!L.draft && haveState) L.draft = { scale: S.settings.scale, matchColors: S.settings.matchColors, useLaptopInput: S.settings.useLaptopInput };
    if (L.draft && S.settings.scaleOptions.length && !S.settings.scaleOptions.some((o) => o.id === L.draft.scale)) {
      const rec = S.settings.scaleOptions.find((o) => o.recommended) || S.settings.scaleOptions[0];
      L.draft.scale = rec.id;
    }
    if (setHTML('rail', rail())) layoutTracks();
    const st = steps[L.pos];
    const v = haveState ? st.render(S, L) : { lane: 'pc', title: 'Getting ready…', lead: '', status: D.h.status('Starting setup…') };
    const content = $('content');
    content.classList.toggle('has-aside', !!v.aside);
    if (L.entering) {
      L.entering = false;
      content.classList.remove('enter'); void content.offsetWidth; content.classList.add('enter');
      content.scrollTop = 0;
    }
    const okBadge = v.ok ? '<span class="ok-badge" aria-label="Done">' + D.icon('check') + '</span>' : '';
    setHTML('r-head', where(v.lane || st.lane) + '<h1 class="title">' + v.title + okBadge + '</h1>' + (v.lead ? '<p class="lead">' + v.lead + '</p>' : ''));
    setHTML('r-top', v.top || '');
    $('r-top').hidden = !v.top;
    setHTML('r-sub', v.sub || '');
    setHTML('r-below', v.below || '');
    setHTML('r-aside', v.aside || '');
    $('r-aside').hidden = !v.aside;
    $('r-sub').hidden = !v.sub;
    $('r-below').hidden = !v.below;

    // Footer: status on the left, then Skip-like actions, Back, primary. A
    // waiting step has no disabled button: the status says what's going on.
    const alert = haveState ? alertText() : '';
    const footer = $('r-footer');
    footer.classList.toggle('alert', !!alert);
    if (alert) {
      setHTML('r-footer', '<div class="status" role="alert"><span class="ic">' + D.icon('bang') + '</span><span class="msg">' + alert + '</span></div>');
    } else {
      const sec = (v.secondary || []).map((b) => button(b, 'subtle')).join('');
      const back = v.back ? '<button class="btn" data-act="back">Back</button>' : '';
      setHTML('r-footer', '<div class="status" role="status">' + (v.status || '') + '</div>' + sec + back + button(v.primary, 'primary'));
    }
    savePlace();

    // Scene: replaced only when its key changes so loops don't restart.
    const stage = $('stage');
    stage.classList.toggle('short', v.stage === 'short');
    stage.classList.toggle('fill', v.stage === 'fill');
    stage.classList.toggle('mid', v.stage === 'mid');
    stage.classList.toggle('crop', !!(v.scene && v.scene.crop));
    stage.hidden = !v.scene;
    const subChanged = regions['r-sub-key'] !== (v.sub || '');
    regions['r-sub-key'] = v.sub || '';
    if (v.scene && (v.scene.key !== sceneKey || subChanged)) {
      sceneKey = v.scene.key;
      sceneNow = v.scene;
      sceneAnims.forEach((a) => a.cancel());
      const sc = $('scene');
      sc.innerHTML = v.scene.html;
      // The machine label sits on the stage itself, unscaled.
      stage.querySelectorAll(':scope > .mlabel').forEach((el) => el.remove());
      const lbl = sc.querySelector('.mlabel');
      if (lbl) stage.appendChild(lbl);
      stage.classList.toggle('labelled', !!lbl);
      fit();
      sceneAnims = D.playScene(sc, v.scene.tl);
      freeze(v.scene);
    }
    if (!v.scene) sceneKey = '';
    overflow();
  }

  // Hold the loop at one frame: for screenshots (?f=0.5) or reduced motion.
  function freeze(scene) {
    const f = params.get('f');
    let frac = null;
    if (f !== null) frac = Number(f);
    else if (reduced.matches || params.get('shot')) frac = scene.poster;
    if (frac === null) return;
    const dur = (scene.tl && scene.tl.dur) || 1000;
    sceneAnims.forEach((a) => { a.pause(); a.currentTime = frac * dur + (a._shift || 0); });
  }
  if (reduced.addEventListener) reduced.addEventListener('change', () => { sceneKey = ''; render(); });

  // Scale the 400 x 250 canvas into the stage, leaving room at the top for
  // the machine label.
  function fit() {
    const stage = $('stage');
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const top = stage.classList.contains('labelled') ? 36 : 0;
    const k = Math.min((w - 8) / 400, (h - top - 6) / 250);
    const wrap = stage.querySelector('.scene-wrap');
    wrap.style.setProperty('--k', k.toFixed(4));
    wrap.style.top = (top + (h - top) / 2) + 'px';
  }

  // A soft fade at the bottom edge when there's more to scroll to.
  function overflow() {
    const c = $('content');
    c.classList.toggle('more', c.scrollHeight - c.scrollTop - c.clientHeight > 4);
  }
  $('content').addEventListener('scroll', overflow, { passive: true });

  // ---------- Actions ----------
  const actions = {
    start() { L.started = true; goNext(); },
    next() { goNext(); },
    back() {
      if (steps[L.pos].id === 'check') { L.started = false; goTo(idx('welcome')); }
    },
    install() {
      L.checkSeen = true;
      if (S.laptop.installed) { goNext(); return; }
      if (steps[L.pos].id !== 'install') goTo(idx('install'));
      L.sent.install = true;
      send({ cmd: 'install' });
      render();
    },
    elevate() { L.sent.elevate = true; send({ cmd: 'elevate' }); render(); },
    skipAx() {
      L.skipAx = true;
      if (L.draft) L.draft.useLaptopInput = false;
      send({ cmd: 'saveSettings', scale: (L.draft || S.settings).scale, matchColors: (L.draft || S.settings).matchColors, useLaptopInput: false });
      goNext();
    },
    skipFind() { L.skipFind = true; goNext(); },
    // Jump the picture's loop to one sub-step.
    seek(el) {
      const tl = sceneNow && sceneNow.tl;
      const ch = tl && tl.chips && tl.chips[Number(el.dataset.i)];
      if (!ch) return;
      const t = Math.min(ch[1] - 0.01, ch[0] + 0.015) * tl.dur;
      sceneAnims.forEach((a) => { a.currentTime = t + (a._shift || 0); });
    },
    scale(el) { L.draft.scale = Number(el.dataset.id); render(); },
    toggle(el) { const k = el.dataset.key; L.draft[k] = !L.draft[k]; render(); },
    save() {
      const d = L.draft;
      send({ cmd: 'saveSettings', scale: d.scale, matchColors: !!d.matchColors, useLaptopInput: !!(S.mac.status.axOk && d.useLaptopInput) });
      L.sizeSaved = true;
      goNext();
    },
    startScreen() { L.sent.startScreen = true; send({ cmd: 'startScreen' }); render(); },
    finish() { send({ cmd: 'finish' }); },
    close() { send({ cmd: 'close' }); },
    minimize() { send({ cmd: 'minimize' }); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act.startsWith('mac:')) { sendMac(act.slice(4)); render(); return; }
    if (actions[act]) actions[act](el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target === document.body || e.target === document.documentElement)) {
      const p = document.querySelector('.footer .btn.primary');
      if (p) p.click();
    }
  });

  // Seconds on the current step, for the "taking a while" cards.
  setInterval(() => {
    if (L.hold) return;
    L.since = Math.floor((Date.now() - L.enteredAt) / 1000);
    if (haveState) { autoAdvance(); render(); }
  }, 1000);

  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe($('stage'));
    new ResizeObserver(() => { layoutTracks(); overflow(); }).observe($('app'));
  }

  // ---------- Boot ----------
  render();
  if (host) {
    host.addEventListener('message', (e) => onState(e.data));
    send({ cmd: 'ready' });
  } else {
    root.classList.add('preview');
    const s = document.createElement('script');
    s.src = '../preview/mock.js';
    s.onload = () => send({ cmd: 'ready' });
    document.body.appendChild(s);
  }
})();
