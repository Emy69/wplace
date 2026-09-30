// ==UserScript==
// @name         wplace Asistente de plantilla
// @namespace    local.wplace.asistente
// @version      1.6.0
// @description  Conversor de imágenes, plantilla superpuesta, progreso, filtro por colores y códigos para compartir con amigos en wplace.live. Tú sigues haciendo cada clic.
// @match        https://wplace.live/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Paleta de wplace: [id, nombre, rgb, dePago] ----------
  const PALETTE = [
    [1,'Black',[0,0,0],0],[2,'Dark Gray',[60,60,60],0],[3,'Gray',[120,120,120],0],[4,'Light Gray',[210,210,210],0],
    [5,'White',[255,255,255],0],[6,'Deep Red',[96,0,24],0],[7,'Red',[237,28,36],0],[8,'Orange',[255,127,39],0],
    [9,'Gold',[246,170,9],0],[10,'Yellow',[249,221,59],0],[11,'Light Yellow',[255,250,188],0],[12,'Dark Green',[14,185,104],0],
    [13,'Green',[19,230,123],0],[14,'Light Green',[135,255,94],0],[15,'Dark Teal',[12,129,110],0],[16,'Teal',[16,174,166],0],
    [17,'Light Teal',[19,225,190],0],[18,'Dark Blue',[40,80,158],0],[19,'Blue',[64,147,228],0],[20,'Cyan',[96,247,242],0],
    [21,'Indigo',[107,80,246],0],[22,'Light Indigo',[153,177,251],0],[23,'Dark Purple',[120,12,153],0],[24,'Purple',[170,56,185],0],
    [25,'Light Purple',[224,159,249],0],[26,'Dark Pink',[203,0,122],0],[27,'Pink',[236,31,128],0],[28,'Light Pink',[243,141,169],0],
    [29,'Dark Brown',[104,70,52],0],[30,'Brown',[149,104,42],0],[31,'Beige',[248,178,119],0],
    [32,'Medium Gray',[170,170,170],1],[33,'Dark Red',[165,14,30],1],[34,'Light Red',[250,128,114],1],[35,'Dark Orange',[228,92,26],1],
    [36,'Light Tan',[214,181,148],1],[37,'Dark Goldenrod',[156,132,49],1],[38,'Goldenrod',[197,173,70],1],[39,'Light Goldenrod',[232,212,95],1],
    [40,'Dark Olive',[74,107,58],1],[41,'Olive',[90,148,74],1],[42,'Light Olive',[132,197,115],1],[43,'Dark Cyan',[15,121,159],1],
    [44,'Light Cyan',[187,250,242],1],[45,'Light Blue',[125,199,255],1],[46,'Dark Indigo',[77,49,184],1],[47,'Dark Slate Blue',[74,66,132],1],
    [48,'Slate Blue',[122,113,196],1],[49,'Light Slate Blue',[181,174,241],1],[50,'Light Brown',[219,164,99],1],[51,'Dark Beige',[209,128,81],1],
    [52,'Light Beige',[255,197,165],1],[53,'Dark Peach',[155,82,73],1],[54,'Peach',[209,128,120],1],[55,'Light Peach',[250,182,164],1],
    [56,'Dark Tan',[123,99,82],1],[57,'Tan',[156,132,107],1],[58,'Dark Slate',[51,57,65],1],[59,'Slate',[109,117,141],1],
    [60,'Light Slate',[179,185,209],1],[61,'Dark Stone',[109,100,63],1],[62,'Stone',[148,140,107],1],[63,'Light Stone',[205,197,158],1],
  ];
  const PAL = {};
  for (const p of PALETTE) PAL[p[0]] = p[2];

  // ---------- Geometría de wplace: 2048 tiles x 1000 px, Web Mercator ----------
  const N = 2048 * 1000;
  function lngLatToPx(lng, lat) {
    const x = (lng + 180) / 360 * N;
    const s = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N;
    return [Math.floor(x), Math.floor(y)];
  }
  function pxToLngLat(x, y) {
    const lng = x / N * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / N;
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return [lng, lat];
  }

  // ---------- Captura del mapa de MapLibre (wplace no lo expone) ----------
  // MapLibre dispara sus eventos con listener.call(map, ev). Envolvemos call hasta
  // ver un objeto con forma de mapa y restauramos el original inmediatamente.
  let map = null;
  (function hookCall() {
    const oc = Function.prototype.call;
    Function.prototype.call = function (t, ...a) {
      if (!map && t && typeof t === 'object' && typeof t.unproject === 'function' &&
          typeof t.getZoom === 'function' && typeof t.getCanvas === 'function') {
        map = t;
        Function.prototype.call = oc;
        onMapReady();
      }
      return oc.apply(this, [t, ...a]);
    };
  })();

  // ---------- Captura (solo lectura) de peticiones de wplace ----------
  // Al hacer clic en un píxel fuera del modo pintar, wplace pide /s0/pixel/TX/TY?x=PX&y=PY.
  let lastClicked = null;
  const ofetch = window.fetch;
  window.fetch = function (input, init) {
    let url = '', method = 'GET';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
      method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const m = url.match(/\/s0\/pixel\/(\d+)\/(\d+)\?x=(\d+)&y=(\d+)/);
      if (m && method === 'GET') { lastClicked = { tx: +m[1], ty: +m[2], px: +m[3], py: +m[4] }; updateStatus(); }
    } catch (e) {}
    const p = ofetch.apply(this, arguments);
    try {
      // Tiles que descarga el propio mapa: se copian (solo lectura) si tocan la plantilla
      const t = url.match(/\/files\/s0\/tiles\/(\d+)\/(\d+)\.png/);
      if (t && tileNeeded(+t[1], +t[2])) p.then(res => { if (res.ok) ingestTile(res.clone(), +t[1], +t[2]); }).catch(() => {});
      // Al enviar píxeles pintados, se refrescan los tiles poco después
      if (method === 'POST' && /\/s0\/pixel\/\d+\/\d+/.test(url)) p.then(() => setTimeout(refreshTiles, 2500)).catch(() => {});
    } catch (e) {}
    return p;
  };

  // ---------- Estado ----------
  const KEY = 'wpAsistente';
  const state = Object.assign({
    tpl: null,            // {w,h,ids,colors:{id:[r,g,b]}}
    origin: { tx: 0, ty: 0, px: 0, py: 0 },
    autoColor: true,
    overlay: true,
    opacity: 0.6,
    mode: 'dim',          // all | pending | dim
    filters: [],          // [] = todos los colores, o lista de ids de la plantilla
    block: true,          // bloquear clics fuera de los píxeles pendientes seleccionados
    collapsed: false,
  }, load());
  if (typeof state.filter === 'number') { state.filters = state.filter ? [state.filter] : []; delete state.filter; }
  if (!Array.isArray(state.filters)) state.filters = [];
  function inFilter(id) { return !state.filters.length || state.filters.includes(id); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function originGlobal() { return [state.origin.tx * 1000 + state.origin.px, state.origin.ty * 1000 + state.origin.py]; }
  function tplRgb(id) { return (state.tpl && state.tpl.colors && state.tpl.colors[id]) || PAL[id] || null; }

  // ---------- Plantilla pre-renderizada (completa, pendientes, hechos) ----------
  let tplCanvas = null, pendCanvas = null, doneCanvas = null;
  function makeLayer(t, filter) {
    const c = document.createElement('canvas');
    c.width = t.w; c.height = t.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(t.w, t.h);
    for (let i = 0; i < t.w * t.h; i++) {
      const rgb = tplRgb(t.ids[i]);
      if (!rgb || !filter(i)) continue;
      if (!inFilter(t.ids[i])) continue;
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  function buildTpl() {
    tplCanvas = pendCanvas = doneCanvas = null;
    const t = state.tpl;
    if (!t || !t.w || !t.h || !Array.isArray(t.ids)) return;
    tplCanvas = makeLayer(t, () => true);
    pendCanvas = makeLayer(t, i => !(done && done[i]));
    doneCanvas = makeLayer(t, i => !!(done && done[i]));
  }
  function tplIdAt(gx, gy) {
    const t = state.tpl; if (!t) return 0;
    const [ox, oy] = originGlobal();
    const x = gx - ox, y = gy - oy;
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) return 0;
    return t.ids[y * t.w + x] || 0;
  }

  // ---------- Estado real del lienzo: tiles de wplace comparados con la plantilla ----------
  const tiles = {};          // "tx,ty" -> {data: Uint8ClampedArray, w}
  let done = null;           // Uint8Array w*h: 1 = ya pintado igual que la plantilla
  let doneCount = 0, refreshing = false, lastRefresh = 0;
  function tplTiles() {
    const t = state.tpl; if (!t) return [];
    const [ox, oy] = originGlobal();
    const out = [];
    for (let ty = Math.floor(oy / 1000); ty <= Math.floor((oy + t.h - 1) / 1000); ty++)
      for (let tx = Math.floor(ox / 1000); tx <= Math.floor((ox + t.w - 1) / 1000); tx++) out.push([tx, ty]);
    return out;
  }
  function tileNeeded(tx, ty) { return tplTiles().some(([a, b]) => a === tx && b === ty); }
  async function ingestTile(res, tx, ty) {
    try {
      const bmp = await createImageBitmap(await res.blob());
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0);
      tiles[tx + ',' + ty] = { data: x.getImageData(0, 0, c.width, c.height).data, w: c.width };
      computeDone();
    } catch (e) {}
  }
  async function refreshTiles() {
    if (!state.tpl || refreshing) return;
    localDone.clear();
    refreshing = true; updateStatus();
    try {
      await Promise.all(tplTiles().map(async ([tx, ty]) => {
        const res = await ofetch(`https://backend.wplace.live/files/s0/tiles/${tx}/${ty}.png?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) await ingestTile(res, tx, ty);
      }));
      lastRefresh = Date.now();
    } catch (e) {}
    refreshing = false; computeDone();
  }
  function computeDone() {
    const t = state.tpl;
    if (!t) { done = null; doneCount = 0; return; }
    const [ox, oy] = originGlobal();
    if (!tplTiles().some(([a, b]) => tiles[a + ',' + b])) { done = null; doneCount = 0; buildTpl(); buildColorList(); requestDraw(); updateStatus(); return; }
    done = new Uint8Array(t.w * t.h); doneCount = 0;
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const id = t.ids[y * t.w + x]; if (!id) continue;
      const rgb = tplRgb(id); if (!rgb) continue;
      const gx = ox + x, gy = oy + y;
      const tile = tiles[Math.floor(gx / 1000) + ',' + Math.floor(gy / 1000)]; if (!tile) continue;
      const i = ((gy % 1000) * tile.w + (gx % 1000)) * 4;
      const d = tile.data;
      if (d[i + 3] > 0 && d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) { done[y * t.w + x] = 1; doneCount++; }
    }
    buildTpl(); buildColorList(); requestDraw(); updateStatus();
  }

  // ---------- Paleta real de wplace, leída de sus botones ----------
  // Se busca el botón por el color de fondo EXACTO, no por id, para no depender de la numeración.
  let palButtons = [];   // [{btn, rgb:[r,g,b]}]
  let palScanAt = 0;
  function parseRgb(s) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function scanPalette(force) {
    const now = Date.now();
    if (!force && now - palScanAt < 1500 && palButtons.length) return palButtons;
    palScanAt = now;
    let out = [];
    const cands = document.querySelectorAll('button[id^="color-"]');
    if (cands.length) {
      for (const b of cands) {
        const rgb = parseRgb(getComputedStyle(b).backgroundColor);
        if (rgb) out.push({ btn: b, rgb });
      }
    } else {
      // Sin ids: solo se acepta un grupo grande de botones hermanos con color de fondo (la rejilla de la paleta).
      // Nunca botones sueltos de la interfaz, para no pulsar cosas como el botón de la alianza.
      const groups = new Map();
      for (const b of document.querySelectorAll('button')) {
        if (b.closest('#wpa-panel') || !b.parentElement) continue;
        if (b.offsetWidth > 60 || b.offsetHeight > 60 || b.textContent.trim().length > 2) continue;
        const rgb = parseRgb(getComputedStyle(b).backgroundColor);
        if (!rgb) continue;
        if (!groups.has(b.parentElement)) groups.set(b.parentElement, []);
        groups.get(b.parentElement).push({ btn: b, rgb });
      }
      for (const g of groups.values()) if (g.length >= 16 && g.length > out.length) out = g;
    }
    palButtons = out;
    return out;
  }
  let inexact = '';
  function findColorButton(id) {
    const want = tplRgb(id); if (!want) return null;
    let pal = scanPalette(false);
    const exact = p => p.rgb[0] === want[0] && p.rgb[1] === want[1] && p.rgb[2] === want[2];
    let hit = pal.find(exact);
    if (!hit) { pal = scanPalette(true); hit = pal.find(exact); }
    if (hit) return hit.btn;
    if (pal.length < 10) return null; // paleta cerrada: no se pulsa nada
    // Sin coincidencia exacta: el más parecido dentro de la paleta, y se avisa en el estado
    let best = null, bd = Infinity;
    for (const p of pal) {
      const d = (p.rgb[0] - want[0]) ** 2 + (p.rgb[1] - want[1]) ** 2 + (p.rgb[2] - want[2]) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd <= 900) { inexact = `⚠ Color #${id} rgb(${want}) no está exacto en la paleta; se usa rgb(${best.rgb})`; return best.btn; }
    return null;
  }
  let lastSelected = -1;
  function selectColor(id, force) {
    if (!force && id === lastSelected) return true;
    inexact = '';
    const b = findColorButton(id);
    if (!b || b.disabled) { lastSelected = -1; return false; }
    b.click();
    lastSelected = id;
    return true;
  }

  // ---------- Overlay ----------
  let ov = null, ovCtx = null, hover = null; // hover = {gx, gy, id}
  function ensureOverlay() {
    if (ov) return;
    ov = document.createElement('canvas');
    ov.id = 'wpa-overlay';
    ov.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:5;';
    document.body.appendChild(ov);
    ovCtx = ov.getContext('2d');
  }
  function draw() {
    if (!map) return;
    ensureOverlay();
    const cv = map.getCanvas();
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (ov.width !== Math.round(r.width * dpr) || ov.height !== Math.round(r.height * dpr)) {
      ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr);
      ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
    }
    ov.style.left = r.left + 'px'; ov.style.top = r.top + 'px';
    ovCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ovCtx.clearRect(0, 0, r.width, r.height);
    if (!state.overlay || !tplCanvas) return;
    const [ox, oy] = originGlobal();
    const t = state.tpl;
    const a = map.project(pxToLngLat(ox, oy));
    const b = map.project(pxToLngLat(ox + t.w, oy + t.h));
    const w = b.x - a.x, h = b.y - a.y;
    if (w < 2 || h < 2) return; // demasiado lejos para que se vea
    ovCtx.imageSmoothingEnabled = false;
    if (state.mode === 'all' || !done) {
      ovCtx.globalAlpha = state.opacity;
      ovCtx.drawImage(tplCanvas, a.x, a.y, w, h);
    } else {
      if (state.mode === 'dim') { ovCtx.globalAlpha = state.opacity * 0.15; ovCtx.drawImage(doneCanvas, a.x, a.y, w, h); }
      ovCtx.globalAlpha = state.opacity;
      ovCtx.drawImage(pendCanvas, a.x, a.y, w, h);
    }
    ovCtx.globalAlpha = 1;
    ovCtx.strokeStyle = 'rgba(255,255,255,.9)'; ovCtx.lineWidth = 1;
    ovCtx.strokeRect(a.x + .5, a.y + .5, w, h);
    ovCtx.strokeStyle = 'rgba(0,0,0,.6)';
    ovCtx.strokeRect(a.x - .5, a.y - .5, w + 2, h + 2);
    if (hover && hover.id) {
      const p1 = map.project(pxToLngLat(hover.gx, hover.gy));
      const p2 = map.project(pxToLngLat(hover.gx + 1, hover.gy + 1));
      ovCtx.strokeStyle = '#fff'; ovCtx.lineWidth = 2;
      ovCtx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ovCtx.strokeStyle = '#000'; ovCtx.lineWidth = 1;
      ovCtx.strokeRect(p1.x - 1, p1.y - 1, p2.x - p1.x + 2, p2.y - p1.y + 2);
    }
  }
  let rafPending = false;
  function requestDraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; draw(); });
  }

  function onMapReady() {
    try {
      map.on('move', requestDraw);
      map.on('zoom', requestDraw);
      map.on('resize', requestDraw);
      map.on('render', requestDraw);
    } catch (e) {}
    requestDraw();
    updateStatus();
    if (pendingGoto) { pendingGoto = false; setTimeout(goToTemplate, 300); }
  }

  // ---------- Ratón ----------
  function pixelUnder(e) {
    const cv = map.getCanvas();
    if (!cv.parentElement || !cv.parentElement.contains(e.target)) return null;
    const r = cv.getBoundingClientRect();
    const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    const [gx, gy] = lngLatToPx(ll.lng, ll.lat);
    let id = tplIdAt(gx, gy);
    if (!inFilter(id)) id = 0; // con filtro, los demás colores se ignoran
    const idx = (gy - originGlobal()[1]) * state.tpl.w + (gx - originGlobal()[0]);
    return { gx, gy, id, done: !!(id && done && done[idx]) };
  }
  document.addEventListener('mousemove', (e) => {
    if (!map || !state.tpl) return;
    const p = pixelUnder(e);
    if (!p) { hover = null; return; }
    if (hover && hover.gx === p.gx && hover.gy === p.gy) return;
    hover = p;
    if (state.autoColor && p.id) selectColor(p.id, false);
    updateStatus();
    requestDraw();
  }, true);

  // Justo antes de que wplace procese el clic, se fuerza el color exacto del píxel bajo el cursor.
  // Va en fase de captura para adelantarse al manejador del mapa.
  document.addEventListener('pointerdown', (e) => {
    if (!map || !state.tpl || !state.autoColor || e.button !== 0) return;
    const p = pixelUnder(e);
    if (!p || !p.id) return;
    hover = p;
    selectColor(p.id, true);
    updateStatus();
  }, true);

  // Bloqueo de clics: si está activo y la paleta está abierta, solo pasan los clics
  // sobre píxeles pendientes de la plantilla (y del filtro de colores, si hay).
  // Se bloquea el evento click, no el mousedown, así arrastrar el mapa sigue funcionando.
  let blockedCount = 0;
  document.addEventListener('click', (e) => {
    if (!map || !state.tpl || !state.block) return;
    const cv = map.getCanvas();
    if (!cv.parentElement || !cv.parentElement.contains(e.target)) return;
    if (scanPalette(false).length < 10) return; // fuera del modo pintar no se bloquea nada
    const p = pixelUnder(e);
    if (p && p.id && !p.done) return;
    e.stopImmediatePropagation(); e.preventDefault();
    blockedCount++; updateStatus();
  }, true);

  // ---------- Barra espaciadora ----------
  // En wplace, Space pinta el píxel bajo el cursor y, mientras se mantiene, cada movimiento
  // del ratón pinta una línea con el color seleccionado. Aquí la tecla real nunca llega a wplace:
  // el script la mantiene "virtualmente" y, por cada píxel válido que pasa bajo el cursor, elige
  // su color exacto y le envía a wplace una pulsación corta para que pinte solo ese píxel.
  let lastMouse = null, spaceHeld = false, lastSpacePainted = null;
  const localDone = new Set();   // píxeles pintados con Space en esta sesión (hasta el próximo refresco)
  document.addEventListener('mousemove', (e) => { lastMouse = e; if (spaceHeld) setTimeout(spacePaintAt, 0); }, true);
  function paintMode() { return scanPalette(false).length >= 10; }
  function synthSpace() {
    for (const type of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true, cancelable: true });
      ev.__wpa = true;
      document.dispatchEvent(ev);
    }
  }
  function spacePaintAt() {
    if (!spaceHeld || !map || !state.tpl || !lastMouse) return;
    const p = pixelUnder(lastMouse);
    if (!p || !p.id || p.done) return;
    const key = p.gx + ',' + p.gy;
    if (key === lastSpacePainted || localDone.has(key)) return;
    if (state.autoColor && !selectColor(p.id, true)) return;
    lastSpacePainted = key; localDone.add(key);
    synthSpace();
  }
  function spaceGuard(e) {
    if (e.__wpa) return;
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (!map || !state.tpl) return;
    const tg = e.target;
    if (tg && (tg.closest('#wpa-panel') || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
    if (!paintMode()) return;
    if (e.type === 'keyup') { spaceHeld = false; lastSpacePainted = null; return; } // soltar siempre pasa
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.type !== 'keydown') return;
    if (!spaceHeld) { spaceHeld = true; lastSpacePainted = null; }
    if (!lastMouse) return;
    const p = pixelUnder(lastMouse);
    if (!p) return;
    if (!p.id || p.done) { if (!e.repeat) { blockedCount++; updateStatus(); } return; }
    spacePaintAt();
  }
  window.addEventListener('keydown', spaceGuard, true);
  window.addEventListener('keyup', spaceGuard, true);
  window.addEventListener('keypress', spaceGuard, true);
  window.addEventListener('blur', () => { spaceHeld = false; lastSpacePainted = null; });

  // ---------- Cargar plantilla / ir a ella ----------
  let pendingGoto = false;
  function applyTemplate(tpl, origin) {
    if (!tpl || !(tpl.w > 0) || !(tpl.h > 0) || !Array.isArray(tpl.ids) || tpl.ids.length !== tpl.w * tpl.h) throw new Error('Plantilla no válida');
    state.tpl = tpl; state.filters = [];
    if (origin) {
      state.origin = { tx: +origin.tx || 0, ty: +origin.ty || 0, px: +origin.px || 0, py: +origin.py || 0 };
      if (ui.tx) { ui.tx.value = state.origin.tx; ui.ty.value = state.origin.ty; ui.px.value = state.origin.px; ui.py.value = state.origin.py; }
    }
    save(); lastSelected = -1; done = null; doneCount = 0;
    buildTpl(); buildColorList(); requestDraw(); updateStatus();
    refreshTiles();
    if (origin) goToTemplate();
  }
  function originIsSet() { const o = state.origin; return !!(o.tx || o.ty || o.px || o.py); }
  function goToTemplate() {
    const t = state.tpl; if (!t) return;
    if (!map) { pendingGoto = true; return; }
    const [ox, oy] = originGlobal();
    const sw = pxToLngLat(ox, oy + t.h), ne = pxToLngLat(ox + t.w, oy);
    try { map.fitBounds([sw, ne], { padding: 120, maxZoom: 19, duration: 1200 }); } catch (e) {}
  }
  let msgTimer = 0;
  function flash(msg) {
    if (!ui.msg) { return; }
    ui.msg.textContent = msg;
    clearTimeout(msgTimer); msgTimer = setTimeout(() => { ui.msg.textContent = ''; }, 9000);
  }
  function slug(s) { return (s || 'plantilla').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plantilla'; }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); return ok;
  }

  // ---------- Código para compartir: WPA1:<base64url(deflate(cabecera + ids))> ----------
  function b64urlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function pipeBytes(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  async function makeShareCode() {
    const t = state.tpl, o = state.origin;
    const used = {};
    for (const id of t.ids) if (id && !used[id]) used[id] = tplRgb(id);
    const head = new TextEncoder().encode(JSON.stringify({ v: 1, w: t.w, h: t.h, o: [o.tx, o.ty, o.px, o.py], c: used, n: t.name || '' }));
    const buf = new Uint8Array(4 + head.length + t.ids.length);
    new DataView(buf.buffer).setUint32(0, head.length);
    buf.set(head, 4);
    for (let i = 0; i < t.ids.length; i++) buf[4 + head.length + i] = t.ids[i] & 255;
    return 'WPA1:' + b64urlEncode(await pipeBytes(buf, new CompressionStream('deflate-raw')));
  }
  async function parseShareCode(text) {
    const m = /WPA1:([A-Za-z0-9_\-]+)/.exec(text);
    if (!m) throw new Error('No hay código WPA1');
    const buf = await pipeBytes(b64urlDecode(m[1]), new DecompressionStream('deflate-raw'));
    const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
    const h = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hl)));
    if (!(h.w > 0 && h.h > 0 && h.w * h.h <= 4e6)) throw new Error('Tamaño no válido');
    const raw = buf.subarray(4 + hl, 4 + hl + h.w * h.h);
    if (raw.length !== h.w * h.h) throw new Error('Código incompleto');
    const tpl = { w: h.w, h: h.h, ids: Array.from(raw), colors: h.c || {}, name: h.n || '' };
    const origin = Array.isArray(h.o) ? { tx: h.o[0], ty: h.o[1], px: h.o[2], py: h.o[3] } : null;
    return { tpl, origin };
  }
  async function shareMessage() {
    const t = state.tpl, o = state.origin;
    const code = await makeShareCode();
    const n = t.ids.filter(Boolean).length;
    return `Plantilla wplace${t.name ? ` «${t.name}»` : ''}: ${t.w}×${t.h}, ${n} píxeles, esquina Tl ${o.tx},${o.ty} · Px ${o.px},${o.py}\n` +
      `Pega este mensaje en el panel del Asistente wplace y pulsa Cargar:\n${code}`;
  }

  // ---------- Importar: texto (código de amigo o JSON del conversor) o PNG ----------
  async function importText(txt) {
    if (/WPA1:/.test(txt)) {
      const r = await parseShareCode(txt);
      applyTemplate(r.tpl, r.origin);
      flash(`Plantilla de tu amigo cargada: ${r.tpl.w}×${r.tpl.h}` + (r.origin ? '. Te llevo a su sitio.' : '.'));
      return;
    }
    const t = JSON.parse(txt);
    applyTemplate(t, null);
    flash(originIsSet() ? 'Plantilla cargada en tu esquina actual.' : 'Plantilla cargada. Ahora fija la esquina.');
  }
  async function importPng(file) {
    const bmp = await createImageBitmap(file);
    if (bmp.width * bmp.height > 4e6) throw new Error('Imagen demasiado grande');
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const exact = new Map(PALETTE.map(p => [p[2].join(','), p[0]]));
    const allIds = PALETTE.map(p => p[0]), tmp = [0, 0, 0];
    const ids = new Array(c.width * c.height).fill(0), colors = {};
    let approx = 0;
    for (let i = 0; i < ids.length; i++) {
      if (d[i * 4 + 3] < 128) continue;
      let id = exact.get(d[i * 4] + ',' + d[i * 4 + 1] + ',' + d[i * 4 + 2]);
      if (!id) { id = nearestId(allIds, d[i * 4], d[i * 4 + 1], d[i * 4 + 2], tmp); approx++; }
      ids[i] = id; colors[id] = PAL[id];
    }
    const name = file.name.replace(/\.[^.]+$/, '');
    const m = /wplace.*?(\d{1,4})-(\d{1,4})-(\d{1,3})-(\d{1,3})(?!\d)/i.exec(name);
    const origin = m && +m[1] < 2048 && +m[2] < 2048 ? { tx: +m[1], ty: +m[2], px: +m[3], py: +m[4] } : null;
    applyTemplate({ w: c.width, h: c.height, ids, colors, name }, origin);
    flash(`PNG cargado: ${c.width}×${c.height}` + (approx ? `. ${approx} píxeles no eran de la paleta y se ajustaron al color más cercano.` : '.') +
      (origin ? ' Coordenadas leídas del nombre del archivo.' : ' Fija la esquina.'));
  }
  async function importFile(f) {
    if (/\.png$/i.test(f.name) || f.type === 'image/png') await importPng(f);
    else await importText(await f.text());
  }

  // ---------- Conversor de imágenes integrado ----------
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linOf(v) { v = v < 0 ? 0 : v > 255 ? 255 : v; const i = v | 0; return i >= 255 ? LIN[255] : LIN[i] + (LIN[i + 1] - LIN[i]) * (v - i); }
  function toOklab(r, g, b, out) {
    const lr = linOf(r), lg = linOf(g), lb = linOf(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    out[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    out[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return out;
  }
  const LAB = {};
  for (const p of PALETTE) LAB[p[0]] = toOklab(p[2][0], p[2][1], p[2][2], [0, 0, 0]);
  function nearestId(ids, r, g, b, tmp) {
    toOklab(r, g, b, tmp);
    let best = ids[0], bd = Infinity;
    for (const id of ids) {
      const q = LAB[id], dl = tmp[0] - q[0], da = tmp[1] - q[1], db = tmp[2] - q[2];
      const d = dl * dl + 3 * (da * da + db * db); // más peso al tono que a la luminosidad
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const CONV_KEY = 'wpAsistenteConv';
  const conv = { el: null, src: null, name: '', res: null, timer: 0, sel: null, k: null };
  function convLoadSel() {
    try { const v = JSON.parse(localStorage.getItem(CONV_KEY)); if (Array.isArray(v) && v.length) return new Set(v); } catch (e) {}
    return new Set(PALETTE.filter(p => !p[3]).map(p => p[0]));
  }
  function convSaveSel() { try { localStorage.setItem(CONV_KEY, JSON.stringify([...conv.sel])); } catch (e) {} }
  function openConverter() { if (!conv.el) buildConverter(); conv.el.style.display = 'flex'; }
  function closeConverter() { if (conv.el) conv.el.style.display = 'none'; }

  function buildConverter() {
    conv.sel = convLoadSel();
    const el = document.createElement('div');
    el.id = 'wpa-conv';
    el.innerHTML = `
      <style>
        #wpa-conv{position:fixed;inset:0;z-index:10000;background:#000b;display:none;align-items:center;justify-content:center;font:13px/1.4 system-ui,sans-serif;color:#eee}
        #wpa-conv *{box-sizing:border-box}
        #wpa-conv .box{background:#1d1d22;border:1px solid #444;border-radius:12px;width:min(1100px,96vw);height:min(780px,94vh);display:flex;flex-direction:column;box-shadow:0 10px 40px #000a}
        #wpa-conv .hd{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #333;font-size:15px}
        #wpa-conv .bd{flex:1;display:grid;grid-template-columns:300px 1fr;min-height:0}
        @media (max-width:760px){#wpa-conv .bd{grid-template-columns:1fr;overflow:auto}}
        #wpa-conv .side{overflow:auto;padding:12px 14px;border-right:1px solid #333}
        #wpa-conv .main{display:flex;flex-direction:column;gap:10px;padding:12px 14px;min-width:0;min-height:0}
        #wpa-conv h4{margin:14px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#999}
        #wpa-conv label{display:block;margin:6px 0 2px}
        #wpa-conv label span{color:#999}
        #wpa-conv .ck{display:flex;align-items:center;gap:6px}
        #wpa-conv input[type=number],#wpa-conv select{width:100%;background:#111;color:#eee;border:1px solid #444;border-radius:6px;padding:5px 7px}
        #wpa-conv input[type=range]{width:100%}
        #wpa-conv .row{display:flex;gap:6px;align-items:center}
        #wpa-conv .row>*{flex:1}
        #wpa-conv button{background:#3a3a44;color:#fff;border:0;border-radius:6px;padding:7px 10px;cursor:pointer;font-weight:600}
        #wpa-conv button.primary{background:#2b6cff}
        #wpa-conv button:disabled{opacity:.45;cursor:not-allowed}
        #wpa-conv .x{background:none;font-size:18px;padding:2px 8px}
        #wpa-conv .drop{border:2px dashed #555;border-radius:10px;padding:18px;text-align:center;color:#aaa;cursor:pointer}
        #wpa-conv .drop.over{border-color:#2b6cff;color:#8fb0ff}
        #wpa-conv .hint{color:#999;font-size:11px;margin-top:4px}
        #wpa-conv .pal{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-top:6px}
        #wpa-conv .pal div{aspect-ratio:1;border-radius:5px;border:2px solid transparent;cursor:pointer;opacity:.3;position:relative}
        #wpa-conv .pal div.on{opacity:1;border-color:#fff}
        #wpa-conv .pal div.paid::after{content:"★";position:absolute;right:2px;bottom:0;font-size:9px;color:#fff;text-shadow:0 0 2px #000}
        #wpa-conv .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
        #wpa-conv .stat{background:#111;border-radius:8px;padding:6px 10px}
        #wpa-conv .stat b{display:block;font-size:18px}
        #wpa-conv .stat span{color:#999;font-size:11px}
        #wpa-conv .used{display:flex;flex-wrap:wrap;gap:4px;max-height:64px;overflow:auto}
        #wpa-conv .used span{display:inline-flex;align-items:center;gap:4px;background:#111;border-radius:5px;padding:2px 6px;font-size:11px}
        #wpa-conv .used i{width:12px;height:12px;border-radius:3px;display:inline-block;border:1px solid #0006}
        #wpa-conv .prev{flex:1;min-height:0;overflow:auto;border:1px solid #333;border-radius:8px;background:repeating-conic-gradient(#8883 0 25%,transparent 0 50%) 0 0/16px 16px;display:flex;align-items:flex-start;justify-content:center;padding:8px}
        #wpa-conv canvas{image-rendering:pixelated}
        #wpa-conv .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      </style>
      <div class="box">
        <div class="hd"><b>Conversor de imágenes a wplace</b><button class="x" title="Cerrar (Esc)">✕</button></div>
        <div class="bd">
          <div class="side">
            <div class="drop" data-k="drop">Arrastra una imagen aquí, pégala con Ctrl+V o haz clic para elegirla</div>
            <input type="file" accept="image/*" data-k="file" style="display:none">
            <div class="hint" data-k="src">Sin imagen</div>
            <h4>Tamaño en píxeles de wplace</h4>
            <div class="row"><input type="number" data-k="w" min="1" max="2000" value="64"><input type="number" data-k="h" min="1" max="2000" value="64"></div>
            <label class="ck"><input type="checkbox" data-k="ratio" checked> Mantener proporción</label>
            <h4>Paleta</h4>
            <div class="row"><button data-a="free">Solo gratis</button><button data-a="all">Todos</button><button data-a="none">Ninguno</button></div>
            <div class="pal" data-k="pal"></div>
            <div class="hint">Clic en cada color para activarlo. Marca solo los de pago (★) que tengas.</div>
            <h4>Ajustes de imagen</h4>
            <label>Brillo <span data-k="brightV">0</span></label><input type="range" data-k="bright" min="-100" max="100" value="0">
            <label>Contraste <span data-k="contrastV">0</span></label><input type="range" data-k="contrast" min="-100" max="100" value="0">
            <label>Saturación <span data-k="satV">100</span> %</label><input type="range" data-k="sat" min="0" max="200" value="100">
            <label>Umbral de transparencia <span data-k="alphaV">128</span></label><input type="range" data-k="alpha" min="0" max="255" value="128">
            <h4>Dithering</h4>
            <select data-k="dither">
              <option value="none">Ninguno (colores planos)</option>
              <option value="fs" selected>Floyd-Steinberg</option>
              <option value="bayer">Ordenado (Bayer)</option>
            </select>
            <label>Fuerza <span data-k="dstrV">35</span> %</label><input type="range" data-k="dstr" min="0" max="100" value="35">
          </div>
          <div class="main">
            <div class="stats">
              <div class="stat"><b data-k="sPix">0</b><span>píxeles a pintar</span></div>
              <div class="stat"><b data-k="sCol">0</b><span>colores usados</span></div>
              <div class="stat"><b data-k="sPaid">0</b><span>colores de pago</span></div>
              <div class="stat"><b data-k="sTime">–</b><span>tiempo a 1 px / 30 s</span></div>
            </div>
            <div class="used" data-k="used"></div>
            <div class="prev"><canvas data-k="cv"></canvas></div>
            <div class="actions">
              <label style="margin:0;flex:1;min-width:160px">Zoom <span data-k="zoomV">6</span>x <input type="range" data-k="zoom" min="1" max="24" value="6"></label>
              <label class="ck" style="margin:0"><input type="checkbox" data-k="orig"> Ver original</label>
              <button data-a="png" disabled>Descargar PNG</button>
              <button class="primary" data-a="use" disabled>Usar como plantilla</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    conv.el = el;
    const k = n => el.querySelector(`[data-k="${n}"]`);
    conv.k = k;

    // Las teclas dentro del conversor no llegan a wplace (evita atajos como E, Z o Espacio)
    for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, e => {
      if (t === 'keydown' && e.key === 'Escape') closeConverter();
      e.stopPropagation();
    });
    el.addEventListener('mousedown', e => { if (e.target === el) closeConverter(); });
    el.querySelector('.x').onclick = closeConverter;
    const file = k('file');
    k('drop').onclick = () => file.click();
    file.onchange = () => { if (file.files[0]) convLoad(file.files[0]); file.value = ''; };
    el.addEventListener('dragover', e => { e.preventDefault(); k('drop').classList.add('over'); });
    el.addEventListener('dragleave', e => { if (e.target === k('drop')) k('drop').classList.remove('over'); });
    el.addEventListener('drop', e => { e.preventDefault(); k('drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) convLoad(f); });
    k('w').addEventListener('input', () => { if (k('ratio').checked) convSync('h'); convSchedule(); });
    k('h').addEventListener('input', () => { if (k('ratio').checked) convSync('w'); convSchedule(); });
    for (const n of ['bright', 'contrast', 'sat', 'alpha', 'dither', 'dstr']) k(n).addEventListener('input', () => { convLabels(); convSchedule(); });
    for (const n of ['zoom', 'orig']) k(n).addEventListener('input', () => { convLabels(); convDraw(); });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => convAction(b.dataset.a));
    convPalGrid(); convLabels();
  }
  window.addEventListener('paste', (e) => {
    if (!conv.el || conv.el.style.display === 'none') return;
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault(); e.stopImmediatePropagation();
    convLoad(item.getAsFile());
  }, true);

  function convLabels() {
    const k = conv.k;
    for (const n of ['bright', 'contrast', 'sat', 'alpha', 'dstr', 'zoom']) k(n + 'V').textContent = k(n).value;
  }
  function convSync(which) {
    const k = conv.k, src = conv.src; if (!src) return;
    if (which === 'h') k('h').value = Math.max(1, Math.round((+k('w').value || 1) * src.height / src.width));
    else k('w').value = Math.max(1, Math.round((+k('h').value || 1) * src.width / src.height));
  }
  async function convLoad(file) {
    if (!file || !/^image\//.test(file.type)) return;
    try {
      const bmp = await createImageBitmap(file);
      conv.src = bmp; conv.name = (file.name || 'imagen').replace(/\.[^.]+$/, '');
      conv.k('src').textContent = `${file.name || 'imagen pegada'} · ${bmp.width}×${bmp.height}`;
      if (conv.k('ratio').checked) convSync('h');
      convSchedule();
    } catch (e) { alert('No se pudo leer la imagen.'); }
  }
  function convPalGrid() {
    const g = conv.k('pal'); g.innerHTML = '';
    for (const [id, name, [r, gg, b], paid] of PALETTE) {
      const d = document.createElement('div');
      d.className = (paid ? 'paid' : '') + (conv.sel.has(id) ? ' on' : '');
      d.style.background = `rgb(${r},${gg},${b})`;
      d.title = name + (paid ? ' (de pago)' : '');
      d.onclick = () => { if (conv.sel.has(id)) conv.sel.delete(id); else conv.sel.add(id); d.classList.toggle('on'); convSaveSel(); convSchedule(); };
      g.appendChild(d);
    }
  }
  function convAction(a) {
    if (a === 'free' || a === 'all' || a === 'none') {
      conv.sel = new Set(a === 'none' ? [] : PALETTE.filter(p => a === 'all' || !p[3]).map(p => p[0]));
      convSaveSel(); convPalGrid(); convSchedule(); return;
    }
    const r = conv.res; if (!r) return;
    if (a === 'use') {
      const colors = {};
      for (const id of r.counts.keys()) colors[id] = PAL[id];
      applyTemplate({ w: r.w, h: r.h, ids: Array.from(r.ids), colors, name: conv.name }, null);
      closeConverter();
      if (state.collapsed && ui.panel) { state.collapsed = false; ui.panel.classList.remove('collapsed'); save(); }
      flash(originIsSet() ? 'Plantilla cargada en tu esquina actual. Muévela con las flechas si hace falta.'
        : 'Plantilla cargada. Ahora haz clic en el mapa donde quieres la esquina y pulsa "Usar último píxel clicado".');
    }
    if (a === 'png') {
      const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
      const x = c.getContext('2d'), img = x.createImageData(r.w, r.h);
      for (let i = 0; i < r.ids.length; i++) { const rgb = PAL[r.ids[i]]; if (!rgb) continue; img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4); }
      x.putImageData(img, 0, 0);
      c.toBlob(b => downloadBlob(b, `wplace_${slug(conv.name)}_${r.w}x${r.h}.png`), 'image/png');
    }
  }
  function convSchedule() {
    clearTimeout(conv.timer);
    conv.timer = setTimeout(() => { conv.res = convRun(); convDraw(); convStats(); }, 40);
  }
  function convDownscale(src, w, h) {
    let cw = src.width, ch = src.height, cur = src;
    while (cw / 2 >= w && ch / 2 >= h) {
      cw = Math.floor(cw / 2); ch = Math.floor(ch / 2);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, cw, ch); cur = c;
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  }
  function convRun() {
    const k = conv.k;
    if (!conv.src) return null;
    const pal = PALETTE.filter(p => conv.sel.has(p[0])).map(p => p[0]);
    if (!pal.length) return null;
    const w = Math.max(1, Math.min(2000, +k('w').value || 1));
    const h = Math.max(1, Math.min(2000, +k('h').value || 1));
    const data = convDownscale(conv.src, w, h);
    const alphaT = +k('alpha').value, mode = k('dither').value, strength = +k('dstr').value / 100;
    const bright = +k('bright').value, contrast = +k('contrast').value, sat = +k('sat').value / 100;
    const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const buf = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (sat !== 1) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
      if (contrast) { r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128; }
      if (bright) { r += bright; g += bright; b += bright; }
      buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b;
    }
    const ids = new Uint8Array(w * h), counts = new Map(), tmp = [0, 0, 0];
    const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;
    for (let y = 0; y < h; y++) {
      const serp = mode === 'fs' && (y & 1);
      for (let xx = 0; xx < w; xx++) {
        const x = serp ? w - 1 - xx : xx, i = y * w + x;
        if (data[i * 4 + 3] < alphaT) continue;
        let r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
        if (mode === 'bayer') { const t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 64 * strength; r += t; g += t; b += t; }
        r = clamp(r); g = clamp(g); b = clamp(b);
        const id = nearestId(pal, r, g, b, tmp);
        ids[i] = id; counts.set(id, (counts.get(id) || 0) + 1);
        if (mode === 'fs' && strength > 0) {
          const q = PAL[id], er = (r - q[0]) * strength, eg = (g - q[1]) * strength, eb = (b - q[2]) * strength;
          const dir = serp ? -1 : 1;
          const spread = (dx, dy, f) => {
            const nx = x + dx * dir, ny = y + dy;
            if (nx < 0 || nx >= w || ny >= h) return;
            const j = ny * w + nx;
            if (data[j * 4 + 3] < alphaT) return;
            buf[j * 3] += er * f; buf[j * 3 + 1] += eg * f; buf[j * 3 + 2] += eb * f;
          };
          spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
        }
      }
    }
    return { w, h, ids, counts, orig: data };
  }
  function convDraw() {
    const k = conv.k, cv = k('cv'), r = conv.res;
    if (!r) { cv.width = cv.height = 0; return; }
    const z = Math.max(1, Math.min(+k('zoom').value, Math.floor(4096 / Math.max(r.w, r.h))));
    const small = document.createElement('canvas'); small.width = r.w; small.height = r.h;
    const sx = small.getContext('2d'), img = sx.createImageData(r.w, r.h);
    if (k('orig').checked) img.data.set(r.orig);
    else for (let i = 0; i < r.ids.length; i++) { const rgb = PAL[r.ids[i]]; if (!rgb) continue; img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 255; }
    sx.putImageData(img, 0, 0);
    cv.width = r.w * z; cv.height = r.h * z;
    const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cv.width, cv.height);
  }
  function convStats() {
    const k = conv.k, r = conv.res;
    conv.el.querySelectorAll('[data-a="use"],[data-a="png"]').forEach(b => b.disabled = !r);
    const used = k('used'); used.innerHTML = '';
    if (!r) { k('sPix').textContent = k('sCol').textContent = k('sPaid').textContent = '0'; k('sTime').textContent = '–'; return; }
    let total = 0; for (const n of r.counts.values()) total += n;
    const byId = Object.fromEntries(PALETTE.map(p => [p[0], p]));
    k('sPix').textContent = total.toLocaleString('es');
    k('sCol').textContent = r.counts.size;
    k('sPaid').textContent = [...r.counts.keys()].filter(id => byId[id][3]).length;
    const sec = total * 30, m = sec / 60, hh = m / 60;
    k('sTime').textContent = sec < 60 ? `${sec} s` : m < 60 ? `${Math.round(m)} min` : hh < 48 ? `${hh.toFixed(1)} h` : `${(hh / 24).toFixed(1)} días`;
    for (const [id, n] of [...r.counts.entries()].sort((a, b) => b[1] - a[1])) {
      const p = byId[id], s = document.createElement('span');
      s.innerHTML = `<i style="background:rgb(${p[2]})"></i>${p[1]}${p[3] ? ' ★' : ''} <b>${n}</b>`;
      used.appendChild(s);
    }
  }

  // ---------- Panel ----------
  let ui = {};
  function buildPanel() {
    if (document.getElementById('wpa-panel')) return;
    const p = document.createElement('div');
    p.id = 'wpa-panel';
    p.innerHTML = `
      <style>
        #wpa-panel{position:fixed;top:70px;right:12px;width:270px;z-index:9999;background:#1d1d22;color:#eee;
          font:12px/1.35 system-ui,sans-serif;border:1px solid #444;border-radius:10px;box-shadow:0 6px 24px #0008;user-select:none}
        #wpa-panel *{box-sizing:border-box}
        #wpa-head{padding:8px 10px;font-weight:700;cursor:move;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333}
        #wpa-body{padding:8px 10px;display:grid;gap:6px}
        #wpa-panel.collapsed #wpa-body{display:none}
        #wpa-panel label{display:flex;align-items:center;gap:6px}
        #wpa-panel input[type=number]{width:100%;background:#111;color:#eee;border:1px solid #444;border-radius:5px;padding:3px 5px}
        #wpa-panel textarea{width:100%;height:44px;background:#111;color:#eee;border:1px solid #444;border-radius:5px;font-size:11px;resize:vertical}
        #wpa-panel button{background:#2b6cff;color:#fff;border:0;border-radius:6px;padding:5px 8px;cursor:pointer;font-weight:600}
        #wpa-panel button.sec{background:#3a3a44}
        #wpa-panel .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
        #wpa-panel .grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px}
        #wpa-body{max-height:calc(100vh - 120px);overflow-y:auto;overflow-x:hidden}
        #wpa-panel.drag-over{outline:2px dashed #2b6cff}
        #wpa-msg{color:#8fd18f;white-space:pre-line}
        #wpa-msg:empty{display:none}
        #wpa-panel .st{background:#111;border-radius:6px;padding:6px;white-space:pre-line;color:#bbb}
        #wpa-panel small{color:#999}
        #wpa-colors{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
        #wpa-colors .cs{height:30px;border-radius:5px;border:2px solid #555;cursor:pointer;display:flex;align-items:flex-end;justify-content:center;font-size:10px;font-weight:700;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000}
        #wpa-colors .cs.sel{border-color:#fff;box-shadow:0 0 0 2px #2b6cff}
        #wpa-colors .cs.done{opacity:.35}
        #wpa-colors .all{grid-column:1/-1;height:22px;background:#3a3a44;color:#eee;text-shadow:none;align-items:center}
      </style>
      <div id="wpa-head"><span>Asistente wplace</span><span id="wpa-toggle" style="cursor:pointer">▾</span></div>
      <div id="wpa-body">
        <button id="wpa-conv-open">Abrir conversor de imágenes</button>
        <textarea id="wpa-json" placeholder="Pega aquí el código de un amigo (WPA1:…) o la plantilla del conversor"></textarea>
        <div class="grid2"><button id="wpa-load">Cargar</button><button id="wpa-file" class="sec">Abrir archivo…</button></div>
        <input type="file" id="wpa-fileinput" accept=".txt,.json,.png,image/png,text/plain" style="display:none">
        <small>Esquina superior izquierda (Tl X, Tl Y, Px X, Px Y):</small>
        <div class="grid4">
          <input type="number" id="wpa-tx" placeholder="Tl X"><input type="number" id="wpa-ty" placeholder="Tl Y">
          <input type="number" id="wpa-px" placeholder="Px X"><input type="number" id="wpa-py" placeholder="Px Y">
        </div>
        <button id="wpa-useclick" class="sec">Usar último píxel clicado</button>
        <div class="grid4">
          <button class="sec" data-n="-1,0">←</button><button class="sec" data-n="1,0">→</button>
          <button class="sec" data-n="0,-1">↑</button><button class="sec" data-n="0,1">↓</button>
        </div>
        <button id="wpa-goto" class="sec">Ir a la plantilla</button>
        <small>Compartir plantilla y coordenadas con un amigo:</small>
        <div class="grid2"><button id="wpa-share" class="sec">Copiar código</button><button id="wpa-sharefile" class="sec">Descargar archivo</button></div>
        <div id="wpa-msg"></div>
        <label><input type="checkbox" id="wpa-auto"> Elegir color al pasar el ratón</label>
        <label><input type="checkbox" id="wpa-ov"> Mostrar overlay</label>
        <label>Opacidad <input type="range" id="wpa-op" min="0.1" max="1" step="0.05" style="flex:1"></label>
        <label>Ver <select id="wpa-mode" style="flex:1;background:#111;color:#eee;border:1px solid #444;border-radius:5px;padding:3px">
          <option value="dim">Pendientes (hechos atenuados)</option>
          <option value="pending">Solo pendientes</option>
          <option value="all">Plantilla completa</option>
        </select></label>
        <button id="wpa-refresh" class="sec">Actualizar estado del lienzo</button>
        <label><input type="checkbox" id="wpa-block"> Bloquear clics fuera de lo pendiente</label>
        <small>Pintar solo estos colores (clic para marcar varios):</small>
        <div id="wpa-colors"></div>
        <div class="st" id="wpa-status">Esperando mapa…</div>
      </div>`;
    document.body.appendChild(p);
    ui = {
      panel: p, json: p.querySelector('#wpa-json'), tx: p.querySelector('#wpa-tx'), ty: p.querySelector('#wpa-ty'),
      px: p.querySelector('#wpa-px'), py: p.querySelector('#wpa-py'), auto: p.querySelector('#wpa-auto'),
      ov: p.querySelector('#wpa-ov'), op: p.querySelector('#wpa-op'), status: p.querySelector('#wpa-status'),
      mode: p.querySelector('#wpa-mode'), colors: p.querySelector('#wpa-colors'), block: p.querySelector('#wpa-block'),
      msg: p.querySelector('#wpa-msg'),
    };
    // Escribir en los campos del panel no dispara atajos de wplace
    for (const t of ['keydown', 'keyup', 'keypress']) p.addEventListener(t, e => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) e.stopPropagation(); });
    p.addEventListener('paste', e => e.stopPropagation());
    ui.block.checked = state.block;
    ui.block.onchange = () => { state.block = ui.block.checked; save(); updateStatus(); };
    ui.tx.value = state.origin.tx; ui.ty.value = state.origin.ty; ui.px.value = state.origin.px; ui.py.value = state.origin.py;
    ui.auto.checked = state.autoColor; ui.ov.checked = state.overlay; ui.op.value = state.opacity; ui.mode.value = state.mode;
    if (state.collapsed) p.classList.add('collapsed');

    p.querySelector('#wpa-load').onclick = async () => {
      const txt = ui.json.value.trim(); if (!txt) return;
      try { await importText(txt); ui.json.value = ''; }
      catch (e) { alert('No se reconoce. Pega el código de un amigo (empieza por WPA1:) o la plantilla del conversor.'); }
    };
    const fileIn = p.querySelector('#wpa-fileinput');
    p.querySelector('#wpa-file').onclick = () => fileIn.click();
    fileIn.onchange = async () => {
      const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
      try { await importFile(f); } catch (e) { alert('No se pudo abrir el archivo: ' + e.message); }
    };
    p.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); p.classList.add('drag-over'); } });
    p.addEventListener('dragleave', e => { if (e.target === p) p.classList.remove('drag-over'); });
    p.addEventListener('drop', async e => {
      const f = e.dataTransfer && e.dataTransfer.files[0]; p.classList.remove('drag-over'); if (!f) return;
      e.preventDefault(); e.stopPropagation();
      try { await importFile(f); } catch (err) { alert('No se pudo abrir el archivo: ' + err.message); }
    });
    p.querySelector('#wpa-conv-open').onclick = openConverter;
    p.querySelector('#wpa-goto').onclick = () => { if (!state.tpl) return flash('Primero carga una plantilla.'); goToTemplate(); };
    p.querySelector('#wpa-share').onclick = async () => {
      if (!state.tpl) return flash('Primero carga una plantilla.');
      try {
        const msg = await shareMessage();
        const ok = await copyToClipboard(msg);
        const len = msg.length;
        flash((ok ? `Copiado (${len.toLocaleString('es')} caracteres). Pégalo a tu amigo.` : 'No se pudo copiar; usa "Descargar archivo".') +
          (len > 2000 ? '\nEs largo para un mensaje de Discord: mejor envíale el archivo.' : '') +
          (originIsSet() ? '' : '\nOjo: aún no has fijado la esquina.'));
      } catch (e) { flash('Error al crear el código: ' + e.message); }
    };
    p.querySelector('#wpa-sharefile').onclick = async () => {
      if (!state.tpl) return flash('Primero carga una plantilla.');
      try {
        downloadBlob(new Blob([await shareMessage()], { type: 'text/plain' }), `plantilla-${slug(state.tpl.name)}.txt`);
        flash('Archivo descargado. Tu amigo lo abre con "Abrir archivo…" o lo arrastra al panel.');
      } catch (e) { flash('Error al crear el archivo: ' + e.message); }
    };
    const readOrigin = () => {
      state.origin = { tx: +ui.tx.value || 0, ty: +ui.ty.value || 0, px: +ui.px.value || 0, py: +ui.py.value || 0 };
      save(); computeDone(); requestDraw(); updateStatus();
      clearTimeout(readOrigin.t); readOrigin.t = setTimeout(refreshTiles, 600);
    };
    [ui.tx, ui.ty, ui.px, ui.py].forEach(i => i.addEventListener('input', readOrigin));
    p.querySelector('#wpa-useclick').onclick = () => {
      if (!lastClicked) { alert('Primero sal del modo pintar y haz clic en el píxel donde quieres la esquina superior izquierda.'); return; }
      ui.tx.value = lastClicked.tx; ui.ty.value = lastClicked.ty; ui.px.value = lastClicked.px; ui.py.value = lastClicked.py;
      readOrigin();
    };
    p.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      const [dx, dy] = b.dataset.n.split(',').map(Number);
      let [gx, gy] = originGlobal(); gx += dx; gy += dy;
      ui.tx.value = Math.floor(gx / 1000); ui.px.value = ((gx % 1000) + 1000) % 1000;
      ui.ty.value = Math.floor(gy / 1000); ui.py.value = ((gy % 1000) + 1000) % 1000;
      readOrigin();
    });
    ui.auto.onchange = () => { state.autoColor = ui.auto.checked; lastSelected = -1; save(); };
    ui.ov.onchange = () => { state.overlay = ui.ov.checked; save(); requestDraw(); };
    ui.op.oninput = () => { state.opacity = +ui.op.value; save(); requestDraw(); };
    ui.mode.onchange = () => { state.mode = ui.mode.value; save(); requestDraw(); };
    p.querySelector('#wpa-refresh').onclick = refreshTiles;
    p.querySelector('#wpa-toggle').onclick = () => { state.collapsed = p.classList.toggle('collapsed'); save(); };

    // Arrastrar el panel
    const head = p.querySelector('#wpa-head');
    let drag = null;
    head.addEventListener('mousedown', e => { if (e.target.id === 'wpa-toggle') return; drag = [e.clientX - p.offsetLeft, e.clientY - p.offsetTop]; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (!drag) return; p.style.left = (e.clientX - drag[0]) + 'px'; p.style.top = (e.clientY - drag[1]) + 'px'; p.style.right = 'auto'; });
    window.addEventListener('mouseup', () => drag = null);

    // Atajo: Alt+A activa/desactiva la elección automática de color
    window.addEventListener('keydown', e => {
      if (e.altKey && e.code === 'KeyA') { ui.auto.checked = !ui.auto.checked; ui.auto.onchange(); updateStatus(); }
    });
    buildColorList();
    updateStatus();
  }

  // Rejilla de colores de la plantilla con píxeles pendientes por color
  function buildColorList() {
    const box = ui.colors; if (!box) return;
    box.innerHTML = '';
    const t = state.tpl; if (!t) return;
    const total = {}, pend = {};
    for (let i = 0; i < t.ids.length; i++) {
      const id = t.ids[i]; if (!id) continue;
      total[id] = (total[id] || 0) + 1;
      if (!done || !done[i]) pend[id] = (pend[id] || 0) + 1;
    }
    const ids = Object.keys(total).map(Number).sort((a, b) => (pend[b] || 0) - (pend[a] || 0));
    state.filters = state.filters.filter(id => total[id]);
    const all = document.createElement('div');
    all.className = 'cs all' + (state.filters.length ? '' : ' sel');
    all.textContent = state.filters.length ? `Quitar filtro (${state.filters.length} colores)` : 'Todos los colores';
    all.onclick = () => setFilters([]);
    box.appendChild(all);
    for (const id of ids) {
      const rgb = tplRgb(id) || [0, 0, 0];
      const d = document.createElement('div');
      const n = done ? (pend[id] || 0) : total[id];
      d.className = 'cs' + (state.filters.includes(id) ? ' sel' : '') + (done && !pend[id] ? ' done' : '');
      d.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      d.textContent = n;
      d.title = `#${id} rgb(${rgb}) · ${done ? `${pend[id] || 0} pendientes de ${total[id]}` : `${total[id]} píxeles`}`;
      d.onclick = () => setFilters(state.filters.includes(id) ? state.filters.filter(x => x !== id) : [...state.filters, id]);
      box.appendChild(d);
    }
  }
  function setFilters(ids) {
    state.filters = ids; save(); lastSelected = -1;
    buildTpl(); buildColorList(); requestDraw(); updateStatus();
  }

  function updateStatus() {
    if (!ui.status) return;
    const t = state.tpl;
    const lines = [];
    lines.push(map ? 'Mapa: OK' : 'Mapa: esperando… (mueve el mapa)');
    if (t) {
      const total = t.ids.filter(Boolean).length;
      lines.push(`Plantilla${t.name ? ` «${t.name}»` : ''}: ${t.w}×${t.h}, ${total} píxeles`);
      if (done) lines.push(`Hechos: ${doneCount} · Pendientes: ${total - doneCount} (${Math.round(doneCount / total * 100)} %)` + (refreshing ? ' · actualizando…' : ''));
      else lines.push(refreshing ? 'Leyendo lienzo…' : 'Lienzo: sin datos (pulsa Actualizar)');
    } else lines.push('Plantilla: ninguna');
    if (state.filters.length) lines.push(`Filtro: solo ${state.filters.length} color(es) seleccionado(s)`);
    if (state.block && blockedCount) lines.push(`Clics bloqueados fuera de lo pendiente: ${blockedCount}`);
    const npal = scanPalette(false).length;
    lines.push(npal >= 10 ? `Paleta detectada: ${npal} colores` : 'Paleta no visible: pulsa "Pintar"');
    if (lastClicked) lines.push(`Último clic: Tl ${lastClicked.tx},${lastClicked.ty} · Px ${lastClicked.px},${lastClicked.py}`);
    if (hover && t) {
      const [ox, oy] = originGlobal();
      const rgb = tplRgb(hover.id);
      const hi = (hover.gy - oy) * t.w + (hover.gx - ox);
      const st = rgb && done ? (done[hi] ? ' ✓ ya pintado' : ' · pendiente') : (rgb ? '' : (tplIdAt(hover.gx, hover.gy) ? ' (fuera del filtro)' : ''));
      lines.push(`Ratón: (${hover.gx - ox}, ${hover.gy - oy}) → ` + (rgb ? `color #${hover.id} rgb(${rgb})${st}` : 'vacío'));
      if (inexact) lines.push(inexact);
    }
    lines.push(state.autoColor ? 'Auto-color: ON (Alt+A)' : 'Auto-color: OFF (Alt+A)');
    ui.status.textContent = lines.join('\n');
  }

  // ---------- Arranque ----------
  function start() {
    buildTpl();
    buildPanel();
    requestDraw();
    setTimeout(refreshTiles, 1500);
    setInterval(() => { if (state.tpl && Date.now() - lastRefresh > 60000) refreshTiles(); }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 500));
  else setTimeout(start, 500);
})();
