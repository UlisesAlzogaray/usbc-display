// Replicas of the Mac's own screens for the steps that happen on the Mac.
// D.scenes.mac(name, opt) returns a scene like the ones in scenes.js
// ({ key, html, tl, poster, crop }), played by the same D.playScene.
//
// Each scene is a crop of a whole Mac screen (1512 x 982 pt, a 14-inch
// MacBook Pro). Windows and dialogs are built at their real size in points,
// measured from captures of macOS 27, and the screen is scaled down into the
// 400 x 250 canvas. Text, icons and artwork are drawn here: nothing is copied
// from Apple. The pointer and the ring around the target come from the
// timeline engine, so posters and reduced motion work as for every scene.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});

  const SCREEN = { w: 1512, h: 982 };
  const ACCENTS = ['purple', 'blue', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite', 'multicolor'];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q = (t) => '“' + t + '”';
  let uid = 0;
  const nid = (p) => 'mk' + p + (++uid);
  const px = (v) => Math.round(v * 100) / 100 + 'px';
  const at = (x, y, w, h) => 'left:' + px(x) + ';top:' + px(y) + (w != null ? ';width:' + px(w) : '') + (h != null ? ';height:' + px(h) : '');

  // ---------- Icons ----------

  // The app's own icon: the same drawing as mac/make-icon.m (a laptop in
  // front of a display), so it matches what the Mac shows for the app.
  function appIcon(cls, full) {
    const g = nid('g'), g2 = nid('g'), s1 = nid('s'), s2 = nid('s'), f = nid('f');
    const grad = (id, y1, y2, a, b) => '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="0" y1="' + y1 + '" x2="0" y2="' + y2 + '"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient>';
    // full: lists show the icon edge to edge, without the transparent margin.
    return '<svg viewBox="' + (full ? '98 98 828 828' : '0 0 1024 1024') + '"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"><defs>' +
      grad(g, 100, 924, '#54a3ff', '#1a5ee0') + grad(g2, 76, 900, '#54a3ff', '#1a5ee0') + grad(s1, 278, 540, '#dbedff', '#9ec7ff') + grad(s2, 470, 662, '#dbedff', '#9ec7ff') +
      '<filter id="' + f + '" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity=".28"/></filter></defs>' +
      '<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#' + g + ')" filter="url(#' + f + ')"/>' +
      '<g transform="translate(16 24)" fill="#fff"><rect x="586" y="548" width="44" height="92" rx="6"/><rect x="508" y="628" width="200" height="30" rx="15"/>' +
      '<rect x="392" y="252" width="432" height="314" rx="36"/><rect x="418" y="278" width="380" height="262" rx="16" fill="url(#' + s1 + ')"/>' +
      '<g fill="none" stroke="url(#' + g2 + ')" stroke-width="36" stroke-linejoin="round"><rect x="214" y="448" width="356" height="234" rx="28"/><rect x="168" y="680" width="448" height="46" rx="20"/></g>' +
      '<rect x="214" y="448" width="356" height="234" rx="28"/><rect x="236" y="470" width="312" height="192" rx="12" fill="url(#' + s2 + ')"/>' +
      '<rect x="168" y="680" width="448" height="46" rx="20"/><rect x="346" y="680" width="92" height="14" rx="7" fill="#ccdefa"/></g></svg>';
  }

  // Gatekeeper's icon: a vault door with a warning sign (drawn, 64 pt grid).
  function vaultIcon() {
    const b = nid('b'), k = nid('k'), w = nid('w');
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><defs>' +
      '<linearGradient id="' + b + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe7ec"/><stop offset=".45" stop-color="#c3cdd4"/><stop offset="1" stop-color="#bcc8d1"/></linearGradient>' +
      '<radialGradient id="' + k + '" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="#939caa"/><stop offset=".8" stop-color="#97a2b1"/><stop offset="1" stop-color="#cfdcee"/></radialGradient>' +
      '<linearGradient id="' + w + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8e06a"/><stop offset="1" stop-color="#dcae3b"/></linearGradient></defs>' +
      '<rect x="6.3" y="6.3" width="51.4" height="51.4" rx="12" fill="url(#' + b + ')"/><rect x="6.6" y="6.6" width="50.8" height="50.8" rx="11.7" fill="none" stroke="#a9b6bf" stroke-opacity=".7" stroke-width=".6"/>' +
      '<circle cx="13.5" cy="13.5" r="1.2" fill="#8d979f"/><circle cx="50.5" cy="13.5" r="1.2" fill="#8d979f"/><circle cx="13.5" cy="50.5" r="1.2" fill="#8d979f"/>' +
      '<path d="M30.5 9.4h3L32 11.3z" fill="#1d1f22"/>' +
      '<circle cx="31.7" cy="31.7" r="19.8" fill="#27292c"/>' +
      '<circle cx="31.7" cy="31.7" r="16.1" fill="none" stroke="#c4c6c8" stroke-width="3.5" stroke-dasharray=".7 1.6"/>' +
      '<circle cx="31.7" cy="31.7" r="11.3" fill="#5f656e"/><circle cx="31.7" cy="31.7" r="10.3" fill="none" stroke="#949ca7" stroke-width="1.7" stroke-dasharray=".45 .55"/>' +
      '<circle cx="31.7" cy="31.7" r="8.4" fill="url(#' + k + ')"/>' +
      '<path d="M45.6 36.8c1.2-2 4-2 5.2 0l10.4 17.9c1.2 2-.3 4.4-2.6 4.4H37.8c-2.3 0-3.8-2.4-2.6-4.4z" fill="url(#' + w + ')" stroke="#f4f4f2" stroke-width="2.3" stroke-linejoin="round"/>' +
      '<path d="M48.2 43.6v7.8" stroke="#fff" stroke-width="2.7" stroke-linecap="round"/><circle cx="48.2" cy="55" r="1.55" fill="#fff"/></svg>';
  }

  // The padlock on permission prompts, with the pane's badge.
  function lockIcon(badge) {
    const sh = nid('s'), bd = nid('b'), st = nid('p'), bg = nid('g');
    const rec = badge === 'record';
    return '<svg viewBox="0 0 64 66" aria-hidden="true"><defs>' +
      '<linearGradient id="' + sh + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9ccd1"/><stop offset=".35" stop-color="#f6f7f8"/><stop offset=".7" stop-color="#b6bac1"/><stop offset="1" stop-color="#e3e5e8"/></linearGradient>' +
      '<linearGradient id="' + bd + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5cf7f"/><stop offset=".55" stop-color="#e8b04f"/><stop offset="1" stop-color="#d79733"/></linearGradient>' +
      '<pattern id="' + st + '" width="4" height="2.1" patternUnits="userSpaceOnUse"><rect width="4" height=".7" fill="#b9802a" fill-opacity=".35"/></pattern>' +
      '<linearGradient id="' + bg + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + (rec ? '#f0605f' : '#3d95fa') + '"/><stop offset="1" stop-color="' + (rec ? '#df4446' : '#2479ef') + '"/></linearGradient></defs>' +
      '<path d="M14.2 29V20.6a15.3 15.3 0 0 1 30.6 0V29" fill="none" stroke="#8d929a" stroke-width="7.2"/>' +
      '<path d="M14.2 29V20.6a15.3 15.3 0 0 1 30.6 0V29" fill="none" stroke="url(#' + sh + ')" stroke-width="5.6"/>' +
      '<rect x="6.7" y="27.6" width="46.3" height="34.4" rx="1.6" fill="url(#' + bd + ')"/><rect x="6.7" y="27.6" width="46.3" height="34.4" rx="1.6" fill="url(#' + st + ')"/>' +
      '<rect x="6.7" y="27.6" width="46.3" height="34.4" rx="1.6" fill="none" stroke="#b07a25" stroke-opacity=".5" stroke-width=".6"/>' +
      '<rect x="35.5" y="40.6" width="25" height="24.4" rx="6.2" fill="url(#' + bg + ')" stroke="#000" stroke-opacity=".12" stroke-width=".5"/>' +
      (rec
        ? '<circle cx="48" cy="52.8" r="7.4" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="1.7"/><circle cx="48" cy="52.8" r="3.6" fill="#fff" fill-opacity=".95"/>'
        : '<path d="M41.2 47.4h4.4l1.4 1.6h3.4M41.2 47.4v10.4h12.6v-5.6" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="1.15" stroke-linejoin="round"/><path d="M42.6 50.4h6.6" stroke="#fff" stroke-opacity=".9" stroke-width="1"/>' +
          '<circle cx="54.6" cy="48.4" r="2.4" fill="none" stroke="#fff" stroke-width="2.3" stroke-dasharray="1.05 .85"/><circle cx="54.6" cy="48.4" r="1.6" fill="#fff"/><circle cx="54.6" cy="48.4" r=".8" fill="#2a7ff2"/>') +
      '</svg>';
  }

  // System Settings' own icon: a grey gear.
  function settingsIcon() {
    const b = nid('b'), r = nid('r');
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="' + b + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a9aa0"/><stop offset="1" stop-color="#5f5f66"/></linearGradient>' +
      '<linearGradient id="' + r + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f6"/><stop offset="1" stop-color="#c2c3c8"/></linearGradient></defs>' +
      '<rect x="6.3" y="6.3" width="51.4" height="51.4" rx="12" fill="url(#' + b + ')"/>' +
      '<circle cx="32" cy="32" r="19.5" fill="#3a3a40"/>' +
      '<circle cx="32" cy="32" r="16.6" fill="none" stroke="url(#' + r + ')" stroke-width="5.6" stroke-dasharray="3.3 3.2"/>' +
      '<circle cx="32" cy="32" r="13.2" fill="url(#' + r + ')"/><circle cx="32" cy="32" r="9" fill="#55555c"/>' +
      '<g stroke="url(#' + r + ')" stroke-width="2.4" stroke-linecap="round"><path d="M32 23.5v17M24.6 27.8l14.8 8.4M24.6 36.2l14.8-8.4"/></g><circle cx="32" cy="32" r="3.2" fill="#d8d9dd"/></svg>';
  }

  // Safari's compass (drawn).
  function safariIcon() {
    const b = nid('b'), c = nid('c');
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="' + b + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e4e8"/></linearGradient>' +
      '<linearGradient id="' + c + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fc3ff"/><stop offset="1" stop-color="#1b62e8"/></linearGradient></defs>' +
      '<rect x="6.3" y="6.3" width="51.4" height="51.4" rx="12" fill="url(#' + b + ')"/>' +
      '<circle cx="32" cy="32" r="21" fill="url(#' + c + ')"/><circle cx="32" cy="32" r="18.2" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2.2" stroke-dasharray=".5 2.35"/>' +
      '<path d="M43.5 20.5L35 35 20.5 43.5 29 29z" fill="#fff"/><path d="M43.5 20.5L29 29l6 6z" fill="#ff3b30"/></svg>';
  }

  // Small app icons for the lists (20 pt). Generic drawings.
  const SQ = (fill, inner, stroke) => '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x=".5" y=".5" width="19" height="19" rx="4.6" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width=".5"' : '') + '/>' + inner + '</svg>';
  const ICON = {
    quicktime: () => SQ('#48484c', '<circle cx="10" cy="10" r="6.6" fill="#1c1c1e"/><circle cx="10" cy="10" r="5.6" fill="none" stroke="#dcdce0" stroke-width="1.9"/><path d="M13.3 13.4l2.7 2.7" stroke="#dcdce0" stroke-width="2.2" stroke-linecap="round"/><path d="M8.7 7.6v4.8l3.9-2.4z" fill="#dcdce0"/>', 'rgba(255,255,255,.12)'),
    screenshot: () => SQ('#e9e9ec', '<rect x="3.4" y="4.6" width="13.2" height="9.6" rx="1.6" fill="none" stroke="#8a8a90" stroke-width="1" stroke-dasharray="1.6 1.1"/><path d="M7.6 8.2h1.1l.6-.9h1.4l.6.9h1.1v3.6H7.6z" fill="#5d5d63"/><circle cx="10" cy="10" r="1.1" fill="#e9e9ec"/>', 'rgba(0,0,0,.18)'),
    shortcuts: (id = nid('h')) => '<svg viewBox="0 0 20 20" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a7bfd"/><stop offset="1" stop-color="#d03ae4"/></linearGradient></defs><rect x=".5" y=".5" width="19" height="19" rx="4.6" fill="url(#' + id + ')"/><rect x="4" y="4.2" width="9" height="9" rx="2.6" transform="rotate(45 8.5 8.7)" fill="#fff" fill-opacity=".55"/><rect x="7" y="7.2" width="9" height="9" rx="2.6" transform="rotate(45 11.5 11.7)" fill="#fff" fill-opacity=".95"/></svg>',
    scripteditor: () => SQ('#f3f3f5', '<path d="M5 4.2h8.2v11.6H6.4A1.4 1.4 0 015 14.4z" fill="#fff" stroke="#a7a7ad" stroke-width=".7"/><path d="M6.6 7h5M6.6 9h5M6.6 11h3.4" stroke="#8a8a90" stroke-width=".7"/><path d="M15.6 6.4l1.2 1.2-6 6-1.7.5.5-1.7z" fill="#f2a33a" stroke="#c77a1a" stroke-width=".4"/>', 'rgba(0,0,0,.16)'),
    air: (id = nid('a')) => '<svg viewBox="0 0 20 20" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9f4a"/><stop offset=".45" stop-color="#ff4f8b"/><stop offset="1" stop-color="#7a5cff"/></linearGradient></defs><rect x=".5" y=".5" width="19" height="19" rx="4.6" fill="url(#' + id + ')"/><g fill="none" stroke="#fff" stroke-width="1.1"><ellipse cx="10" cy="10" rx="5.6" ry="2.6"/><ellipse cx="10" cy="10" rx="5.6" ry="2.6" transform="rotate(60 10 10)"/><ellipse cx="10" cy="10" rx="5.6" ry="2.6" transform="rotate(120 10 10)"/></g></svg>',
    filevault: () => SQ('#8e8e93', '<path d="M4.4 9.6L10 5l5.6 4.6V15H4.4z" fill="none" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/><circle cx="10" cy="11.6" r="1.7" fill="none" stroke="#fff" stroke-width="1.1"/>'),
    accessories: () => SQ('#8e8e93', '<rect x="3.6" y="7.6" width="12.8" height="4.8" rx="2.4" fill="none" stroke="#fff" stroke-width="1.3"/>'),
    shield: () => SQ('#2f7cf6', '<path d="M10 3.8l5 1.9v3.9c0 3.1-2.1 5.3-5 6.6-2.9-1.3-5-3.5-5-6.6V5.7z" fill="#fff"/><path d="M10 3.8v12.4c-2.9-1.3-5-3.5-5-6.6V5.7z" fill="#2f7cf6" fill-opacity=".25"/>'),
    hand: () => SQ('#2f7cf6', '<path d="M7.2 10.4V6.1a.9.9 0 011.8 0v3.5-4.4a.9.9 0 011.8 0v4.4-3.7a.9.9 0 011.8 0v4.3-2.6a.9.9 0 011.8 0v4.6c0 2.6-1.8 4.6-4.4 4.6-1.9 0-2.8-.9-3.8-2.5L4.6 9.9a.9.9 0 011.5-1z" fill="#fff"/>'),
    analytics: () => SQ('#2f7cf6', '<path d="M5.5 15V9.5M8.5 15V5.5M11.5 15V8M14.5 15V11" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'),
    ads: () => SQ('#2f7cf6', '<path d="M4.5 8.2h2.6L13 5v10l-5.9-3.2H4.5z" fill="#fff"/><path d="M15.2 8.4v3.2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>'),
  };

  // Sidebar of System Settings: colored tiles with a white glyph.
  const G = {
    appearance: '<circle cx="10" cy="10" r="5.2" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M10 4.8a5.2 5.2 0 010 10.4z" fill="#fff"/>',
    dock: '<rect x="4" y="5" width="12" height="10" rx="1.8" fill="none" stroke="#fff" stroke-width="1.3"/><path d="M5.6 12.4h8.8" stroke="#fff" stroke-width="1.6"/>',
    displays: '<circle cx="10" cy="10" r="2.6" fill="#fff"/><path d="M10 4.4v1.5M10 14.1v1.5M4.4 10h1.5M14.1 10h1.5M6 6l1.1 1.1M12.9 12.9L14 14M6 14l1.1-1.1M12.9 7.1L14 6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>',
    menubar: '<rect x="4" y="5.4" width="12" height="3.8" rx="1.9" fill="#fff"/><rect x="4" y="10.8" width="12" height="3.8" rx="1.9" fill="none" stroke="#fff" stroke-width="1.1"/>',
    siri: '<circle cx="10" cy="10" r="5.4" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M5 10c2-2.6 8-2.6 10 0M5 10c2 2.6 8 2.6 10 0" fill="none" stroke="#fff" stroke-width="1"/>',
    spotlight: '<circle cx="9" cy="9" r="3.8" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M11.8 11.8l3.4 3.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
    wallpaper: '<g fill="none" stroke="#fff" stroke-width="1.1"><circle cx="10" cy="6.4" r="2.4"/><circle cx="13.4" cy="8.8" r="2.4"/><circle cx="12.2" cy="12.8" r="2.4"/><circle cx="7.8" cy="12.8" r="2.4"/><circle cx="6.6" cy="8.8" r="2.4"/></g>',
    notifications: '<path d="M6 13.2V9.4a4 4 0 018 0v3.8l1.2 1.3H4.8z" fill="#fff"/><circle cx="10" cy="15.6" r="1.3" fill="#fff"/>',
    sound: '<path d="M4.4 8.2h2.4L10 5.4v9.2l-3.2-2.8H4.4z" fill="#fff"/><path d="M12 7.6a3.2 3.2 0 010 4.8M13.8 6a5.6 5.6 0 010 8" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>',
    focus: '<path d="M12.6 4.8a5.6 5.6 0 105 7.6 4.6 4.6 0 01-5-7.6z" fill="#fff"/>',
    screentime: '<path d="M6.2 4.4h7.6M6.2 15.6h7.6M7 4.6c0 3 3 3.6 3 5.4s-3 2.4-3 5.4M13 4.6c0 3-3 3.6-3 5.4s3 2.4 3 5.4" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>',
    lockscreen: '<rect x="6" y="9" width="8" height="6" rx="1.2" fill="#fff"/><path d="M7.6 9V7.4a2.4 2.4 0 014.8 0V9" fill="none" stroke="#fff" stroke-width="1.3"/>',
    privacy: '<path d="M7.2 10.4V6.1a.9.9 0 011.8 0v3.5-4.4a.9.9 0 011.8 0v4.4-3.7a.9.9 0 011.8 0v4.3-2.6a.9.9 0 011.8 0v4.6c0 2.6-1.8 4.6-4.4 4.6-1.9 0-2.8-.9-3.8-2.5L4.6 9.9a.9.9 0 011.5-1z" fill="#fff"/>',
    touchid: '<g fill="none" stroke="#e2445c" stroke-width="1" stroke-linecap="round"><path d="M5.6 8.4a4.6 4.6 0 018.8 0M6.8 14.8a7 7 0 01-.8-3.2 4 4 0 018 0v.6"/><path d="M8.6 15.6a6.6 6.6 0 01-.7-3.4 2.1 2.1 0 014.2 0c0 1.2.3 2.2.8 3.1M10 12.2c0 1.6.4 2.9 1.1 4"/></g>',
    users: '<circle cx="7.6" cy="7.6" r="2.2" fill="#fff"/><circle cx="12.8" cy="7.9" r="1.9" fill="#fff"/><path d="M3.8 14.4c.4-2.3 2-3.4 3.8-3.4s3.4 1.1 3.8 3.4zM11.4 14.4c-.1-1.3-.5-2.3-1.1-3 .8-.4 1.6-.5 2.5-.4 1.5.2 2.7 1.3 3 3.4z" fill="#fff"/>',
    gamecenter: '<circle cx="8" cy="8.4" r="3.4" fill="#ff5a6e"/><circle cx="12.6" cy="9" r="3" fill="#ffc53d" fill-opacity=".9"/><circle cx="10.6" cy="12.6" r="3.2" fill="#5ac8fa" fill-opacity=".9"/><circle cx="12.4" cy="12.4" r="2" fill="#7f5af0" fill-opacity=".85"/>',
    general: '<circle cx="10" cy="10" r="3.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="1.9 1"/><circle cx="10" cy="10" r="1.5" fill="#fff"/>',
  };
  const TILE = { appearance: '#1c1c1e', dock: '#1c1c1e', displays: '#2f7cf6', menubar: '#8e8e93', siri: 'linear', spotlight: '#8e8e93', wallpaper: '#30b0c7', notifications: '#ff3b30', sound: '#ff2d55', focus: '#5e5ce6', screentime: '#5e5ce6', lockscreen: '#1c1c1e', privacy: '#2f7cf6', touchid: '#ffffff', users: '#2f7cf6', gamecenter: '#ffffff', general: '#8e8e93' };
  function tile(n) {
    const id = nid('t');
    const fill = TILE[n] === 'linear' ? 'url(#' + id + ')' : TILE[n];
    const defs = TILE[n] === 'linear' ? '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a8cff"/><stop offset=".5" stop-color="#c04bff"/><stop offset="1" stop-color="#ff5a7a"/></linearGradient></defs>' : '';
    return '<svg viewBox="0 0 20 20" aria-hidden="true">' + defs + '<rect x=".5" y=".5" width="19" height="19" rx="4.6" fill="' + fill + '"' + (TILE[n] === '#ffffff' || TILE[n] === '#1c1c1e' ? ' stroke="rgba(128,128,128,.35)" stroke-width=".5"' : '') + '/>' + G[n] + '</svg>';
  }

  // Line glyphs used in toolbars and lists.
  const GL = {
    back: '<svg viewBox="0 0 9 15"><path d="M7.6 1.2L1.5 7.5l6.1 6.3" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fwd: '<svg viewBox="0 0 9 15"><path d="M1.4 1.2l6.1 6.3-6.1 6.3" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg class="mk-chev" viewBox="0 0 6 11"><path d="M1 1l4 4.5L1 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    updown: '<svg viewBox="0 0 8 12"><path d="M1.2 4.4L4 1.6l2.8 2.8M1.2 7.6L4 10.4l2.8-2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mag: '<svg viewBox="0 0 14 14"><circle cx="5.8" cy="5.8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9.2 9.2l3.6 3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 11 11"><path d="M5.5 0v11M0 5.5h11" stroke="currentColor" stroke-width="1.3"/></svg>',
    minus: '<svg viewBox="0 0 11 11"><path d="M0 5.5h11" stroke="currentColor" stroke-width="1.3"/></svg>',
    sidebar: '<svg viewBox="0 0 17 17"><rect x="1.5" y="2.5" width="14" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 2.8v11.4" stroke="currentColor" stroke-width="1.4"/></svg>',
    share: '<svg viewBox="0 0 17 17"><path d="M8.5 1.6v9.4M5.4 4.6l3.1-3 3.1 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 7.2H4.4a1.4 1.4 0 00-1.4 1.4v5.6a1.4 1.4 0 001.4 1.4h8.2a1.4 1.4 0 001.4-1.4V8.6a1.4 1.4 0 00-1.4-1.4h-1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    newtab: '<svg viewBox="0 0 17 17"><path d="M8.5 2.5v12M2.5 8.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    tabs: '<svg viewBox="0 0 17 17"><rect x="1.8" y="4.6" width="10.6" height="10.6" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.8 2h7.8a2.4 2.4 0 012.4 2.4v7.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    reload: '<svg viewBox="0 0 14 14"><path d="M11.6 7.2A4.6 4.6 0 117 2.6c1.6 0 2.9.7 3.8 1.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11.4 1.6v3.2H8.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dlcircle: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 4.8v7.6M5.9 9.4L9 12.5l3.1-3.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrowdl: '<svg viewBox="0 0 20 20"><path d="M10 2v11m0 0l-4.5-4.5M10 13l4.5-4.5M3 17h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    returnkey: '<svg viewBox="0 0 12 10"><path d="M10.5 1v4.4H2M4.6 2.6L1.6 5.4l3 2.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const laptopLine = '<svg width="64" height="44" viewBox="0 0 64 44"><rect x="8" y="3" width="48" height="31" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M2 38h60l-3 4H5z" fill="currentColor"/></svg>';
  const macLine = '<svg width="64" height="44" viewBox="0 0 64 44"><rect x="8" y="3" width="48" height="31" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M2 38h60l-3 4H5z" fill="currentColor"/><circle cx="32" cy="6" r="1" fill="currentColor"/></svg>';

  // macOS arrow pointer, black with a white edge. Its tip sits at (1, 1) of
  // the box, which is where the timeline engine puts the click point.
  function pointer(c) {
    const w = 14 * c + 3, h = 21 * c + 3;
    return '<div class="cur mk-cur"><svg viewBox="0 0 ' + w.toFixed(2) + ' ' + h.toFixed(2) + '" style="width:' + px(w) + ';height:' + px(h) + '"><g transform="translate(1 1) scale(' + c.toFixed(3) + ')">' +
      '<path d="M0 0V16.4L3.9 12.7 6.45 18.5 8.75 17.5 6.3 11.85H11.7Z" fill="#000" stroke="#fff" stroke-width="1.3" stroke-linejoin="round" paint-order="stroke"/></g></svg></div>';
  }

  // ---------- Pieces ----------
  const lights = '<div class="mk-lights"><i></i><i></i><i></i></div>';
  function sw(on, cls) {
    return '<div class="mk-sw' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '"><i class="tr"></i><i class="kn"><i class="kt"></i></i></div>';
  }

  // System Settings sidebar, scrolled the way the captures show it. y is the
  // centre of each row in window points.
  const SIDEBAR = [
    ['appearance', 'Appearance', 90], ['dock', 'Desktop &amp; Dock', 122], ['displays', 'Displays', 154], ['menubar', 'Menu Bar', 186], ['siri', 'Siri', 218], ['spotlight', 'Spotlight', 250], ['wallpaper', 'Wallpaper', 282],
    ['notifications', 'Notifications', 327], ['sound', 'Sound', 359], ['focus', 'Focus', 391], ['screentime', 'Screen Time', 423],
    ['lockscreen', 'Lock Screen', 468], ['privacy', 'Privacy &amp; Security', 500], ['touchid', 'Touch ID &amp; Password', 532], ['users', 'Users &amp; Groups', 564],
    ['gamecenter', 'Game Center', 609],
  ];
  function sidebar(sel) {
    const rows = SIDEBAR.map((r) => '<div class="mk-si' + (r[0] === sel ? ' sel' : '') + '" style="top:' + (r[2] - 16) + 'px"><i class="ic">' + tile(r[0]) + '</i><span>' + r[1] + '</span></div>').join('');
    return '<div class="mk-side">' + rows + '<div class="mk-sfade"></div><div class="mk-search">' + GL.mag + '<span>Search</span></div>' + lights + '</div>';
  }

  // One System Settings window. cfg: { x, y, sel, title, pane, edge, off, extra (in the
  // content area), over (over the whole window, for sheets) }
  function settingsWin(cfg) {
    return '<div class="mk-win mk-set' + (cfg.off ? ' off' : '') + '" style="' + at(cfg.x, cfg.y) + '">' + sidebar(cfg.sel) +
      '<div class="mk-main"><div class="mk-pane">' + cfg.pane + '</div>' +
      '<div class="mk-tb' + (cfg.edge ? ' edge' : '') + '"><div class="bf"><span class="b">' + GL.back + '</span><i></i><span class="f">' + GL.fwd + '</span></div><div class="ttl">' + cfg.title + '</div></div>' +
      (cfg.extra || '') + '</div>' + (cfg.over || '') + '</div>';
  }
  // A grouped box at a fixed position in the pane.
  const group = (y, rows, style) => '<div class="mk-g" style="top:' + px(y) + (style ? ';' + style : '') + '">' + rows + '</div>';
  const row = (icon, name, right, cls) => '<div class="mk-r' + (icon ? ' ic' : '') + (cls ? ' ' + cls : '') + '">' + (icon ? '<i class="ic">' + icon + '</i>' : '') + '<span>' + name + '</span><span class="sp"></span>' + (right || '') + '</div>';
  const valChev = (v) => (v ? '<span class="val">' + v + '</span>' : '') + GL.chev;

  // ---------- Panes (positions in pane points, from the captures) ----------

  // Privacy & Security scrolled down to the Security section (sec-Security).
  function paneSecurity(o, btnCls) {
    const app = esc(o.appName);
    return group(-26.5, row(ICON.analytics(), 'Analytics &amp; Improvements', valChev('')) + row(ICON.ads(), 'Apple Advertising', valChev(''))) +
      group(71, row(ICON.air(), 'Apple Intelligence Report', valChev('On')), 'height:42px') +
      '<div class="mk-hdr" style="top:141.5px">Security</div>' +
      group(169, '<div class="mk-r" style="height:37.5px"><span>Allow applications from</span><span class="sp"></span><span class="mk-pop">App Store &amp; Known Developers<b>' + GL.updown + '</b></span></div>') +
      group(216.5, '<div class="mk-r" style="height:auto;align-items:flex-start;padding-top:6.5px;padding-bottom:10px;white-space:normal"><span style="width:272px;line-height:16px;margin-top:3.9px">' + q(app + '.app') + ' was blocked to protect your Mac.</span><span class="sp"></span><span class="mk-pb ' + (btnCls || '') + '" style="margin-right:0.5px">Open Anyway</span></div>' +
        '<div class="mk-r" style="height:auto;padding-top:10.5px;padding-bottom:10px;white-space:normal;display:block"><span class="mk-note" style="display:block;color:var(--tx2)">Apple could not verify ' + q(app + '.app') + ' is free of malware that may harm your Mac or compromise your privacy.</span></div>') +
      group(327.5, row(ICON.filevault(), 'FileVault', valChev('Off')) + row(ICON.accessories(), 'Accessories', valChev('Ask')) + row(ICON.shield(), 'Background Security Improvements', valChev(''))) +
      group(465.5, row(ICON.hand(), 'Lockdown Mode', valChev('Off')), 'height:42px') +
      '<div class="mk-desc" style="top:518px;left:30.5px;width:440px;color:var(--tx3)">Your Mac can reduce your exposure to digital threats by applying security limits to apps and features. This is intended for people in high-risk situations, such as journalists, activists, and public figures.</div>' +
      '<div class="a" style="right:54.5px;top:579.5px"><span class="mk-pb" style="height:23.5px;width:94px;padding:0">Advanced…</span></div><div class="a" style="right:20.5px;top:579.5px"><span class="mk-help">?</span></div>';
  }

  // A privacy list with switches (Screen & System Audio Recording style).
  function appList(y, apps, header) {
    const rows = apps.map((a) => '<div class="mk-r ic" style="height:40px"><i class="ic">' + a[0] + '</i><span>' + a[1] + '</span><span class="sp"></span>' + sw(a[2], a[3]) + '</div>').join('');
    return group(y, (header || '') + rows + '<div class="mk-pm">' + GL.plus + '<i></i>' + GL.minus + '</div>');
  }
  function paneScreen(o, on, tgt) {
    return '<div class="mk-hdr" style="top:63px">Screen &amp; System Audio Recording</div>' +
      '<div class="mk-desc" style="top:81px">Allow the applications below to record the content of your screen and audio, even<br>while using other applications.</div>' +
      appList(119.5, [[ICON.quicktime(), 'QuickTime Player', true], [ICON.screenshot(), 'Screenshot', true], [appIcon('', true), esc(o.appName) + '.app', on, tgt ? 'tgt' : '']]);
  }
  function paneAx(o, on) {
    const head = '<div class="mk-r" style="height:68px;align-items:flex-start;padding-top:12.4px;white-space:normal;color:var(--tx2)"><span>Apps with this access can view and send email, edit contacts and photos, monitor your keyboard, track websites, record your screen, control any app on your Mac, and more.</span></div><div style="height:1px;background:var(--sep)"></div>';
    return appList(64, [[ICON.scripteditor(), 'Script Editor', true], [ICON.shortcuts(), 'Shortcuts', true], [appIcon('', true), esc(o.appName) + '.app', on, 'tgt']], head);
  }
  // Login Items, scrolled so Background App Activity sits under the toolbar.
  function paneLogin(o) {
    const s = 170;
    return '<div class="mk-g" style="top:' + (105.5 - s) + 'px;height:118.5px"><div class="mk-r" style="height:27.5px;background:color-mix(in srgb,var(--grp) 80%,var(--tx) 6%);font-size:12px"><span style="width:236px">Item</span><span>Kind</span></div>' +
      '<div class="a" style="left:0;right:0;bottom:0;height:24.5px"><div class="mk-pm" style="height:24.5px">' + GL.plus + '<i></i>' + GL.minus + '</div></div></div>' +
      '<div class="mk-hdr" style="top:' + (254.5 - s) + 'px">Background App Activity</div>' +
      '<div class="mk-desc" style="top:' + (273 - s) + 'px">These apps can automatically run in the background to do things like sync data and<br>check for updates.</div>' +
      group(311 - s, '<div class="mk-r two"><i class="ic">' + appIcon('', true) + '</i><span><span class="nm">' + esc(o.appName) + '</span><span class="st">Not running in background</span></span><span class="sp"></span>' + sw(false, 'tgt') + '</div>');
  }
  // Displays with two displays: the arrangement sheet over the pane.
  function paneDisplays() {
    const dw = nid('w');
    const mbp = '<svg viewBox="0 0 120 76" width="120" height="76"><rect x="12" y="2" width="96" height="62" rx="5" fill="#1b1b1d" stroke="#6b6b70" stroke-width="1"/><rect x="16" y="6" width="88" height="54" rx="1.5" fill="url(#' + dw + ')"/><path d="M2 66h116l-3 6.5c-.5 1-1.4 1.5-2.5 1.5H7.5c-1.1 0-2-.5-2.5-1.5z" fill="#9b9ca1"/><rect x="50" y="2" width="20" height="3" rx="1.5" fill="#1b1b1d"/></svg>';
    const mon = '<svg viewBox="0 0 120 76" width="120" height="76"><rect x="6" y="2" width="108" height="62" rx="4" fill="#1b1b1d" stroke="#6b6b70" stroke-width="1"/><rect x="10" y="6" width="100" height="54" rx="1.5" fill="url(#' + dw + ')"/><path d="M52 64h16l2 8H50z" fill="#8c8d92"/><rect x="42" y="71" width="36" height="3" rx="1.5" fill="#a3a4a9"/></svg>';
    return '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="' + dw + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3d9a"/><stop offset=".5" stop-color="#6a3aa8"/><stop offset="1" stop-color="#c0508a"/></linearGradient></defs></svg>' +
      '<div class="mk-dth" style="left:94px;top:84px;width:140px">' + mbp + '<div style="margin-top:12px">Built-in Display</div></div>' +
      '<div class="mk-dth" style="left:274px;top:84px;width:140px;font-weight:400">' + mon + '<div style="margin-top:12px">USB-C Display</div></div>' +
      '<div class="a" style="left:0;right:0;top:210px;height:1px;background:var(--sep)"></div>' +
      group(231, row(null, 'Use as', '<span class="val" style="margin-right:4px">Main display</span><span class="mk-pop"><b>' + GL.updown + '</b></span>') + row(null, 'Resolution', '<span class="val">Default</span>')) +
      group(330, row(null, 'Brightness', '') + row(null, 'Automatically adjust brightness', sw(true)) + row(null, 'True Tone', sw(true)));
  }

  // ---------- Dialogs ----------
  // Gatekeeper-style alert. cfg: { x, y, icon, title, body: [..], field, buttons: [[label, cls]], row, help }
  function alertBox(cfg) {
    return '<div class="mk-al ' + (cfg.cls || '') + '"' + (cfg.x != null ? ' style="' + at(cfg.x, cfg.y) + '"' : '') + '>' + (cfg.help ? '<div class="q">?</div>' : '') +
      '<div class="ai">' + cfg.icon + '</div><h4>' + cfg.title + '</h4>' + (cfg.body || []).map((p) => '<p>' + p + '</p>').join('') + (cfg.field || '') +
      '<div class="bt' + (cfg.row ? ' row' : '') + '">' + cfg.buttons.map((b) => '<div class="' + (b[1] || '') + '">' + b[0] + '</div>').join('') + '</div></div>';
  }
  // Permission prompt (Screen Recording, Device Control and Data Access).
  function prompt(cfg) {
    return '<div class="mk-pr ' + (cfg.cls || '') + '" style="' + at(cfg.x, cfg.y) + '"><div class="bar">' + cfg.title + '</div><div class="lk">' + lockIcon(cfg.badge) + '</div>' +
      '<div class="tx"><b>' + cfg.msg + '</b><p>Grant access to this application in Privacy &amp; Security<br>settings, located in System Settings.</p></div>' +
      '<span class="mk-help">?</span><div class="bt"><div class="tgt">Open System Settings</div><div>Deny</div></div></div>';
  }

  // ---------- Safari ----------
  const SAF = { x: 326, y: 120, w: 860, h: 640 };
  // The download page. state: 'dl' (before) or 'after' (download started).
  // tgt: the page's main button is what the pointer clicks.
  function page(o, state, top, tgt) {
    const T = tgt ? ' tgt' : '';
    const n = esc(o.appName);
    let h = '<div class="mk-page" style="top:' + px(top) + '"><main><div class="icon">' + appIcon() + '</div><h1>' + n + '</h1><p class="pl">Use your laptop as a second screen for this Mac.</p>' +
      '<div class="path"><span>' + laptopLine + 'Your laptop</span><div class="wire"></div><span>' + macLine + 'This Mac</span></div>';
    if (state === 'dl') {
      h += '<div class="dl' + T + '">' + GL.arrowdl + 'Download ' + n + '</div>';
    } else {
      h += '<div class="dl again">' + GL.arrowdl + 'Download again</div>';
    }
    h += '<p class="meta">For Mac · 8 MB<br>This file comes from your laptop, through the cable. Not from the internet.</p>';
    if (state !== 'dl') {
      h += '<div class="box"><h2>While it downloads</h2><ol><li>If Safari asks whether to allow downloads, click <b>Allow</b>.</li><li>Open <b>' + n + '</b> from your Downloads. If your Mac says it can’t check the app, click <b>Done</b>, not Move to Trash.</li></ol></div>' +
        '<div class="box"><h2>Your Mac said it can’t check the app?</h2><p>Click <b>Done</b> in that box, then click below. In the window that opens, click <b>Open Anyway</b>.</p><div class="dl' + T + '">Open Privacy &amp; Security</div><p class="meta">If Safari asks to open System Settings, click <b>Allow</b>.</p></div>';
    }
    return h + '</main></div>';
  }
  // cfg: { addr: html for the address field area, page: html, off, dl: true to show the downloads button, extra }
  function safariWin(o, cfg) {
    const w = SAF.w;
    const right = '<div class="pill" style="right:12px;width:' + (cfg.dl ? 142 : 108) + 'px;justify-content:space-around;padding:0 4px">' + (cfg.dl ? '<span class="dlb">' + GL.dlcircle + '</span>' : '') + GL.share + GL.newtab + GL.tabs + '</div>';
    return '<div class="mk-win mk-saf' + (cfg.off ? ' off' : '') + '" style="' + at(SAF.x, SAF.y, w, SAF.h) + '"><div class="vp">' + cfg.page + '</div>' +
      '<div class="stb">' + lights + '<div class="pill" style="left:92px;width:112px;justify-content:space-between;padding:0 3px">' + GL.sidebar + '<span style="display:flex">' + GL.back.replace('<svg', '<svg style="width:9px;height:15px;margin:0 8px"') + '<span class="fd">' + GL.fwd.replace('<svg', '<svg style="width:9px;height:15px;margin:0 8px"') + '</span></span></div>' +
      cfg.addr + right + '</div>' + (cfg.extra || '') + '</div>';
  }
  const ADDR_W = 388, ADDR_X = (SAF.w - ADDR_W) / 2;
  const addrIdle = (host, cls, extra) => '<div class="mk-addr ' + (cls || '') + '" style="left:' + ADDR_X + 'px;width:' + ADDR_W + 'px">' + (extra || '') + '<span class="url">' + esc(host) + '</span><span class="rl">' + GL.reload + '</span></div>';

  // ---------- Desktop ----------
  function menubar(o) {
    const wifi = '<svg viewBox="0 0 18 14"><path d="M9 13.2l2.4-2.9a3.8 3.8 0 00-4.8 0zM4.3 7.6l1.4 1.7a5.2 5.2 0 016.6 0l1.4-1.7a7.4 7.4 0 00-9.4 0zM1.5 4.3l1.4 1.7a9.6 9.6 0 0112.2 0l1.4-1.7a11.8 11.8 0 00-15 0z"/></svg>';
    const batt = '<svg viewBox="0 0 28 13"><rect x=".7" y=".7" width="23.6" height="11.6" rx="3.4" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.1"/><rect x="2.3" y="2.3" width="17.4" height="8.4" rx="2"/><path d="M25.8 4.5v4c.9-.3 1.4-1.1 1.4-2s-.5-1.7-1.4-2z" fill-opacity=".45"/></svg>';
    const search = '<svg viewBox="0 0 14 14"><circle cx="5.8" cy="5.8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.1 9.1l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const cc = '<svg viewBox="0 0 16 14"><rect x=".8" y="1" width="14.4" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12.7" cy="3.5" r="1.4"/><rect x=".8" y="8" width="14.4" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="3.3" cy="10.5" r="1.4"/></svg>';
    return '<div class="mk-menu" style="width:' + SCREEN.w + 'px">' + batt + wifi + search + cc + '<span>Fri Oct 16&nbsp;&nbsp;9:41 AM</span></div>';
  }

  // ---------- Timeline helpers ----------
  const EASE = 'cubic-bezier(.42,0,.22,1)';
  // Pointer moves from a canvas point to a target and stays there.
  const glide = (t0, t1, from, sel, dx, dy) => [[t0, from[0], from[1], EASE], [t1, sel, dx || 0, dy || 0]];
  // The control looks pressed while the button is down.
  function press(o, sel, t, accent) {
    const f = o.dark ? (accent ? 'brightness(1.16)' : 'brightness(1.5)') : (accent ? 'brightness(.86)' : 'brightness(.9)');
    return [sel, [{ offset: 0, filter: 'brightness(1)' }, { offset: t - 0.004, filter: 'brightness(1)' }, { offset: t, filter: f }, { offset: t + 0.03, filter: f }, { offset: t + 0.045, filter: 'brightness(1)' }, { offset: 1, filter: 'brightness(1)' }]];
  }
  // A switch turning on at t, holding until z (then off for the next loop).
  // The knob stretches a little on the way, like the real one.
  function switchOn(sel, t, z) {
    const op = [{ offset: 0, opacity: 0 }, { offset: t, opacity: 0 }, { offset: t + 0.03, opacity: 1 }, { offset: z, opacity: 1 }, { offset: z + 0.01, opacity: 0 }, { offset: 1, opacity: 0 }];
    return [[sel + ' .tr', op], [sel + ' .kt', op],
      [sel + ' .kn', [{ offset: 0, transform: 'translateX(0) scaleX(1)' }, { offset: t, transform: 'translateX(0) scaleX(1)', easing: 'cubic-bezier(.4,0,.2,1)' },
        { offset: t + 0.016, transform: 'translateX(7px) scaleX(1.18)', easing: 'cubic-bezier(.2,.8,.3,1.1)' }, { offset: t + 0.04, transform: 'translateX(12px) scaleX(1)' },
        { offset: z, transform: 'translateX(12px) scaleX(1)' }, { offset: z + 0.01, transform: 'translateX(0) scaleX(1)' }, { offset: 1, transform: 'translateX(0) scaleX(1)' }]]];
  }
  // A standard loop: pointer comes in, hovers the target, clicks it.
  function clickLoop(o, from, sel, opt) {
    opt = opt || {};
    const t = opt.click || 0.6;
    return {
      cursor: glide(opt.start || 0.08, opt.arrive || 0.36, from, sel, opt.dx, opt.dy).concat([[opt.leave || 0.94, sel, opt.dx || 0, opt.dy || 0]]),
      cursorVis: [[opt.start || 0.08, opt.leave || 0.94]],
      halo: [[sel, (opt.arrive || 0.36) - 0.06, t]],
      clicks: [[t, sel, opt.dx || 0, opt.dy || 0]],
      anim: [press(o, sel, t, opt.accent)],
    };
  }

  // ---------- Variants ----------
  // Each returns { cam: { x, y, s }, layers, tl, poster }. cam is the Mac
  // point shown at the canvas's top-left corner and the scale.
  const WIN = { x: 280, y: 150 };
  const CAM_SET = { x: WIN.x + 200, y: WIN.y - 14, s: 0.72 };
  // A dialog centred in what the camera shows, whatever its height.
  const centred = (cam, html, dy) => '<div class="mk-ctr" style="' + at(cam.x, cam.y + (dy || 0), 400 / cam.s, 250 / cam.s) + '">' + html + '</div>';

  const V = {};
  const appApp = (o) => esc(o.appName) + '.app';
  const isDefault = (o) => o.appName === 'USB-C Display';

  // Gatekeeper: "Not Opened". The highlighted button is Move to Trash; the one to click is Done.
  V['gk-notopened'] = function (o) {
    const cam = { x: 478, y: 158, s: 0.72 };
    const body = isDefault(o) ? 'Apple could not verify “USB-C<br>Display.app” is free of malware that<br>may harm your Mac or compromise<br>your privacy.' : 'Apple could not verify ' + q(appApp(o)) + ' is free of malware that may harm your Mac or compromise your privacy.';
    const title = isDefault(o) ? q(appApp(o)) + '<br>Not Opened' : q(appApp(o)) + ' Not Opened';
    const dlg = alertBox({ cls: 'dlg', icon: vaultIcon(), title, body: [body], help: true, buttons: [['Move to Trash', 'def'], ['Done', 'tgt']] });
    const tl = Object.assign({ dur: 6500, vis: [['.dlg', [[0.03, 0.7]], 'pop']] }, clickLoop(o, [345, 238], '.tgt', { click: 0.6 }));
    return { cam, layers: centred(cam, dlg), tl, poster: 0.5 };
  };

  // The trio below shares one window and one camera, so the wizard can cycle
  // them without the picture jumping.
  function securityWin(o, off, btnCls) {
    return settingsWin({ x: WIN.x, y: WIN.y, sel: 'privacy', title: 'Privacy &amp; Security', edge: true, off, pane: paneSecurity(o, btnCls) });
  }
  V['gk-settings'] = function (o) {
    const tl = Object.assign({ dur: 6500 }, clickLoop(o, [150, 236], '.tgt', { click: 0.6 }));
    return { cam: CAM_SET, layers: securityWin(o, false, 'tgt'), tl, poster: 0.5 };
  };
  V['gk-confirm'] = function (o) {
    const dlg = alertBox({ cls: 'dlg', icon: vaultIcon(), title: 'Open ' + q(appApp(o)) + '?', help: true,
      body: ['Apple is not able to verify that it is free from malware that could harm your Mac or compromise your privacy.'],
      buttons: [['Open Anyway', 'def tgt'], ['Done', '']] });
    // The pointer starts where gk-settings left it, so cycling the two reads as one move.
    const tl = Object.assign({ dur: 6500, vis: [['.dlg', [[0.03, 0.7]], 'pop']] }, clickLoop(o, [329, 179], '.tgt', { click: 0.6, accent: true }));
    return { cam: CAM_SET, layers: securityWin(o, true) + centred(CAM_SET, dlg), tl, poster: 0.5 };
  };
  V['password'] = function (o) {
    const field = '<div class="fldw"><div class="fld pw"><span class="ph">Password</span><span class="dots"></span></div><i class="fr"></i></div>';
    const dlg = alertBox({ cls: 'dlg', icon: settingsIcon(), title: 'Privacy &amp; Security',
      body: ['Privacy &amp; Security is trying to modify your system settings. Touch ID or enter your password to allow this.'],
      field, row: true, buttons: [['Cancel', ''], ['Modify Settings', 'def tgt']] });
    const tl = {
      dur: 8500,
      vis: [['.dlg', [[0.02, 0.86]], 'pop'], ['.pw .ph', [[0, 0.3]]], ['.fr', [[0.27, 0.86]]]],
      type: [['.pw .dots', '••••••••', 0.31, 0.45, 0.86]],
      // To the field, click, wait while the password goes in, then to the button.
      cursor: [[0.06, 200, 181, EASE], [0.22, '.pw', 30, 1], [0.5, '.pw', 30, 1, EASE], [0.64, '.tgt'], [0.95, '.tgt']],
      cursorVis: [[0.06, 0.95]],
      halo: [['.pw', 0.16, 0.27], ['.tgt', 0.6, 0.76]],
      clicks: [[0.26, '.pw', 30, 1], [0.76, '.tgt']],
      anim: [press(o, '.tgt', 0.76, true)],
    };
    return { cam: CAM_SET, layers: securityWin(o, true) + centred(CAM_SET, dlg), tl, poster: 0.68 };
  };

  // Notification banner at the top right. Nothing to click.
  V['bg-items'] = function (o) {
    const cam = { x: SCREEN.w - 500, y: 0, s: 0.8, noCursor: true };
    const note = '<div class="mk-note-b nt" style="' + at(SCREEN.w - 12 - 344, 42) + '"><i class="ic">' + settingsIcon() + '</i><div class="bd"><b>Background Items Added</b><p>' + q(esc(o.appName)) + ' added items that can run in the background. You can manage this in Login Items Settings.</p></div><span class="tm">now</span></div>';
    const tl = { dur: 7000, vis: [['.nt', [[0.06, 0.9]], 'slideL']] };
    return { cam, layers: menubar(o) + note, tl, poster: 0.5 };
  };

  // Permission prompts.
  function promptVariant(o, title, badge, msg) {
    const cam = { x: 756 - 250, y: 340 - 156.25, s: 0.8 };
    const pr = prompt({ x: 756 - 230.5, y: 340 - 90.5, cls: 'dlg', title, badge, msg });
    const tl = Object.assign({ dur: 6500, vis: [['.dlg', [[0.03, 0.7]], 'pop']] }, clickLoop(o, [330, 232], '.tgt', { click: 0.6 }));
    return { cam, layers: pr, tl, poster: 0.5 };
  }
  V['screen-prompt'] = (o) => promptVariant(o, 'Screen Recording', 'record',
    isDefault(o) ? q(appApp(o)) + ' would like to record this<br>computer’s screen and audio.' : q(appApp(o)) + ' would like to record this computer’s screen and audio.');
  V['ax-prompt'] = (o) => promptVariant(o, 'Device Control and Data Access', 'folder',
    isDefault(o) ? q(appApp(o)) + ' would like to control this Mac<br>and access your data.' : q(appApp(o)) + ' would like to control this Mac and access your data.');

  // Privacy lists: click the app's switch.
  function listVariant(o, title, pane) {
    const tl = Object.assign({ dur: 7000 }, clickLoop(o, [150, 236], '.tgt', { click: 0.56 }));
    tl.anim = tl.anim.concat(switchOn('.tgt', 0.565, 0.95));
    return { cam: CAM_SET, layers: settingsWin({ x: WIN.x, y: WIN.y, sel: 'privacy', title, pane }), tl, poster: 0.5 };
  }
  V['screen-list'] = (o) => listVariant(o, 'Screen &amp; System Audio Recording', paneScreen(o, false, true));
  V['ax-list'] = (o) => listVariant(o, 'Device Control and Data Access', paneAx(o, false));
  V['login-list'] = function (o) {
    const tl = Object.assign({ dur: 7000 }, clickLoop(o, [150, 236], '.tgt', { click: 0.56 }));
    tl.anim = tl.anim.concat(switchOn('.tgt', 0.565, 0.95));
    return { cam: CAM_SET, layers: settingsWin({ x: WIN.x, y: WIN.y, sel: '', title: 'Login Items', edge: true, pane: paneLogin(o) }), tl, poster: 0.5 };
  };

  // After the switch: macOS asks to quit and reopen the app.
  V['screen-reopen'] = function (o) {
    const msg = q(appApp(o)) + ' may not be able to record the contents of your screen until it is quit.';
    const dlg = alertBox({ cls: 'dlg', icon: appIcon(), title: msg, row: true, buttons: [['Later', ''], ['Quit &amp; Reopen', 'def tgt']] });
    // From the switch the user just turned on.
    const tl = Object.assign({ dur: 6500, vis: [['.dlg', [[0.03, 0.7]], 'pop']] }, clickLoop(o, [354, 171], '.tgt', { click: 0.6, accent: true }));
    return { cam: CAM_SET, layers: settingsWin({ x: WIN.x, y: WIN.y, sel: 'privacy', title: 'Screen &amp; System Audio Recording', off: true, pane: paneScreen(o, true) }) + centred(CAM_SET, dlg), tl, poster: 0.5 };
  };

  // Displays: drag USB-C Display next to the MacBook in the arrangement sheet.
  V['displays'] = function (o) {
    const sw0 = 400 / CAM_SET.s;
    const sheet = { w: 420, h: 262 };
    const sx = CAM_SET.x + (sw0 - sheet.w) / 2 - WIN.x, sy = 62;
    // Inside the arrangement area: MacBook in the middle-left, USB-C Display to its right.
    const area = '<div class="area">' +
      '<div class="mk-disp" style="' + at(78, 26, 120, 78) + '"><i class="wl"></i><i class="mb"></i><span>Built-in Display</span></div>' +
      '<div class="mk-disp drag usb" style="' + at(198, 30, 112, 70) + '"><i class="wl"></i><span>USB-C Display</span></div></div>';
    const arr = '<div class="mk-dim"></div><div class="mk-arr" style="' + at(sx, sy, sheet.w, sheet.h) + '"><div class="txt">To rearrange displays, drag them to the desired position. To relocate the menu bar, drag it to a different display.</div>' + area +
      '<div class="a" style="right:18px;bottom:16px"><span class="mk-pb" style="background:var(--ac);color:var(--ac-tx);padding:0 18px">Done</span></div></div>';
    const win = settingsWin({ x: WIN.x, y: WIN.y, sel: 'displays', title: 'Displays', pane: paneDisplays(), over: arr });
    // The display starts lower right and is dragged into place (in pane points; the cursor
    // follows it in canvas units, which is points times the scale).
    const k = CAM_SET.s, ox = 44, oy = 24;
    const tl = {
      dur: 7500,
      anim: [['.usb', [{ offset: 0, transform: 'translate(' + ox + 'px,' + oy + 'px)' }, { offset: 0.34, transform: 'translate(' + ox + 'px,' + oy + 'px)', easing: EASE }, { offset: 0.66, transform: 'translate(0,0)' }, { offset: 0.96, transform: 'translate(0,0)' }, { offset: 0.99, transform: 'translate(' + ox + 'px,' + oy + 'px)' }, { offset: 1, transform: 'translate(' + ox + 'px,' + oy + 'px)' }]],
        ['.usb', [{ offset: 0, boxShadow: '0 0 0 1.5px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.3)' }, { offset: 0.3, boxShadow: '0 0 0 1.5px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.3)' }, { offset: 0.32, boxShadow: '0 0 0 2px #fff, 0 8px 18px rgba(0,0,0,.45)' }, { offset: 0.68, boxShadow: '0 0 0 2px #fff, 0 8px 18px rgba(0,0,0,.45)' }, { offset: 0.7, boxShadow: '0 0 0 1.5px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.3)' }, { offset: 1, boxShadow: '0 0 0 1.5px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.3)' }]]],
      cursor: [[0.06, 320, 230, EASE], [0.28, '.usb', ox * k, oy * k], [0.34, '.usb', ox * k, oy * k, EASE], [0.66, '.usb', 0, 0], [0.94, '.usb', 0, 0]],
      cursorVis: [[0.06, 0.94]],
      halo: [],
      clicks: [[0.31, '.usb', ox * k, oy * k]],
    };
    return { cam: Object.assign({ cls: 'sq' }, CAM_SET), layers: win, tl, poster: 0.5 };
  };

  // ---------- Safari ----------
  // Toolbar and the top of the page; the same framing for typing the address
  // and for Safari's own question, so the two read as the same window.
  const CAM_SAF = { x: SAF.x + 118, y: SAF.y - 12, s: 0.78 };
  // A close-up of the page around its main button. top: the first page row
  // shown, in window points (measured: Download is at 465-525, Open Privacy &
  // Security at 391-447 with the page scrolled).
  const camPage = (top) => ({ x: SAF.x + SAF.w / 2 - 322.6, y: SAF.y + top, s: 0.62 });
  const PAGE_TOP = 92;          // the card starts below the toolbar (the page scrolls when taller)
  const SCROLL_AFTER = 560;     // how far the "after" page is scrolled to show its new button

  V['safari-type'] = function (o) {
    const host = o.host;
    const box = 'left:' + ADDR_X + 'px;width:' + ADDR_W + 'px';
    const pg = '<div class="start"></div><div class="pg">' + page(o, 'dl', PAGE_TOP) + '</div>';
    // What Safari suggests once the address is typed; the top hit goes with Return.
    const globe = '<svg viewBox="0 0 15 15"><circle cx="7.5" cy="7.5" r="6.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.4 7.5h12.2M7.5 1.2c-3.2 3.4-3.2 9.2 0 12.6M7.5 1.2c3.2 3.4 3.2 9.2 0 12.6" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    const sug = '<div class="mk-sug sg" style="left:' + ADDR_X + 'px;width:' + ADDR_W + 'px"><div class="hd">Top Hit</div><div class="r on">' + globe + '<span>' + esc(host) + '</span><small>— Go to site</small></div>' +
      '<div class="hd" style="margin-top:4px">Suggestions</div><div class="r">' + GL.mag.replace('<svg', '<svg style="width:13px;height:13px;margin:0 1px"') + '<span>' + esc(host) + '</span></div></div>';
    const key = '<div class="mk-key rk" style="' + at(SAF.x + ADDR_X + ADDR_W - 132, SAF.y + 178) + '">' + GL.returnkey + '<span>return</span></div>';
    const addr = '<div class="mk-addr a-ph tgt" style="' + box + '"><span class="ph">Search or enter website name</span></div>' +
      '<div class="mk-addr edit a-ed" style="' + box + '"><span class="ty">' + esc(host) + '</span><i class="caret"></i></div>' +
      addrIdle(host, 'a-go', '<i class="prog"></i>') + sug;
    const tl = {
      dur: 9000,
      vis: [['.a-ph', [[0, 0.26]]], ['.a-ed', [[0.26, 0.62]]], ['.a-go', [[0.62, 1]]], ['.pg', [[0.7, 0.98]]], ['.rk', [[0.5, 0.68]], 'pop'], ['.caret', [[0.47, 0.62]]], ['.sg', [[0.47, 0.61]]]],
      type: [['.a-ed .ty', host, 0.3, 0.46, 0.62]],
      anim: [['.rk', [{ offset: 0, transform: 'translateY(0)' }, { offset: 0.59, transform: 'translateY(0)' }, { offset: 0.6, transform: 'translateY(2px)' }, { offset: 0.63, transform: 'translateY(2px)' }, { offset: 0.64, transform: 'translateY(0)' }, { offset: 1, transform: 'translateY(0)' }]],
        ['.prog', [{ offset: 0, transform: 'scaleX(0)', opacity: 1 }, { offset: 0.62, transform: 'scaleX(0)', opacity: 1, easing: 'cubic-bezier(.3,.6,.3,1)' }, { offset: 0.74, transform: 'scaleX(1)', opacity: 1 }, { offset: 0.77, transform: 'scaleX(1)', opacity: 0 }, { offset: 1, opacity: 0 }]]],
      cursor: glide(0.04, 0.2, [300, 200], '.tgt', -40, 2).concat([[0.95, '.tgt', -40, 2]]),
      cursorVis: [[0.04, 0.95]],
      halo: [['.tgt', 0.14, 0.26]],
      clicks: [[0.25, '.tgt', -40, 2]],
    };
    return { cam: CAM_SAF, layers: safariWin(o, { addr, page: pg }) + key, tl, poster: 0.56 };
  };
  V['safari-download'] = function (o) {
    const tl = Object.assign({ dur: 6500 }, clickLoop(o, [340, 236], '.tgt', { click: 0.6, accent: true }));
    tl.anim = tl.anim.concat([['.dlb', [{ offset: 0, opacity: 0 }, { offset: 0.62, opacity: 0 }, { offset: 0.66, opacity: 1 }, { offset: 0.97, opacity: 1 }, { offset: 1, opacity: 0 }]]]);
    return { cam: camPage(200), layers: safariWin(o, { addr: addrIdle(o.host), page: page(o, 'dl', PAGE_TOP, true), dl: true }), tl, poster: 0.5 };
  };
  V['safari-open'] = function (o) {
    const cam = { x: SAF.x + SAF.w - 513 + 10, y: SAF.y - 12, s: 0.78 };
    const pop = '<div class="mk-pop2 pv" style="' + at(SAF.w - 12 - 330, 58) + '"><div class="hd">Downloads<span>Clear</span></div><div class="it tgt"><i class="mk-hl"></i><i class="ic">' + appIcon() + '</i><div><b>' + esc(o.appName) + '</b><span>8 MB</span></div><span class="mg">' + GL.mag + '</span></div></div>';
    const tl = {
      dur: 7000,
      vis: [['.pv', [[0.03, 0.8]], 'pop']],
      cursor: glide(0.08, 0.36, [120, 230], '.tgt', -40, 0).concat([[0.94, '.tgt', -40, 0]]),
      cursorVis: [[0.08, 0.94]],
      halo: [['.tgt', 0.3, 0.6]],
      clicks: [[0.6, '.tgt', -40, 0], [0.655, '.tgt', -40, 0]],
      anim: [['.tgt .mk-hl', [{ offset: 0, opacity: 0 }, { offset: 0.6, opacity: 0 }, { offset: 0.605, opacity: 1 }, { offset: 0.8, opacity: 1 }, { offset: 0.81, opacity: 0 }, { offset: 1, opacity: 0 }]],
        ['.tgt b, .tgt span', [{ offset: 0, color: 'var(--tx)' }, { offset: 0.6, color: 'var(--tx)' }, { offset: 0.605, color: '#fff' }, { offset: 0.8, color: '#fff' }, { offset: 0.81, color: 'var(--tx)' }, { offset: 1, color: 'var(--tx)' }]]],
    };
    return { cam: Object.assign({ cls: 'sq' }, cam), layers: safariWin(o, { addr: addrIdle(o.host), page: page(o, 'after', PAGE_TOP), dl: true, extra: pop }), tl, poster: 0.5 };
  };
  // After the download: the page offers a button that opens Privacy & Security.
  V['safari-settings'] = function (o) {
    const tl = Object.assign({ dur: 6500 }, clickLoop(o, [340, 236], '.tgt', { click: 0.6, accent: true }));
    return { cam: camPage(179), layers: safariWin(o, { addr: addrIdle(o.host), page: page(o, 'after', PAGE_TOP - SCROLL_AFTER, true), dl: true }), tl, poster: 0.5 };
  };
  // Safari asks before a page opens another app: a sheet over that page.
  V['safari-allow'] = function (o) {
    const sheet = alertBox({ x: SAF.w / 2 - 130, y: 52 + 26, cls: 'dlg', icon: safariIcon(), title: 'Do you want to allow this page to open “System Settings”?', row: true, buttons: [['Cancel', ''], ['Allow', 'def tgt']] });
    const tl = Object.assign({ dur: 6500, vis: [['.dlg', [[0.03, 0.7]], 'pop'], ['.mk-dim', [[0.02, 0.72]]]] }, clickLoop(o, [120, 236], '.tgt', { click: 0.6, accent: true }));
    return { cam: CAM_SAF, layers: safariWin(o, { addr: addrIdle(o.host), page: page(o, 'after', PAGE_TOP - SCROLL_AFTER), dl: true, extra: '<div class="mk-dim" style="top:52px"></div>' + sheet }), tl, poster: 0.5 };
  };

  // ---------- Builder ----------
  function norm(opt) {
    opt = opt || {};
    return {
      dark: opt.dark !== false,
      accent: ACCENTS.indexOf(opt.accent) >= 0 ? opt.accent : 'purple',
      host: String(opt.host || 'usbc.local').replace(/^https?:\/\//, '').replace(/\/$/, ''),
      appName: String(opt.appName || 'USB-C Display'),
    };
  }

  D.scenes = D.scenes || {};
  D.scenes.mac = function (name, opt) {
    const o = norm(opt);
    const v = (V[name] || V['gk-notopened'])(o);
    const cam = v.cam;
    const s = cam.s;
    const html = '<div class="mk ' + (o.dark ? 'dark' : 'light') + ' acc-' + o.accent + (cam.cls ? ' ' + cam.cls : '') + '" data-mac="' + esc(name) + '">' +
      '<div class="mk-scr" style="width:' + SCREEN.w + 'px;height:' + SCREEN.h + 'px;transform:scale(' + s + ') translate(' + px(-cam.x) + ',' + px(-cam.y) + ')"><div class="mk-wall"></div>' + v.layers + '</div>' +
      (cam.noCursor ? '' : pointer(Math.min(1.2, s * 1.2))) + '</div>' +
      '<div class="mlabel mac">' + D.icon('mac') + 'On your Mac</div>';
    return { key: 'mac:' + name + ':' + (o.dark ? 'd' : 'l') + o.accent + ':' + o.host + ':' + o.appName, html, tl: v.tl, poster: v.poster, crop: false };
  };
  // For the preview page: the list of variants.
  D.scenes.mac.names = Object.keys(V);
})();
