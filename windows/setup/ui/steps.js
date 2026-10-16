// The steps of setup. Each step is a function of the state snapshot
// (CONTRACT.md section 2) and the local place L. Copy is plain and short.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});
  const I = (n) => D.icon(n);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Small builders ----------
  const h = {
    why(o) {
      return '<section class="card why" aria-label="Why we ask"><div class="why-head">' + I('shield') + 'Why we ask</div><dl>' +
        '<dt>What it allows</dt><dd>' + o.allows + '</dd>' +
        '<dt>Why it’s needed</dt><dd>' + o.why + '</dd>' +
        '<dt>Without it</dt><dd class="without">' + o.without + '</dd></dl>' +
        (o.never ? '<div class="never"><div class="nv-head">What we never do</div><ul class="list shield">' + o.never.map((n) => '<li>' + I('check') + '<span>' + n + '</span></li>').join('') + '</ul></div>' : '') +
        '</section>';
    },
    info(kind, html) {
      const g = { info: 'bang', caution: 'bang', critical: 'x', success: 'check' }[kind];
      return '<div class="infobar ' + kind + '" role="status"><span class="ic">' + I(g) + '</span><p>' + html + '</p></div>';
    },
    card(title, icon, body, cls) {
      return '<section class="card ' + (cls || '') + '"><h3>' + (icon ? I(icon) : '') + title + '</h3>' + body + '</section>';
    },
    list(items, cls) {
      return '<ul class="list ' + (cls || '') + '">' + items.map((i) => '<li>' + I(i[0]) + '<span>' + i[1] + '</span></li>').join('') + '</ul>';
    },
    help(items) {
      return '<div class="help">' + items.map((it, i) => '<div class="card"><span class="num">' + (i + 1) + '</span><div><b>' + it[0] + '</b><span>' + it[1] + '</span></div></div>').join('') + '</div>';
    },
    // Prompts the Mac shows only sometimes: what it says, and what to click.
    ifAsks(items) {
      return '<section class="card asks"><h3>' + I('mac') + 'Only if your Mac asks</h3>' +
        items.map((it) => '<p class="ask"><b>' + it[0] + '</b> ' + it[1] + '</p>').join('') + '</section>';
    },
    // Sub-steps: numbered dots in the corner of the picture, and one
    // caption at a time, in step with the picture's loop. Clicking a dot
    // replays that part.
    subs(items) {
      const plain = (t) => String(t).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
      return '<div class="subs">' + items.map((it, i) => '<button class="sub" data-act="seek" data-i="' + i + '" title="' + esc(plain(it[0])) + '" aria-label="Step ' + (i + 1) + ': ' + esc(plain(it[1])) + '"><span class="n">' + (i + 1) + '</span><i class="hl">' + (i + 1) + '</i></button>').join('<i class="ln"></i>') + '</div>' +
        '<div class="sub-caps" aria-live="polite">' + items.map((it, i) => '<p class="sc"><span class="n">' + (i + 1) + '</span><span>' + it[1] + '</span></p>').join('') + '</div>';
    },
    note(html) { return '<p class="note">' + html + '</p>'; },
    spin(big) {
      return '<svg class="spinner' + (big ? ' big' : '') + '" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/></svg>';
    },
    status(text) { return h.spin() + '<span>' + text + '</span>'; },
    statusDone(text) { return '<span class="ok-ic">' + I('check') + '</span><span>' + text + '</span>'; },
    keys(list) { return '<span class="keys">' + list.map((k) => '<span class="key">' + k + '</span>').join('<span class="plus">+</span>') + '</span>'; },
    kbd(list) { return list.map((k) => '<span class="kbd">' + k + '</span>').join(' + '); },
  };
  D.h = h;

  const NEVER_DATA = 'No data leaves your two computers.';
  const FIREWALL_ASK = ['Accept incoming network connections?', 'Click <b>Allow</b>. It only listens on the cable.'];
  // Only on accounts that can't add apps to Applications by themselves.
  const MOVE_ASK = ['USB-C Display wants to make changes', 'Type your Mac’s <b>password</b> and click <b>OK</b>. It needs it once, to put itself in Applications.'];

  const hostOf = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1);
  const macNeedsApp = (s) => !(s.mac.reachable && !s.mac.outdated);
  const secs = (t) => (t ? (Date.now() - t) / 1000 : 0);
  // When something first happened on this step (cleared when the step changes).
  const mark = (L, k, cond) => { if (cond && !L.marks[k]) L.marks[k] = Date.now(); return cond ? secs(L.marks[k]) : 0; };
  // A picture of what's on the Mac's screen right now (macos.js), in the Mac's own appearance once
  // its app has said (Mac app 4 and later), until then in this laptop's.
  const macScene = (s, name, fallback) => (D.scenes.mac
    ? D.scenes.mac(name, {
      dark: s.mac.appearance ? s.mac.appearance === 'dark' : document.documentElement.dataset.theme === 'dark',
      accent: s.mac.accent || 'blue', host: hostOf(s.server.url) || 'usbc.local', appName: 'USB-C Display',
    })
    : fallback());
  // Live, so it reads as watching the Mac rather than waiting on it.
  const FOLLOWING = h.status('Following your Mac…');
  const SHOWING = h.statusDone('Your Mac’s screen is showing on this laptop');

  // ---------- Steps ----------
  const steps = [];
  const add = (o) => steps.push(o);

  add({
    id: 'welcome', lane: 'pc', rail: 'Welcome',
    done: (s, L) => L.started,
    render() {
      return {
        lane: 'both',
        scene: D.scenes.hero(''),
        title: 'Use this laptop as a second screen for your Mac',
        lead: 'We’ll set it up together, one small step at a time. This laptop shows you what to do, and tells you when to look at your Mac.',
        aside: h.card('What you’ll need', '', '<div class="needs">' +
          [['cable', 'A fast USB-C cable', 'Thunderbolt or USB4. Look for a lightning bolt or 40 on the plug.'],
            ['plug', 'Both chargers', 'Keep both computers plugged in.'],
            ['key', 'Your Mac’s password', 'The one you sign in with. Not the Mac’s owner? Have them nearby.'],
            ['clock', 'About 5 minutes', 'You can stop and come back.']]
            .map((n) => '<div class="item"><span class="ico">' + I(n[0]) + '</span><div><b>' + n[1] + '</b><span>' + n[2] + '</span></div></div>').join('') + '</div>') +
          h.card('Private by design', 'shield', '<p>Your Mac and this laptop talk only through the cable. Nothing goes to the internet.</p>'),
        primary: { label: 'Start', act: 'start' },
      };
    },
  });

  add({
    id: 'check', lane: 'pc', rail: 'Check this laptop',
    done: (s, L) => L.checkSeen && s.laptop.usb4 === 'ok',
    render(s, L) {
      const u = s.laptop.usb4;
      const win11 = s.laptop.windowsBuild >= 22000;
      const row = (st, name, val) => '<div class="check-row"><span class="st ' + st + '">' + (st === 'wait' ? h.spin() : I(st === 'ok' ? 'check' : st === 'bad' ? 'x' : 'info')) + '</span><span class="name">' + name + '</span><span class="val">' + (val || '') + '</span></div>';
      const checks = '<section class="card checks">' +
        row(u === 'ok' ? 'ok' : u === 'missing' ? 'bad' : 'wait', 'A fast USB-C port', u === 'ok' ? 'Found' : u === 'missing' ? 'Not found' : 'Looking…') +
        row(win11 ? 'ok' : 'bad', 'Windows 11', win11 ? 'Found' : 'Needed') +
        row(s.laptop.isAdminUser ? 'ok' : 'info', s.laptop.isAdminUser ? 'You can approve changes' : 'An administrator approves one change', '') +
        '</section>';
      if (u === 'missing') {
        return {
          lane: 'pc', stage: 'short', scene: D.scenes.check('missing'),
          title: 'This laptop can’t be a screen for your Mac',
          lead: 'It doesn’t have the fast USB-C port that carries the picture. A setting or a different cable can’t fix that, sorry.',
          below: checks,
          aside: h.card('Nothing was changed', 'shield', '<p>Nothing was installed and no settings were touched. You can delete the file you downloaded.</p>') +
            h.card('Good to know', 'info', '<p>USB-C Display needs a laptop with a USB4 or Thunderbolt port. These ports often have a small lightning bolt or the number 40 next to them.</p>'),
          primary: { label: 'Close', act: 'close' },
        };
      }
      if (u !== 'ok') {
        return {
          lane: 'pc', stage: 'short', scene: D.scenes.check('scan'),
          title: 'Checking this laptop',
          lead: 'Looking for a fast USB-C port. This takes a few seconds.',
          below: checks,
          aside: h.card('Just looking', 'shield', '<p>This check only reads this laptop’s list of parts. Nothing is installed yet.</p>'),
          status: h.status('Checking…'),
          back: true,
          secondary: L.since > 15 ? [{ label: 'Continue anyway', act: 'install' }] : [],
        };
      }
      return {
        lane: 'pc', stage: 'short', scene: D.scenes.check('ok'),
        title: 'This laptop can do it', ok: true,
        lead: 'It has the fast USB-C port that USB-C Display needs. Next, we install it on this laptop. Windows won’t ask anything yet.',
        below: checks,
        aside: h.card('What gets installed', 'laptop', h.list([
          ['check', 'The USB-C Display app, just for your account'],
          ['check', 'A Start menu shortcut'],
          ['check', 'It starts when you sign in, so it’s ready when you plug in'],
          ['undo', 'Remove it anytime in <b>Settings › Apps › Installed apps</b>'],
        ])),
        back: true,
        primary: { label: 'Install on this laptop', act: 'install' },
      };
    },
  });

  add({
    id: 'install', lane: 'pc', rail: 'Install',
    done: (s) => s.laptop.installed,
    render(s, L) {
      const aside = h.card('What gets installed', 'laptop', h.list([
        ['check', 'The app, in your own user folder'],
        ['check', 'A Start menu shortcut'],
        ['check', 'An entry in Settings, so you can remove it'],
        ['undo', 'Remove it anytime in <b>Settings › Apps › Installed apps</b>'],
      ]));
      if (s.laptop.installed) {
        return { lane: 'pc', scene: D.scenes.install(), title: 'Installed on this laptop', ok: true, lead: 'All the files are in place.', aside, primary: { label: 'Next', act: 'next' } };
      }
      const err = s.laptop.installError;
      const busy = (L.sent.install || s.laptop.installing) && !err;
      return {
        lane: 'pc', scene: D.scenes.install(),
        title: err ? 'That didn’t install' : 'Installing on this laptop',
        lead: 'Copying USB-C Display to this laptop. It installs just for you, so nothing needs approval here.',
        below: err ? h.info('critical', '<b>Something stopped the install.</b> ' + esc(err) + ' Nothing was left half done.')
          : busy ? '<div class="progress-row"><div class="progress indet"><i></i></div></div>' : '',
        aside,
        status: busy ? h.status('Installing…') : '',
        primary: busy ? null : { label: err ? 'Try again' : 'Install', act: 'install' },
      };
    },
  });

  const WHY_ELEVATE = h.why({
    allows: 'Your Mac can fetch its app from this laptop, through the cable. And if the cable connection ever freezes, this laptop can fix it by itself.',
    why: 'Windows blocks other devices from reaching this laptop. This opens one small door, only on the cable.',
    without: 'Your Mac can’t get its app, so setup can’t finish.',
    never: ['Only the cable. Wi-Fi and the internet stay closed.', NEVER_DATA, 'Uninstalling removes it all.'],
  });
  add({
    id: 'approve', lane: 'pc', rail: 'One approval',
    done: (s) => s.laptop.elevation === 'done',
    render(s) {
      const e = s.laptop.elevation;
      const admin = s.laptop.isAdminUser;
      const unknown = D.SIGNED ? '' : ' Windows will say the publisher is <b>Unknown</b>. That’s expected for this app.';
      const v = {
        lane: 'pc', scene: D.scenes.uac(!admin),
        title: 'One approval on this laptop',
        lead: admin
          ? 'Windows will ask if USB-C Display Setup can make changes. Click <b>Yes</b>. This is the only time this laptop asks.' + unknown
          : 'Windows will ask for an administrator’s name and password. Ask the person who looks after this laptop to type them, then click <b>Yes</b>.' + unknown,
        aside: WHY_ELEVATE,
        primary: { label: 'Continue', act: 'elevate' },
        status: admin ? '<span>Then click <b>Yes</b> in the Windows box.</span>' : '<span>Then an administrator signs in and clicks <b>Yes</b>.</span>',
      };
      const notes = [];
      if (e === 'pending') {
        v.status = h.status(admin ? 'Waiting for you to click Yes…' : 'Waiting for an administrator…');
        v.primary = null;
        notes.push(h.info('info', 'Can’t see it? Look for a blinking shield icon on the taskbar at the bottom of the screen.'));
      } else if (e === 'refused') {
        v.title = 'Windows needs a Yes to continue';
        notes.push(h.info('caution', '<b>Windows got a No, so nothing changed.</b> Without this approval your Mac can’t get its app. Click Try again, then Yes.'));
        v.primary = { label: 'Try again', act: 'elevate' };
        v.status = '';
      } else if (e === 'failed' && s.laptop.firewallOk) {
        // The Mac's way in is open; only the automatic cable fix is missing.
        v.title = 'Approved'; v.ok = true; v.lead = 'Thanks. This laptop won’t ask again.';
        notes.push(h.info('caution', '<b>Your Mac can get its app.</b> One extra part didn’t install: the one that fixes a frozen cable connection by itself. You can go on, or try again.'));
        v.primary = { label: 'Next', act: 'next' };
        v.secondary = [{ label: 'Try again', act: 'elevate' }];
        v.status = '';
      } else if (e === 'failed') {
        v.title = 'That didn’t work';
        notes.push(h.info('critical', '<b>Windows didn’t finish the changes.</b> Please try once more.'));
        v.primary = { label: 'Try again', act: 'elevate' };
        v.status = '';
      } else if (e === 'done') {
        v.title = 'Approved'; v.ok = true; v.lead = 'Thanks. This laptop won’t ask again.';
        v.primary = { label: 'Next', act: 'next' }; v.status = '';
      }
      v.below = notes.join('');
      if (notes.length) v.stage = 'short';
      return v;
    },
  });

  const ACCESSORY_FIX = 'Clicked <b>Don’t Allow</b> by mistake? On your Mac, open <b>System Settings › Privacy &amp; Security</b>, set <b>Allow accessories to connect</b> to <b>Ask for new accessories</b>, then plug the cable in again.';
  add({
    id: 'plug', lane: 'pc', rail: 'Plug in the cable',
    done: (s) => s.link.adapterUp,
    render(s, L) {
      // The host can't time a plug before the cable's adapter appears, so
      // this step counts from when it was opened.
      const up = s.link.adapterUp;
      const slow = !up && L.since >= 40;
      const v = {
        lane: 'both', scene: D.scenes.plug(),
        title: up ? 'Cable connected' : 'Plug in the cable', ok: up,
        lead: 'Connect your Mac and this laptop with the cable. Plug both computers into their chargers too, so the connection stays steady.',
        aside: h.card('Which cable and port', 'cable', h.list([
          ['check', 'A <b>Thunderbolt or USB4</b> cable. A phone charging cable usually only charges.'],
          ['check', 'A <b>fast port</b>. Look for a small lightning bolt or the number 40 next to it.'],
        ])) + h.card('On your Mac', 'mac', '<p>Unlock your Mac. If it asks <b>Allow accessory to connect?</b>, click <b>Allow</b>.</p><p>Clicked Don’t Allow? Unplug the cable and plug it in again.</p>', 'mac-card'),
        status: up ? '' : h.status('Waiting for the cable…'),
        primary: up ? { label: 'Next', act: 'next' } : null,
      };
      if (slow) {
        v.title = 'Still waiting for the cable';
        v.lead = 'Plugged in already, but nothing yet? Try these, one at a time.';
        v.aside = h.help([
          ['Look at your Mac', 'Unlock it. If it asks about an accessory, click Allow.'],
          ['Try the other USB-C port', 'Only some ports are fast enough. Look for a lightning bolt or 40.'],
          ['Try a different cable', 'Some cables only charge and can’t carry a picture.'],
        ]) + h.note(ACCESSORY_FIX);
      }
      return v;
    },
  });

  add({
    id: 'connect', lane: 'pc', rail: 'Find each other',
    done: (s) => s.link.macFound,
    render(s, L) {
      const found = s.link.macFound;
      const slow = !found && Math.max(s.link.secondsSincePlug, L.since) >= 40;
      const v = {
        lane: 'both', scene: D.scenes.connect(found),
        title: found ? 'Found your Mac' : 'Your Mac and this laptop are finding each other', ok: found,
        lead: found
          ? (s.mac.reachable && !s.mac.outdated ? 'USB-C Display is already on your Mac. We’ll skip ahead.' : 'Next, your Mac gets its app from this laptop.')
          : 'This can take up to 30 seconds. You don’t need to do anything.',
        aside: h.card('How they talk', 'cable', '<p>Straight through the cable, like a private network of just two computers. No Wi-Fi and no internet.</p>'),
        status: found ? '' : h.status('Connecting…'),
        primary: found ? { label: 'Next', act: 'next' } : null,
      };
      if (slow) {
        v.title = 'This is taking longer than usual';
        v.lead = 'The cable is connected, but your Mac hasn’t answered yet. Try these, one at a time.';
        v.aside = h.help([
          ['Look at your Mac', 'Unlock it, and click Allow if it asks about an accessory.'],
          ['Plug it in again', 'Unplug the cable, wait 5 seconds, and plug it back in. Still nothing? Restart your Mac.'],
          ['Pause VPN or security apps', 'On your Mac, quit VPN, firewall or ad blocking apps for now.'],
          ['Check the cable network', 'On your Mac, in System Settings › Network, Thunderbolt Bridge should look connected.'],
        ]);
      }
      return v;
    },
  });

  add({
    id: 'safari', lane: 'mac', rail: 'Open Safari',
    skip: (s) => !macNeedsApp(s),
    done: (s) => s.server.pageVisited,
    render(s, L) {
      const url = s.server.url || s.server.fallbackUrl;
      const host = hostOf(url);
      const ready = s.server.urlReady && host;
      const outdated = s.mac.outdated;
      // The cable's IPv4 address only as a second try: a Mac on Wi-Fi often sends it out over Wi-Fi.
      const alt = ready && s.server.fallbackUrl && hostOf(s.server.fallbackUrl) !== host && L.since > 45;
      const stuck = !s.server.running && L.since > 20;
      const scheme = (u) => { const m = /^(https?:\/\/)?(.*)$/.exec(String(u)); return '<span class="sch">' + esc(m[1] || 'http://') + '</span>' + esc(m[2].replace(/\/$/, '')); };
      const box = ready
        ? '<div class="urlbox"><span class="cap">' + I('mac') + 'Type this on your Mac, exactly as shown</span><span class="u' + (host.length > 12 ? ' long' : '') + '">' + scheme(url) + '</span></div>'
        : '<div class="urlbox waiting"><span class="u">' + h.spin() + 'Getting the address ready…</span></div>';
      const notes = [];
      if (ready) notes.push('Saw a search page instead? Check that it starts with <b>http://</b>.');
      if (alt) notes.push('Still nothing? Type this instead: <b>' + esc(s.server.fallbackUrl) + '</b>');
      return {
        lane: 'mac', scene: macScene(s, 'safari-type', () => D.scenes.safari(host || 'usbc.local')), stage: 'mid',
        title: outdated ? 'Get the newer app' : 'On your Mac, open Safari',
        lead: (outdated ? 'Your Mac has an older USB-C Display. It can get the new one from this laptop. ' : '') +
          'Click the <b>compass icon</b> in the Dock at the bottom of your Mac’s screen. Click the address bar at the top, type the address below, then press <b>Return</b>.',
        top: stuck && !ready
          ? h.info('caution', '<b>This laptop isn’t ready to send the app yet.</b> If Windows asks about network access, click <b>Allow</b>. Or try the approval again.')
          : box + notes.map(h.note).join(''),
        aside: h.card('What you’ll see', 'eye', '<p>A simple page with one Download button. It comes from this laptop, through the cable. Your Mac doesn’t go on the internet for it.</p><p>Safari may say <b>Not Secure</b> next to the address. That’s normal for a page on a cable.</p>'),
        status: ready ? h.status('Waiting for the page to open on your Mac…') : '',
        secondary: stuck ? [{ label: 'Try the approval again', act: 'elevate' }] : [],
      };
    },
  });

  const WHY_GATE = (notarized) => h.why({
    allows: 'Your Mac opens USB-C Display, an app from outside the App Store.',
    why: notarized
      ? 'Macs ask before opening any new app. It’s a normal safety check.'
      : 'It isn’t registered with Apple yet, so your Mac can’t check it and warns you. Nothing harmful was found.',
    without: 'Your Mac won’t open the app, and this laptop can’t show its screen.',
    never: ['The app came from this laptop over the cable, not the internet.', 'Remove it anytime: drag it from Applications to the Trash.'],
  });
  add({
    id: 'download', lane: 'mac', rail: 'Download and open',
    skip: (s) => !macNeedsApp(s),
    done: (s) => !macNeedsApp(s),
    render(s, L) {
      const d = s.server.download;
      const nz = s.server.appNotarized;
      const host = hostOf(s.server.url) || 'usbc.local';
      // An older copy in Applications is replaced by itself now: no Update dialog to show.
      const scene = D.scenes.download(host, nz, { size: d.size ? mb(d.size) + ' MB' : '8 MB' });
      if (!d.done) scene.poster = d.sent ? (nz ? 0.24 : 0.08) : (nz ? 0.1 : 0.05);
      const v = { lane: 'mac', scene, aside: WHY_GATE(nz) };
      const prog = d.size ? '<div class="progress-row"><div class="pl"><span>' + (d.done ? 'Your Mac has the app' : 'Sending the app to your Mac…') + '</span><span>' + mb(d.sent) + ' of ' + mb(d.size) + ' MB</span></div><div class="progress"><i style="width:' + Math.min(100, (100 * d.sent) / d.size).toFixed(1) + '%"></i></div></div>' : '';
      // In preview (?since=) the hold flag stands in for time already spent.
      const waited = Math.max(mark(L, 'done', d.done), d.done && L.hold ? L.since : 0);
      const asks = [FIREWALL_ASK, MOVE_ASK, ['A note: Background Items Added', 'That’s USB-C Display getting ready to start by itself. Nothing to click.']];
      if (!d.sent && !d.done) {
        v.scene = macScene(s, 'safari-download', () => scene);
        v.title = 'Click Download on your Mac';
        v.lead = 'On the page that opened in Safari, click the blue <b>Download</b> button. If Safari asks to allow downloads, click <b>Allow</b>.';
        v.status = FOLLOWING;
      } else if (!d.done) {
        v.scene = macScene(s, 'safari-download', () => scene);
        v.title = 'Downloading to your Mac';
        v.lead = 'Your Mac is getting the app from this laptop, through the cable.';
        v.below = prog;
        v.status = h.status('Downloading…');
      } else if (nz) {
        v.scene = macScene(s, 'safari-open', () => scene);
        v.title = 'Open the app on your Mac';
        v.lead = 'In Safari, click the <b>download arrow</b> at the top right, then double-click <b>USB-C Display</b>. When your Mac asks if you’re sure, click <b>Open</b>. ' +
          'It then moves itself to Applications.';
        v.stage = 'short';
        v.below = h.ifAsks(asks);
        v.status = FOLLOWING;
      } else {
        // Not notarized: Gatekeeper stops the first open. The app isn't running yet, but the page
        // in Safari is ours: it says when Safari loses focus (Gatekeeper's box takes it) and comes
        // back, and when its Open Privacy & Security button is clicked. The laptop follows that.
        const sv = s.server;
        const left = sv.pageBlurs > 0;  // counted since the download finished (Wizard.OnDownload)
        const opened = mark(L, 'settings', sv.settingsOpened);
        let name, title, lead;
        if (sv.settingsOpened) {
          // Safari asks to open System Settings, then three boxes we can't see from here: show
          // them in turn, a few seconds each, in the order they come.
          const seq = [['safari-allow', 'Click <b>Allow</b>', 'Safari asks to open System Settings. Click <b>Allow</b>.'],
            ['gk-settings', 'Click <b>Open Anyway</b>', 'System Settings opens at the right place. Next to “USB-C Display.app” was blocked, click <b>Open Anyway</b>.'],
            ['gk-confirm', 'Click <b>Open Anyway</b> again', 'Your Mac asks once more. Click <b>Open Anyway</b>.'],
            ['password', 'Type your password', 'Use Touch ID or type your Mac’s <b>password</b>, then click OK. The app opens and moves itself to Applications.']];
          const i = opened < 4 ? 0 : 1 + (Math.floor((opened - 4) / 5) % 3);
          [name, title, lead] = seq[i];
          title = title.replace(/<\/?b>/g, '') + ' on your Mac';
          v.sub = h.subs(seq.map((x) => [x[1].replace(/<\/?b>/g, ''), x[2]]));
        } else if (left && !sv.pageFocused) {
          name = 'gk-notopened';
          title = 'Click Done on your Mac';
          lead = 'Your Mac says it can’t check the app, only because it isn’t registered with Apple yet. Click <b>Done</b>. Not Move to Trash, even though it’s the highlighted button.';
        } else if (left) {
          name = 'safari-settings';
          title = 'Click Open Privacy & Security';
          lead = 'Back in Safari, the page now has a button: <b>Open Privacy &amp; Security</b>. Click it. It opens exactly where you allow the app.';
        } else {
          name = 'safari-open';
          title = 'Open the app on your Mac';
          lead = 'In Safari, click the <b>download arrow</b> at the top right, then double-click <b>USB-C Display</b>. Your Mac will say it can’t check it. That’s expected.';
        }
        v.scene = macScene(s, name, () => scene);
        v.title = title;
        v.lead = lead;
        v.aside += waited > 90 && !sv.settingsOpened
          ? h.card('Don’t see the button?', 'info', '<p>In Safari, scroll the USB-C Display page down a little. Or open <b>System Settings › Privacy &amp; Security</b> and scroll to the bottom.</p>')
          : h.ifAsks(asks.slice(0, 2));
        v.status = FOLLOWING;
      }
      return v;
    },
  });

  add({
    id: 'move', lane: 'mac', rail: 'Move the app',
    skip: (s) => s.mac.reachable && s.mac.status.inApplications,
    done: (s) => s.mac.reachable && s.mac.status.inApplications,
    render(s, L) {
      const t = L.sentAt.moveToApplications;
      const moving = t && secs(t) < 20;
      const failed = t && !moving && s.mac.reachable && !s.mac.status.inApplications;
      const v = {
        lane: 'pc', scene: D.scenes.move(),
        title: 'Move the app to Applications',
        // The app moves itself when it's opened; this step only shows when that didn't work.
        lead: 'The app couldn’t move itself to Applications, so it’s running from your Downloads folder. Click <b>Move it for me</b> to try again.',
        stage: 'short',
        below: h.ifAsks([MOVE_ASK, FIREWALL_ASK]),
        aside: h.why({
          allows: 'USB-C Display moves itself into your Applications folder and opens again from there.',
          why: 'Apps in Downloads can’t start by themselves when you plug in the cable.',
          without: 'You’d have to open it from Downloads every time.',
          never: ['It only moves itself. Nothing else is touched.', 'Undo anytime: drag it from Applications to the Trash.'],
        }),
        primary: { label: 'Move it for me', act: 'mac:moveToApplications' },
      };
      if (moving || (t && !failed)) {
        v.lane = 'mac';
        v.title = 'Moving the app on your Mac';
        v.lead = 'Look at your Mac. If it asks for your password, type it. The app then opens again by itself.';
        v.status = h.status('Moving it…');
        v.primary = null;
      } else if (failed) {
        v.title = 'The app didn’t move yet';
        v.lead = 'Your Mac may have said no. Click <b>Try again</b>. Or move it yourself: in Finder, drag <b>USB-C Display</b> from Downloads to Applications, then open it from there.';
        v.primary = { label: 'Try again', act: 'mac:moveToApplications' };
      }
      return v;
    },
  });

  add({
    id: 'login', lane: 'mac', rail: 'Start automatically',
    done: (s) => s.mac.status.loginItemEnabled && !s.mac.status.loginItemNeedsApproval,
    render(s, L) {
      const off = s.mac.status.loginItemNeedsApproval;
      const v = {
        lane: 'mac', scene: macScene(s, 'bg-items', () => D.scenes.login(off)),
        title: 'Let it start by itself',
        lead: 'So your Mac is ready whenever you plug in the cable. Your Mac may have shown a note called <b>Background Items Added</b>. That was us. There’s nothing to click.',
        aside: h.why({
          allows: 'A small part of USB-C Display starts when you log in to your Mac.',
          why: 'So the Mac side is ready the moment you plug in the cable, without opening anything.',
          without: 'You’d have to open the app on your Mac every time.',
          never: ['It only listens on the cable, to this laptop.', 'Turn it off anytime in <b>General › Login Items &amp; Extensions</b>.'],
        }),
        status: h.status('Checking with your Mac…'),
        secondary: L.since > 20 ? [{ label: 'Open Login Items on my Mac', act: 'mac:loginItems' }] : [],
      };
      if (off) {
        // Switched off in Login Items: the Mac opens that page by itself (app.js autoAdvance).
        const front = s.mac.status.settingsFront;
        v.scene = macScene(s, 'login-list', () => D.scenes.login(off));
        v.title = 'Turn it back on in Login Items';
        v.lead = front
          ? 'In System Settings on your Mac, under <b>Background App Activity</b>, turn on the switch next to <b>USB-C Display</b>.'
          : 'USB-C Display is switched off on your Mac. Click <b>Show it on my Mac</b>, then turn on its switch under <b>Background App Activity</b>.';
        v.below = h.info('caution', '<b>It’s switched off on your Mac.</b> While it’s off, your Mac can’t get ready by itself.');
        v.primary = front ? null : { label: 'Show it on my Mac', act: 'mac:loginItems' };
        v.secondary = [];
        v.status = FOLLOWING;
      }
      return v;
    },
  });

  add({
    id: 'screen', lane: 'mac', rail: 'Share the picture',
    done: (s) => s.mac.reachable && s.mac.status.screenOk && !s.mac.status.screenNeedsRelaunch,
    render(s, L) {
      const st = s.mac.status;
      const why = h.why({
        allows: 'This laptop can show the picture of your Mac’s extra screen.',
        why: 'macOS calls this Screen Recording, and its box mentions audio. It’s how the picture gets from your Mac to this laptop.',
        without: 'This laptop stays black.',
        never: ['No sound. Only the picture of the extra screen.', 'Only to this laptop, over the cable. Nothing is saved.', 'Turn it off anytime in <b>Privacy &amp; Security</b>.'],
      });
      if (st.screenNeedsRelaunch || L.sent.relaunch) {
        const late = L.sentAt.relaunch && secs(L.sentAt.relaunch) > 25;
        return {
          lane: 'mac', scene: macScene(s, 'screen-reopen', () => D.scenes.waiting('Restarting USB-C Display on your Mac')),
          title: 'Click Quit & Reopen on your Mac',
          lead: 'Your Mac restarts USB-C Display so it can use the permission. Click <b>Quit &amp; Reopen</b>, or just wait: it restarts by itself in a few seconds.',
          aside: why,
          status: h.status('Restarting. This takes about 10 seconds…'),
          primary: late ? { label: 'Restart it on my Mac', act: 'mac:relaunch' } : null,
        };
      }
      // The Mac asks by itself as this step opens (app.js autoAdvance); from then on this shows
      // whatever the Mac shows: its question, then the list in System Settings.
      return permissionView(s, L, {
        action: 'screen', prompt: 'screen-prompt', list: 'screen-list', why,
        old: (direct) => D.scenes.screen(direct),
        asking: ['Your Mac is asking to share its screen', 'Click <b>Open System Settings</b> on your Mac. macOS says “record this computer’s screen and audio”. That’s Apple’s name for it: it’s how the picture reaches this laptop. Nothing is saved, and no sound.'],
        listing: ['Turn on USB-C Display', 'In <b>Screen &amp; System Audio Recording</b> on your Mac, turn on the switch next to <b>USB-C Display</b>. Your Mac then asks for Touch ID or your password.'],
      });
    },
  });

  // One permission step, following the Mac: its question (a macOS prompt) while that's up, the
  // list in System Settings while that's in front, otherwise a way to show the question again.
  function permissionView(s, L, o) {
    const st = s.mac.status;
    const sent = L.sent[o.action], since = secs(L.sentAt[o.action]);
    let name, title, lead, primary = null;
    if (st.promptUp) [name, [title, lead]] = [o.prompt, o.asking];
    else if (st.settingsFront) [name, [title, lead]] = [o.list, o.listing];
    else if (sent && since > 3) {
      name = o.prompt;
      title = 'Your Mac’s question was closed';
      lead = 'No problem, it happens. Click <b>Show it again on my Mac</b>.';
      primary = { label: 'Show it again on my Mac', act: 'mac:' + o.action };
    } else {
      name = o.prompt;
      title = 'Asking your Mac…';
      lead = 'Look at your Mac: a question from macOS is about to appear.';
    }
    return {
      lane: 'mac', scene: macScene(s, name, () => o.old(name === o.list)),
      title, lead, aside: o.why, status: FOLLOWING, primary,
      secondary: o.secondary || [],
    };
  }

  add({
    id: 'access', lane: 'mac', rail: 'Laptop keyboard',
    done: (s, L) => s.mac.status.axOk || L.skipAx,
    render(s, L) {
      return permissionView(s, L, {
        action: 'accessibility', prompt: 'ax-prompt', list: 'ax-list',
        old: (direct) => D.scenes.access(direct),
        asking: ['Your Mac is asking about this laptop’s trackpad and keyboard', 'Click <b>Open System Settings</b> on your Mac. macOS says “control this Mac and access your data”: that’s what lets this laptop’s trackpad and keyboard move the pointer and type. It only follows what you do here.'],
        listing: ['Turn on USB-C Display', 'In <b>Device Control and Data Access</b> on your Mac, turn on the switch next to <b>USB-C Display</b>. Your Mac then asks for Touch ID or your password.'],
        secondary: [{ label: 'Skip', act: 'skipAx' }],
        why: h.why({
          allows: 'This laptop’s trackpad and keyboard can move your Mac’s pointer and type.',
          why: 'macOS calls this Device Control and Data Access (Accessibility before macOS 27). Apps need it to move the pointer.',
          without: 'Everything else still works. You’ll use your Mac’s own mouse and keyboard.',
          never: ['Only what you do on this laptop’s trackpad and keyboard.', 'Nothing is recorded or sent anywhere else.', 'Turn it off anytime in <b>Privacy &amp; Security</b>.'],
        }),
      });
    },
  });

  add({
    id: 'size', lane: 'pc', rail: 'Choose the size',
    done: (s, L) => L.sizeSaved,
    render(s, L) {
      const d = L.draft;
      const opts = (s.settings.scaleOptions || []).map((o) =>
        '<button class="opt' + (o.id === d.scale ? ' on' : '') + '" data-act="scale" data-id="' + o.id + '" role="radio" aria-checked="' + (o.id === d.scale) + '"><span class="radio"></span><span class="opt-text"><b>' + esc(o.label) + '</b>' + (o.detail ? '<span class="opt-detail">' + esc(o.detail) + '</span>' : '') + '</span>' + (o.recommended ? '<span class="tag accent">Recommended</span>' : '<span></span>') + '</button>').join('');
      const ax = s.mac.status.axOk;
      const sw = (key, on, dis) => '<button class="switch' + (on ? ' on' : '') + '" data-act="toggle" data-key="' + key + '" role="switch" aria-checked="' + !!on + '"' + (dis ? ' disabled' : '') + '></button>';
      return {
        lane: 'pc', scene: D.scenes.size(d.scale), stage: 'short',
        title: 'Choose how big things look',
        lead: 'Pick a size for your Mac’s extra screen on this laptop. You can change it later.',
        below: '<div class="opts" role="radiogroup" aria-label="Size">' + opts + '</div>',
        aside: '<section class="card toggles">' +
          '<div class="toggle-row"><div><b>Match colors with your Mac</b><span class="t-detail">Colors look the same on both screens.</span></div>' + sw('matchColors', d.matchColors) + '</div>' +
          '<div class="toggle-row' + (ax ? '' : ' dis') + '"><div><b>Use this laptop’s trackpad and keyboard</b><span class="t-detail">' + (ax ? 'Control your Mac from here.' : 'Needs the keyboard permission on your Mac. You skipped it, which is fine.') + '</span></div>' + sw('useLaptopInput', ax && d.useLaptopInput, !ax) + '</div>' +
          '</section>',
        primary: { label: 'Save and continue', act: 'save' },
      };
    },
  });

  add({
    id: 'picture', lane: 'pc', rail: 'First picture',
    done: (s) => s.screen.showing,
    render(s, L) {
      const err = s.screen.error;
      const starting = (L.sent.startScreen || s.screen.running) && !s.screen.showing && !err;
      // From the click on, nothing here moves: the Mac draws this same window on its new screen,
      // the picture shows when both copies look the same (the handover), and it stays still
      // until the next step, so nothing jumps right after the cut.
      const scene = D.scenes.picture();
      if ((L.sent.startScreen || s.screen.running) && !err) { scene.poster = 0.5; scene.still = true; scene.key += '-still'; }
      return {
        lane: 'pc', scene,
        title: 'Ready for the first picture',
        lead: 'This laptop is about to become your Mac’s extra screen. This window stays right where it is: only what’s behind it changes, from Windows to your Mac.',
        sub: h.subs([
          ['Show it', 'Click <b>Show my Mac’s screen</b>.'],
          ['Look around', 'This window is now on your Mac. Move windows over from your Mac’s own screen.'],
          ['Windows back', 'Anytime, press ' + h.kbd(['Ctrl', 'Alt', 'Esc']) + '.'],
        ]),
        below: err ? h.info('critical', '<b>The picture didn’t start.</b> ' + esc(err)) : '',
        aside: h.card('Remember this', 'keyboard', '<div class="keycard">' + h.keys(['Ctrl', 'Alt', 'Esc']) + '</div><p>Press these together anytime to get <b>Windows</b> back on this laptop.</p>', 'keys-card') +
          h.card('What happens', 'display', h.list([
            ['check', 'Your Mac’s screen flickers once as it adds the new screen.'],
            ['check', 'This laptop shows your Mac’s extra screen, full size.'],
          ])),
        // Showing: this step moves on in a moment; the button doesn't come back meanwhile.
        status: s.screen.showing ? SHOWING : starting ? h.status('Starting. The picture appears in a few seconds…') : '',
        primary: starting || s.screen.showing ? null : { label: err ? 'Try again' : 'Show my Mac’s screen', act: 'startScreen' },
      };
    },
  });

  // While the picture shows, the receiver covers this window. The host
  // brings the window back when it closes (Ctrl + Alt + Esc), so this step
  // is mostly seen afterwards.
  add({
    id: 'find', lane: 'mac', rail: 'Try it out',
    done: (s, L) => s.screen.pointerOnLaptop || L.skipFind,
    render(s, L) {
      const aside = h.card('Not on the right?', 'pointer', '<p>Your Mac may have put the new screen on the left. Try the other edge.</p><p>You can move it later in <b>System Settings › Displays</b> on your Mac.</p>');
      if (s.screen.showing) {
        return {
          lane: 'mac', scene: macScene(s, 'displays', () => D.scenes.find()),
          title: 'This is your Mac now',
          lead: 'This laptop is your Mac’s second screen, and this window is on it. Slide your Mac’s pointer off the edge of its own screen to come here, and move windows across.',
          aside,
          status: SHOWING,
          primary: { label: 'It works', act: 'skipFind' },
        };
      }
      const again = L.sent.startScreen && s.screen.running;
      return {
        lane: 'pc', scene: D.scenes.find(),
        title: 'Welcome back. Did it work?',
        lead: 'Did your Mac’s pointer show up on this laptop when you slid it off the right edge?',
        aside: aside + h.card('Only saw black?', 'info', '<p>Click <b>Show it again</b>. If it stays black, open <b>Privacy &amp; Security › Screen &amp; System Audio Recording</b> on your Mac and check that USB-C Display is on.</p>'),
        status: again ? h.status('Starting…') : '',
        secondary: again ? [] : [{ label: 'Show it again', act: 'startScreen' }],
        primary: { label: 'Yes, it worked', act: 'skipFind' },
      };
    },
  });

  add({
    id: 'done', lane: 'pc', rail: 'All set',
    done: () => false,
    render(s) {
      const row = (ic, b, t) => '<div class="row"><span class="ico">' + I(ic) + '</span><div><b>' + b + '</b><span>' + t + '</span></div></div>';
      return {
        // Seen on the Mac's new screen: Finish keeps the picture; Back to Windows ends it, and
        // this same window is there on the laptop again.
        secondary: s.screen.showing ? [{ label: 'Back to Windows', act: 'stopScreen' }] : [],
        lane: 'both', stage: 'fill', scene: D.scenes.hero('done'),
        title: 'All set', ok: true,
        lead: 'This laptop is now a second screen for your Mac.',
        below: '<div class="undo"><section class="card"><h4 class="pc">' + I('laptop') + 'Undo on this laptop</h4><p>Settings › Apps › Installed apps › USB-C Display › Uninstall.</p></section>' +
          '<section class="card"><h4 class="mac">' + I('mac') + 'Undo on your Mac</h4><p>Drag USB-C Display from Applications to the Trash.</p></section></div>',
        aside: h.card('What to expect later', '', '<div class="later">' +
          row('cable', 'Next time, just plug in', 'In a few seconds this laptop becomes your Mac’s screen. If this laptop asks what the cable is for, click <b>Use as a screen</b>.') +
          row('bell', 'Your Mac may check in', 'Now and then it asks if USB-C Display can keep sharing the screen. Click <b>Continue to Allow</b>.') +
          row('keyboard', 'Windows back anytime', 'Press Ctrl + Alt + Esc.') + '</div>'),
        primary: { label: 'Finish', act: 'finish' },
      };
    },
  });

  D.steps = steps;
  D.stepIndex = (id) => steps.findIndex((x) => x.id === id);
})();
