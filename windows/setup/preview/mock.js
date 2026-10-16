// Preview harness: a stand-in for the setup app when the wizard runs in a
// normal browser. ui/index.html?scenario=<name>&step=<id> renders any step
// in any state. Without step=, it plays the scenario and reacts to clicks
// like the real app would, so the whole flow can be clicked through.
(function () {
  'use strict';
  const D = window.USBC;
  const params = new URLSearchParams(location.search);

  function base() {
    return {
      type: 'state',
      laptop: { windowsBuild: 26100, arch: 'arm64', isAdminUser: true, usb4: 'unknown', installed: false, elevation: 'none', firewallOk: false, recoveryTasksOk: false },
      link: { adapterUp: false, adapterName: '', secondsSincePlug: 0, macFound: false, macV6: '', macV4: '', laptopV4: '' },
      server: { running: false, url: 'http://usbc.local', fallbackUrl: 'http://169.254.29.64', urlReady: false, pageVisited: false, download: { sent: 0, size: 0, done: false }, appNotarized: true },
      mac: {
        reachable: false, outdated: false, appVersion: '', macOS: '',
        status: { screenOk: false, axOk: false, screenPrompted: false, axPrompted: false, loginItemEnabled: false, loginItemNeedsApproval: false, sessionActive: false, runningAsAgent: false, inApplications: false, screenNeedsRelaunch: false },
      },
      screen: { running: false, showing: false, pointerOnLaptop: false },
      settings: {
        scaleOptions: [
          { id: 125, label: 'Same size as a MacBook', detail: 'Text looks as big as on a Mac laptop', recommended: true },
          { id: 150, label: 'Larger text', detail: 'The size Windows uses on this screen', recommended: false },
          { id: 100, label: 'More space', detail: 'More fits, but text is small', recommended: false },
        ],
        scale: 125, matchColors: true, useLaptopInput: true,
      },
      setupDone: false,
    };
  }

  // State as it looks when the user has just reached each step.
  const ORDER = D.steps.map((s) => s.id);
  function stateAt(step) {
    const s = base();
    const at = (id) => ORDER.indexOf(step) > ORDER.indexOf(id);
    if (at('welcome')) s.laptop.usb4 = 'ok';
    if (at('check')) { /* install pending */ }
    if (at('install')) s.laptop.installed = true;
    if (at('approve')) { s.laptop.elevation = 'done'; s.laptop.firewallOk = true; s.laptop.recoveryTasksOk = true; s.server.running = true; }
    if (at('plug')) { s.link.adapterUp = true; s.link.adapterName = 'USB4 P2P Network Adapter'; s.link.secondsSincePlug = 8; }
    if (at('connect')) { s.link.macFound = true; s.link.macV6 = 'fe80::1'; s.link.macV4 = '169.254.10.2'; s.link.laptopV4 = '169.254.29.64'; s.server.urlReady = true; s.link.secondsSincePlug = 24; }
    if (at('safari')) s.server.pageVisited = true;
    if (at('download')) { s.server.download = { sent: 8388608, size: 8388608, done: true }; s.mac.reachable = true; s.mac.appVersion = '1.0'; s.mac.macOS = '27.0.1'; s.mac.status.runningAsAgent = false; }
    if (at('move')) { s.mac.status.inApplications = true; }
    if (at('login')) { s.mac.status.loginItemEnabled = true; s.mac.status.runningAsAgent = true; }
    if (at('screen')) { s.mac.status.screenOk = true; s.mac.status.screenPrompted = true; }
    if (at('access')) { s.mac.status.axOk = true; s.mac.status.axPrompted = true; }
    if (at('picture')) { s.screen.running = true; s.screen.showing = true; s.mac.status.sessionActive = true; }
    if (at('find')) s.screen.pointerOnLaptop = true;
    if (step === 'done') s.setupDone = false;
    return s;
  }

  // Named scenarios: a step plus a change to its state. Every failure and
  // branch card has one.
  const SC = {
    'default': { },
    'usb4-checking': { step: 'check', f: (s) => { s.laptop.usb4 = 'unknown'; } },
    'usb4-ok': { step: 'check', f: (s) => { s.laptop.usb4 = 'ok'; } },
    'usb4-missing': { step: 'check', f: (s) => { s.laptop.usb4 = 'missing'; } },
    'installing': { step: 'install', sent: 'install' },
    'install-error': { step: 'install', sent: 'install', f: (s) => { s.laptop.installError = 'Windows said the folder is in use.'; } },
    'elevation-none': { step: 'approve' },
    'not-admin': { step: 'approve', f: (s) => { s.laptop.isAdminUser = false; } },
    'elevation-pending': { step: 'approve', f: (s) => { s.laptop.elevation = 'pending'; } },
    'elevation-refused': { step: 'approve', f: (s) => { s.laptop.elevation = 'refused'; } },
    'elevation-failed': { step: 'approve', f: (s) => { s.laptop.elevation = 'failed'; } },
    'elevation-tasks-failed': { step: 'approve', f: (s) => { s.laptop.elevation = 'failed'; s.laptop.firewallOk = true; } },
    'waiting-cable': { step: 'plug' },
    'slow-plug': { step: 'plug', since: 45 },
    'connecting': { step: 'connect', f: (s) => { s.link.secondsSincePlug = 12; } },
    'slow-link': { step: 'connect', f: (s) => { s.link.secondsSincePlug = 52; } },
    'mac-found': { step: 'connect', f: (s) => { s.link.macFound = true; } },
    'url-not-ready': { step: 'safari', f: (s) => { s.server.urlReady = false; } },
    'safari': { step: 'safari' },
    'safari-fallback-hint': { step: 'safari', since: 50 },
    'safari-fallback': { step: 'safari', f: (s) => { s.server.url = s.server.fallbackUrl; s.server.usingFallback = true; } },
    'server-stuck': { step: 'safari', since: 25, f: (s) => { s.server.running = false; s.server.urlReady = false; } },
    'mac-outdated': { step: 'safari', f: (s) => { s.mac.reachable = true; s.mac.outdated = true; s.mac.appVersion = '0.9'; } },
    'download-wait': { step: 'download' },
    'downloading': { step: 'download', f: (s) => { s.server.download = { sent: 3355443, size: 8388608, done: false }; } },
    'notarized': { step: 'download', f: (s) => { s.server.download = { sent: 8388608, size: 8388608, done: true }; s.server.appNotarized = true; } },
    'not-notarized': { step: 'download', f: (s) => { s.server.download = { sent: 8388608, size: 8388608, done: true }; s.server.appNotarized = false; } },
    'not-notarized-late': { step: 'download', since: 70, f: (s) => { s.server.download = { sent: 8388608, size: 8388608, done: true }; s.server.appNotarized = false; } },
    'download-outdated': { step: 'download', f: (s) => { s.server.download = { sent: 8388608, size: 8388608, done: true }; s.server.appNotarized = true; s.mac.reachable = true; s.mac.outdated = true; } },
    'move': { step: 'move' },
    'moving': { step: 'move', sent: 'moveToApplications' },
    'move-failed': { step: 'move', sent: 'moveToApplications', sentAgo: 25 },
    'login': { step: 'login' },
    'login-disabled': { step: 'login', f: (s) => { s.mac.status.loginItemNeedsApproval = true; } },
    'login-disabled-sent': { step: 'login', sent: 'loginItems', f: (s) => { s.mac.status.loginItemNeedsApproval = true; } },
    'screen': { step: 'screen' },
    'screen-asked': { step: 'screen', f: (s) => { s.mac.status.screenPrompted = true; } },
    'screen-sent': { step: 'screen', sent: 'screen' },
    'screen-relaunch': { step: 'screen', f: (s) => { s.mac.status.screenPrompted = true; s.mac.status.screenNeedsRelaunch = true; } },
    'relaunch-late': { step: 'screen', sent: 'relaunch', sentAgo: 30, f: (s) => { s.mac.status.screenPrompted = true; s.mac.status.screenNeedsRelaunch = true; } },
    'access': { step: 'access' },
    'access-sent': { step: 'access', sent: 'accessibility', f: (s) => { s.mac.status.axPrompted = true; } },
    'size': { step: 'size' },
    'size-no-ax': { step: 'size', f: (s) => { s.mac.status.axOk = false; } },
    'picture': { step: 'picture', f: (s) => { s.screen.running = false; s.screen.showing = false; } },
    'picture-starting': { step: 'picture', sent: 'startScreen', f: (s) => { s.screen.running = true; } },
    'picture-error': { step: 'picture', f: (s) => { s.screen.error = 'The screen part of USB-C Display isn’t installed yet.'; } },
    'find-showing': { step: 'find', f: (s) => { s.screen.running = true; s.screen.showing = true; } },
    'find': { step: 'find' },
    'find-back': { step: 'find', f: (s) => { s.screen.running = false; s.screen.showing = false; } },
    'unplugged': { step: 'screen', f: (s) => { s.link.adapterUp = false; s.link.macFound = false; s.mac.reachable = false; } },
    'mac-asleep': { step: 'access', since: 10, f: (s) => { s.mac.reachable = false; } },
    'done': { step: 'done' },
    // Played from the start: this laptop and the Mac were set up before.
    'returning': { init: (s) => { s.laptop.installed = true; s.laptop.elevation = 'done'; s.laptop.firewallOk = s.laptop.recoveryTasksOk = true; } },
  };
  D.previewScenarios = SC;

  const name = params.get('scenario') || 'default';
  const sc = SC[name] || SC.default;
  const step = params.get('step') || sc.step || null;
  let state;
  if (step) {
    state = stateAt(step);
    // Steps before the current one are done; the current step is waiting.
    if (step === 'picture') { state.screen.running = false; state.screen.showing = false; }
    if (sc.f) sc.f(state);
  } else {
    state = base();
    if (sc.init) sc.init(state);
  }
  D.previewParams = { step: step, since: params.get('since') || sc.since || 0 };

  const push = () => D.receive(JSON.parse(JSON.stringify(state)));
  const later = (ms, fn) => setTimeout(() => { fn(); push(); }, ms);
  const playing = !step || params.get('play') === '1';

  D.mock = {
    receive(cmd) {
      if (cmd.cmd === 'ready') {
        push();
        if (sc.sent) {
          const L = D.local;
          L.sent[sc.sent] = true;
          L.sentAt[sc.sent] = Date.now() - (sc.sentAgo || 1) * 1000;
          L.sentN[sc.sent] = 1;
          push();
        }
        return;
      }
      if (!playing) return;
      const s = state;
      switch (cmd.cmd) {
        case 'install': later(1800, () => { s.laptop.installed = true; }); break;
        case 'elevate':
          s.laptop.elevation = 'pending'; push();
          later(2500, () => { s.laptop.elevation = 'done'; s.laptop.firewallOk = s.laptop.recoveryTasksOk = true; s.server.running = true; });
          break;
        case 'macAction':
          if (cmd.action === 'moveToApplications') { s.mac.reachable = false; push(); later(2500, () => { s.mac.reachable = true; s.mac.status.inApplications = true; }); }
          if (cmd.action === 'loginItems') later(2500, () => { s.mac.status.loginItemNeedsApproval = false; s.mac.status.loginItemEnabled = true; });
          if (cmd.action === 'screen') { s.mac.status.screenPrompted = true; push(); later(4000, () => { s.mac.status.screenNeedsRelaunch = true; }); }
          if (cmd.action === 'relaunch') { later(800, () => { s.mac.reachable = false; }); later(4000, () => { s.mac.reachable = true; s.mac.status.screenNeedsRelaunch = false; s.mac.status.screenOk = true; }); }
          if (cmd.action === 'accessibility') { s.mac.status.axPrompted = true; push(); later(3500, () => { s.mac.status.axOk = true; }); }
          break;
        case 'startScreen': s.screen.running = true; push(); later(2500, () => { s.screen.showing = true; }); break;
        case 'finish': s.setupDone = true; push(); break;
        default: break;
      }
    },
  };

  // When playing, the "world" moves on by itself: the laptop check, the
  // cable, the Mac finding the page, the download, and the login item.
  if (playing) {
    let ticks = 0, last = '';
    setInterval(() => {
      const cur = D.currentStep();
      if (cur !== last) { ticks = 0; last = cur; }
      ticks++;
      const s = state;
      let changed = true;
      if (cur === 'check' && s.laptop.usb4 === 'unknown' && ticks > 2) s.laptop.usb4 = 'ok';
      else if (cur === 'plug' && !s.link.adapterUp && ticks > 4) { s.link.adapterUp = true; s.link.secondsSincePlug = 5; }
      else if (cur === 'connect' && !s.link.macFound && ticks > 4) {
        s.link.macFound = true; s.server.urlReady = true;
        if (name === 'returning') {
          s.mac.reachable = true;
          Object.assign(s.mac.status, { screenOk: true, axOk: true, loginItemEnabled: true, runningAsAgent: true, inApplications: true });
        }
      }
      else if (cur === 'safari' && !s.server.urlReady) s.server.urlReady = true;
      else if (cur === 'safari' && ticks > 6) s.server.pageVisited = true;
      else if (cur === 'download' && ticks > 3 && !s.server.download.done) {
        const size = 8388608;
        s.server.download.size = size;
        s.server.download.sent = Math.min(size, s.server.download.sent + 2097152);
        s.server.download.done = s.server.download.sent >= size;
      } else if (cur === 'download' && s.server.download.done && ticks > 12) s.mac.reachable = true;
      else if (cur === 'login' && ticks > 5 && !s.mac.status.loginItemNeedsApproval) { s.mac.status.loginItemEnabled = true; s.mac.status.runningAsAgent = true; }
      else if (cur === 'find' && ticks > 5) s.screen.pointerOnLaptop = true;
      else changed = false;
      if (changed) push();
    }, 1000);
  }
})();

// ?autoplay=1 clicks the primary button whenever it is enabled, to run the
// whole flow end to end in a headless browser.
(function () {
  const p = new URLSearchParams(location.search);
  if (p.get('autoplay') !== '1') return;
  const seen = [];
  setInterval(() => {
    const cur = window.USBC.currentStep();
    if (seen[seen.length - 1] !== cur) { seen.push(cur); console.log('step ' + cur); }
    const b = document.querySelector('.footer .btn.primary:not([disabled])');
    if (b && cur !== 'done') b.click();
  }, 1500);
})();
