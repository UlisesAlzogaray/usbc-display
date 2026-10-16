// Pictures for the setup window (SPEC §3.0.6, §6.3):
//   D.glyph(name)            hero glyphs, filled, in the accent gradient
//   D.listGlyph(name)        30 pt line glyphs for the Ready list
//   D.scenes.camTransform()  the camera of a picture band
//   D.playScene()            the timeline engine that plays the Mac pictures
//                            drawn by macos.js (D.scenes.mac)
// Every drawing here is our own. Nothing is copied from Apple.
(function () {
  'use strict';
  const D = (window.USBC = window.USBC || {});
  D.scenes = D.scenes || {};

  // ---------- Hero glyphs ----------
  // Sizes in Mac points: the SVG's width and height attributes. The window's
  // CSS scales them to points (calc(N * var(--pt))).
  const SIZES = {
    displays: [126, 78.5], hand: [78, 93], plug: [26, 89],
    folder: [120, 93], keyboard: [146, 93], check: [93, 93],
  };
  // A rounded rectangle as a path, so rings can use the even-odd rule.
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    const R = (v) => Math.round(v * 1000) / 1000;
    return 'M' + R(x + r) + ' ' + R(y) + 'H' + R(x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + R(x + w) + ' ' + R(y + r) +
      'V' + R(y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + R(x + w - r) + ' ' + R(y + h) +
      'H' + R(x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + R(x) + ' ' + R(y + h - r) +
      'V' + R(y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + R(x + r) + ' ' + R(y) + 'Z';
  }
  // A ring: the area between two rounded rectangles (stroke drawn inward).
  const ring = (x, y, w, h, r, sw) => rr(x, y, w, h, r) + rr(x + sw, y + sw, w - 2 * sw, h - 2 * sw, Math.max(0, r - sw));

  // Ids are fixed per glyph, so the same name always gives the same markup.
  // Two copies on the page (old and new screen during a crossfade) define
  // identical gradients, so either one resolves to the same paint.
  function hero(name, defs, body) {
    const w = SIZES[name][0], h = SIZES[name][1];
    const g = 'usbc-g-' + name;
    return '<svg class="hero-svg glyph-' + name + '" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true" focusable="false"><defs>' +
      '<linearGradient id="' + g + '" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="' + h + '">' +
      '<stop offset="0" style="stop-color: color-mix(in oklch, var(--accent), white 22%)"/>' +
      '<stop offset="1" style="stop-color: var(--accent)"/></linearGradient>' + (defs || '') + '</defs>' +
      body.replace(/GRAD/g, 'url(#' + g + ')').replace(/MASK/g, 'url(#usbc-m-' + name + ')') + '</svg>';
  }
  const maskDef = (name, w, h, holes) => '<mask id="usbc-m-' + name + '" maskUnits="userSpaceOnUse" x="-2" y="-2" width="' + (w + 4) + '" height="' + (h + 4) + '">' +
    '<rect x="-2" y="-2" width="' + (w + 4) + '" height="' + (h + 4) + '" fill="#fff"/>' + holes + '</mask>';

  const GLYPHS = {
    // Two displays, flat, both feet on one floor line (126 x 78.5, the ink of
    // the reference render). The front display hides the back one: its whole
    // outline is a hole in the back display, so the two meet without a gap.
    displays: () => hero('displays',
      maskDef('displays', 126, 78.5, '<path d="' + rr(54, 18.5, 72, 49.5, 9) + '" fill="#000"/>'),
      '<g fill="GRAD"><g mask="MASK"><path fill-rule="evenodd" d="' + ring(0, 0, 93.5, 64.5, 8, 5) + '"/>' +
      '<rect x="34.5" y="64.5" width="24.5" height="9.5"/><rect x="31.5" y="73.5" width="30.5" height="5" rx="2.5"/></g>' +
      '<path fill-rule="evenodd" d="' + ring(54, 18.5, 72, 49.5, 9, 5) + '"/>' +
      '<rect x="79.5" y="67" width="21" height="7"/><rect x="77" y="73.5" width="26" height="5" rx="2.5"/></g>'),
    // A raised open right hand: four fingers (the middle one tallest), a palm
    // rounded at the bottom, and the thumb angled out to the left, with a
    // fillet where it meets the index finger (its straight sides reach into
    // the palm and thumb, so no two edges meet in a seam). The fingers fan out a little:
    // each turns about its own knuckle on the palm's top edge (y 36), so the
    // part below it stays inside the palm and no edge crosses the outline
    // (drawn 0.75 pt to the left so the fanned little finger stays in the box).
    hand: () => hero('hand', '',
      '<g fill="GRAD" transform="translate(-0.75 0)"><rect x="22" y="5" width="12" height="47" rx="6" transform="rotate(-3 28 36)"/><rect x="36.5" y="0" width="12" height="52" rx="6"/>' +
      '<rect x="51" y="3" width="12" height="49" rx="6" transform="rotate(1.5 57 36)"/><rect x="65.5" y="13" width="12" height="41" rx="6" transform="rotate(3.5 71.5 36)"/>' +
      '<path d="M22 36H77.5V67A26 26 0 0 1 51.5 93H48A26 26 0 0 1 22 67Z"/>' +
      '<path d="M8.4 43.6L28.5 70.6" stroke="GRAD" stroke-width="13" stroke-linecap="round"/>' +
      '<path d="M22 58L33 54 36 80 24 76Z"/><path d="M22 43H24V54L21.5 52.4 16 45.5 17.2 44.6Q22 51 22 43Z"/></g>'),
    // A USB-C plug pointing up.
    plug: () => hero('plug', '',
      '<g fill="GRAD"><path d="M6 13V3A3 3 0 0 1 9 0H17A3 3 0 0 1 20 3V13Z"/><rect x="0" y="17" width="26" height="40" rx="5.5"/>' +
      '<rect x="10" y="56.5" width="6" height="32.5"/></g>'),
    // A folder (one outline: a slanted tab on a rounded body) with a down
    // arrow cut out of it, round caps and joins.
    folder: () => hero('folder',
      maskDef('folder', 120, 93, '<path d="M60 34V70M45 57L60 72 75 57" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'),
      '<g fill="GRAD" mask="MASK"><path d="M0 10A10 10 0 0 1 10 0H38.5A6 6 0 0 1 43.6 2.8L48.5 10H110A10 10 0 0 1 120 20V83A10 10 0 0 1 110 93H10A10 10 0 0 1 0 83Z"/></g>'),
    // A keyboard and trackpad seen from above: key caps and a trackpad cut out.
    keyboard: () => {
      // Rows inset 10 pt; 10 x 10 keys with 3 pt gaps, one wider key per row so
      // each row fills the 126 pt exactly; the bottom row has a space bar.
      const rows = [
        [10, 10, 10, 10, 10, 10, 10, 10, 22],
        [22, 10, 10, 10, 10, 10, 10, 10, 10],
        [15.5, 10, 10, 10, 10, 10, 10, 10, 16.5],
        [10, 10, 10, 61, 10, 10],
      ];
      let holes = '';
      rows.forEach((keys, i) => {
        let x = 10;
        const y = 10 + i * 13;
        keys.forEach((w) => { holes += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="10" rx="2.5" fill="#000"/>'; x += w + 3; });
      });
      holes += '<rect x="45" y="62" width="56" height="26" rx="6" fill="#000"/>';
      return hero('keyboard', maskDef('keyboard', 146, 93, holes), '<rect x="0" y="0" width="146" height="93" rx="12" fill="GRAD" mask="MASK"/>');
    },
    // A filled circle with a check mark cut out.
    check: () => hero('check',
      maskDef('check', 93, 93, '<path d="M27 48L41 62 67 32" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'),
      '<circle cx="46.5" cy="46.5" r="46.5" fill="GRAD" mask="MASK"/>'),
  };
  D.glyph = function (name) {
    const f = GLYPHS[name] || GLYPHS.displays;
    return f();
  };
  D.glyph.names = Object.keys(GLYPHS);
  D.glyph.sizes = SIZES;

  // ---------- List glyphs (30 pt line drawings in currentColor) ----------
  const LIST = {
    // A circle open at the top left, with an arrow leaving through the gap.
    escape: '<path d="M16 5A11 11 0 1 1 5 16"/><path d="M16 16L6 6M6 13V6H13"/>',
    plug: '<rect x="12" y="2" width="6" height="5" rx="1"/><rect x="9" y="8" width="12" height="13" rx="2.5"/><path d="M15 21V29"/>',
    keyboard: '<rect x="1" y="6" width="28" height="18" rx="3"/>' +
      '<path stroke-width="1.6" d="M6 11h0M9 11h0M12 11h0M15 11h0M18 11h0M21 11h0M24 11h0M6 15h0M9 15h0M12 15h0M15 15h0M18 15h0M21 15h0M24 15h0"/>' +
      '<path d="M9 20H21"/>',
  };
  D.listGlyph = function (name) {
    return '<svg class="list-svg lglyph-' + name + '" viewBox="0 0 30 30" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (LIST[name] || LIST.escape) + '</svg>';
  };
  D.listGlyph.names = Object.keys(LIST);

  // ---------- Camera ----------
  // A band shows the Mac's screen from point (x, y) at scale s. Applied to
  // .mk-scr, whose transform origin is its top-left corner.
  D.scenes.camTransform = function (cam) {
    const r = (v) => Math.round(v * 1000) / 1000;
    return 'scale(' + r(cam.s) + ') translate(' + r(-cam.x) + 'px,' + r(-cam.y) + 'px)';
  };

  // ---------- Timeline engine ----------
  // A timeline lists pointer moves, clicks, highlights and what is visible
  // when, as fractions of one loop of tl.dur ms. Points are canvas units:
  // tl.w wide (800 for a picture band, 400 for older scenes). A target given
  // as a selector resolves to the centre of that element plus (dx, dy).
  // tl.stillAt freezes the picture at that fraction (still pictures);
  // reduced motion freezes it at tl.poster.
  // A story (tl.real) is a long loop: the engine's own transitions (a click,
  // its ring, a highlight, a fade) keep the real length they have in a 6.5 s
  // loop instead of growing with the loop. A picture with several screens
  // (.mk-scr), or a camera that moves, gives tl.camAt(screenEl, t): the camera
  // that screen rests at, at fraction t, so every target is measured where it
  // will be when the pointer gets there. tl.chapters ({row, start, end} as
  // fractions of the loop): the band's element gets a 'usbc-chapter' event
  // ({detail: {index, chapter}}) each time the loop enters another chapter.
  D.playScene = function (root, tl, start) {
    const anims = [];
    if (!tl || !root || !root.animate) return anims;
    const dur = tl.dur || 6000;
    const W = (f) => (tl.real ? (f * 6500) / dur : f);
    const wrap = root.closest('.scene-wrap') || root;
    const wr = wrap.getBoundingClientRect();
    const k = wr.width / (tl.w || 400) || 1;
    const layer = root.classList.contains('mk') ? root : (root.querySelector('.mk') || root);
    Array.from(layer.children).forEach((e) => { if (e.classList.contains('ring') || e.classList.contains('halo')) e.remove(); });
    const all = (sel) => Array.from(root.querySelectorAll(sel));
    const first = (sel) => root.querySelector(sel);
    const clamp = (v) => Math.max(0, Math.min(1, v));
    // Canvas units of an element's box. With a camera (Mac pictures), the box
    // is measured on the Mac's screen and mapped through the scene's own
    // camera (at time t), so it is right even while the band is still panning to it.
    const scr0 = tl.cam ? layer.querySelector('.mk-scr') : null;
    const canvasRect = (el, t) => {
      const r = el.getBoundingClientRect();
      const scr = scr0 ? (el.closest('.mk-scr') || scr0) : null;
      if (scr && scr.offsetWidth) {
        const sr = scr.getBoundingClientRect();
        const cs = sr.width / scr.offsetWidth;          // current scale of the screen, page px per Mac pt
        const c = (tl.camAt && t != null && tl.camAt(scr, t)) || tl.cam;
        return { x: ((r.left - sr.left) / cs - c.x) * c.s, y: ((r.top - sr.top) / cs - c.y) * c.s, w: (r.width / cs) * c.s, h: (r.height / cs) * c.s };
      }
      return { x: (r.left - wr.left) / k, y: (r.top - wr.top) / k, w: r.width / k, h: r.height / k };
    };
    const center = (sel, dx, dy, t) => {
      const el = typeof sel === 'string' ? first(sel) : sel;
      if (!el) return [(tl.w || 400) / 2, (tl.h || 250) / 2];
      const b = canvasRect(el, t);
      return [b.x + b.w / 2 + (dx || 0), b.y + b.h / 2 + (dy || 0)];
    };
    const box = (sel, t) => {
      const el = first(sel);
      return el ? canvasRect(el, t) : null;
    };
    // [t, sel, dx, dy, easing, tm]: the target measured at tm (default t).
    const pt2 = (e) => (typeof e[1] === 'string' ? center(e[1], e[2], e[3], e[5] != null ? e[5] : e[0]) : [e[1], e[2]]);
    const add = (el, kf, extra) => {
      if (!el) return;
      kf = normalize(kf);
      const a = el.animate(kf, { duration: dur, iterations: Infinity, fill: 'both' });
      if (extra && extra.delayFrac) a._shift = extra.delayFrac * dur;
      anims.push(a);
    };

    // Resolve every target point before anything moves.
    // A halo follows the corner radius of what it marks (scaled like its box);
    // something drawn without a radius (an icon) gets a capsule or a circle.
    const halos = (tl.halo || []).map((h) => {
      const el = first(h[0]);
      const b = box(h[0], h[1]);
      const rad = el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0;
      if (b && rad > 0 && el.offsetWidth) b.r = Math.min(b.h / 2, rad * b.w / el.offsetWidth);
      return [b, h[1], h[2]];
    });
    const clicks = (tl.clicks || []).map((c) => [c[0], pt2(c)]);
    const cursorPts = (tl.cursor || []).map((c) => {
      const p = pt2(c);
      return { t: c[0], x: p[0], y: p[1], easing: typeof c[1] === 'string' ? c[4] : c[3] };
    });

    // Pointer: its tip sits at (1, 1) of its box.
    const cu = first('.mk-cur') || first('.cur');
    if (cu && cursorPts.length) {
      add(cu, cursorPts.map((c) => ({ offset: c.t, transform: 'translate(' + (c.x - 1) + 'px,' + (c.y - 1) + 'px)', easing: c.easing || 'linear' })));
      add(cu, visKf(tl.cursorVis || [[0, 1]], W(0.015)));
      if (clicks.length) {
        const pk = [{ offset: 0, transform: 'scale(1)' }];
        clicks.forEach(([t]) => { pk.push({ offset: clamp(t - W(0.005)), transform: 'scale(1)' }, { offset: clamp(t), transform: 'scale(.82)' }, { offset: clamp(t + W(0.012)), transform: 'scale(1)' }); });
        pk.push({ offset: 1, transform: 'scale(1)' });
        add(cu.querySelector('svg'), pk);
      }
    }
    // A ring where the click lands.
    clicks.forEach(([t, p]) => {
      const r = document.createElement('div');
      r.className = 'ring';
      r.style.left = p[0] + 'px'; r.style.top = p[1] + 'px';
      layer.appendChild(r);
      add(r, [{ offset: 0, opacity: 0, transform: 'scale(.3)' }, { offset: clamp(t - W(0.002)), opacity: 0, transform: 'scale(.3)' }, { offset: clamp(t), opacity: 0.9, transform: 'scale(.5)' }, { offset: clamp(t + W(0.05)), opacity: 0, transform: 'scale(1.6)' }, { offset: 1, opacity: 0, transform: 'scale(1.6)' }]);
    });
    // A calm highlight around what to click, while the pointer rests on it.
    halos.forEach(([b, a, z]) => {
      if (!b) return;
      const h = document.createElement('div');
      h.className = 'halo';
      const pad = 2;
      Object.assign(h.style, { left: b.x - pad + 'px', top: b.y - pad + 'px', width: b.w + pad * 2 + 'px', height: b.h + pad * 2 + 'px', borderRadius: ((b.r != null ? b.r : b.h / 2) + pad) + 'px' });
      layer.appendChild(h);
      add(h, [{ offset: 0, opacity: 0 }, { offset: clamp(a), opacity: 0 }, { offset: clamp(a + W(0.03)), opacity: 1 }, { offset: clamp(z - W(0.01)), opacity: 1 }, { offset: clamp(z + W(0.02)), opacity: 0 }, { offset: 1, opacity: 0 }]);
    });
    // What is visible when.
    (tl.vis || []).forEach(([sel, ranges, mode]) => all(sel).forEach((el) => add(el, visKf(ranges, W(0.018), mode, W(0.035)))));
    // Typing, one character at a time.
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
    // Free-form keyframes.
    (tl.anim || []).forEach(([sel, kf, extra]) => all(sel).forEach((el) => add(el, kf, extra)));

    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hold = tl.stillAt != null ? tl.stillAt : (reduce && tl.poster != null ? tl.poster : null);
    if (hold != null) {
      anims.forEach((a) => { a.pause(); a.currentTime = ((hold * dur) + (a._shift || 0)) % dur; });
    } else {
      const t0 = start != null ? start : document.timeline.currentTime;
      anims.forEach((a) => { a.startTime = t0 - (a._shift || 0); });
    }
    watchChapters(root, tl, anims);
    return anims;
  };

  // ---------- Chapters (a story's parts, tl.chapters) ----------
  // The fraction of the loop an animation of a scene is at: 0 before it starts.
  D.scenes.loopFrac = function (anims, tl) {
    const a = (anims || []).find((x) => !x._shift) || (anims || [])[0];
    if (!a || !tl || a.currentTime == null) return null;
    const dur = tl.dur || 6000;
    const t = a.currentTime - (a._shift || 0);
    return t <= 0 ? 0 : (t % dur) / dur;
  };
  // The index (in tl.chapters) of the chapter playing at fraction f; -1 past
  // the last chapter's end (a story's short way back to its start).
  D.scenes.chapterAt = function (tl, f) {
    const ch = (tl && tl.chapters) || [];
    let i = ch.length ? 0 : -1;
    ch.forEach((c, j) => { if (c.end > c.start && c.start <= f + 1e-6) i = j; });
    return i >= 0 && f > ch[i].end + 1e-6 ? -1 : i;
  };
  // Tells the band's element each time the loop enters another chapter (and
  // once at the start, also for a held frame). Stops by itself once the
  // picture is gone or its loop is cancelled.
  function watchChapters(root, tl, anims) {
    if (!tl.chapters || !tl.chapters.length || !anims.length || typeof CustomEvent !== 'function') return;
    const a = anims.find((x) => !x._shift) || anims[0];
    const dur = tl.dur || 6000;
    let last = -1;
    const tick = () => {
      if (!root.isConnected || a.playState === 'idle') return;
      const f = D.scenes.loopFrac([a], tl);
      if (f == null) return;
      const i = D.scenes.chapterAt(tl, f);
      if (i !== last) {
        last = i;
        root.dispatchEvent(new CustomEvent('usbc-chapter', { detail: { index: i, chapter: tl.chapters[i] } }));
      }
      if (a.playState === 'paused') return;
      // Wake just after the next chapter starts (or the loop wraps).
      const next = tl.chapters.map((c) => c.start).filter((s) => s > f + 1e-6).sort((x, y) => x - y)[0];
      const ms = ((next != null ? next : 1) - f) * dur;
      setTimeout(tick, Math.max(40, Math.min(ms + 20, 1000)));
    };
    setTimeout(tick, 0);
  }

  // Keyframes that show an element during the given ranges of the loop.
  // mode 'pop': a dialog appearing (fade and scale .97 to 1, like macOS);
  // 'slideL': a notification arriving from the right.
  function visKf(ranges, f, mode, popF) {
    const hid = { pop: 'scale(.97)', slideL: 'translateX(24px)', up: 'translateY(8px)' }[mode];
    const g = mode === 'pop' ? (popF != null ? popF : 0.035) : f;
    const on = (o) => (hid ? { offset: o, opacity: 1, transform: 'none' } : { offset: o, opacity: 1 });
    const off = (o) => (hid ? { offset: o, opacity: 0, transform: hid } : { offset: o, opacity: 0 });
    const kf = [];
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
    if (!sorted.length || sorted[0][0] > 0) kf.push(off(0));
    sorted.forEach(([a, z]) => {
      if (a <= 0) kf.push(on(0)); else { kf.push(Object.assign(off(a), mode === 'pop' ? { easing: SPRING } : {})); kf.push(Object.assign(on(Math.min(1, a + g)), { easing: 'linear' })); }
      if (z >= 1) kf.push(on(1)); else { kf.push(on(Math.max(0, z - f))); kf.push(off(z)); }
    });
    if (kf[kf.length - 1].offset < 1) kf.push(off(1));
    kf.forEach((k, i) => { if (i < kf.length - 1 && !k.easing) k.easing = 'cubic-bezier(.1,.9,.2,1)'; });
    return kf;
  }
  const SPRING = 'linear(0, .099, .286, .471, .625, .741, .826, .884, .924, .951, .968, .980, .987, .992, .995, .997, 1)';

  // Sort, clamp, and pad keyframes so they cover 0..1.
  function normalize(kf) {
    kf = kf.map((k) => Object.assign({}, k, { offset: Math.max(0, Math.min(1, k.offset)) })).sort((a, b) => a.offset - b.offset);
    if (kf[0].offset > 0) kf.unshift(Object.assign({}, kf[0], { offset: 0 }));
    const last = kf[kf.length - 1];
    if (last.offset < 1) kf.push(Object.assign({}, last, { offset: 1, easing: 'linear' }));
    return kf;
  }
})();
