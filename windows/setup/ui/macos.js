// Pictures of the Mac's own screens for the picture band (SPEC §3.0.3, §6.3).
//
// D.scenes.mac(name, opt) returns
//   { key, html, tl, poster, cam: {x, y, s}, family, w: 800, h: 300 }
// html is an 800 x 300 canvas (.mk). Inside it, .mk-scr is a whole Mac screen
// (1512 x 982 pt, a 14-inch MacBook Pro) laid out in points: wallpaper,
// windows and dialogs at their real size, measured from macOS 27 captures.
// The camera (D.scenes.camTransform(cam)) shows 800/s x 300/s points of it,
// from (x, y). Scenes of one family share one screen layout, so the wizard can
// pan between their cameras. The pointer is our own drawn arrow, played by
// D.playScene with tl (tl.w = 800). Text, icons and artwork are our drawings;
// the words quote macOS, because that is what the person sees on the Mac.
//
// opt = { dark, accent, host, appName, appSize, appBytes, appVersion,
//         notarized, frame: 'band', still, off, fromChapter, fromRow }
//   appSize: the page's own size text ("0.7 MB"); appBytes: the size in bytes,
//   which Safari's Downloads list writes the Mac's way ("660 KB").
//   still: frozen at poster, no pointer.  off: list scenes show the switch
//   off, with no pointer.  Use key (not html) to tell scenes apart.
//   fromChapter (gk-story): the first chapter to play, 0-based (chapters teach
//   rows D.scenes.mac.story.rows = [1, 2, 2, 3]); fromRow: the same, as the
//   first row not yet done. The story's tl.chapters lists the chapters it
//   plays: {index, row, start, end, poster} as fractions of its loop (the
//   short outro back to the start is in none); its family names that range,
//   so another range crossfades in. tl.stills: a frame per click, the
//   pointer resting on its target (stepped through when motion is reduced).
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});
  D.scenes = D.scenes || {};

  const SCREEN = { w: 1512, h: 982 };
  const CANVAS = { w: 800, h: 300 };
  const ACCENTS = ['purple', 'blue', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q = (t) => '“' + t + '”';
  let uid = 0;
  const nid = (p) => 'mk' + p + (++uid);
  const px = (v) => Math.round(v * 100) / 100 + 'px';
  const at = (x, y, w, h) => 'left:' + px(x) + ';top:' + px(y) + (w != null ? ';width:' + px(w) : '') + (h != null ? ';height:' + px(h) : '');
  const camT = (cam) => (D.scenes.camTransform ? D.scenes.camTransform(cam) : 'scale(' + cam.s + ') translate(' + -cam.x + 'px,' + -cam.y + 'px)');

  // ---------- Icons (our drawings) ----------

  // The app's own icon, the same drawing as mac/make-icon.m.
  function appIcon(cls, full) {
    const g = nid('g'), g2 = nid('g'), s1 = nid('s'), s2 = nid('s'), f = nid('f');
    const grad = (id, y1, y2, a, b) => '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="0" y1="' + y1 + '" x2="0" y2="' + y2 + '"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient>';
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

  // A vault door with a warning sign (Gatekeeper's alerts).
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

  // A zip archive: a white page with its corner folded, a zipper down the top
  // half and "ZIP" near the foot (what Finder and Safari show for a .zip).
  function zipIcon() {
    const p = nid('p');
    let teeth = '';
    for (let i = 0, y = 5.4; y < 27; i++, y += 2.15) teeth += '<rect x="' + (i % 2 ? 32 : 29.4) + '" y="' + y.toFixed(2) + '" width="2.6" height="1.25" rx=".4"/>';
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="' + p + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ececef"/></linearGradient></defs>' +
      '<path d="M15 4.5H40L51.5 16V57A2.5 2.5 0 0 1 49 59.5H15A2.5 2.5 0 0 1 12.5 57V7A2.5 2.5 0 0 1 15 4.5Z" fill="url(#' + p + ')" stroke="#000" stroke-opacity=".22" stroke-width=".7"/>' +
      '<path d="M40 4.5V13.5A2.5 2.5 0 0 0 42.5 16H51.5Z" fill="#d9d9de" stroke="#000" stroke-opacity=".18" stroke-width=".7" stroke-linejoin="round"/>' +
      '<g fill="#7c7c82">' + teeth + '</g><rect x="29" y="27.6" width="6" height="9.4" rx="1.8" fill="#86868c"/><rect x="30.7" y="31.6" width="2.6" height="3.4" rx=".9" fill="#f4f4f6"/>' +
      '<text x="32" y="52.6" text-anchor="middle" font-family="MK Text, system-ui, sans-serif" font-weight="700" font-size="8.6" letter-spacing=".5" fill="#8e8e93">ZIP</text></svg>';
  }

  // A grey gear (System Settings and its notifications).
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

  // Small app icons for the lists (20 pt). Generic drawings.
  const SQ = (fill, inner, stroke) => '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x=".5" y=".5" width="19" height="19" rx="4.6" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width=".5"' : '') + '/>' + inner + '</svg>';
  const ICON = {
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
  };
  const TILE = { appearance: '#1c1c1e', dock: '#1c1c1e', displays: '#2f7cf6', menubar: '#8e8e93', siri: 'linear', spotlight: '#8e8e93', wallpaper: '#30b0c7', notifications: '#ff3b30', sound: '#ff2d55', focus: '#5e5ce6', screentime: '#5e5ce6', lockscreen: '#1c1c1e', privacy: '#2f7cf6', touchid: '#ffffff', users: '#2f7cf6', gamecenter: '#ffffff' };
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
    globe: '<svg viewBox="0 0 15 15"><circle cx="7.5" cy="7.5" r="6.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.4 7.5h12.2M7.5 1.2c-3.2 3.4-3.2 9.2 0 12.6M7.5 1.2c3.2 3.4 3.2 9.2 0 12.6" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  };

  // The pointer: a black arrow with a white edge, our own drawing. Its tip sits
  // at (1, 1) of the box, where the timeline engine puts the click point.
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

  // System Settings sidebar, scrolled the way the captures show it, 10 pt
  // further so the band's lower edge falls between two rows. y is the centre
  // of each row in window points.
  const SIDE_SCROLL = -10;
  const SIDEBAR = [
    ['appearance', 'Appearance', 90], ['dock', 'Desktop &amp; Dock', 122], ['displays', 'Displays', 154], ['menubar', 'Menu Bar', 186], ['siri', 'Siri', 218], ['spotlight', 'Spotlight', 250], ['wallpaper', 'Wallpaper', 282],
    ['notifications', 'Notifications', 327], ['sound', 'Sound', 359], ['focus', 'Focus', 391], ['screentime', 'Screen Time', 423],
    ['lockscreen', 'Lock Screen', 468], ['privacy', 'Privacy &amp; Security', 500], ['touchid', 'Touch ID &amp; Password', 532], ['users', 'Users &amp; Groups', 564],
    ['gamecenter', 'Game Center', 609],
  ];
  function sidebar(sel) {
    const rows = SIDEBAR.map((r) => '<div class="mk-si' + (r[0] === sel ? ' sel' : '') + '" style="top:' + (r[2] + SIDE_SCROLL - 16) + 'px"><i class="ic">' + tile(r[0]) + '</i><span>' + r[1] + '</span></div>').join('');
    return '<div class="mk-side">' + rows + '<div class="mk-sfade"></div><div class="mk-search">' + GL.mag + '<span>Search</span></div>' + lights + '</div>';
  }

  // One System Settings window (740 x 625). cfg: { x, y, sel, title, pane,
  // edge, off, cls, extra (in the content area), over (over the window) }
  function settingsWin(cfg) {
    return '<div class="mk-win mk-set' + (cfg.off ? ' off' : '') + (cfg.cls ? ' ' + cfg.cls : '') + '" style="' + at(cfg.x, cfg.y) + '">' + sidebar(cfg.sel) +
      '<div class="mk-main"><div class="mk-pane">' + cfg.pane + '</div>' +
      '<div class="mk-tb' + (cfg.edge ? ' edge' : '') + '"><div class="bf"><span class="b">' + GL.back + '</span><i></i><span class="f">' + GL.fwd + '</span></div><div class="ttl">' + cfg.title + '</div></div>' +
      (cfg.extra || '') + '</div>' + (cfg.over || '') + '</div>';
  }
  // A grouped box at a fixed position in the pane.
  const group = (y, rows, style) => '<div class="mk-g" style="top:' + px(y) + (style ? ';' + style : '') + '">' + rows + '</div>';
  const row = (icon, name, right, cls) => '<div class="mk-r' + (icon ? ' ic' : '') + (cls ? ' ' + cls : '') + '">' + (icon ? '<i class="ic">' + icon + '</i>' : '') + '<span>' + name + '</span><span class="sp"></span>' + (right || '') + '</div>';
  const valChev = (v) => (v ? '<span class="val">' + v + '</span>' : '') + GL.chev;

  // ---------- Panes (positions in pane points, from the captures) ----------

  // Privacy & Security scrolled down to the Security section. opt: { blocked
  // (the "was blocked" message with Open Anyway), btn (class of that button),
  // scroll (added to every y) }
  function paneSecurity(o, opt) {
    opt = opt || {};
    const Y = (v) => v + (opt.scroll || 0);
    const app = esc(o.appName);
    let h = group(Y(-26.5), row(ICON.analytics(), 'Analytics &amp; Improvements', valChev('')) + row(ICON.ads(), 'Apple Advertising', valChev(''))) +
      group(Y(71), row(ICON.air(), 'Apple Intelligence Report', valChev('On')), 'height:42px') +
      '<div class="mk-hdr" style="top:' + px(Y(141.5)) + '">Security</div>' +
      group(Y(169), '<div class="mk-r" style="height:37.5px"><span>Allow applications from</span><span class="sp"></span><span class="mk-pop">App Store &amp; Known Developers<b>' + GL.updown + '</b></span></div>');
    let y = 216.5;
    if (opt.blocked) {
      h += group(Y(y), '<div class="mk-r" style="height:auto;align-items:flex-start;padding-top:6.5px;padding-bottom:10px;white-space:normal"><span style="width:272px;line-height:16px;margin-top:3.9px">' + q(app + '.app') + ' was blocked to protect your Mac.</span><span class="sp"></span><span class="mk-pb ' + (opt.btn || '') + '" style="margin-right:0.5px">Open Anyway</span></div>' +
        '<div class="mk-r" style="height:auto;padding-top:10.5px;padding-bottom:10px;white-space:normal;display:block"><span class="mk-note" style="display:block;color:var(--tx2)">Apple could not verify ' + q(app + '.app') + ' is free of malware that may harm your Mac or compromise your privacy.</span></div>');
      y = 327.5;
    }
    h += group(Y(y), row(ICON.filevault(), 'FileVault', valChev('Off')) + row(ICON.accessories(), 'Accessories', valChev('Ask')) + row(ICON.shield(), 'Background Security Improvements', valChev(''))) +
      group(Y(y + 138), row(ICON.hand(), 'Lockdown Mode', valChev('Off')), 'height:42px') +
      '<div class="mk-desc" style="top:' + px(Y(y + 190.5)) + ';left:30.5px;width:440px;color:var(--tx3)">Your Mac can reduce your exposure to digital threats by applying security limits to apps and features. This is intended for people in high-risk situations, such as journalists, activists, and public figures.</div>' +
      '<div class="a" style="right:54.5px;top:' + px(Y(y + 252)) + '"><span class="mk-pb" style="height:23.5px;width:94px;padding:0">Advanced…</span></div><div class="a" style="right:20.5px;top:' + px(Y(y + 252)) + '"><span class="mk-help">?</span></div>';
    return h;
  }

  // A privacy list with switches (Screen & System Audio Recording style).
  function appList(y, apps, header) {
    const rows = apps.map((a) => '<div class="mk-r ic" style="height:40px"><i class="ic">' + a[0] + '</i><span>' + a[1] + '</span><span class="sp"></span>' + sw(a[2], a[3]) + '</div>').join('');
    return group(y, (header || '') + rows + '<div class="mk-pm">' + GL.plus + '<i></i>' + GL.minus + '</div>');
  }
  // Only apps that asked are listed (Apple's own tools never are), so on the
  // person's Mac the list holds just our app.
  function paneScreen(o, on, tgt) {
    return '<div class="mk-hdr" style="top:63px">Screen &amp; System Audio Recording</div>' +
      '<div class="mk-desc" style="top:81px">Allow the applications below to record the content of your screen and audio, even<br>while using other applications.</div>' +
      appList(119.5, [[appIcon('', true), esc(o.appName) + '.app', on, tgt ? 'tgt' : '']]);
  }
  function paneAx(o, on, tgt) {
    const head = '<div class="mk-r" style="height:68px;align-items:flex-start;padding-top:12.4px;white-space:normal;color:var(--tx2)"><span>Apps with this access can view and send email, edit contacts and photos, monitor your keyboard, track websites, record your screen, control any app on your Mac, and more.</span></div><div style="height:1px;background:var(--sep)"></div>';
    return appList(64, [[appIcon('', true), esc(o.appName) + '.app', on, tgt ? 'tgt' : '']], head);
  }
  // Login Items, scrolled so Background App Activity sits under the toolbar.
  function paneLogin(o, on, tgt) {
    const s = 170;
    return '<div class="mk-g" style="top:' + (105.5 - s) + 'px;height:118.5px"><div class="mk-r" style="height:27.5px;background:color-mix(in srgb,var(--grp) 80%,var(--tx) 6%);font-size:12px"><span style="width:236px">Item</span><span>Kind</span></div>' +
      '<div class="a" style="left:0;right:0;bottom:0;height:24.5px"><div class="mk-pm" style="height:24.5px">' + GL.plus + '<i></i>' + GL.minus + '</div></div></div>' +
      '<div class="mk-hdr" style="top:' + (254.5 - s) + 'px">Background App Activity</div>' +
      '<div class="mk-desc" style="top:' + (273 - s) + 'px">These apps can automatically run in the background to do things like sync data and<br>check for updates.</div>' +
      group(311 - s, '<div class="mk-r two"><i class="ic">' + appIcon('', true) + '</i><span><span class="nm">' + esc(o.appName) + '</span><span class="st">Not running in background</span></span><span class="sp"></span>' + sw(on, tgt ? 'tgt' : '') + '</div>');
  }

  // ---------- Dialogs ----------
  // An alert (260 pt, round, glass). cfg: { x, y, cls, icon (none for a
  // sheet), title, body: [..], field, buttons: [[label, cls]], row (side by side), help }
  function alertBox(cfg) {
    return '<div class="mk-al ' + (cfg.cls || '') + '"' + (cfg.x != null ? ' style="' + at(cfg.x, cfg.y) + '"' : '') + '>' + (cfg.help ? '<div class="q">?</div>' : '') +
      (cfg.icon ? '<div class="ai">' + cfg.icon + '</div>' : '') + '<h4>' + cfg.title + '</h4>' + (cfg.body || []).map((p) => '<p>' + p + '</p>').join('') + (cfg.field || '') +
      '<div class="bt' + (cfg.row ? ' row' : '') + '">' + cfg.buttons.map((b) => '<div class="' + (b[1] || '') + '">' + b[0] + '</div>').join('') + '</div></div>';
  }
  // A permission prompt (Screen Recording, Device Control and Data Access).
  function prompt(cfg) {
    return '<div class="mk-pr ' + (cfg.cls || '') + '"><div class="bar">' + cfg.title + '</div><div class="lk">' + lockIcon(cfg.badge) + '</div>' +
      '<div class="tx"><b>' + cfg.msg + '</b><p>Grant access to this application in Privacy &amp; Security<br>settings, located in System Settings.</p></div>' +
      '<span class="mk-help">?</span><div class="bt"><div class="tgt">Open System Settings</div><div>Deny</div></div></div>';
  }
  // The authentication dialog (Touch ID or password).
  function authBox(cls, btnCls) {
    const field = '<div class="fldw"><div class="fld pw"><span class="ph">Password</span><span class="dots"></span></div><i class="fr"></i></div>';
    return alertBox({ cls, icon: settingsIcon(), title: 'Privacy &amp; Security',
      body: ['Privacy &amp; Security is trying to modify your system settings. Touch ID or enter your password to allow this.'],
      field, row: true, buttons: [['Cancel', ''], ['Modify Settings', 'def ' + btnCls]] });
  }

  // ---------- Safari ----------
  const SAF = { x: 326, y: 120, w: 860, h: 700 };
  // The download page (web/index.html, SPEC §8) at 1 CSS px = 1 pt, as
  // Safari shows it. st: 'A' (loaded), 'B' (after Download), 'C' (allow it in
  // Privacy & Security). tgt marks the page's main button for the pointer.
  function page(o, st, cls, tgt) {
    const n = esc(o.appName);
    const T = tgt ? ' tgt' : '';
    const meta = '<p class="meta">' + (o.appSize ? esc(o.appSize) + ' · ' : '') + 'Comes from your PC through the cable, not from the internet.</p>';
    let line, act, foot = meta;
    if (st === 'A') {
      line = 'Use your Windows PC as a display for this Mac.';
      act = '<span class="cap pri' + T + '">Download</span>';
    } else if (st === 'B') {
      line = 'Double-click <b>' + zipName(o) + '</b> in Safari’s Downloads, then double-click <b>' + n + '</b>.' + (o.notarized ? '' : ' When your Mac says it can’t verify the app, click <b>Done</b>, not <span class="nw">Move to Trash</span>.');
      act = '<span class="cap sec">Download Again</span>';
    } else {
      line = 'To open ' + n + ', allow it in Privacy &amp; Security.';
      act = '<span class="cap pri' + T + '">Open Privacy &amp; Security</span><p class="nt">If you clicked Move to Trash, click Download Again.</p><span class="cap sec">Download Again</span>';
      // The calm line under the buttons, right before the Mac's two warnings. One line: page C's
      // heading then sits below the Safari camera's lower edge.
      foot = '<p class="meta">Your Mac does this for every app that Apple hasn’t verified.</p>';
    }
    return '<div class="mk-page st-' + st + (cls ? ' ' + cls : '') + '"><main><div class="icon">' + appIcon() + '</div><h1>' + n + '</h1><p class="pl">' + line + '</p><div class="act">' + act + '</div>' + foot + '</main></div>';
  }
  // cfg: { addr (the address field area), page, off, dl (downloads button), extra, cls, h (another height) }
  function safariWin(o, cfg) {
    const right = '<div class="pill" style="right:12px;width:' + (cfg.dl ? 142 : 108) + 'px;justify-content:space-around;padding:0 4px">' + (cfg.dl ? '<span class="dlb">' + GL.dlcircle + '</span>' : '') + GL.share + GL.newtab + GL.tabs + '</div>';
    return '<div class="mk-win mk-saf' + (cfg.off ? ' off' : '') + (cfg.cls ? ' ' + cfg.cls : '') + '" style="' + at(SAF.x, SAF.y, SAF.w, cfg.h || SAF.h) + '"><div class="vp">' + cfg.page + '</div>' +
      '<div class="stb">' + lights + '<div class="pill" style="left:92px;width:112px;justify-content:space-between;padding:0 3px">' + GL.sidebar + '<span style="display:flex">' + GL.back.replace('<svg', '<svg style="width:9px;height:15px;margin:0 8px"') + '<span class="fd">' + GL.fwd.replace('<svg', '<svg style="width:9px;height:15px;margin:0 8px"') + '</span></span></div>' +
      cfg.addr + right + '</div>' + (cfg.extra || '') + '</div>';
  }
  const ADDR_W = 388, ADDR_X = (SAF.w - ADDR_W) / 2;
  const addrIdle = (host, cls, extra) => '<div class="mk-addr ' + (cls || '') + '" style="left:' + ADDR_X + 'px;width:' + ADDR_W + 'px">' + (extra || '') + '<span class="url">' + esc(host) + '</span><span class="rl">' + GL.reload + '</span></div>';
  // Safari's own question, over the page (window points): an alert run as a
  // sheet, so no icon and the lighter sheet card (V8: verify on the Mac).
  const safariSheet = (title, body, cls) => '<div class="mk-dim" style="top:52px"></div>' +
    alertBox({ x: SAF.w / 2 - 130, y: 64, cls: 'dlg mat sheet ' + (cls || ''), icon: '', title, body, row: true, buttons: [['Cancel', ''], ['Allow', 'def tgt']] });

  // ---------- Finder ----------
  // A Downloads window in icon view, as Archive Utility leaves it after
  // expanding the zip: the app it made is selected next to the zip. Sidebar
  // symbols are line drawings in the accent colour, as Finder draws them.
  const FSYM = {
    airdrop: '<circle cx="8" cy="8.6" r="1.5" fill="currentColor" stroke="none"/><path d="M5.1 11.9a4.4 4.4 0 1 1 5.8 0M3 14a7.2 7.2 0 1 1 10 0"/>',
    recents: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.5 1.5"/>',
    apps: '<path d="M5.3 13.6L9.3 3.4M10.7 13.6L6.7 3.4M3.4 10.2h9.2"/>',
    desktop: '<rect x="1.8" y="2.6" width="12.4" height="8.6" rx="1.5"/><path d="M5.8 13.8h4.4M8 11.2v2.6"/>',
    docs: '<path d="M4 1.8h5.1L12.2 5v9.2H4z"/><path d="M9 1.9v3.2h3.1"/>',
    downloads: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6v6.2M5.5 8.4L8 10.9l2.5-2.5"/>',
  };
  const fsym = (n) => '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + FSYM[n] + '</svg>';
  const FINDER_TOOLS = '<div class="pill fv"><svg viewBox="0 0 17 17"><g fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.2" y="2.2" width="5.2" height="5.2" rx="1.3"/><rect x="9.6" y="2.2" width="5.2" height="5.2" rx="1.3"/><rect x="2.2" y="9.6" width="5.2" height="5.2" rx="1.3"/><rect x="9.6" y="9.6" width="5.2" height="5.2" rx="1.3"/></g></svg>' +
    '<svg class="dn" viewBox="0 0 9 6"><path d="M1.2 1.4L4.5 4.6l3.3-3.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="pill fs">' + GL.mag + '</div>';
  const zipName = (o) => esc(o.appName.replace(/\s+/g, '-')) + '.zip';
  // cfg: { x, y, w, h, off, cls }
  function finderWin(o, cfg) {
    const fav = [['airdrop', 'AirDrop'], ['recents', 'Recents'], ['apps', 'Applications'], ['desktop', 'Desktop'], ['docs', 'Documents'], ['downloads', 'Downloads']];
    const side = '<div class="fd-side"><div class="fd-hd" style="top:52px">Favorites</div>' +
      fav.map((r, i) => '<div class="fd-si' + (r[0] === 'downloads' ? ' sel' : '') + '" style="top:' + (70 + i * 28) + 'px"><i>' + fsym(r[0]) + '</i><span>' + r[1] + '</span></div>').join('') + lights + '</div>';
    const item = (cls, icon, name, x) => '<div class="fd-it ' + cls + '" style="left:' + x + 'px;top:62px"><div class="fic">' + icon + '</div><span class="fl">' + name + '</span></div>';
    const tb = '<div class="mk-tb"><div class="bf"><span class="b">' + GL.back + '</span><i></i><span class="f">' + GL.fwd + '</span></div><div class="ttl">Downloads</div>' + FINDER_TOOLS + '</div>';
    return '<div class="mk-win mk-fd' + (cfg.off ? ' off' : '') + (cfg.cls ? ' ' + cfg.cls : '') + '" style="' + at(cfg.x, cfg.y, cfg.w, cfg.h) + '">' + side +
      '<div class="fd-main">' + item('fi-app sel', appIcon(), esc(o.appName), 14) + item('fi-zip', zipIcon(), zipName(o), 126) + tb + '</div></div>';
  }

  // ---------- Desktop ----------
  // The Mac's clock: the time now, so the picture matches the person's own
  // menu bar; a fixed Fri Oct 16 9:41 AM in screenshots (?shot=1).
  const isShot = () => document.documentElement.classList.contains('shot');
  const timeOf = (d) => (isShot() ? '9:41 AM' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '\u00a0'));
  const clockOf = (d) => (isShot() ? 'Fri Oct 16' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/,/g, '')) + '\u00a0\u00a0' + timeOf(d);
  let clockTimer = 0;
  function tickClock() {
    const els = document.querySelectorAll('.mk .mk-menu .clk');
    if (!els.length) { clearInterval(clockTimer); clockTimer = 0; return; }
    const t = clockOf(new Date());
    els.forEach((e) => { if (e.textContent !== t) e.textContent = t; });
  }
  function menubar() {
    if (!clockTimer && !isShot()) clockTimer = setInterval(tickClock, 10000);
    const wifi = '<svg viewBox="0 0 18 14"><path d="M9 13.2l2.4-2.9a3.8 3.8 0 00-4.8 0zM4.3 7.6l1.4 1.7a5.2 5.2 0 016.6 0l1.4-1.7a7.4 7.4 0 00-9.4 0zM1.5 4.3l1.4 1.7a9.6 9.6 0 0112.2 0l1.4-1.7a11.8 11.8 0 00-15 0z"/></svg>';
    const batt = '<svg viewBox="0 0 28 13"><rect x=".7" y=".7" width="23.6" height="11.6" rx="3.4" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.1"/><rect x="2.3" y="2.3" width="17.4" height="8.4" rx="2"/><path d="M25.8 4.5v4c.9-.3 1.4-1.1 1.4-2s-.5-1.7-1.4-2z" fill-opacity=".45"/></svg>';
    const search = '<svg viewBox="0 0 14 14"><circle cx="5.8" cy="5.8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.1 9.1l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const cc = '<svg viewBox="0 0 16 14"><rect x=".8" y="1" width="14.4" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12.7" cy="3.5" r="1.4"/><rect x=".8" y="8" width="14.4" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="3.3" cy="10.5" r="1.4"/></svg>';
    return '<div class="mk-menu" style="width:' + SCREEN.w + 'px">' + batt + wifi + search + cc + '<span class="clk">' + clockOf(new Date()) + '</span></div>';
  }

  // ---------- Timeline helpers ----------
  const EASE = 'cubic-bezier(.42,0,.22,1)';
  // The control looks pressed while the button is down.
  function press(o, sel, t, accent) {
    const f = o.dark ? (accent ? 'brightness(1.16)' : 'brightness(1.5)') : (accent ? 'brightness(.86)' : 'brightness(.9)');
    return [sel, [{ offset: 0, filter: 'brightness(1)' }, { offset: t - 0.004, filter: 'brightness(1)' }, { offset: t, filter: f }, { offset: t + 0.03, filter: f }, { offset: t + 0.045, filter: 'brightness(1)' }, { offset: 1, filter: 'brightness(1)' }]];
  }
  // A switch turning on at t and staying on until z.
  function switchOn(sel, t, z) {
    const op = [{ offset: 0, opacity: 0 }, { offset: t, opacity: 0 }, { offset: t + 0.03, opacity: 1 }, { offset: z, opacity: 1 }, { offset: z + 0.01, opacity: 0 }, { offset: 1, opacity: 0 }];
    return [[sel + ' .tr', op], [sel + ' .kt', op],
      [sel + ' .kn', [{ offset: 0, transform: 'translateX(0) scaleX(1)' }, { offset: t, transform: 'translateX(0) scaleX(1)', easing: 'cubic-bezier(.4,0,.2,1)' },
        { offset: t + 0.016, transform: 'translateX(7px) scaleX(1.18)', easing: 'cubic-bezier(.2,.8,.3,1.1)' }, { offset: t + 0.04, transform: 'translateX(12px) scaleX(1)' },
        { offset: z, transform: 'translateX(12px) scaleX(1)' }, { offset: z + 0.01, transform: 'translateX(0) scaleX(1)' }, { offset: 1, transform: 'translateX(0) scaleX(1)' }]]];
  }
  // The teaching loop: the pointer glides in from (fx, fy) away from the
  // target, rests on it, clicks, and holds. opt: { from: [fx, fy], click,
  // dx, dy, accent, dur }. By default the tip rests 6 canvas units below the
  // middle of the target, under its label, so the arrow never hides the word
  // the sentence names. A button with another one right below it gets dx 40,
  // dy 2 (beside its label, clear of the next button's label).
  function clickLoop(o, sel, opt) {
    opt = opt || {};
    const t = opt.click || 0.5, a = opt.arrive || 0.3, s = opt.start || 0.06, z = opt.leave || 0.94;
    const f = opt.from || [140, 70], dx = opt.dx || 0, dy = opt.dy != null ? opt.dy : 6;
    // after: the pointer steps aside once the click is done, so what changed shows.
    const aw = opt.after ? [[t + 0.06, sel, dx, dy, EASE], [t + 0.16, sel, dx + opt.after[0], dy + opt.after[1]], [z, sel, dx + opt.after[0], dy + opt.after[1]]] : [[z, sel, dx, dy]];
    return {
      dur: opt.dur || 6500,
      cursor: [[s, sel, dx + f[0], dy + f[1], EASE], [a, sel, dx, dy]].concat(aw),
      cursorVis: [[s, z]],
      halo: [[sel, a - 0.04, t]],
      clicks: [[t, sel, dx, dy]],
      anim: [press(o, sel, t, opt.accent)],
    };
  }

  // ---------- Scenes ----------
  // Each returns { cam: {x, y, s}, layers, tl, poster, still? }. The family
  // groups scenes that share one screen layout (a pan within a family keeps
  // every window in place).
  const V = {};
  const FAMILY = {};
  const def = (name, family, fn) => { V[name] = fn; FAMILY[name] = family; };
  const view = (cam) => ({ w: CANVAS.w / cam.s, h: CANVAS.h / cam.s });
  // A dialog centred in what the camera shows.
  const centred = (cam, html, dy) => { const v = view(cam); return '<div class="mk-ctr" style="' + at(cam.x, cam.y + (dy || 0), v.w, v.h) + '">' + html + '</div>'; };
  const appApp = (o) => esc(o.appName) + '.app';
  const isDefault = (o) => o.appName === 'USB-C Display';

  // ---- Safari (family "safari": one Safari window, several cameras) ----
  // The whole window width with its toolbar and the top of the page.
  const CAM_SAF = { x: 286, y: 100, s: 0.85 };
  // The page column: state A/B from the icon to the meta line; state C from
  // the icon down to its meta line (the crop falls through the icon).
  const CAM_COL_A = { x: 286, y: 319.5, s: 0.85 };
  const CAM_COL_C = { x: 286, y: 336, s: 0.85 };

  def('safari-type', 'safari', function (o) {
    const host = o.host;
    const box = 'left:' + ADDR_X + 'px;width:' + ADDR_W + 'px';
    const pg = '<div class="mk-start"></div>' + page(o, 'A', 'pg');
    // What Safari suggests once the address is typed; the top hit goes with Return.
    const sug = '<div class="mk-sug sg" style="' + box + '"><div class="hd">Top Hit</div><div class="r on">' + GL.globe + '<span>' + esc(host) + '</span></div>' +
      '<div class="hd" style="margin-top:4px">Suggestions</div><div class="r">' + GL.mag.replace('<svg', '<svg style="width:13px;height:13px;margin:0 1px"') + '<span>' + esc(host) + '</span></div></div>';
    const addr = '<div class="mk-addr a-ph tgt" style="' + box + '"><span class="ph">Search or enter website name</span></div>' +
      '<div class="mk-addr edit a-ed" style="' + box + '"><span class="ty">' + esc(host) + '</span><i class="caret"></i></div>' +
      addrIdle(host, 'a-go', '<i class="prog"></i>') + sug;
    const tl = {
      dur: 9000,
      vis: [['.a-ph', [[0, 0.26]]], ['.a-ed', [[0.26, 0.62]]], ['.a-go', [[0.62, 1]]], ['.pg', [[0.68, 0.98]]], ['.caret', [[0.47, 0.62]]], ['.sg', [[0.47, 0.61]]]],
      type: [['.a-ed .ty', host, 0.3, 0.46, 0.62]],
      anim: [['.prog', [{ offset: 0, transform: 'scaleX(0)', opacity: 1 }, { offset: 0.62, transform: 'scaleX(0)', opacity: 1, easing: 'cubic-bezier(.3,.6,.3,1)' }, { offset: 0.72, transform: 'scaleX(1)', opacity: 1 }, { offset: 0.75, transform: 'scaleX(1)', opacity: 0 }, { offset: 1, opacity: 0 }]]],
      // The tip rests in the empty left part of the field, clear of its
      // placeholder. As on the Mac, the pointer hides once typing starts
      // (until the mouse moves).
      cursor: [[0.04, '.tgt', 40, 120, EASE], [0.18, '.tgt', -100, 3], [0.29, '.tgt', -100, 3]],
      cursorVis: [[0.04, 0.29]],
      halo: [['.tgt', 0.15, 0.25]],
      clicks: [[0.25, '.tgt', -100, 3]],
    };
    return { cam: CAM_SAF, layers: safariWin(o, { addr, page: pg }), tl, poster: 0.56 };
  });

  // The page's Download button; at the click the page turns to state B. The
  // tip rests on the button's right part, clear of "Download" and of the
  // wider "Download Again" that takes its place (the column moves down a
  // little as the sentence grows), then steps out to the right.
  def('safari-download', 'safari', function (o) {
    const tl = clickLoop(o, '.tgt', { click: 0.5, accent: true, from: [150, 50], dx: 55, after: [75, -6] });
    tl.vis = [['.pa', [[0, 0.5], [0.97, 1]]], ['.pb', [[0.5, 0.97]]], ['.dlb', [[0.52, 0.97]]]];
    const pg = page(o, 'A', 'pa', true) + page(o, 'B', 'pb');
    // Still (downloading): the page after the click.
    return { cam: CAM_COL_A, layers: safariWin(o, { addr: addrIdle(o.host), page: pg, dl: true }), tl, poster: 0.42, still: 0.8 };
  });

  // Safari asks before the first download from a site (V8: verify the words).
  def('safari-allow-dl', 'safari', function (o) {
    const tl = clickLoop(o, '.tgt', { click: 0.5, accent: true, from: [120, 80] });
    const sheet = safariSheet('Do you want to allow downloads on ' + q(esc(o.host)) + '?', ['You can change which websites can download files in Websites Settings.']);
    return { cam: CAM_SAF, layers: safariWin(o, { addr: addrIdle(o.host), page: page(o, 'B'), dl: true, extra: sheet }), tl, poster: 0.42 };
  });

  // A size the way the Mac writes it (ByteCountFormatter, decimal): 660 KB, 1.2 MB.
  const macSize = (b) => (b < 1e3 ? b + ' bytes' : b < 999.5e3 ? Math.round(b / 1e3) + ' KB' : (b / 1e6).toFixed(1).replace(/\.0$/, '') + ' MB');
  // 'safari-open' (the Downloads list, then the app) is the story's first
  // chapter on its own: see 'gk-story' below.

  // The page after a blocked open: its button opens Privacy & Security.
  def('safari-settings', 'safari', function (o) {
    const tl = clickLoop(o, '.tgt', { click: 0.5, accent: true, from: [160, 40] });
    return { cam: CAM_COL_C, layers: safariWin(o, { addr: addrIdle(o.host), page: page(o, 'C', '', true), dl: true }), tl, poster: 0.42 };
  });

  // Safari asks before the page opens System Settings.
  def('safari-allow', 'safari', function (o) {
    const tl = clickLoop(o, '.tgt', { click: 0.5, accent: true, from: [120, 80] });
    const sheet = safariSheet('Do you want to allow this page to open “System Settings”?');
    return { cam: CAM_SAF, layers: safariWin(o, { addr: addrIdle(o.host), page: page(o, 'C'), dl: true, extra: sheet }), tl, poster: 0.42 };
  });

  // ---- Alerts over Safari (family "alert") ----
  // Safari's own camera: its inactive toolbar frames the alert, and the page's
  // sentence and meta line are not drawn around it (macos.css, .fam-alert).
  const CAM_AL = CAM_SAF;
  const safariBehind = (o) => safariWin(o, { addr: addrIdle(o.host), page: page(o, 'B'), dl: true, off: true });

  // Gatekeeper: "Not Opened". The highlighted button is Move to Trash; the one to click is Done.
  const notOpenedBox = (o, cls, done) => alertBox({ cls, icon: vaultIcon(), help: true,
    title: isDefault(o) ? q(appApp(o)) + '<br>Not Opened' : q(appApp(o)) + ' Not Opened',
    body: [isDefault(o) ? 'Apple could not verify “USB-C<br>Display.app” is free of malware that<br>may harm your Mac or compromise<br>your privacy.' : 'Apple could not verify ' + q(appApp(o)) + ' is free of malware that may harm your Mac or compromise your privacy.'],
    buttons: [['Move to Trash', 'def'], ['Done', done]] });
  def('gk-notopened', 'alert', function (o) {
    const dlg = notOpenedBox(o, 'dlg mat', 'tgt');
    const tl = clickLoop(o, '.tgt', { click: 0.5, from: [170, 30] });
    return { cam: CAM_AL, layers: safariBehind(Object.assign({}, o, { notarized: false })) + centred(CAM_AL, dlg), tl, poster: 0.42 };
  });

  // A notarized app's first open (V7: verify the words).
  def('gk-open', 'alert', function (o) {
    const n = Object.assign({}, o, { notarized: true });
    const dlg = alertBox({ cls: 'dlg mat', icon: appIcon(), title: q(appApp(o)) + ' is an app downloaded from the Internet. Are you sure you want to open it?',
      body: ['Safari downloaded this file today at ' + timeOf(new Date()) + ' from ' + esc(o.host) + '.', 'Apple checked it for malicious software and none was detected.'],
      buttons: [['Open', 'def tgt'], ['Cancel', '']] });
    // Open has Cancel right below it: the tip rests beside its label.
    const tl = clickLoop(o, '.tgt', { click: 0.5, accent: true, from: [170, 60], dx: 40, dy: 2 });
    return { cam: CAM_AL, layers: safariBehind(n) + centred(CAM_AL, dlg), tl, poster: 0.42 };
  });

  // ---- System Settings (family "settings": one window, cameras from its top) ----
  const WIN = { x: 280, y: 150 };
  const CAM_SET = { x: 150, y: 140, s: 0.8 };
  // Scrolled so the band's lower edge falls between the "was blocked" group
  // and the FileVault group.
  const SEC_SCROLL = 45;
  const winSecurity = (o, off, cls, btn) => settingsWin({ x: WIN.x, y: WIN.y, sel: 'privacy', title: 'Privacy &amp; Security', edge: true, off, cls, pane: paneSecurity(o, { blocked: true, btn, scroll: SEC_SCROLL }) });

  // Open Anyway, three parts on one camera (20 s): the pane's button; the
  // confirmation; Touch ID or the password, then Modify Settings.
  const confirmBox = (o) => alertBox({ cls: 'dlg-c', icon: vaultIcon(), title: 'Open ' + q(appApp(o)) + '?', help: true,
    body: ['Apple is not able to verify that it is free from malware that could harm your Mac or compromise your privacy. Don’t open this unless you are certain it is from a trustworthy source.'],
    buttons: [['Open Anyway', 'def t2'], ['Done', '']] });
  def('gk-anyway', 'settings', function (o) {
    const confirm = confirmBox(o);
    const auth = authBox('dlg-a', 't3');
    // The password dialog sits 15 pt lower, below the toolbar's title and the row under it.
    const layers = winSecurity(o, true, 'w-off') + winSecurity(o, false, 'w-on', 't1') + centred(CAM_SET, confirm) + centred(CAM_SET, auth, 15);
    const tl = {
      dur: 20000,
      vis: [['.w-on', [[0, 0.3], [0.975, 1]]], ['.dlg-c', [[0.31, 0.6]], 'pop'], ['.dlg-a', [[0.635, 0.955]], 'pop'], ['.pw .ph', [[0, 0.72]]], ['.fr', [[0.71, 0.955]]]],
      type: [['.pw .dots', '••••••••', 0.725, 0.79, 0.955]],
      // The tip rests under each label; Open Anyway has Done right below it, so
      // there it rests beside its label. The pointer moves on as the
      // confirmation closes, hides while the password is typed, and fades out
      // with the password dialog.
      cursor: [[0.03, '.t1', 120, 86, EASE], [0.12, '.t1', 0, 6], [0.3, '.t1', 0, 6, EASE], [0.4, '.t2', 40, 2], [0.57, '.t2', 40, 2, EASE], [0.69, '.pw', 40, 1], [0.79, '.pw', 40, 1, EASE], [0.85, '.t3', 0, 6], [0.95, '.t3', 0, 6]],
      cursorVis: [[0.03, 0.73], [0.795, 0.95]],
      halo: [['.t1', 0.13, 0.22], ['.t2', 0.42, 0.52], ['.t3', 0.86, 0.91]],
      clicks: [[0.22, '.t1', 0, 6], [0.52, '.t2', 40, 2], [0.705, '.pw', 40, 1], [0.91, '.t3', 0, 6]],
      anim: [press(o, '.t1', 0.22), press(o, '.t2', 0.52, true), press(o, '.t3', 0.91, true)],
    };
    return { cam: CAM_SET, layers, tl, poster: 0.18 };
  });

  // ---- The story (gk-story): from the finished download to Open Anyway ----
  // One calm loop instead of one sub-state per step. Four chapters, each drawn
  // with the replicas above:
  //   0 (row 1) Safari's Downloads list shows the zip as Safari leaves it
  //     ("USB-C-Display.zip", an archive icon). A double-click expands it:
  //     Archive Utility reveals what it made, so Finder comes forward on
  //     Downloads with "USB-C Display" selected next to the zip (V21), and that
  //     app is double-clicked. Safari, behind Finder now, has lost the focus,
  //     so its page turns to state C there (web/index.html does on blur).
  //     (With Safari's "Open safe files after downloading" on, the list
  //     shows the app itself; the picture keeps to the case the person can't
  //     guess.)
  //   1 (row 2) "“USB-C Display.app” Not Opened": the pointer steps off the
  //     app as the alert comes and waits beside it, clear of its words; Done.
  //   2 (row 2) Finder is in front again: the pointer clicks Safari's page
  //     beside it, and Safari comes forward at once (nothing fades, as on the
  //     Mac), its page in state C. The band pans down to Open Privacy &
  //     Security; as it is clicked the band pans back up, the pointer riding
  //     down with the page, and Safari's sheet comes: Allow.
  //   3 (row 3) Privacy & Security: Open Anyway; the confirmation: Open
  //     Anyway; the authentication dialog, shown and left for the person.
  // Two screens: A (Safari, Finder and the alert; s 0.85, panning to the page
  // column and back) and B (System Settings; s 0.8, as gk-anyway). Between
  // them the band dips through the desktop, so no window's words ever lie
  // over another's: Safari's windows fade out, then B fades in; as the loop
  // restarts, B fades out, then Safari's windows come back.
  // Times are seconds: the pointer glides 1.15 s, rests 0.8 s on what it
  // will click (with the highlight), clicks, and what the click did stays at
  // least a second before the pointer sets off again. storyScene() cuts the
  // loop to the chapters played (opt.fromChapter onwards) and gives
  // tl.chapters, and tl.stills: one frame per click, the pointer resting on
  // what it will click (app.js steps through them when motion is reduced).
  const SPRING = 'linear(0, .099, .286, .471, .625, .741, .826, .884, .924, .951, .968, .980, .987, .992, .995, .997, 1)';
  const GLIDE = 1.15, REST = 0.8, OUTRO = 1, DBL = 0.3;
  const STORY_ROWS = [1, 2, 2, 3];
  // Finder's window lies within Safari's frame (so Safari, brought forward,
  // hides it), in the left half of what the camera shows; its two items sit
  // under the Not Opened alert, so no name shows twice beside it. It reaches
  // below the band, so nothing of the page behind peeks out under it.
  const FD_WIN = { x: 446, y: 160, w: 556, h: 300 };
  // Where the pointer clicks to bring Safari back: its page, right of Finder
  // (window points).
  const SAF_BACK = { x: FD_WIN.x + FD_WIN.w + 60 - SAF.x, y: FD_WIN.y + 60 - SAF.y };

  function storyData(o) {
    const st = { tracks: [], chapters: [], cams: {} };
    const HID = { opacity: 0, transform: 'scale(.97)' }, SHOWN = { opacity: 1, transform: 'none' }, GONE = { opacity: 0, transform: 'none' };
    const ON = { opacity: 1 }, OFF = { opacity: 0 };
    // A value that changes at t over d seconds: [[t, d, value, easing], ...].
    // kind: 'el', 'cam', 'layer' (a whole screen), 'dip' (Safari's windows,
    // which leave and come back around the other screen).
    const track = (sel, layer, v0, changes, kind) => {
      const kf = [[0, v0]];
      let cur = v0;
      changes.slice().sort((a, b) => a[0] - b[0]).forEach(([t, d, v, e]) => { kf.push([t, Object.assign({}, cur, { easing: e || 'ease-in-out' })], [t + d, v]); cur = v; });
      st.tracks.push({ sel, layer, kind: kind || 'el', kf });
    };
    const pop = (t) => [[t, 0, HID, 'linear'], [t, 0.25, SHOWN, SPRING]];
    const shut = (t, d) => [[t, d || 0.16, GONE, 'ease-in']];
    // A control looks pressed while the button is down; a double-click ([t1,
    // t2]) presses it twice.
    const pressed = (sel, layer, t, accent, f) => {
      f = f || (o.dark ? (accent ? 'brightness(1.16)' : 'brightness(1.5)') : (accent ? 'brightness(.86)' : 'brightness(.9)'));
      const ch = [];
      if (Array.isArray(t)) t.forEach((u) => ch.push([u - 0.03, 0.03, { filter: f }, 'linear'], [u + 0.08, 0.08, { filter: 'brightness(1)' }, 'ease-out']));
      else ch.push([t - 0.03, 0.03, { filter: f }, 'linear'], [t + 0.16, 0.12, { filter: 'brightness(1)' }, 'ease-out']);
      track(sel, layer, { filter: 'brightness(1)' }, ch);
    };
    const cam = (layer, c0, changes) => {
      st.cams[layer] = [[0, 0, c0]].concat(changes);
      track('.ly-' + layer.toLowerCase(), layer, { transform: camT(c0) }, changes.map(([t, d, c]) => [t, d, { transform: camT(c) }, SPRING]), 'cam');
    };
    const chapter = (start, intro, end, poster, entry) => {
      const c = { row: STORY_ROWS[st.chapters.length], start, intro, end, poster, entry, moves: [], rides: [], halo: [], clicks: [] };
      st.chapters.push(c);
      return c;
    };
    // The pointer glides to sel, arrives REST before t, rests (highlighted),
    // clicks at t (and again DBL later for a double-click).
    const click = (c, sel, t, dx, dy, opt) => {
      opt = opt || {};
      const arrive = t - REST;
      c.moves.push([arrive - GLIDE, arrive, sel, dx, dy]);
      if (!opt.noHalo) c.halo.push([opt.halo || sel, arrive - 0.05, t]);
      c.clicks.push([t, sel, dx, dy]);
      if (opt.dbl) c.clicks.push([t + DBL, sel, dx, dy]);
    };

    // Chapter 0: Downloads, the zip, then the app it makes (Finder).
    const c0 = chapter(0, 0, 9.95, 5.6, ['.saf-on .dlb', -150, 110]);
    // The tip rests in the button's lower right, clear of its arrow.
    click(c0, '.saf-on .dlb', 2.6, 7, 7);
    pressed('.saf-on .dlb', 'A', 2.6);
    track('.pv', 'A', HID, pop(2.75).concat(shut(6.6, 0.15)));
    // The tip rests just right of the zip's name, so the name stays readable.
    click(c0, '.saf-on .zi', 5.9, 30, 3, { dbl: true });
    track('.zi .mk-hl', 'A', OFF, [[5.9, 0.03, ON, 'linear'], [6.9, 0, OFF]]);
    track('.zi b', 'A', { color: 'var(--tx)' }, [[5.9, 0.03, { color: 'var(--ac-tx)' }, 'linear'], [6.9, 0, { color: 'var(--tx)' }]]);
    track('.zi .sz, .zi .mg', 'A', { color: 'var(--tx2)' }, [[5.9, 0.03, { color: 'var(--ac-tx)' }, 'linear'], [6.9, 0, { color: 'var(--tx2)' }]]);
    // Finder comes forward; Safari goes inactive behind it, where its page
    // turns to state C unseen. A window turns active or inactive at once, as
    // on the Mac: Finder as the alert comes and again once it has gone, Safari
    // at the click that brings it back (chapter 2). Then Safari's windows dip
    // out for System Settings (chapter 3).
    track('.fd-on', 'A', HID, pop(6.6).concat([[10.1, 0, GONE], [13.52, 0, SHOWN], [15.75, 0, GONE]]));
    track('.fd-off', 'A', OFF, [[6.85, 0, ON], [15.75, 0, OFF]]);
    track('.saf-on', 'A', ON, [[6.6, 0, OFF], [15.75, 0, ON], [24.2, 0.25, OFF]], 'dip');
    track('.saf-off', 'A', ON, [[24.2, 0.25, OFF]], 'dip');
    track('.pgB', 'A', ON, o.notarized ? [] : [[6.85, 0, OFF]]);
    track('.pgC', 'A', OFF, o.notarized ? [] : [[6.85, 0, ON]]);
    // The tip rests on the app's icon, clear of its name.
    click(c0, '.fd-on .fi-app .fic', 9.5, 6, -4, { dbl: true });
    pressed('.fd-on .fi-app .fic svg', 'A', [9.5, 9.5 + DBL], false, 'brightness(.7)');

    // Chapter 1: the Not Opened alert, Done. Right after the double-click the
    // pointer steps off the app and waits beside the alert, so nothing covers
    // its words while they are read (they are the most of the story).
    const c1 = chapter(9.95, 0, 13.6, 12.5, ['.al-no', 175, 0]);
    track('.al-no', 'A', HID, pop(10.1).concat(shut(13.35)));
    c1.moves.push([9.5 + DBL + 0.1, 10.45, '.al-no', 175, 0]);
    click(c1, '.al-no .t-done', 13.2, 0, 6);
    pressed('.al-no .t-done', 'A', 13.2);

    // Chapter 2: back to Safari, its page's button, then Safari's sheet.
    const c2 = chapter(13.6, 0, 24.2, 19.0, ['.saf-on .bk', -150, 60]);
    // Finder is in front again: a click on Safari's page beside it.
    click(c2, '.saf-on .bk', 15.75, 0, 0, { noHalo: true });
    cam('A', CAM_SAF, [[16.45, 0.9, CAM_COL_C], [19.55, 0.9, CAM_SAF]]);
    // The tip rests in the button's right padding, clear of its words and of
    // the note under it.
    click(c2, '.saf-on .pgC .tgt', 19.4, 68, 2);
    pressed('.saf-on .pgC .tgt', 'A', 19.4, true);
    // The band pans back up as Safari's sheet comes; the pointer stays on the
    // button, so it rides down and out with the page, then comes up to Allow.
    c2.rides.push([19.55, 0.9]);
    track('.sg-dim', 'A', OFF, [[20.15, 0.22, ON], [23.5, 0.2, OFF]]);
    track('.sg-al', 'A', HID, pop(20.2).concat(shut(23.5, 0.15)));
    click(c2, '.saf-on .sg-al .tgt', 23.35, 30, 2);
    pressed('.saf-on .sg-al .tgt', 'A', 23.35, true);

    // Chapter 3: System Settings: Open Anyway, Open Anyway, then Touch ID or the password.
    const c3 = chapter(24.2, 0.7, 34.75, 26.9, ['.t1', 120, 86]);
    track('.ly-a', 'A', ON, [[24.85, 0, OFF]], 'layer');
    track('.ly-b', 'B', OFF, [[24.45, 0.4, ON]], 'layer');
    st.cams.B = [[0, 0, CAM_SET]];
    click(c3, '.t1', 27.25, 0, 6);
    pressed('.t1', 'B', 27.25);
    track('.w-on', 'B', ON, [[27.4, 0.15, OFF]]);
    // The confirmation stays a full second before the pointer sets off: it is
    // the warning people stop at.
    track('.dlg-c', 'B', HID, pop(27.4).concat(shut(30.75, 0.15)));
    // Open Anyway has Done right below it: the tip rests beside its label,
    // high enough that the arrow stays off Done.
    click(c3, '.t2', 30.6, 40, -3);
    pressed('.t2', 'B', 30.6, true);
    track('.dlg-a', 'B', HID, pop(31.05));
    track('.dlg-a .fr', 'B', OFF, [[31.3, 0.15, ON]]);
    // Then the pointer steps aside onto the desktop, clear of the dialog and
    // the pane: Touch ID or the password is the person's own part.
    c3.moves.push([31.15, 32.25, '.dlg-a', 318, 10]);
    return st;
  }

  function storyScreens(o, withA, withB) {
    const size = o.appBytes ? macSize(o.appBytes) : esc(o.appSize);
    let a = '', b = '';
    if (withA) {
      const pop = '<div class="mk-pop2 pv" style="' + at(SAF.w - 12 - 330, 58) + '"><div class="hd">Downloads<span>Clear</span></div><div class="it zi"><i class="mk-hl"></i><i class="ic">' + zipIcon() + '</i>' +
        '<div><b>' + zipName(o) + '</b>' + (size ? '<span class="sz">' + size + '</span>' : '') + '</div><span class="mg">' + GL.mag + '</span></div></div>';
      const sheet = '<div class="mk-dim sg-dim" style="top:52px"></div>' +
        alertBox({ x: SAF.w / 2 - 130, y: 64, cls: 'dlg sheet sg-al', icon: '', title: 'Do you want to allow this page to open “System Settings”?', row: true, buttons: [['Cancel', ''], ['Allow', 'def tgt']] });
      // Where the pointer clicks Safari's page to bring it forward (nothing drawn).
      const back = '<i class="bk" style="position:absolute;' + at(SAF_BACK.x - 1, SAF_BACK.y - 1, 2, 2) + '"></i>';
      const pages = (tgt) => page(o, 'B', 'pgB') + page(o, 'C', 'pgC', tgt);
      // The notarized page's sentence is a line shorter, so its centred column would sit 11 pt
      // lower and the band's edge would cut its icon: a window 22 pt shorter (its bottom is out of
      // the picture) keeps the icon where the other one is.
      const h = o.notarized ? SAF.h - 22 : SAF.h;
      a = safariWin(o, { addr: addrIdle(o.host), page: pages(false), dl: true, off: true, cls: 'saf-off', h }) +
        safariWin(o, { addr: addrIdle(o.host), page: pages(true), dl: true, cls: 'saf-on', extra: pop + sheet + back, h }) +
        finderWin(o, Object.assign({ off: true, cls: 'fd-off' }, FD_WIN)) + finderWin(o, Object.assign({ cls: 'fd-on' }, FD_WIN)) +
        centred(CAM_SAF, notOpenedBox(o, 'dlg al-no', 't-done'));
    }
    if (withB) {
      // The password dialog sits 15 pt lower, below the toolbar's title and the row under it.
      b = winSecurity(o, true, 'w-off') + winSecurity(o, false, 'w-on', 't1') + centred(CAM_SET, confirmBox(o)) + centred(CAM_SET, authBox('dlg-a', 't3'), 15);
    }
    return { a, b };
  }

  // The loop of chapters from..to (indexes in STORY_ROWS): its timeline in
  // fractions, with an outro that brings the start back, and tl.chapters:
  // [{index, row, start, end, poster}] (the outro belongs to no chapter, so
  // no row is current while the loop goes back to its start).
  function storyScene(o, from, to) {
    const st = storyData(o);
    const C = st.chapters;
    from = Math.max(0, Math.min(C.length - 1, from | 0));
    to = Math.max(from, Math.min(C.length - 1, to | 0));
    const s0 = C[from].start + (from > 0 ? C[from].intro : 0);
    const endMain = C[to].end, E = endMain + OUTRO, D = E - s0;
    const F = (t) => Math.max(0, Math.min(1, (t - s0) / D));
    const valueAt = (kf, t) => { let v = kf[0][1]; kf.forEach(([u, p]) => { if (u <= t + 1e-6) v = p; }); return v; };
    const plain = (p) => { const c = Object.assign({}, p); delete c.easing; return c; };
    const layers = {};
    st.tracks.forEach((tr) => { if (tr.kind === 'layer') layers[tr.layer] = tr.kf; });
    const shown = (L, t) => !layers[L] || +valueAt(layers[L], t).opacity > 0.5;
    const withA = from <= 2, withB = to >= 3;
    // Both screens play: they meet through the desktop (a dip), both ways.
    const dip = withA && withB;

    const anim = [];
    st.tracks.forEach((tr) => {
      if ((tr.layer === 'A' && !withA) || (tr.layer === 'B' && !withB)) return;
      const v0 = plain(valueAt(tr.kf, s0)), v1 = plain(valueAt(tr.kf, endMain));
      const kf = [Object.assign({ offset: 0 }, v0)];
      tr.kf.forEach(([t, p]) => { if (t > s0 + 1e-6 && t < endMain - 1e-6) kf.push(Object.assign({ offset: F(t) }, p)); });
      kf.push(Object.assign({ offset: F(endMain) }, v1));
      if (JSON.stringify(v0) !== JSON.stringify(v1)) {
        // Back to the start. Screen B leaving fades out over A's bare desktop
        // (A is there at once beneath it, its windows still out), then Safari's
        // windows come back; what can't be seen changes at once; on a screen
        // that stays, dialogs close first and windows come back after.
        let a, z;
        if (tr.kind === 'layer') { if (+v0.opacity > +v1.opacity) { a = endMain; z = endMain + 0.02; } else { a = endMain + 0.1; z = endMain + 0.35; } }
        else if (tr.kind === 'dip' && dip) { a = endMain + 0.35; z = endMain + 0.7; }
        else if (!shown(tr.layer, endMain)) { a = endMain; z = endMain + 0.01; }
        else if (!shown(tr.layer, s0)) { a = E - 0.05; z = E - 0.04; }
        else if (tr.kind === 'cam') { a = endMain + 0.1; z = endMain + 0.9; }
        else if (v0.opacity != null && +v0.opacity > +v1.opacity) { a = endMain + 0.3; z = endMain + 0.55; }
        else { a = endMain; z = endMain + 0.25; }
        kf.push(Object.assign({ offset: F(a) }, v1, { easing: 'ease-in-out' }), Object.assign({ offset: F(z) }, v0));
      }
      anim.push([tr.sel, kf]);
    });

    // The pointer: each target is measured where it was when the pointer got
    // there (the 6th field), so a hold doesn't jump when the camera moves on.
    // A ride keeps it on what it just clicked while the camera moves: it is
    // measured before and after, and moves with the camera's own easing.
    const cursor = [], halo = [], clicks = [], stills = [];
    let last = null;
    for (let k = from; k <= to; k++) {
      const c = C[k];
      if (k === from) { last = [c.entry[0], c.entry[1], c.entry[2], 0]; cursor.push([0, last[0], last[1], last[2], 'linear', 0]); }
      const steps = c.moves.map((m) => ({ t: m[0], m })).concat(c.rides.map((r) => ({ t: r[0], r }))).sort((x, y) => x.t - y.t);
      steps.forEach(({ m, r }) => {
        if (m) {
          let [g0, g1] = m;
          const [, , sel, dx, dy] = m;
          if (g0 < s0 + 0.3) { g1 += s0 + 0.3 - g0; g0 = s0 + 0.3; }
          cursor.push([F(g0), last[0], last[1], last[2], EASE, last[3]], [F(g1), sel, dx, dy, 'linear', F(g1)]);
          last = [sel, dx, dy, F(g1)];
        } else {
          const [r0, rd] = r;
          cursor.push([F(r0), last[0], last[1], last[2], SPRING, F(r0 - 0.02)], [F(r0 + rd), last[0], last[1], last[2], 'linear', F(r0 + rd)]);
          last = [last[0], last[1], last[2], F(r0 + rd)];
        }
      });
      c.halo.forEach(([sel, a, z]) => halo.push([sel, F(a), F(z)]));
      c.clicks.forEach(([t, sel, dx, dy]) => {
        clicks.push([F(t), sel, dx, dy]);
        // One still per click (the second of a double-click is the same one).
        if (!stills.length || t - stills[stills.length - 1][0] > 0.5) stills.push([t, F(t - 0.12)]);
      });
    }
    cursor.push([F(endMain), last[0], last[1], last[2], 'linear', last[3]]);
    // The last still of the whole story: the authentication dialog, left for the person.
    if (to === C.length - 1) stills.push([endMain, F(endMain - 0.6)]);
    const chapters = [];
    for (let k = from; k <= to; k++) chapters.push({ index: k, row: C[k].row, start: k === from ? 0 : F(C[k].start), end: F(C[k].end), poster: F(C[k].poster) });
    const camOf = (L, t) => { let c = st.cams[L][0][2]; st.cams[L].forEach(([u, , cc]) => { if (u <= t + 1e-6) c = cc; }); return c; };
    const tl = {
      dur: Math.round(D * 1000), real: true, anim, cursor, halo, clicks,
      cursorVis: [[F(s0 + 0.2), F(endMain)]],
      chapters,
      stills: stills.map((x) => x[1]),
      camAt: (scr, f) => camOf(scr.classList.contains('ly-b') ? 'B' : 'A', s0 + f * D),
    };
    const scr = storyScreens(o, withA, withB);
    const screens = [];
    if (withA) screens.push({ cls: 'ly-a', cam: camOf('A', s0), layers: scr.a });
    if (withB) screens.push({ cls: 'ly-b', cam: CAM_SET, layers: scr.b });
    return { cam: shown('B', s0) && withB ? CAM_SET : camOf('A', s0), screens, tl, poster: chapters[0].poster, family: 'story:' + from + '-' + to, range: [from, to] };
  }
  def('gk-story', 'story', (o) => storyScene(o, o.fromChapter, STORY_ROWS.length - 1));
  // The Downloads list on its own (the notarized build): chapter 0, looping.
  def('safari-open', 'story', (o) => storyScene(o, 0, 0));

  // Privacy lists: the pointer turns on the app's switch. off: the switch
  // stays off and there's no pointer.
  function listScene(o, title, pane, sel, edge) {
    const layers = settingsWin({ x: WIN.x, y: WIN.y, sel, title, pane, edge });
    if (o.off) return { cam: CAM_SET, layers, tl: { dur: 1000 }, poster: 0 };
    const tl = clickLoop(o, '.tgt', { click: 0.5, from: [-150, -60], dur: 7000, dy: 0 });
    tl.anim = tl.anim.concat(switchOn('.tgt', 0.505, 0.95));
    return { cam: CAM_SET, layers, tl, poster: 0.44 };
  }
  def('screen-list', 'settings', (o) => listScene(o, 'Screen &amp; System Audio Recording', paneScreen(o, false, !o.off), 'privacy'));
  def('ax-list', 'settings', (o) => listScene(o, 'Device Control and Data Access', paneAx(o, false, !o.off), 'privacy'));
  def('login-list', 'settings', (o) => listScene(o, 'Login Items', paneLogin(o, false, !o.off), '', true));

  // After the switch: macOS asks to quit and reopen the app.
  def('screen-reopen', 'settings', function (o) {
    const msg = q(appApp(o)) + ' may not be able to record the contents of your screen until it is quit.';
    const dlg = alertBox({ cls: 'dlg mat', icon: appIcon(), title: msg, body: ['You can choose to quit ' + q(appApp(o)) + ' now, or do it on your own later.'],
      row: true, buttons: [['Later', ''], ['Quit &amp; Reopen', 'def tgt']] });
    const tl = clickLoop(o, '.tgt', { click: 0.5, accent: true, from: [150, 70] });
    // The alert sits just under the toolbar; the pane's header and description
    // behind it aren't drawn, so no scrap of them sticks out beside it.
    return { cam: CAM_SET, layers: settingsWin({ x: WIN.x, y: WIN.y, sel: 'privacy', title: 'Screen &amp; System Audio Recording', off: true, cls: 'under', pane: paneScreen(o, true) }) + centred(CAM_SET, dlg, 10), tl, poster: 0.42 };
  });

  // ---- Permission prompts (family "prompt"): the prompt in the middle of
  // the screen, an inactive System Settings window behind it ----
  const CAM_PR = { x: 311.6, y: 173.3, s: 0.9 };
  // The window sits so the sidebar's names end clear of the prompt's left edge.
  const WIN_PR = { x: 380, y: 205 };
  // Privacy & Security scrolled so the rows beside the prompt show no words
  // (only their chevrons and "On"), and Security with "Allow applications
  // from" sits whole below it; the band's edge falls above FileVault.
  const PR_SCROLL = 95;
  function promptScene(o, title, badge, msg, behind) {
    const pr = prompt({ cls: 'dlg mat', title, badge, msg });
    const tl = clickLoop(o, '.tgt', { click: 0.5, from: [170, 70] });
    return { cam: CAM_PR, layers: behind + centred(CAM_PR, pr), tl, poster: 0.42 };
  }
  def('screen-prompt', 'prompt', (o) => promptScene(o, 'Screen Recording', 'record',
    isDefault(o) ? q(appApp(o)) + ' would like to record this<br>computer’s screen and audio.' : q(appApp(o)) + ' would like to record this computer’s screen and audio.',
    settingsWin({ x: WIN_PR.x, y: WIN_PR.y, sel: 'privacy', title: 'Privacy &amp; Security', edge: true, off: true, pane: paneSecurity(o, { scroll: PR_SCROLL }) })));
  def('ax-prompt', 'prompt', (o) => promptScene(o, 'Device Control and Data Access', 'folder',
    isDefault(o) ? q(appApp(o)) + ' would like to control this Mac<br>and access your data.' : q(appApp(o)) + ' would like to control this Mac and access your data.',
    settingsWin({ x: WIN_PR.x, y: WIN_PR.y, sel: 'privacy', title: 'Screen &amp; System Audio Recording', off: true, cls: 'under', pane: paneScreen(o, true) })));

  // ---- The "Login Item Added" notification (family "banner") ----
  const CAM_BN = { x: SCREEN.w - CANVAS.w / 0.9, y: 0, s: 0.9 };
  const WIN_BN = { x: 700, y: 140 };
  // Privacy & Security scrolled so Analytics & Improvements sits wholly under
  // the toolbar, and the band's lower edge falls below the Security header.
  const BN_SCROLL = 30;
  def('bg-items', 'banner', function (o) {
    const note = '<div class="mk-note-b nt" style="' + at(SCREEN.w - 12 - 344, 44) + '"><i class="ic">' + settingsIcon() + '</i><div class="bd"><b>Login Item Added</b><p>' + q(esc(o.appName)) + ' can run in the background. You can manage this in Login Items &amp; Extensions.</p></div><span class="tm">now</span></div>';
    const win = settingsWin({ x: WIN_BN.x, y: WIN_BN.y, sel: 'privacy', title: 'Privacy &amp; Security', edge: true, pane: paneSecurity(o, { scroll: BN_SCROLL }) });
    const tl = { dur: 7000, vis: [['.nt', [[0.06, 0.9]], 'slideL']] };
    return { cam: CAM_BN, layers: win + menubar() + note, tl, poster: 0.5 };
  });

  // ---------- Builder ----------
  function norm(opt) {
    opt = opt || {};
    const acc = String(opt.accent || '').toLowerCase();
    return {
      dark: opt.dark !== false,
      accent: ACCENTS.indexOf(acc) >= 0 ? acc : 'blue',
      host: String(opt.host || 'usbc.local').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '') || 'usbc.local',
      appName: String(opt.appName || 'USB-C Display'),
      appSize: String(opt.appSize || ''),
      appBytes: Math.max(0, Math.round(+opt.appBytes || 0)),
      appVersion: String(opt.appVersion || '5'),
      notarized: !!opt.notarized,
      still: !!opt.still,
      off: !!opt.off,
      // gk-story: the first chapter to play (0-based, see STORY_ROWS), or the
      // first chapter of row fromRow.
      fromChapter: Number.isInteger(+opt.fromChapter) && opt.fromChapter !== '' && opt.fromChapter != null
        ? Math.max(0, Math.min(STORY_ROWS.length - 1, +opt.fromChapter))
        : (+opt.fromRow > 1 ? Math.max(0, STORY_ROWS.indexOf(Math.min(3, +opt.fromRow | 0))) : 0),
    };
  }
  const r1 = (v) => Math.round(v * 10) / 10;

  D.scenes.mac = function (name, opt) {
    const o = norm(opt);
    const known = !!V[name];
    // An unknown name shows the empty desktop, never a wrong instruction.
    const v = known ? V[name](o) : { cam: CAM_SAF, layers: '', tl: { dur: 1000 }, poster: 0 };
    // Most pictures are one screen; a story has several, each with its camera.
    const screens = v.screens || [{ cls: '', cam: v.cam, layers: v.layers }];
    const cam = { x: r1(v.cam.x), y: r1(v.cam.y), s: v.cam.s };
    const frozen = o.still || o.off || !known;
    let tl = Object.assign({}, v.tl);
    let poster = v.poster;
    if (frozen) {
      poster = o.still && v.still != null ? v.still : poster;
      // A still picture: what the screen looks like at that moment, without
      // the pointer, its highlight or its clicks.
      delete tl.cursor; delete tl.cursorVis; delete tl.halo; delete tl.clicks;
      tl.stillAt = poster;
    }
    tl.w = CANVAS.w; tl.h = CANVAS.h; tl.poster = poster; tl.cam = cam;
    const cls = 'mk ' + (o.dark ? 'dark' : 'light') + ' acc-' + o.accent + ' fam-' + (FAMILY[name] || 'none') + (frozen ? ' still' : '') + (o.off ? ' off-state' : '');
    const html = '<div class="' + cls + '" data-mac="' + esc(name) + '">' +
      screens.map((sc) => '<div class="mk-scr' + (sc.cls ? ' ' + sc.cls : '') + '" style="width:' + SCREEN.w + 'px;height:' + SCREEN.h + 'px;transform:' + camT(sc.cam) + '"><div class="mk-wall"></div>' + sc.layers + '</div>').join('') +
      (frozen || !tl.cursor ? '' : pointer(cam.s * 1.15)) + '</div>';
    const key = 'mac:' + name + ':' + (o.dark ? 'd' : 'l') + ':' + o.accent + ':' + o.host + ':' + o.appName + ':' + o.appSize + ':' + o.appBytes + ':' + o.appVersion +
      ':' + (o.notarized ? 'n' : '') + (o.still ? 's' : '') + (o.off ? 'o' : '') + (v.range ? ':' + v.range.join('-') : '');
    // A story's family names the chapters it plays: another range is another
    // picture (a crossfade), never a pan of the band over the story's own camera.
    return { key, html, tl, poster, cam, family: v.family || FAMILY[name] || 'none', w: CANVAS.w, h: CANVAS.h };
  };
  // The story's chapters and the row of the steps each one teaches.
  D.scenes.mac.story = { rows: STORY_ROWS.slice() };
  // For the preview pages: every scene and its family.
  D.scenes.mac.names = Object.keys(V);
  D.scenes.mac.families = Object.assign({}, FAMILY);
})();
