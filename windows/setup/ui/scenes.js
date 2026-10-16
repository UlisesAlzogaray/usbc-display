// Illustrations for each step, plus a tiny timeline engine on the Web
// Animations API. Scenes are HTML on a 400 x 250 canvas. A timeline lists
// cursor moves, clicks and what is visible when, as fractions of one loop.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});

  // The setup exe isn't code signed yet, so Windows shows "Unknown" as the
  // publisher. Flip this once it is signed.
  D.SIGNED = false;

  // ---------- Icons (Fluent-like line icons, 16 x 16) ----------
  const P = {
    laptop: '<rect x="2.5" y="3" width="11" height="7.5" rx="1"/><path d="M1 12.5h14"/><path d="M6.1 4.7h1.6v1.6H6.1zM8.3 4.7h1.6v1.6H8.3zM6.1 6.9h1.6v1.6H6.1zM8.3 6.9h1.6v1.6H8.3z" fill="currentColor" stroke="none"/>',
    mac: '<rect x="3" y="2.5" width="10" height="7.5" rx="1.6"/><path d="M6.6 2.6h2.8v.8a.6.6 0 01-.6.6H7.2a.6.6 0 01-.6-.6z" fill="currentColor" stroke="none"/><path d="M1.5 12h13l-.8 1.3H2.3z"/>',
    check: '<path d="M3.5 8.5l3 3 6-7"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    info: '<circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.8v.1"/>',
    warn: '<path d="M8 2.2l6.3 11H1.7z"/><path d="M8 6.5v3.2M8 11.6v.1"/>',
    bang: '<path d="M8 3.5v6M8 12.3v.2"/>',
    shield: '<path d="M8 1.8l5.2 2v4c0 3.2-2.2 5.4-5.2 6.4-3-1-5.2-3.2-5.2-6.4v-4z"/><path d="M5.6 8.2l1.7 1.7 3.2-3.6"/>',
    cable: '<path d="M4 1.5v3M7 1.5v3M3 4.5h5v3a2.5 2.5 0 01-5 0zM5.5 10v1.5a3 3 0 003 3h1a3 3 0 003-3V9"/><path d="M11 6.5h3v2.5h-3z"/>',
    plug: '<path d="M6 1.5v3M10 1.5v3M4 4.5h8v3a4 4 0 01-8 0zM8 11.5v3"/>',
    key: '<circle cx="5" cy="8" r="3"/><path d="M8 8h6.5M12 8v2.5M14.5 8v2"/>',
    clock: '<circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/>',
    copy: '<rect x="5" y="5" width="8.5" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 014.5 2H10"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.2 7V5a2.8 2.8 0 015.6 0v2"/>',
    cloudoff: '<path d="M4.5 12.5h7a3 3 0 00.4-6A4 4 0 004.6 6 3.2 3.2 0 004.5 12.5z"/><path d="M2 2l12 12"/>',
    eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    keyboard: '<rect x="1.5" y="4" width="13" height="8.5" rx="1.5"/><path d="M4 7h.1M6.5 7h.1M9 7h.1M11.5 7h.1M5 10h6"/>',
    power: '<path d="M8 1.8v5.5"/><path d="M4.6 4.2a5.2 5.2 0 106.8 0"/>',
    undo: '<path d="M5 3.5L2 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 010 8H6"/>',
    trash: '<path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4"/>',
    arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
    bolt: '<path d="M9 1.5L3.5 9h4L7 14.5 12.5 7h-4z"/>',
    refresh: '<path d="M13 3v3.5H9.5"/><path d="M12.6 6.4A5.2 5.2 0 103.2 10"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    bell: '<path d="M4 11V7a4 4 0 018 0v4l1.2 1.5H2.8z"/><path d="M6.5 14a1.6 1.6 0 003 0"/>',
    pointer: '<path d="M4 2l8 6.2-3.6.6 2 3.8-1.6.8-2-3.8L4 12z"/>',
    sparkle: '<path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"/>',
    display: '<rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2"/><path d="M6 14h4M8 11v3"/>',
    minus: '<path d="M2 8h12"/>',
    chevron: '<path d="M6 3.5L10.5 8 6 12.5"/>',
    hand: '<path d="M5.5 8.5V3.2a1.1 1.1 0 012.2 0V7.5M7.7 7V2.5a1.1 1.1 0 012.2 0V7.5M9.9 7.2V3.6a1.1 1.1 0 012.2 0V9c0 3-2 5.5-5 5.5-2.2 0-3.3-1.2-4.4-3L3 8.8a1.1 1.1 0 011.9-1.1l.6 1"/>',
    folder: '<path d="M1.8 4.2a1 1 0 011-1h3.4l1.5 1.5h5.5a1 1 0 011 1v6.6a1 1 0 01-1 1H2.8a1 1 0 01-1-1z"/>',
    restart: '<path d="M2.5 3v3.5H6"/><path d="M2.9 6.4A5.3 5.3 0 1 1 3 10"/>',
  };
  D.icon = (n, cls) => '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true">' + (P[n] || '') + '</svg>';
  D.iconFill = (n) => '<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round" aria-hidden="true">' + (P[n] || '') + '</svg>';

  let gid = 0;
  // The app's own icon: two screens joined by a cable. Generic, made here.
  D.appIcon = function (cls) {
    const id = 'ag' + (++gid);
    return '<svg viewBox="0 0 32 32"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8cff"/><stop offset="1" stop-color="#7b5cf0"/></linearGradient></defs>' +
      '<rect x="1" y="1" width="30" height="30" rx="7.5" fill="url(#' + id + ')"/>' +
      '<rect x="5.5" y="8" width="11" height="8" rx="1.6" fill="#fff"/><rect x="18" y="10" width="8.5" height="6.5" rx="1.4" fill="#fff" fill-opacity=".85"/>' +
      '<path d="M11 16v3.2c0 1.8 1.2 2.8 3 2.8h5.2c1.8 0 3-1 3-2.8v-2.7" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>';
  };

  // Mac pointer: black with a white edge. Windows pointer: white with a black edge.
  const CURSOR = '<svg viewBox="0 0 13 19"><path d="M1 1v15l3.7-3.5 2.4 5.3 2.4-1.1-2.4-5.2H12z" fill="#111" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg>';
  const CURSOR_W = '<svg viewBox="0 0 13 19"><path d="M1 1v15l3.7-3.5 2.4 5.3 2.4-1.1-2.4-5.2H12z" fill="#fff" stroke="#111" stroke-width="1" stroke-linejoin="round"/></svg>';

  // ---------- Dock icons (generic shapes) ----------
  const DOCK = {
    finder: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#3a8ef6"/><path d="M10 0h5.5A4.5 4.5 0 0120 4.5v11a4.5 4.5 0 01-4.5 4.5H10z" fill="#bcdcff"/><circle cx="6.5" cy="8" r="1.1" fill="#123"/><circle cx="13.5" cy="8" r="1.1" fill="#123"/><path d="M6 13c2.5 2 5.5 2 8 0" stroke="#123" stroke-width="1" fill="none" stroke-linecap="round"/></svg>',
    grid: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#e9e9ee"/><g fill="#8e8e98"><rect x="4" y="4" width="4.5" height="4.5" rx="1.2"/><rect x="11.5" y="4" width="4.5" height="4.5" rx="1.2"/><rect x="4" y="11.5" width="4.5" height="4.5" rx="1.2"/><rect x="11.5" y="11.5" width="4.5" height="4.5" rx="1.2"/></g></svg>',
    compass: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#fff"/><circle cx="10" cy="10" r="7.6" fill="#1e88f5"/><circle cx="10" cy="10" r="6.4" fill="#5cb6ff"/><path d="M13.6 6.4L11 11 6.4 13.6 9 9z" fill="#fff"/><path d="M13.6 6.4L9 9 11 11z" fill="#ff3b30"/></svg>',
    chat: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#34c759"/><path d="M10 4.5c3.6 0 6 2.1 6 4.8s-2.4 4.8-6 4.8c-.8 0-1.5-.1-2.2-.3L5 15l.8-2.4C4.6 11.7 4 10.6 4 9.3c0-2.7 2.4-4.8 6-4.8z" fill="#fff"/></svg>',
    mail: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#2f7cf6"/><rect x="4" y="6" width="12" height="8.5" rx="1.2" fill="#fff"/><path d="M4.5 6.6l5.5 4 5.5-4" stroke="#2f7cf6" stroke-width="1" fill="none"/></svg>',
    photo: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#fff"/><g opacity=".9"><circle cx="10" cy="6.5" r="3" fill="#ffcc00"/><circle cx="13.5" cy="10" r="3" fill="#ff3b30"/><circle cx="10" cy="13.5" r="3" fill="#5856d6"/><circle cx="6.5" cy="10" r="3" fill="#34c759"/></g></svg>',
    gear: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#8e8e93"/><circle cx="10" cy="10" r="5.6" fill="none" stroke="#e5e5ea" stroke-width="2.2" stroke-dasharray="2.2 1.6"/><circle cx="10" cy="10" r="3.4" fill="#e5e5ea"/><circle cx="10" cy="10" r="1.5" fill="#8e8e93"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="#d8d8de"/><path d="M6 6h8l-.8 9H6.8z" fill="#fff" stroke="#9a9aa2" stroke-width=".8"/></svg>',
  };
  function dock(extra, cls) {
    const names = ['finder', 'grid', 'compass', 'chat', 'mail', 'photo', 'gear', 'trash'];
    return '<div class="dock ' + (cls || '') + '">' + names.map((n) => '<div class="di d-' + n + '">' + DOCK[n] + '<i class="dot"></i></div>').join('') + (extra || '') + '</div>';
  }
  const menubar = '<div class="menubar"><i class="dot"></i><i style="width:13px"></i><i style="width:9px"></i><i style="width:11px"></i><i style="width:8px"></i><i class="r" style="width:12px"></i><i style="width:9px"></i><i style="width:14px"></i></div>';
  // Windows 11 taskbar: centred Start, a few pinned apps, the clock on the right.
  const taskbar = '<div class="taskbar"><span class="start"><i></i><i></i><i></i><i></i></span><i class="t"></i><i class="t a"></i><i class="t b"></i><i class="t c"></i><span class="tray"><i></i><i></i></span></div>';

  function mac(x, y, w, inner, cls) {
    return '<div class="mbp ' + (cls || '') + '" style="left:' + x + 'px;top:' + y + 'px;width:' + w + 'px"><div class="lid"><div class="scr">' + inner + '<div class="notch"></div></div></div><div class="base"></div></div>';
  }
  function pc(x, y, w, inner, cls) {
    const tb = Math.max(8, Math.round(w * 0.05));
    return '<div class="pcl ' + (cls || '') + '" style="left:' + x + 'px;top:' + y + 'px;width:' + w + 'px"><div class="lid"><div class="scr" style="--tb:' + tb + 'px">' + inner + '</div></div><div class="base"></div></div>';
  }
  const label = (lane, text) => '<div class="mlabel ' + lane + '">' + D.icon(lane === 'pc' ? 'laptop' : 'mac') + text + '</div>';
  const cap = (lane, text, cx, y) => '<div class="dev-cap ' + lane + '" style="left:' + (cx - 60) + 'px;width:120px;top:' + y + 'px">' + text + '</div>';
  const cur = (cls, win) => '<div class="cur ' + (cls || '') + '">' + (win ? CURSOR_W : CURSOR) + '</div>';
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q = (t) => '“' + t + '”';
  const APP = 'USB-C Display';
  // Grey bars stand in for text nobody needs to read.
  const bars = (ws, cls) => '<span class="bars ' + (cls || '') + '">' + ws.map((w) => '<i style="width:' + w + '%"></i>').join('') + '</span>';

  function malert(cls, style, body) {
    return '<div class="malert ' + cls + '" style="' + style + '">' + body + '</div>';
  }
  // System Settings window. side: [label or null for a bar, cls]; the
  // selected look comes from .hl spans so it can move during a loop.
  const SIDE = [[null, 'w1'], [null, 'w2'], [null, 'w3'], ['General', 'si-gen'], [null, 'w2'], ['Privacy &amp; Security', 'si-priv'], [null, 'w1'], [null, 'w3']];
  function settings(cls, style, sel, main) {
    const items = SIDE.map((s) => '<div class="si ' + s[1] + '"><b class="hl' + (sel.indexOf(s[1]) >= 0 ? ' on' : '') + '"></b><i></i>' + (s[0] ? '<span>' + s[0] + '</span>' : '<em></em>') + '</div>').join('');
    return '<div class="mwin mset ' + cls + '" style="' + style + '"><div class="side"><div class="search"></div>' + items + '</div><div class="smain">' + main + '</div><div class="abs" style="left:8px;top:8px"><div class="lights"><i></i><i></i><i></i></div></div></div>';
  }
  const grp = (n) => '<div class="grp">' + Array.from({ length: n }, (_, i) => '<div class="row"><span class="gi g' + (i % 3) + '"></span>' + bars([[62, 48, 56][i % 3]]) + '</div>').join('') + '</div>';
  const tog = (cls) => '<div class="mtog anim ' + (cls || '') + '"><i class="g"></i><i class="k"></i></div>';
  const fingerprint = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5 9.5a7.5 7.5 0 0114 0M7.5 18c-.8-1.5-1.2-3.2-1.2-5a5.7 5.7 0 0111.4 0v1"/><path d="M9.8 20c-.7-1.6-1.1-3.3-1.1-5.2a3.3 3.3 0 016.6 0c0 1.8.4 3.3 1 4.7"/><path d="M12 14.5c0 2.3.6 4.3 1.6 6"/></svg>';
  const folderSvg = (glyph) => '<svg viewBox="0 0 54 44"><path d="M3 8a4 4 0 014-4h13l5 5h22a4 4 0 014 4v24a4 4 0 01-4 4H7a4 4 0 01-4-4z" fill="#5fb0f7"/><path d="M3 15a4 4 0 014-4h40a4 4 0 014 4v22a4 4 0 01-4 4H7a4 4 0 01-4-4z" fill="#8ccaff"/>' + (glyph || '') + '</svg>';
  const pwSheet = (cls, style, btn, btnCls) => malert(cls, style, '<div class="touch">' + fingerprint + '</div><b>Touch ID or password</b>' + bars([86, 60]) + '<div class="field"><span class="pwd"></span></div><div class="btns"><div class="mb">Cancel</div><div class="mb def ' + btnCls + '">' + btn + '</div></div>');
  const winSpin = '<div class="wspin"></div>';

  // ---------- Scenes ----------
  // Each returns { key, html, tl, poster, crop }. poster is the frame shown
  // when motion is reduced. Coordinates are canvas units. crop marks a
  // close-up of the Mac that runs off the bottom of the stage.
  const S = {};

  // Hero: Mac + cable + laptop become one desktop.
  S.hero = function (opt) {
    const done = opt === 'done';
    const win = (cls) => '<div class="mwin ' + cls + '" style="left:30px;top:20px;width:66px;height:44px"><div class="tb" style="height:11px"><div class="lights"><i></i><i></i><i></i></div></div><div style="padding:5px 6px;display:grid;gap:3px"><i style="height:3px;width:80%;background:var(--m-btn);border-radius:2px"></i><i style="height:3px;width:60%;background:var(--m-btn);border-radius:2px"></i><i style="height:3px;width:70%;background:var(--m-btn);border-radius:2px"></i></div></div>';
    const macIn = menubar + win('w-mac') + dock('', 'mini');
    const pcIn = taskbar + '<div class="abs pcmac" style="inset:0;background:var(--m-wall)">' + menubar + win('w-pc') + '</div>';
    const y = 58;
    const html =
      mac(22, y, 160, macIn) + pc(218, y, 160, pcIn) +
      '<svg class="abs cable" width="400" height="250" style="left:0;top:0"><path class="c" d="M190 ' + (y + 109) + ' C 206 ' + (y + 111) + ', 186 ' + (y + 160) + ', 200 ' + (y + 160) + ' C 214 ' + (y + 160) + ', 194 ' + (y + 112) + ', 212 ' + (y + 111) + '"/><path class="glow" pathLength="1" d="M190 ' + (y + 109) + ' C 206 ' + (y + 111) + ', 186 ' + (y + 160) + ', 200 ' + (y + 160) + ' C 214 ' + (y + 160) + ', 194 ' + (y + 112) + ', 212 ' + (y + 111) + '" stroke-dasharray=".22 1"/><rect class="plug" x="185" y="' + (y + 106) + '" width="8" height="5" rx="1.5"/><rect class="plug" x="209" y="' + (y + 108) + '" width="8" height="5" rx="1.5"/></svg>' +
      cap('mac', 'Your Mac', 102, y + 126) + cap('pc', 'This laptop', 298, y + 128) +
      (done ? '<div class="badge ok" style="left:187px;top:' + (y + 74) + 'px">' + D.icon('check') + '</div><div class="pulse p1" style="left:181px;top:' + (y + 68) + 'px;width:38px;height:38px"></div>' : '') +
      cur();
    const tl = {
      dur: 8000,
      vis: [['.pcmac', done ? [[0, 1]] : [[0.24, 0.96]]]],
      anim: [
        ['.cable .glow', [{ offset: 0, strokeDashoffset: 0.22, opacity: 0 }, { offset: 0.1, strokeDashoffset: 0.22, opacity: 1 }, { offset: 0.22, strokeDashoffset: -1, opacity: 1 }, { offset: 0.23, opacity: 0 }, { offset: 1, opacity: 0 }]],
        ['.w-mac', [{ offset: 0, transform: 'translateX(0)' }, { offset: 0.38, transform: 'translateX(0)', easing: 'cubic-bezier(.5,0,.3,1)' }, { offset: 0.66, transform: 'translateX(196px)' }, { offset: 0.97, transform: 'translateX(196px)' }, { offset: 0.98, transform: 'translateX(0)' }, { offset: 1, transform: 'translateX(0)' }]],
        ['.w-pc', [{ offset: 0, transform: 'translateX(-196px)' }, { offset: 0.38, transform: 'translateX(-196px)', easing: 'cubic-bezier(.5,0,.3,1)' }, { offset: 0.66, transform: 'translateX(0)' }, { offset: 1, transform: 'translateX(0)' }]],
      ].concat(done ? [['.p1', [{ offset: 0, opacity: 0.8, transform: 'scale(.7)' }, { offset: 0.3, opacity: 0, transform: 'scale(1.6)' }, { offset: 1, opacity: 0 }]]] : []),
      cursor: [[0.28, 88, y + 26], [0.38, 88, y + 26], [0.66, 284, y + 26, 'cubic-bezier(.5,0,.3,1)'], [0.76, 284, y + 26]],
      cursorVis: [[0.3, 0.78]],
    };
    return { key: 'hero' + opt, html, tl, poster: 0.7 };
  };

  // Check this laptop: a zoom on the side ports.
  S.check = function (v) {
    const pcIn = taskbar + '<div class="winapp" style="left:34px;top:22px;width:118px;height:62px"><div class="wt">' + D.appIcon() + '<i></i></div><div class="wc" style="padding:3px 10px"><b>Checking</b><div class="wprog"><i class="pg"></i></div></div></div>';
    const ok = v === 'ok', bad = v === 'missing';
    const html =
      pc(36, 54, 196, pcIn) +
      '<svg class="abs" width="400" height="250" style="left:0;top:0"><path d="M240 180 C 258 180, 258 154, 266 150" stroke="var(--text-2)" stroke-opacity=".6" stroke-width="1.2" stroke-dasharray="3 3" fill="none"/><circle cx="240" cy="180" r="3" fill="var(--text-2)" fill-opacity=".6"/></svg>' +
      '<div class="bubble" style="left:252px;top:54px;width:136px;height:136px">' +
      '<div class="abs" style="left:-4px;right:-4px;top:44px;height:42px;background:linear-gradient(#5a5d63,#34363b);border-radius:6px"></div>' +
      '<div class="port p1" style="left:22px;top:60px;width:30px"></div><div class="port p2" style="left:78px;top:60px;width:30px"></div>' +
      (bad ? '' : '<div class="abs bolt" style="left:88px;top:47px">' + D.iconFill('bolt') + '</div>') +
      '<div class="port-lbl" style="left:12px;width:50px;top:94px">USB-C</div><div class="port-lbl" style="left:68px;width:50px;top:94px">' + (bad ? 'USB-C' : 'USB4') + '</div>' +
      '<div class="halo h" style="left:17px;top:55px;width:40px;height:19px' + (bad ? ';box-shadow:0 0 0 2px #d93a3f,0 0 0 6px rgba(217,58,63,.25)' : '') + '"></div>' +
      '</div>' +
      (ok ? '<div class="badge ok fin" style="left:352px;top:60px">' + D.icon('check') + '</div>' : '') +
      (bad ? '<div class="badge bad fin" style="left:352px;top:60px">' + D.icon('x') + '</div>' : '') +
      label('pc', 'On this laptop');
    const tl = {
      dur: 4000,
      anim: [
        ['.halo.h', [{ offset: 0, opacity: 0, transform: 'translateX(0)' }, { offset: 0.08, opacity: 1, transform: 'translateX(0)' }, { offset: 0.3, opacity: 1, transform: 'translateX(0)', easing: 'cubic-bezier(.5,0,.3,1)' }, { offset: 0.48, opacity: 1, transform: 'translateX(56px)' }, { offset: v === 'scan' ? 0.7 : 0.94, opacity: v === 'scan' ? 0 : 1, transform: 'translateX(56px)' }, { offset: 1, opacity: 0, transform: 'translateX(56px)' }]],
        ['.pg', [{ offset: 0, transform: 'scaleX(0)' }, { offset: 0.5, transform: 'scaleX(1)' }, { offset: 1, transform: 'scaleX(1)' }]],
      ],
      vis: (ok || bad) ? [['.fin', [[0.52, 0.97]], 'pop']] : [],
    };
    return { key: 'check' + v, html, tl, poster: 0.8 };
  };

  // Install: a progress window on the laptop.
  S.install = function () {
    const pcIn = taskbar + '<div class="winapp" style="left:55px;top:40px;width:180px;height:84px"><div class="wt">' + D.appIcon() + '<i></i></div><div class="wc"><b>Installing USB-C Display</b>' + bars([70]) + '<div class="wprog"><i class="pg"></i></div></div></div>' +
      '<div class="badge ok fin" style="left:132px;top:134px;width:24px;height:24px">' + D.icon('check') + '</div>';
    const html = pc(50, 30, 300, pcIn) + label('pc', 'On this laptop');
    const tl = {
      dur: 5000,
      anim: [['.pg', [{ offset: 0, transform: 'scaleX(0)' }, { offset: 0.08, transform: 'scaleX(0)', easing: 'cubic-bezier(.3,.1,.3,1)' }, { offset: 0.7, transform: 'scaleX(1)' }, { offset: 1, transform: 'scaleX(1)' }]]],
      vis: [['.fin', [[0.72, 0.97]], 'pop']],
    };
    return { key: 'install', html, tl, poster: 0.45 };
  };

  // The Windows approval prompt. Generic; the publisher line matches what
  // Windows will really show for this exe.
  S.uac = function (cred) {
    const pub = D.SIGNED ? 'Verified publisher: USB-C Display' : 'Publisher: Unknown';
    const body = cred
      ? '<div class="meta">' + pub + '</div><div class="wfield">User name</div><div class="wfield">Password</div>'
      : '<div class="meta">' + pub + '</div>' + bars([64], 'l');
    const ask = D.SIGNED ? 'Do you want to allow this app to make changes to your device?' : 'Do you want to allow this app from an unknown publisher to make changes to your device?';
    const dlg = '<div class="wdlg dl' + (cred ? ' cred' : '') + '" style="left:' + (cred ? 30 : 42) + 'px;top:' + (cred ? 3 : 8) + 'px;width:' + (cred ? 230 : 206) + 'px"><div class="wb"><div class="cap">User Account Control</div><div class="q">' + ask + '</div><div class="app">' + D.appIcon() + '<b>USB-C Display Setup</b></div>' + body + '</div><div class="wf"><div class="wbtn acc yes">Yes</div><div class="wbtn">No</div></div></div>';
    const pcIn = taskbar + '<div class="dim dm"></div>' + dlg + '<div class="badge ok fin" style="left:132px;top:72px">' + D.icon('check') + '</div>';
    const html = pc(50, 30, 300, pcIn) + label('pc', 'On this laptop') + cur('', true);
    const tl = {
      dur: 6500,
      vis: [['.dm', [[0.04, 0.62]]], ['.dl', [[0.06, 0.62]], 'pop'], ['.fin', [[0.68, 0.96]], 'pop']],
      cursor: [[0.12, 340, 236], [0.42, '.yes', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.62, '.yes', 0, 2]],
      cursorVis: [[0.1, 0.64]],
      clicks: [[0.48, '.yes']],
      halo: [['.yes', 0.22, 0.46]],
    };
    return { key: 'uac' + (cred ? 'c' : ''), html, tl, poster: 0.4 };
  };

  // Plug in: cable, chargers, and the possible accessory prompt on the Mac.
  const CABLE_D = 'M183 150 C 200 151, 184 200, 200 200 C 216 200, 200 153, 218 152';
  function twoDevices(macIn, pcIn) {
    return mac(24, 46, 150, macIn) + pc(226, 46, 150, pcIn);
  }
  S.plug = function () {
    // The alert sits inside the Mac's screen, so it's clear which computer asks.
    const alert = '<div class="dim soft acc-d"></div>' + malert('acc small', 'left:12px;top:14px;width:116px', '<b>Allow accessory to connect?</b><div class="btns"><div class="mb">Don’t Allow</div><div class="mb def allow">Allow</div></div>');
    const html =
      twoDevices(menubar + alert, taskbar) +
      '<svg class="abs cable" width="400" height="250" style="left:0;top:0"><path class="c cdraw" pathLength="1" stroke-dasharray="1 1" d="' + CABLE_D + '"/><path class="glow" pathLength="1" stroke-dasharray=".25 1" d="' + CABLE_D + '"/><rect class="plug pl" x="178" y="147" width="8" height="5" rx="1.5"/><rect class="plug pl" x="214" y="149" width="8" height="5" rx="1.5"/>' +
      '<path class="charge ch" pathLength="1" stroke-dasharray="1 1" d="M15 150 C 6 152, 14 182, 12 190"/><path class="charge ch" pathLength="1" stroke-dasharray="1 1" d="M385 152 C 394 154, 386 182, 388 190"/></svg>' +
      '<div class="brick br" style="left:3px;top:188px">' + D.iconFill('bolt') + '</div><div class="brick br" style="left:379px;top:188px">' + D.iconFill('bolt') + '</div>' +
      cap('mac', 'Your Mac', 99, 160) + cap('pc', 'This laptop', 301, 162) +
      '<div class="ringbox rb" style="left:18px;top:40px;width:162px;height:118px"></div>' +
      '<div class="tagnote purple tg" style="left:42px;top:24px">Only if your Mac asks</div>' +
      '<div class="badge ok fin" style="left:187px;top:186px">' + D.icon('check') + '</div>' + cur();
    const tl = {
      dur: 9000,
      anim: [
        ['.cdraw', [{ offset: 0, strokeDashoffset: 1 }, { offset: 0.04, strokeDashoffset: 1, easing: 'cubic-bezier(.4,0,.2,1)' }, { offset: 0.18, strokeDashoffset: 0 }, { offset: 1, strokeDashoffset: 0 }]],
        ['.ch', [{ offset: 0, strokeDashoffset: 1 }, { offset: 0.2, strokeDashoffset: 1 }, { offset: 0.3, strokeDashoffset: 0 }, { offset: 1, strokeDashoffset: 0 }]],
        ['.glow', [{ offset: 0, opacity: 0, strokeDashoffset: 0.25 }, { offset: 0.33, opacity: 0, strokeDashoffset: 0.25 }, { offset: 0.34, opacity: 1, strokeDashoffset: 0.25 }, { offset: 0.44, opacity: 1, strokeDashoffset: -1 }, { offset: 0.45, opacity: 0 }, { offset: 1, opacity: 0 }]],
        ['.rb', [{ offset: 0, opacity: 0 }, { offset: 0.47, opacity: 0 }, { offset: 0.5, opacity: 1 }, { offset: 0.58, opacity: 0.35 }, { offset: 0.66, opacity: 1 }, { offset: 0.74, opacity: 0.35 }, { offset: 0.84, opacity: 0 }, { offset: 1, opacity: 0 }]],
      ],
      vis: [['.pl', [[0.17, 1]]], ['.br', [[0.2, 1]], 'pop'], ['.acc-d', [[0.48, 0.84]]], ['.acc', [[0.48, 0.84]], 'pop'], ['.tg', [[0.48, 0.84]], 'pop'], ['.fin', [[0.86, 0.98]], 'pop']],
      cursor: [[0.52, 150, 140], [0.7, '.allow', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.82, '.allow', 0, 2]],
      cursorVis: [[0.52, 0.84]],
      clicks: [[0.75, '.allow']],
    };
    return { key: 'plug', html, tl, poster: 0.72 };
  };

  // Connect: dots run along the cable while they find each other.
  S.connect = function (found) {
    const pcIn = taskbar + '<div class="winapp pill" style="left:5px;top:22px;width:130px;height:24px"><div class="spin-ring" style="left:8px;top:6px;width:12px;height:12px;border-color:rgba(0,0,0,.15);border-top-color:var(--w-accent)"></div><span>Looking for your Mac</span></div>';
    const dots = [0, 1, 2].map((i) => '<i class="abs dt dt' + i + '" style="left:0;top:0;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--accent);offset-path:path(\'' + CABLE_D + '\');offset-rotate:0deg"></i>').join('') +
      [0, 1].map((i) => '<i class="abs dr dr' + i + '" style="left:0;top:0;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--mac);offset-path:path(\'' + CABLE_D + '\');offset-rotate:0deg"></i>').join('');
    const html =
      twoDevices(menubar, found ? taskbar : pcIn) +
      '<svg class="abs cable" width="400" height="250" style="left:0;top:0"><path class="c" d="' + CABLE_D + '"/>' + (found ? '<path class="c" style="stroke:var(--accent);opacity:.9" d="' + CABLE_D + '"/>' : '') + '<rect class="plug" x="178" y="147" width="8" height="5" rx="1.5"/><rect class="plug" x="214" y="149" width="8" height="5" rx="1.5"/></svg>' +
      (found ? '<div class="badge ok" style="left:187px;top:186px">' + D.icon('check') + '</div>' : dots +
        '<div class="pulse pa" style="left:59px;top:56px;width:80px;height:80px"></div><div class="pulse pb" style="left:261px;top:56px;width:80px;height:80px"></div>') +
      cap('mac', 'Your Mac', 99, 160) + cap('pc', 'This laptop', 301, 162);
    const run = (sel, rev, i, n) => [sel, [{ offset: 0, offsetDistance: rev ? '100%' : '0%', opacity: 0 }, { offset: 0.1, opacity: 1 }, { offset: 0.9, opacity: 1 }, { offset: 1, offsetDistance: rev ? '0%' : '100%', opacity: 0 }], { delayFrac: i / n }];
    const tl = found ? { dur: 3000 } : {
      dur: 2400,
      anim: [run('.dt0', 0, 0, 3), run('.dt1', 0, 1, 3), run('.dt2', 0, 2, 3), run('.dr0', 1, 0.5, 2), run('.dr1', 1, 1.5, 2),
        ['.pa', [{ offset: 0, opacity: 0.7, transform: 'scale(.6)' }, { offset: 0.8, opacity: 0, transform: 'scale(1.5)' }, { offset: 1, opacity: 0 }]],
        ['.pb', [{ offset: 0, opacity: 0, transform: 'scale(.6)' }, { offset: 0.4, opacity: 0.7, transform: 'scale(.6)' }, { offset: 1, opacity: 0, transform: 'scale(1.3)' }]]],
    };
    return { key: 'connect' + (found ? 'f' : ''), html, tl, poster: 0.3 };
  };

  // Safari on the Mac, typing the address and getting the landing page.
  function safariWin(url, opt) {
    opt = opt || {};
    const page = '<div class="landing lp">' +
      '<div class="abs" style="left:120px;top:14px">' + D.appIcon('ai') + '</div>' +
      '<b class="abs" style="left:0;right:0;top:50px">USB-C Display</b>' +
      '<span class="abs" style="left:0;right:0;top:67px">From your laptop, over the cable</span>' +
      '<div class="abs big dlb" style="left:64px;width:150px;top:86px">Download USB-C Display</div></div>';
    return '<div class="mwin sw" style="left:26px;top:16px;width:278px;height:150px"><div class="tb"><div class="lights"><i></i><i></i><i></i></div>' +
      '<div class="addr' + (opt.focus ? ' focus' : '') + '">' + (opt.typing ? '<span class="ph">Search or enter website</span>' : '') +
      '<span class="ns">' + D.icon('lock') + 'Not Secure</span><span class="ty">' + (opt.typing ? '' : esc(url)) + '</span></div>' +
      (opt.dl ? '<div class="dl-btn">' + '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.3"/><circle class="dlr" cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.3" pathLength="1" stroke-dasharray="1 1" transform="rotate(-90 6 6)"/><path d="M6 3.2v4.6M4.2 6.2L6 8l1.8-1.8" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg></div>' : '') +
      '</div>' + page + '</div>';
  }
  const MAC_CLOSE = (inner) => mac(30, 30, 340, inner);

  S.safari = function (url) {
    const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const inner = menubar + safariWin(host, { typing: true }) + dock();
    const html = MAC_CLOSE(inner) + label('mac', 'On your Mac') +
      '<div class="keycap rk" style="left:318px;top:196px">return</div>' + cur();
    const tl = {
      dur: 9500,
      vis: [['.sw', [[0.2, 0.97]], 'grow'], ['.lp', [[0.62, 0.97]]], ['.ns', [[0.62, 0.97]]], ['.ph', [[0.2, 0.355]]], ['.rk', [[0.56, 0.66]], 'pop']],
      cls: [['.addr', 'focus', 0.35, 0.62]],
      type: [['.ty', host, 0.38, 0.55, 0.97]],
      cursor: [[0.02, 300, 120], [0.14, '.d-compass', 0, 0, 'cubic-bezier(.5,0,.3,1)'], [0.26, '.d-compass'], [0.34, '.addr', -20, 0, 'cubic-bezier(.5,0,.3,1)'], [0.66, '.addr', -20, 0], [0.8, '.dlb', 10, 4, 'cubic-bezier(.5,0,.3,1)'], [0.97, '.dlb', 10, 4]],
      cursorVis: [[0, 0.98]],
      clicks: [[0.16, '.d-compass'], [0.355, '.addr', -20, 0]],
      anim: [['.d-compass', [{ offset: 0, transform: 'translateY(0)' }, { offset: 0.17, transform: 'translateY(0)' }, { offset: 0.19, transform: 'translateY(-6px)' }, { offset: 0.21, transform: 'translateY(0)' }, { offset: 1, transform: 'translateY(0)' }]],
        ['.d-compass .dot', [{ offset: 0, opacity: 0 }, { offset: 0.2, opacity: 0 }, { offset: 0.21, opacity: 1 }, { offset: 0.97, opacity: 1 }, { offset: 1, opacity: 0 }]]],
      halo: [['.dlb', 0.82, 0.97]],
    };
    return { key: 'safari' + host, html, tl, poster: 0.85, crop: true };
  };

  // Download and open. Two variants: notarized (one dialog) or not
  // notarized (Done, System Settings, Privacy & Security, Open Anyway twice,
  // password). opt: { size: '8 MB', outdated: bool }.
  S.download = function (url, notarized, opt) {
    opt = opt || {};
    const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const pop = '<div class="popover pv" style="left:186px;top:40px;width:112px"><div class="h">Downloads</div><div class="it sel di1">' + D.appIcon() + '<div><b>USB-C Display</b><span>' + esc(opt.size || '8 MB') + '</span></div></div></div>';
    const update = malert('d4', 'left:77px;top:40px', D.appIcon('ai') + '<b>Update USB-C Display?</b>' + bars([84, 56]) + '<div class="btns"><div class="mb">Not Now</div><div class="mb def upd">Update</div></div>');
    let inner = menubar + safariWin(host, { dl: true }) + pop;
    let tl;
    if (notarized) {
      const open = malert('d1', 'left:77px;top:36px', D.appIcon('ai') + '<b>' + q(APP) + ' is an app downloaded from the Internet. Are you sure you want to open it?</b>' + bars([80, 52]) + '<div class="btns"><div class="mb">Cancel</div><div class="mb def op">Open</div></div>');
      const up = opt.outdated;
      inner += open + (up ? update : '') + dock();
      tl = {
        dur: up ? 11000 : 9000,
        vis: [['.dl-btn', [[0.12, 1]], 'pop'], ['.pv', [[0.36, 0.56]], 'pop'], ['.d1', [[0.56, up ? 0.76 : 0.86]], 'pop']].concat(up ? [['.d4', [[0.78, 0.97]], 'pop']] : []),
        anim: [['.dlr', [{ offset: 0, strokeDashoffset: 1 }, { offset: 0.13, strokeDashoffset: 1 }, { offset: 0.28, strokeDashoffset: 0 }, { offset: 1, strokeDashoffset: 0 }]]],
        cursor: [[0.02, 330, 200], [0.08, '.dlb', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.2, '.dlb', 0, 2], [0.32, '.dl-btn', 0, 0, 'cubic-bezier(.5,0,.3,1)'], [0.4, '.di1', -20, 0, 'cubic-bezier(.5,0,.3,1)'], [0.56, '.di1', -20, 0], [0.66, '.op', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [up ? 0.76 : 0.97, '.op', 0, 2]].concat(up ? [[0.86, '.upd', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.97, '.upd', 0, 2]] : []),
        cursorVis: [[0, 0.98]],
        clicks: [[0.1, '.dlb'], [0.34, '.dl-btn'], [0.48, '.di1', -20, 0], [0.51, '.di1', -20, 0], [up ? 0.72 : 0.76, '.op']].concat(up ? [[0.9, '.upd']] : []),
        halo: [['.op', 0.6, up ? 0.72 : 0.8]].concat(up ? [['.upd', 0.8, 0.9]] : []),
      };
      return { key: 'dln' + host + (up ? 'u' : ''), html: MAC_CLOSE(inner) + label('mac', 'On your Mac') + cur(), tl, poster: up ? 0.88 : 0.72, crop: true };
    }
    const notOpened = (cls, again) => malert(cls, 'left:77px;top:24px', D.appIcon('ai') + '<b>' + q(APP) + ' Not Opened</b>' + bars([88, 76, 50]) +
      '<div class="btns stack">' + (again
        ? '<div class="mb def oa2">Open Anyway</div><div class="mb">Done</div>'
        : '<div class="mb def done">Done</div><div class="mb trash">Move to Trash<span class="xb">' + D.icon('x') + '</span></div>') + '</div>');
    const paneGen = '<div class="pane pg-gen"><div class="ttl">General</div>' + grp(3) + grp(2) + '</div>';
    const panePriv = '<div class="pane pg-priv"><div class="scrl"><div class="ttl">Privacy &amp; Security</div>' + grp(3) + grp(2) +
      '<div class="sec">Security</div><div class="grp"><div class="blocked"><span>' + q(APP) + ' was blocked</span><div class="pill oa">Open Anyway</div></div></div></div></div>';
    const set = settings('st', 'left:17px;top:16px;width:296px;height:152px', [], paneGen + panePriv);
    inner += notOpened('d1') + set + notOpened('d3', true) + pwSheet('d2', 'left:77px;top:30px', 'OK', 'ok2') + dock();
    tl = {
      dur: 19000,
      vis: [['.sw', [[0, 0.36]]], ['.dl-btn', [[0.05, 1]], 'pop'], ['.pv', [[0.1, 0.2]], 'pop'], ['.d1', [[0.2, 0.34]], 'pop'],
        ['.st', [[0.4, 1]], 'grow'], ['.pg-gen', [[0.4, 0.5]]], ['.pg-priv', [[0.5, 1]]], ['.si-gen .hl', [[0.4, 0.5]]], ['.si-priv .hl', [[0.5, 1]]],
        ['.d3', [[0.68, 0.82]], 'pop'], ['.d2', [[0.84, 0.98]], 'pop']],
      anim: [['.dlr', [{ offset: 0, strokeDashoffset: 1 }, { offset: 0.05, strokeDashoffset: 1 }, { offset: 0.1, strokeDashoffset: 0 }, { offset: 1, strokeDashoffset: 0 }]],
        ['.scrl', [{ offset: 0, transform: 'translateY(0)' }, { offset: 0.53, transform: 'translateY(0)', easing: 'cubic-bezier(.3,.1,.2,1)' }, { offset: 0.6, transform: 'translateY(-62px)' }, { offset: 1, transform: 'translateY(-62px)' }]]],
      type: [['.pwd', '••••••••', 0.87, 0.91, 0.98]],
      cursor: [[0.0, 330, 200], [0.06, '.dl-btn', 0, 0, 'cubic-bezier(.5,0,.3,1)'], [0.1, '.dl-btn', 0, 0], [0.13, '.di1', -20, 0, 'cubic-bezier(.5,0,.3,1)'], [0.2, '.di1', -20, 0],
        [0.27, '.done', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.34, '.done', 0, 2], [0.38, '.d-gear', 0, 0, 'cubic-bezier(.5,0,.3,1)'], [0.42, '.d-gear'],
        [0.47, '.si-priv', 0, 0, 'cubic-bezier(.5,0,.3,1)'], [0.52, '.si-priv'], [0.56, '.oa', 0, -60, 'cubic-bezier(.5,0,.3,1)'], [0.66, '.oa', 0, -60],
        [0.73, '.oa2', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.82, '.oa2', 0, 2], [0.93, '.ok2', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.98, '.ok2', 0, 2]],
      cursorVis: [[0, 0.99]],
      clicks: [[0.08, '.dl-btn'], [0.15, '.di1', -20, 0], [0.17, '.di1', -20, 0], [0.31, '.done'], [0.39, '.d-gear'], [0.49, '.si-priv'], [0.64, '.oa', 0, -62], [0.78, '.oa2'], [0.95, '.ok2']],
      halo: [['.done', 0.22, 0.31], ['.oa2', 0.7, 0.78]],
      chips: [[0, 0.2], [0.2, 0.36], [0.36, 0.62], [0.62, 0.83], [0.83, 1]],
    };
    return { key: 'dlg' + host, html: MAC_CLOSE(inner) + label('mac', 'On your Mac') + cur(), tl, poster: 0.3, crop: true };
  };

  // Move to Applications, with the Downloads folder prompt the Mac may show.
  S.move = function () {
    const ask = malert('fa-ask', 'left:77px;top:34px', D.appIcon('ai') + '<b>' + q(APP) + ' would like to access files in your Downloads folder.</b><div class="btns"><div class="mb">Don’t Allow</div><div class="mb def fa-ok">Allow</div></div>') +
      '<div class="tagnote purple tg" style="left:180px;top:22px">Only if your Mac asks</div>';
    const win = '<div class="mwin mv" style="left:44px;top:22px;width:242px;height:132px"><div class="tb"><div class="lights"><i></i><i></i><i></i></div><span class="wtitle">Moving USB-C Display</span></div>' +
      '<div class="folder" style="left:32px;top:58px">' + folderSvg('<path d="M27 18v12M22 25l5 5 5-5" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>') + 'Downloads</div>' +
      '<div class="folder fa" style="left:150px;top:58px">' + folderSvg('<path d="M21 31l6-12 6 12M23.5 27h7" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>') + 'Applications</div>' +
      '<div class="abs fly" style="left:43px;top:40px;width:32px;height:32px">' + D.appIcon() + '</div>' +
      '<svg class="abs" width="242" height="132" style="left:0;top:0;pointer-events:none"><path d="M88 50 C 112 24, 144 24, 166 50" stroke="var(--m-text2)" stroke-dasharray="2 3" fill="none" stroke-width="1.2"/></svg></div>';
    const inner = menubar + win + ask + dock('<div class="di dapp">' + D.appIcon() + '<i class="dot" style="opacity:1"></i></div>');
    const html = MAC_CLOSE(inner) + label('mac', 'On your Mac') + cur();
    const tl = {
      dur: 8000,
      vis: [['.fa-ask', [[0.04, 0.3]], 'pop'], ['.tg', [[0.04, 0.3]], 'pop']],
      cursor: [[0.04, 320, 200], [0.18, '.fa-ok', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.3, '.fa-ok', 0, 2]],
      cursorVis: [[0.04, 0.32]],
      clicks: [[0.24, '.fa-ok']],
      halo: [['.fa-ok', 0.12, 0.24]],
      anim: [
        ['.fly', [{ offset: 0, transform: 'translate(0,0)', opacity: 1 }, { offset: 0.36, transform: 'translate(0,0)', easing: 'cubic-bezier(.5,0,.3,1)' }, { offset: 0.48, transform: 'translate(60px,-22px)', easing: 'cubic-bezier(.5,0,.3,1)' }, { offset: 0.6, transform: 'translate(118px,8px) scale(.7)', opacity: 1 }, { offset: 0.62, opacity: 0, transform: 'translate(118px,8px) scale(.6)' }, { offset: 0.97, opacity: 0 }, { offset: 1, opacity: 1, transform: 'translate(0,0)' }]],
        ['.fa', [{ offset: 0, transform: 'scale(1)' }, { offset: 0.61, transform: 'scale(1)' }, { offset: 0.65, transform: 'scale(1.1)' }, { offset: 0.7, transform: 'scale(1)' }, { offset: 1, transform: 'scale(1)' }]],
        ['.dapp', [{ offset: 0, transform: 'translateY(0)', opacity: 0 }, { offset: 0.7, opacity: 0 }, { offset: 0.72, opacity: 1, transform: 'translateY(0)' }, { offset: 0.76, transform: 'translateY(-8px)' }, { offset: 0.8, transform: 'translateY(0)' }, { offset: 0.84, transform: 'translateY(-5px)' }, { offset: 0.88, transform: 'translateY(0)' }, { offset: 0.97, opacity: 1 }, { offset: 1, opacity: 0 }]],
      ],
    };
    return { key: 'move', html, tl, poster: 0.5, crop: true };
  };

  // Start automatically: the Background Items Added note, or the fix.
  S.login = function (fix) {
    if (!fix) {
      const note = '<div class="mnote nt" style="left:164px;top:16px">' + '<div class="ni">' + D.icon('gear') + '</div><div><b>Background Items Added</b>' + bars([92, 70]) + '</div></div>' +
        '<div class="tagnote blue tg" style="left:176px;top:68px">That’s us. Nothing to click.</div>';
      const inner = menubar + note + dock();
      const tl = { dur: 7000, vis: [['.nt', [[0.08, 0.9]], 'slideL'], ['.tg', [[0.28, 0.9]], 'pop']] };
      return { key: 'login', html: MAC_CLOSE(inner) + label('mac', 'On your Mac'), tl, poster: 0.6, crop: true };
    }
    const set = settings('st', 'left:17px;top:16px;width:296px;height:152px', ['si-gen'],
      '<div class="pane"><div class="ttl"><span class="bk">‹</span>Login Items &amp; Extensions</div><div class="sec">Open at Login</div>' + grp(1) +
      '<div class="sec">Allow in the Background</div><div class="grp"><div class="row">' + D.appIcon() + '<span>' + esc(APP) + '</span><span class="sp"></span>' + tog('t1') + '</div><div class="row"><span class="gi g1"></span>' + bars([50]) + '<span class="sp"></span><div class="mtog on"></div></div></div></div>');
    const inner = menubar + set + dock();
    const tl = {
      dur: 7000,
      cursor: [[0.05, 300, 200], [0.36, '.t1', 2, 2, 'cubic-bezier(.5,0,.3,1)'], [0.9, '.t1', 2, 2]],
      cursorVis: [[0.05, 0.92]],
      clicks: [[0.44, '.t1', 2, 2]],
      anim: toggleAnim('.t1', 0.46, 0.96),
      halo: [['.t1', 0.24, 0.42]],
    };
    return { key: 'loginfix', html: MAC_CLOSE(inner) + label('mac', 'On your Mac') + cur(), tl, poster: 0.7, crop: true };
  };

  function toggleAnim(sel, on, off) {
    return [
      [sel + ' .g', [{ offset: 0, opacity: 0 }, { offset: on, opacity: 0 }, { offset: on + 0.03, opacity: 1 }, { offset: off, opacity: 1 }, { offset: Math.min(1, off + 0.02), opacity: 0 }, { offset: 1, opacity: 0 }]],
      [sel + ' .k', [{ offset: 0, transform: 'translateX(0)' }, { offset: on, transform: 'translateX(0)', easing: 'cubic-bezier(.3,1.4,.5,1)' }, { offset: on + 0.03, transform: 'translateX(8px)' }, { offset: off, transform: 'translateX(8px)' }, { offset: Math.min(1, off + 0.02), transform: 'translateX(0)' }, { offset: 1, transform: 'translateX(0)' }]],
    ];
  }

  // A privacy pane with USB-C Display's switch.
  function privPane(title) {
    return '<div class="pane"><div class="ttl"><span class="bk">‹</span>' + title + '</div>' + bars([90, 64], 'l') +
      '<div class="grp" style="margin-top:6px"><div class="row">' + D.appIcon() + '<span>' + esc(APP) + '</span><span class="sp"></span>' + tog('t1') + '</div><div class="row"><span class="gi g2"></span>' + bars([46]) + '<span class="sp"></span><div class="mtog"></div></div></div></div>';
  }

  // Screen Recording: prompt, pane, toggle, password, Quit & Reopen. When
  // the Mac already asked once, it opens straight on the pane.
  S.screen = function (prompted) {
    const ask = malert('a1', 'left:77px;top:24px', D.appIcon('ai') + '<b>' + q(APP) + ' would like to record this computer’s screen and audio.</b>' + bars([86, 60]) + '<div class="btns stack"><div class="mb def oss">Open System Settings</div><div class="mb">Deny</div></div>');
    const set = settings('st', 'left:17px;top:16px;width:296px;height:152px', ['si-priv'], privPane('Screen &amp; System Audio Recording'));
    const pw = pwSheet('a2', 'left:77px;top:30px', 'Modify Settings', 'ms');
    const qr = malert('a3', 'left:77px;top:36px', D.appIcon('ai') + '<b>' + q(APP) + ' may not be able to record the contents of your screen until it is quit.</b><div class="btns stack"><div class="mb def qr">Quit &amp; Reopen</div><div class="mb">Later</div></div>');
    const inner = menubar + set + (prompted ? '' : ask) + pw + qr + dock();
    let tl;
    if (!prompted) {
      tl = {
        dur: 13000,
        vis: [['.a1', [[0.02, 0.22]], 'pop'], ['.st', [[0.22, 0.98]], 'grow'], ['.a2', [[0.56, 0.76]], 'pop'], ['.a3', [[0.78, 0.98]], 'pop']],
        cursor: [[0.04, 320, 200], [0.14, '.oss', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.22, '.oss', 0, 2], [0.38, '.t1', 2, 2, 'cubic-bezier(.5,0,.3,1)'], [0.5, '.t1', 2, 2], [0.66, '.ms', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.76, '.ms', 0, 2], [0.88, '.qr', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.97, '.qr', 0, 2]],
        cursorVis: [[0.04, 0.98]],
        clicks: [[0.19, '.oss'], [0.44, '.t1', 2, 2], [0.73, '.ms'], [0.93, '.qr']],
        anim: toggleAnim('.t1', 0.45, 0.97),
        type: [['.pwd', '••••••••', 0.6, 0.68, 0.76]],
        halo: [['.oss', 0.06, 0.18], ['.t1', 0.3, 0.44]],
        chips: [[0, 0.22], [0.22, 0.54], [0.54, 0.77], [0.77, 1]],
      };
    } else {
      tl = {
        dur: 10000,
        vis: [['.st', [[0.02, 0.98]], 'grow'], ['.a2', [[0.42, 0.68]], 'pop'], ['.a3', [[0.72, 0.98]], 'pop']],
        cursor: [[0.04, 320, 200], [0.24, '.t1', 2, 2, 'cubic-bezier(.5,0,.3,1)'], [0.36, '.t1', 2, 2], [0.56, '.ms', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.68, '.ms', 0, 2], [0.86, '.qr', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.97, '.qr', 0, 2]],
        cursorVis: [[0.04, 0.98]],
        clicks: [[0.3, '.t1', 2, 2], [0.64, '.ms'], [0.92, '.qr']],
        anim: toggleAnim('.t1', 0.31, 0.97),
        type: [['.pwd', '••••••••', 0.46, 0.56, 0.68]],
        halo: [['.t1', 0.14, 0.3]],
        chips: [[0, 0.4], [0.4, 0.7], [0.7, 1]],
      };
    }
    return { key: 'screen' + (prompted ? 'p' : ''), html: MAC_CLOSE(inner) + label('mac', 'On your Mac') + cur(), tl, poster: prompted ? 0.36 : 0.5, crop: true };
  };

  // Accessibility: prompt, pane, toggle, password.
  S.access = function (prompted) {
    const ask = malert('a1', 'left:77px;top:28px', D.appIcon('ai') + '<b>' + q(APP) + ' would like to control this computer using accessibility features.</b>' + bars([86, 60]) + '<div class="btns stack"><div class="mb def oss">Open System Settings</div><div class="mb">Deny</div></div>');
    const set = settings('st', 'left:17px;top:16px;width:296px;height:152px', ['si-priv'], privPane('Accessibility'));
    const pw = pwSheet('a2', 'left:77px;top:30px', 'Modify Settings', 'ms');
    const inner = menubar + set + (prompted ? '' : ask) + pw + dock();
    let tl;
    if (!prompted) {
      tl = {
        dur: 10000,
        vis: [['.a1', [[0.02, 0.28]], 'pop'], ['.st', [[0.28, 0.98]], 'grow'], ['.a2', [[0.68, 0.96]], 'pop']],
        cursor: [[0.04, 320, 200], [0.18, '.oss', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.28, '.oss', 0, 2], [0.46, '.t1', 2, 2, 'cubic-bezier(.5,0,.3,1)'], [0.62, '.t1', 2, 2], [0.84, '.ms', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.96, '.ms', 0, 2]],
        cursorVis: [[0.04, 0.97]],
        clicks: [[0.24, '.oss'], [0.53, '.t1', 2, 2], [0.9, '.ms']],
        anim: toggleAnim('.t1', 0.54, 0.97),
        type: [['.pwd', '••••••••', 0.72, 0.82, 0.96]],
        halo: [['.oss', 0.08, 0.22], ['.t1', 0.38, 0.52]],
        chips: [[0, 0.28], [0.28, 0.66], [0.66, 1]],
      };
    } else {
      tl = {
        dur: 8000,
        vis: [['.st', [[0.02, 0.98]], 'grow'], ['.a2', [[0.5, 0.96]], 'pop']],
        cursor: [[0.04, 320, 200], [0.26, '.t1', 2, 2, 'cubic-bezier(.5,0,.3,1)'], [0.42, '.t1', 2, 2], [0.78, '.ms', 0, 2, 'cubic-bezier(.5,0,.3,1)'], [0.96, '.ms', 0, 2]],
        cursorVis: [[0.04, 0.97]],
        clicks: [[0.34, '.t1', 2, 2], [0.86, '.ms']],
        anim: toggleAnim('.t1', 0.35, 0.97),
        type: [['.pwd', '••••••••', 0.56, 0.7, 0.96]],
        halo: [['.t1', 0.14, 0.32]],
        chips: [[0, 0.48], [0.48, 1]],
      };
    }
    return { key: 'access' + (prompted ? 'p' : ''), html: MAC_CLOSE(inner) + label('mac', 'On your Mac') + cur(), tl, poster: prompted ? 0.45 : 0.6, crop: true };
  };

  // Choose the size: the laptop shows a Mac window at the chosen size.
  S.size = function (scale) {
    const k = Math.max(0.6, Math.min(1.6, (scale || 125) / 125));
    const lines = [92, 78, 86, 64, 80, 70, 88, 60].map((w) => '<i style="display:block;height:4px;width:' + w + '%;background:var(--m-btn);border-radius:2px;margin-top:5px"></i>').join('');
    const win = '<div class="mwin" style="left:24px;top:20px;width:242px;height:142px"><div class="tb" style="height:' + 16 * k + 'px"><div class="lights"><i></i><i></i><i></i></div></div>' +
      '<div style="padding:' + 8 * k + 'px ' + 10 * k + 'px"><div style="font:700 ' + 16 * k + 'px/' + 20 * k + 'px var(--m-font)">Aa Bb Cc</div><div style="font:400 ' + 9 * k + 'px/' + 12 * k + 'px var(--m-font);color:var(--m-text2);margin-top:' + 3 * k + 'px">This is how big text looks.</div>' + lines + '</div></div>';
    const html = pc(50, 30, 300, '<div class="abs" style="inset:0;background:var(--m-wall)">' + menubar + win + '</div>') + label('pc', 'On this laptop');
    return { key: 'size' + scale, html, tl: { dur: 1000 }, poster: 0 };
  };

  // First picture: click the button, the laptop shows the Mac's extra screen
  // (just wallpaper at first), the Mac's pointer slides in from the left,
  // then Ctrl + Alt + Esc brings Windows back.
  S.picture = function () {
    const macLayer = '<div class="abs ml" style="inset:0;z-index:11;background:var(--m-wall)">' + menubar +
      '<div class="chev ch-in" style="left:4px;top:66px"><span class="c1">' + D.icon('chevron') + '</span><span class="c2">' + D.icon('chevron') + '</span></div>' +
      '<div class="cur cm">' + CURSOR + '</div></div>';
    const pcIn = taskbar + '<div class="winapp" style="left:62px;top:30px;width:132px;height:78px"><div class="wt">' + D.appIcon() + '<i></i></div><div class="wc"><b>Ready for the first picture</b><div class="wbtn-a showb">Show my Mac’s screen</div></div></div>' + macLayer;
    const keys = '<div class="abs keyrow" style="left:68px;width:264px;top:212px"><div class="keycap k1">Ctrl</div><span class="plus">+</span><div class="keycap k2">Alt</div><span class="plus">+</span><div class="keycap k3">Esc</div></div>';
    const html = pc(68, 22, 264, pcIn) + keys + '<div class="tagnote blue tg" style="left:284px;top:216px">Windows is back</div>' +
      '<div class="tagnote purple tm" style="left:96px;top:60px">Your Mac’s pointer</div>' + label('pc', 'On this laptop') + cur('', true);
    const press = (sel, t) => [sel, [{ offset: 0, transform: 'translateY(0)' }, { offset: t, transform: 'translateY(0)' }, { offset: t + 0.01, transform: 'translateY(2px)' }, { offset: 0.74, transform: 'translateY(2px)' }, { offset: 0.75, transform: 'translateY(0)' }, { offset: 1, transform: 'translateY(0)' }]];
    const tl = {
      dur: 10000,
      vis: [['.ml', [[0.2, 0.72]]], ['.tg', [[0.76, 0.96]], 'pop'], ['.tm', [[0.46, 0.6]], 'pop']],
      cursor: [[0.02, 250, 200], [0.1, '.showb', 4, 2, 'cubic-bezier(.5,0,.3,1)'], [0.18, '.showb', 4, 2]],
      cursorVis: [[0.02, 0.19]],
      clicks: [[0.14, '.showb', 4, 2]],
      halo: [['.showb', 0.04, 0.14]],
      anim: [press('.k1', 0.62), press('.k2', 0.65), press('.k3', 0.68),
        ['.cm', [{ offset: 0, transform: 'translate(-14px,60px)', opacity: 0 }, { offset: 0.34, transform: 'translate(-14px,60px)', opacity: 1, easing: 'cubic-bezier(.3,0,.3,1)' }, { offset: 0.48, transform: 'translate(96px,74px)', opacity: 1 }, { offset: 0.6, transform: 'translate(120px,70px)', opacity: 1 }, { offset: 0.72, transform: 'translate(120px,70px)', opacity: 1 }, { offset: 0.73, opacity: 0 }, { offset: 1, opacity: 0 }]],
        ['.ch-in .c1', [{ offset: 0, opacity: 0 }, { offset: 0.24, opacity: 0 }, { offset: 0.28, opacity: 1 }, { offset: 0.34, opacity: 0.2 }, { offset: 0.38, opacity: 0 }, { offset: 1, opacity: 0 }]],
        ['.ch-in .c2', [{ offset: 0, opacity: 0 }, { offset: 0.27, opacity: 0 }, { offset: 0.31, opacity: 1 }, { offset: 0.37, opacity: 0.2 }, { offset: 0.4, opacity: 0 }, { offset: 1, opacity: 0 }]]],
      chips: [[0, 0.2], [0.2, 0.58], [0.58, 1]],
    };
    return { key: 'picture', html, tl, poster: 0.5 };
  };

  // Find your new screen: the pointer slides off the Mac onto the laptop.
  S.find = function () {
    const y = 58;
    const macIn = menubar + '<div class="cur cm">' + CURSOR + '</div>';
    const pcIn = taskbar + '<div class="abs" style="inset:0;z-index:11;background:var(--m-wall)">' + menubar + '</div><div class="cur cp">' + CURSOR + '</div>';
    const html = mac(22, y, 160, macIn) + pc(218, y, 160, pcIn) +
      '<svg class="abs cable" width="400" height="250" style="left:0;top:0"><path class="c" d="M190 ' + (y + 109) + ' C 206 ' + (y + 111) + ', 186 ' + (y + 160) + ', 200 ' + (y + 160) + ' C 214 ' + (y + 160) + ', 194 ' + (y + 112) + ', 212 ' + (y + 111) + '"/></svg>' +
      '<div class="abs edge" style="left:174px;top:' + (y + 16) + 'px;width:3px;height:84px;border-radius:2px;background:var(--accent)"></div>' +
      '<div class="chev" style="left:184px;top:' + (y + 50) + 'px"><span class="c1">' + D.icon('chevron') + '</span><span class="c2">' + D.icon('chevron') + '</span></div>' +
      cap('mac', 'Your Mac', 102, y + 126) + cap('pc', 'This laptop', 298, y + 128);
    const pts = [[0, 50, 48], [0.12, 50, 48], [0.5, 162, 40], [0.72, 230, 50], [1, 230, 50]];
    const mk = (dx) => pts.map((p, i) => ({ offset: p[0], transform: 'translate(' + (p[1] + dx) + 'px,' + p[2] + 'px)', easing: i === 1 ? 'cubic-bezier(.4,0,.6,1)' : 'linear' }));
    const tl = {
      dur: 5000,
      anim: [['.cm', mk(0)], ['.cp', mk(-150)],
        ['.edge', [{ offset: 0, opacity: 0 }, { offset: 0.25, opacity: 0 }, { offset: 0.35, opacity: 1 }, { offset: 0.55, opacity: 1 }, { offset: 0.65, opacity: 0 }, { offset: 1, opacity: 0 }]],
        ['.c1', [{ offset: 0, opacity: 0.2 }, { offset: 0.3, opacity: 0.2 }, { offset: 0.38, opacity: 1 }, { offset: 0.6, opacity: 0.2 }, { offset: 1, opacity: 0.2 }]],
        ['.c2', [{ offset: 0, opacity: 0.2 }, { offset: 0.36, opacity: 0.2 }, { offset: 0.44, opacity: 1 }, { offset: 0.66, opacity: 0.2 }, { offset: 1, opacity: 0.2 }]]],
      vis: [['.cm', [[0, 0.95]]], ['.cp', [[0, 0.95]]]],
    };
    return { key: 'find', html, tl, poster: 0.47 };
  };

  // Waiting on this laptop while the Mac app restarts. Nothing changes on the
  // Mac, so the picture is of this laptop.
  S.waiting = function (text) {
    const pcIn = taskbar + '<div class="winapp" style="left:55px;top:40px;width:180px;height:84px"><div class="wt">' + D.appIcon() + '<i></i></div><div class="wc wcc">' + winSpin + '<b>' + esc(text) + '</b></div></div>';
    const html = pc(50, 30, 300, pcIn) + label('pc', 'On this laptop');
    return { key: 'wait' + text, html, tl: { dur: 1000 }, poster: 0 };
  };

  // Unplugged or not reachable: devices with a gap.
  S.unplugged = function () {
    const html = twoDevices(menubar, taskbar) +
      '<svg class="abs cable" width="400" height="250" style="left:0;top:0"><path class="c" style="opacity:.5" d="M183 150 C 196 151, 186 196, 196 204"/><rect class="plug" x="178" y="147" width="8" height="5" rx="1.5"/></svg>' +
      '<div class="badge bad" style="left:187px;top:84px">' + D.icon('x') + '</div>' +
      cap('mac', 'Your Mac', 99, 160) + cap('pc', 'This laptop', 301, 162);
    return { key: 'unplugged', html, tl: { dur: 1000 }, poster: 0 };
  };

  D.scenes = S;

  // ---------- Timeline engine ----------
  // Build Web Animations for one scene root. Returns the animations.
  D.playScene = function (root, tl, start) {
    const anims = [];
    if (!tl || !root.animate) return anims;
    const dur = tl.dur || 6000;
    const wrap = root.closest('.scene-wrap') || root;
    const wr = wrap.getBoundingClientRect();
    const k = wr.width / 400 || 1;
    const all = (sel) => Array.from(root.querySelectorAll(sel));
    const first = (sel) => root.querySelector(sel);
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const center = (sel, dx, dy) => {
      const el = typeof sel === 'string' ? first(sel) : sel;
      if (!el) return [200, 125];
      const r = el.getBoundingClientRect();
      return [(r.left + r.width / 2 - wr.left) / k + (dx || 0), (r.top + r.height / 2 - wr.top) / k + (dy || 0)];
    };
    const box = (sel) => {
      const el = first(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (r.left - wr.left) / k, y: (r.top - wr.top) / k, w: r.width / k, h: r.height / k };
    };
    const pt = (e) => (typeof e[1] === 'string' ? center(e[1], e[2], e[3]) : [e[1], e[2]]);
    const add = (el, kf, extra) => {
      if (!el) return;
      kf = normalize(kf);
      const o = { duration: dur, iterations: Infinity, fill: 'both' };
      const a = el.animate(kf, o);
      if (extra && extra.delayFrac) a._shift = extra.delayFrac * dur;
      anims.push(a);
    };

    // Resolve every target point before anything moves.
    const halos = (tl.halo || []).map((h) => [box(h[0]), h[1], h[2]]);
    const clicks = (tl.clicks || []).map((c) => [c[0], pt(c)]);
    const cursorPts = (tl.cursor || []).map((c) => {
      const p = pt(c);
      const easing = typeof c[1] === 'string' ? c[4] : c[3];
      return { t: c[0], x: p[0], y: p[1], easing };
    });

    // Cursor
    const cu = first(':scope > .cur') || first('.cur:not(.cm):not(.cp)');
    if (cu && cursorPts.length) {
      const kf = cursorPts.map((c) => ({ offset: c.t, transform: 'translate(' + (c.x - 1) + 'px,' + (c.y - 1) + 'px)', easing: c.easing || 'linear' }));
      add(cu, kf);
      add(cu, visKf(tl.cursorVis || [[0, 1]], 0.015));
      if (clicks.length) {
        const pk = [{ offset: 0, transform: 'scale(1)' }];
        clicks.forEach(([t]) => { pk.push({ offset: clamp(t - 0.005), transform: 'scale(1)' }, { offset: clamp(t), transform: 'scale(.82)' }, { offset: clamp(t + 0.012), transform: 'scale(1)' }); });
        pk.push({ offset: 1, transform: 'scale(1)' });
        add(cu.querySelector('svg'), pk);
      }
    }
    // Click rings
    clicks.forEach(([t, p]) => {
      const r = document.createElement('div');
      r.className = 'ring';
      r.style.left = p[0] + 'px'; r.style.top = p[1] + 'px';
      root.appendChild(r);
      add(r, [{ offset: 0, opacity: 0, transform: 'scale(.3)' }, { offset: clamp(t - 0.002), opacity: 0, transform: 'scale(.3)' }, { offset: clamp(t), opacity: 0.95, transform: 'scale(.5)' }, { offset: clamp(t + 0.05), opacity: 0, transform: 'scale(1.6)' }, { offset: 1, opacity: 0, transform: 'scale(1.6)' }]);
    });
    // Highlight halos on what to click
    halos.forEach(([b, a, z]) => {
      if (!b) return;
      const h = document.createElement('div');
      h.className = 'halo';
      const pad = 3;
      Object.assign(h.style, { left: b.x - pad + 'px', top: b.y - pad + 'px', width: b.w + pad * 2 + 'px', height: b.h + pad * 2 + 'px', borderRadius: Math.min(12, b.h / 2 + pad) + 'px' });
      root.appendChild(h);
      add(h, [{ offset: 0, opacity: 0 }, { offset: clamp(a), opacity: 0 }, { offset: clamp(a + 0.02), opacity: 1 }, { offset: clamp((a + z) / 2), opacity: 0.55 }, { offset: clamp(z - 0.02), opacity: 1 }, { offset: clamp(z), opacity: 0 }, { offset: 1, opacity: 0 }]);
    });
    // Visibility ranges
    (tl.vis || []).forEach(([sel, ranges, mode]) => all(sel).forEach((el) => add(el, visKf(ranges, 0.018, mode))));
    // Class-like toggles (focus ring)
    (tl.cls || []).forEach(([sel, , a, z]) => all(sel).forEach((el) => {
      add(el, [{ offset: 0, boxShadow: '0 0 0 0 transparent' }, { offset: a, boxShadow: '0 0 0 0 transparent' }, { offset: a + 0.005, boxShadow: '0 0 0 1.5px #0a84ff' }, { offset: z, boxShadow: '0 0 0 1.5px #0a84ff' }, { offset: z + 0.005, boxShadow: '0 0 0 0 transparent' }, { offset: 1, boxShadow: '0 0 0 0 transparent' }]);
    }));
    // Typing
    (tl.type || []).forEach(([sel, text, a, z, end]) => all(sel).forEach((el) => {
      el.textContent = '';
      const n = text.length;
      for (let i = 0; i < n; i++) {
        const s = document.createElement('span');
        s.textContent = text[i];
        el.appendChild(s);
        const t = a + ((z - a) * i) / Math.max(1, n - 1);
        add(s, [{ offset: 0, opacity: 0 }, { offset: clamp(t), opacity: 0 }, { offset: clamp(t + 0.001), opacity: 1 }, { offset: clamp(end), opacity: 1 }, { offset: clamp(end + 0.001), opacity: 0 }, { offset: 1, opacity: 0 }]);
      }
    }));
    // Free-form keyframes
    (tl.anim || []).forEach(([sel, kf, extra]) => all(sel).forEach((el) => add(el, kf, extra)));

    // Sub-step chips outside the scene follow the same clock.
    if (tl.chips) {
      const subs = Array.from(document.querySelectorAll('.subs .sub'));
      const caps = Array.from(document.querySelectorAll('.sub-caps .sc'));
      tl.chips.forEach(([a, z], i) => {
        const el = subs[i];
        if (el) {
          let hl = el.querySelector('.hl');
          if (!hl) { hl = document.createElement('i'); hl.className = 'hl'; el.appendChild(hl); }
          add(hl, visKf([[a, z]], 0.01));
        }
        if (caps[i]) add(caps[i], visKf([[a, z]], 0.012, 'up'));
      });
    }

    const t0 = start != null ? start : document.timeline.currentTime;
    anims.forEach((a) => { a.startTime = t0 - (a._shift || 0); });
    return anims;
  };

  function visKf(ranges, f, mode) {
    const hid = { pop: 'scale(.94)', grow: 'scale(.9) translateY(10px)', slideL: 'translateX(24px)', up: 'translateY(8px)' }[mode];
    const on = (o) => (hid ? { offset: o, opacity: 1, transform: 'none' } : { offset: o, opacity: 1 });
    const off = (o) => (hid ? { offset: o, opacity: 0, transform: hid } : { offset: o, opacity: 0 });
    const kf = [];
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
    if (!sorted.length || sorted[0][0] > 0) kf.push(off(0));
    sorted.forEach(([a, z]) => {
      if (a <= 0) kf.push(on(0)); else { kf.push(off(a)); kf.push(Object.assign(on(Math.min(1, a + f)), { easing: 'linear' })); }
      if (z >= 1) kf.push(on(1)); else { kf.push(on(Math.max(0, z - f))); kf.push(off(z)); }
    });
    if (kf[kf.length - 1].offset < 1) kf.push(off(1));
    kf.forEach((k, i) => { if (i < kf.length - 1 && !k.easing) k.easing = 'cubic-bezier(.1,.9,.2,1)'; });
    return kf;
  }

  // Sort, clamp, and pad keyframes so they cover 0..1.
  function normalize(kf) {
    kf = kf.map((k) => Object.assign({}, k, { offset: Math.max(0, Math.min(1, k.offset)) })).sort((a, b) => a.offset - b.offset);
    if (kf[0].offset > 0) kf.unshift(Object.assign({}, kf[0], { offset: 0 }));
    const last = kf[kf.length - 1];
    if (last.offset < 1) kf.push(Object.assign({}, last, { offset: 1, easing: 'linear' }));
    return kf;
  }
})();
