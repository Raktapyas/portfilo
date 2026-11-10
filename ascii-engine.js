const DEFAULTS = Object.freeze({
  density: ' .:-=+*#%@',
  fontSize: 14,
  fontFamily: '"Courier New", Courier, monospace',
  lineHeight: 1,
  color: '#e01e37',
  background: null,
  fit: 'cover',
  invert: false,
  gamma: 1,
  morphSpeed: 9,
  animateIn: true,
  maxDPR: 2,
  crossOrigin: null,
  observeResize: true,
  respectReducedMotion: true,
  interactive: true,
  pointerRadius: 120,
  pointerStrength: 0.85,
  ambient: true,
  glitchChance: 0.0015,
  glitchInterval: 110,
  glitchDurationMin: 70,
  glitchDurationMax: 180,
  glitchChars: '!<>-_/\\[]{}—=+*^?#%@$&'
});

const lerp = (from, to, t) => from + (to - from) * t;

const hash = (x, y, seed) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
};

export default class AsciiEngine {
  constructor(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('AsciiEngine: canvas must be an HTMLCanvasElement');
    }

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('AsciiEngine: 2D context unavailable');

    this.canvas = canvas;
    this.ctx = ctx;
    this.options = { ...DEFAULTS, ...options };

    const o = this.options;
    o.density = String(o.density == null ? DEFAULTS.density : o.density);
    if (!o.density.length) throw new Error('AsciiEngine: density must not be empty');
    o.fontSize = Math.max(1, Number(o.fontSize) || DEFAULTS.fontSize);
    o.lineHeight = Math.max(0.1, Number(o.lineHeight) || DEFAULTS.lineHeight);
    o.gamma = Math.max(0.01, Number(o.gamma) || DEFAULTS.gamma);
    o.morphSpeed = Math.max(0.001, Number(o.morphSpeed) || DEFAULTS.morphSpeed);
    o.maxDPR = Math.max(1, Number(o.maxDPR) || DEFAULTS.maxDPR);
    if (!['cover', 'contain', 'stretch'].includes(o.fit)) o.fit = DEFAULTS.fit;
    o.interactive = Boolean(o.interactive);
    o.ambient = Boolean(o.ambient);
    o.pointerRadius = Math.max(1, Number(o.pointerRadius) || DEFAULTS.pointerRadius);
    const pointerStrength = Number(o.pointerStrength);
    o.pointerStrength = Number.isFinite(pointerStrength)
      ? Math.max(0, Math.min(1.5, pointerStrength))
      : DEFAULTS.pointerStrength;
    o.glitchChance = Math.max(0, Number(o.glitchChance) || 0);
    o.glitchInterval = Math.max(16, Number(o.glitchInterval) || DEFAULTS.glitchInterval);
    o.glitchDurationMin = Math.max(16, Number(o.glitchDurationMin) || DEFAULTS.glitchDurationMin);
    o.glitchDurationMax = Math.max(o.glitchDurationMin, Number(o.glitchDurationMax) || DEFAULTS.glitchDurationMax);

    this._density = Array.from(o.density);
    this._glitchChars = Array.from(String(o.glitchChars == null ? DEFAULTS.glitchChars : o.glitchChars))
      .filter((ch) => ch !== ' ' && ch !== '\n' && ch !== '\t');
    if (!this._glitchChars.length) this._glitchChars = ['#'];
    this._flatCells = [];
    this._pointer = { active: false, x: 0, y: 0 };
    this._pointerCells = new Set();
    this._glitching = new Set();
    this._morphing = false;
    this._now = 0;
    this._lastGlitch = 0;
    this._image = null;
    this._cells = [];
    this._cols = 0;
    this._rows = 0;
    this._cellW = 0;
    this._cellH = 0;
    this._offsetX = 0;
    this._offsetY = 0;
    this._cssW = 0;
    this._cssH = 0;
    this._dpr = 1;
    this._font = '';
    this._raf = 0;
    this._resizeRaf = 0;
    this._last = 0;
    this._running = false;
    this._dirty = true;
    this._reduced = Boolean(
      o.respectReducedMotion &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    this._sample = document.createElement('canvas');
    this._sampleCtx = this._sample.getContext('2d', { willReadFrequently: true });
    if (!this._sampleCtx) throw new Error('AsciiEngine: sampling context unavailable');

    this._onResize = this._onResize.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._tick = this._tick.bind(this);

    this._observer = null;
    const observed = canvas.parentElement || canvas;
    if (o.observeResize && typeof ResizeObserver === 'function') {
      this._observer = new ResizeObserver(this._onResize);
      this._observer.observe(observed);
    } else {
      window.addEventListener('resize', this._onResize, { passive: true });
    }

    if (o.interactive) {
      canvas.addEventListener('pointermove', this._onPointerMove, { passive: true });
      canvas.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
      canvas.addEventListener('pointercancel', this._onPointerLeave, { passive: true });
    }

    this._measure();
    this._syncSize();
    this._draw();
  }

  get grid() {
    return this._cells;
  }

  get cols() {
    return this._cols;
  }

  get rows() {
    return this._rows;
  }

  async load(src) {
    let image;

    if (this._isDrawable(src)) {
      image = src;
      if (image instanceof HTMLImageElement && !image.complete) {
        await image.decode();
      }
    } else {
      image = await this._createImage(src);
    }

    this._image = image;
    this._measure();
    this._syncSize();
    this._build();
    if (this._pointer.active) this._applyPointer();

    if (this._reduced) {
      this._settle();
      this._draw();
    } else {
      this.start();
    }

    return this;
  }

  resize() {
    if (!this.canvas.isConnected) return this;

    this._measure();
    this._syncSize();

    if (this._image) {
      this._build();
      if (this._pointer.active) this._applyPointer();
      if (this._reduced) {
        this._settle();
        this._draw();
      } else {
        this.start();
      }
    } else {
      this._draw();
    }

    return this;
  }

  start() {
    if (!this._image) return this;

    if (this._reduced) {
      this._settle();
      this._draw();
      return this;
    }

    if (this._running) return this;

    this._running = true;
    this._last = 0;
    this._raf = requestAnimationFrame(this._tick);
    return this;
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    return this;
  }

  destroy() {
    this.stop();

    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = 0;

    if (this._observer) this._observer.disconnect();
    else window.removeEventListener('resize', this._onResize);

    if (this.options.interactive) {
      this.canvas.removeEventListener('pointermove', this._onPointerMove);
      this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
      this.canvas.removeEventListener('pointercancel', this._onPointerLeave);
    }

    this._observer = null;
    this._pointer.active = false;
    this._pointerCells.clear();
    this._glitching.clear();
    this._flatCells = [];
    this._cells = [];
    this._image = null;
    this._sample.width = 0;
    this._sample.height = 0;
    this.ctx.clearRect(0, 0, this._cssW, this._cssH);
    return this;
  }

  _isDrawable(value) {
    return Boolean(
      value &&
      (value instanceof HTMLImageElement ||
        value instanceof HTMLCanvasElement ||
        (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap))
    );
  }

  _createImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      if (this.options.crossOrigin != null) image.crossOrigin = this.options.crossOrigin;
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`AsciiEngine: failed to load image "${src}"`));
      image.src = src;
    });
  }

  _measure() {
    const o = this.options;
    this.ctx.font = `${o.fontSize}px ${o.fontFamily}`;
    const width = this.ctx.measureText('M').width;
    this._cellW = Math.max(1, width || o.fontSize * 0.6);
    this._cellH = Math.max(1, o.fontSize * o.lineHeight);
    this._font = this.ctx.font;
  }

  _syncSize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width || this.canvas.clientWidth || this.canvas.width || 1);
    const cssH = Math.max(1, rect.height || this.canvas.clientHeight || this.canvas.height || 1);
    const dpr = Math.min(this.options.maxDPR, window.devicePixelRatio || 1);
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);

    this._cssW = cssW;
    this._cssH = cssH;
    this._dpr = dpr;

    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._cols = Math.max(1, Math.floor(cssW / this._cellW));
    this._rows = Math.max(1, Math.floor(cssH / this._cellH));
    this._offsetX = (cssW - this._cols * this._cellW) / 2;
    this._offsetY = (cssH - this._rows * this._cellH) / 2;
  }

  _build() {
    if (!this._image) return;

    const cols = this._cols;
    const rows = this._rows;
    const sample = this._sample;
    sample.width = cols;
    sample.height = rows;

    const sctx = this._sampleCtx;
    sctx.clearRect(0, 0, cols, rows);
    this._drawSource(sctx, cols, rows);

    let pixels;
    try {
      pixels = sctx.getImageData(0, 0, cols, rows).data;
    } catch (error) {
      throw new Error(
        'AsciiEngine: image data is unreadable. Serve the image from the same origin or set crossOrigin.'
      );
    }

    const densityLast = this._density.length - 1;
    const gamma = this.options.gamma;
    const invert = this.options.invert;
    const previous = this._cells;
    const previousCols = previous.length ? previous[0].length : 0;
    const previousRows = previous.length;
    const animateIn = this.options.animateIn && !this._reduced;
    const next = new Array(rows);

    for (let y = 0; y < rows; y++) {
      const row = new Array(cols);

      for (let x = 0; x < cols; x++) {
        const offset = (y * cols + x) * 4;
        let luminance =
          0.2126 * pixels[offset] +
          0.7152 * pixels[offset + 1] +
          0.0722 * pixels[offset + 2];

        if (invert) luminance = 255 - luminance;
        luminance = 255 * Math.pow(luminance / 255, gamma);

        const baseCharIndex = Math.round((luminance / 255) * densityLast);
        const targetCharIndex = baseCharIndex;
        let activeCharIndex = targetCharIndex;

        if (animateIn) {
          if (previousCols && previousRows) {
            const px = Math.min(
              previousCols - 1,
              Math.round((x / Math.max(1, cols - 1)) * (previousCols - 1))
            );
            const py = Math.min(
              previousRows - 1,
              Math.round((y / Math.max(1, rows - 1)) * (previousRows - 1))
            );
            activeCharIndex = previous[py][px].activeCharIndex;
          } else {
            activeCharIndex = Math.random() * densityLast;
          }
        }

        row[x] = {
          activeCharIndex,
          targetCharIndex,
          baseCharIndex,
          glitchUntil: 0,
          glitchChar: '',
          x,
          y
        };
      }

      next[y] = row;
    }

    this._cells = next;
    this._flatCells = [];
    for (const row of next) {
      for (const cell of row) this._flatCells.push(cell);
    }
    this._pointerCells.clear();
    this._glitching.clear();
    this._morphing = animateIn;
    this._dirty = true;
  }

  _drawSource(ctx, width, height) {
    const image = this._image;
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;

    if (this.options.fit === 'stretch') {
      ctx.drawImage(image, 0, 0, width, height);
      return;
    }

    const scale =
      this.options.fit === 'cover'
        ? Math.max(width / iw, height / ih)
        : Math.min(width / iw, height / ih);

    const dw = iw * scale;
    const dh = ih * scale;

    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  _tick(now) {
    if (!this._running) return;

    const dt = this._last ? Math.min(0.05, (now - this._last) / 1000) : 1 / 60;
    this._last = now;
    this._now = now;

    const moving = this._step(dt);
    const glitching = this._updateGlitches(now);

    if (this._dirty || moving || glitching) this._draw();
    this._dirty = false;

    const ambient = this.options.ambient && this.options.glitchChance > 0 && !this._reduced;
    const keepAlive = ambient || this._morphing || this._glitching.size > 0;

    if (keepAlive) {
      this._raf = requestAnimationFrame(this._tick);
    } else {
      this._running = false;
      this._raf = 0;
    }
  }

  _step(dt) {
    const cells = this._cells;
    if (!this._morphing || !cells.length) return false;

    const t = 1 - Math.exp(-this.options.morphSpeed * dt);
    let moving = false;

    for (let y = 0; y < cells.length; y++) {
      const row = cells[y];

      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        const delta = cell.targetCharIndex - cell.activeCharIndex;

        if (Math.abs(delta) < 0.01) {
          cell.activeCharIndex = cell.targetCharIndex;
          continue;
        }

        cell.activeCharIndex = lerp(cell.activeCharIndex, cell.targetCharIndex, t);
        moving = true;
      }
    }

    if (!moving) this._morphing = false;
    return moving;
  }

  _updateGlitches(now) {
    if (this._reduced || !this.options.ambient) {
      if (this._glitching.size) this._glitching.clear();
      return false;
    }

    let active = false;

    for (const cell of this._glitching) {
      if (now >= cell.glitchUntil) this._glitching.delete(cell);
      else active = true;
    }

    if (now - this._lastGlitch >= this.options.glitchInterval) {
      this._lastGlitch = now;
      const total = this._flatCells.length;

      if (total && this.options.glitchChance > 0) {
        const count = Math.max(1, Math.round(total * this.options.glitchChance));
        const min = this.options.glitchDurationMin;
        const max = this.options.glitchDurationMax;

        for (let i = 0; i < count; i++) {
          const cell = this._flatCells[(Math.random() * total) | 0];

          if (!cell || this._pointerCells.has(cell)) continue;
          if (Math.abs(cell.targetCharIndex - cell.activeCharIndex) > 0.01) continue;

          cell.glitchUntil = now + min + Math.random() * (max - min);
          cell.glitchChar = this._glitchChars[(Math.random() * this._glitchChars.length) | 0];
          this._glitching.add(cell);
          active = true;
        }
      }
    }

    return active || this._glitching.size > 0;
  }

  _settle() {
    this._glitching.clear();
    for (const row of this._cells) {
      for (const cell of row) {
        cell.activeCharIndex = cell.targetCharIndex;
        cell.glitchUntil = 0;
      }
    }
  }

  _draw() {
    const ctx = this.ctx;
    const o = this.options;
    const width = this._cssW;
    const height = this._cssH;

    ctx.clearRect(0, 0, width, height);

    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, width, height);
    }

    if (!this._cells.length) return;

    ctx.font = this._font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const density = this._density;
    const cw = this._cellW;
    const ch = this._cellH;
    const ox = this._offsetX;
    const oy = this._offsetY;
    const colorFn = typeof o.color === 'function' ? o.color : null;
    const staticColor = colorFn ? null : o.color;

    ctx.fillStyle = staticColor || DEFAULTS.color;
    let lastColor = ctx.fillStyle;

    for (let y = 0; y < this._cells.length; y++) {
      const row = this._cells[y];
      const py = oy + y * ch + ch * 0.5;

      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        const glyph =
          cell.glitchUntil > this._now && cell.glitchChar
            ? cell.glitchChar
            : density[Math.round(cell.activeCharIndex)];

        if (glyph === ' ' || glyph === undefined) continue;

        if (colorFn) {
          const color = colorFn(cell, x, y, this);
          if (color && color !== lastColor) {
            ctx.fillStyle = color;
            lastColor = color;
          }
        }

        ctx.fillText(glyph, ox + x * cw, py);
      }
    }
  }

  _onPointerMove(event) {
    if (!this.options.interactive || !this._image) return;

    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    this._pointer.x = (event.clientX - rect.left) * (this._cssW / rect.width);
    this._pointer.y = (event.clientY - rect.top) * (this._cssH / rect.height);
    this._pointer.active = true;
    this._applyPointer();
  }

  _onPointerLeave() {
    if (!this._pointer.active && !this._pointerCells.size) return;
    this._pointer.active = false;
    if (this._resetPointerTargets()) this.start();
  }

  _applyPointer() {
    const hadTargets = this._resetPointerTargets();
    if (!this._pointer.active || !this._cells.length) return;

    const { x, y } = this._pointer;
    const radius = this.options.pointerRadius;
    const radiusSq = radius * radius;
    const cw = this._cellW;
    const ch = this._cellH;
    const ox = this._offsetX;
    const oy = this._offsetY;
    const minX = Math.max(0, Math.floor((x - radius - ox) / cw));
    const maxX = Math.min(this._cols - 1, Math.ceil((x + radius - ox) / cw));
    const minY = Math.max(0, Math.floor((y - radius - oy) / ch));
    const maxY = Math.min(this._rows - 1, Math.ceil((y + radius - oy) / ch));
    const last = this._density.length - 1;
    const strength = this.options.pointerStrength;
    let changed = hadTargets;

    for (let row = minY; row <= maxY; row++) {
      const cells = this._cells[row];
      const cy = oy + row * ch + ch * 0.5;
      const dy = cy - y;

      for (let col = minX; col <= maxX; col++) {
        const cell = cells[col];
        const cx = ox + col * cw + cw * 0.5;
        const dx = cx - x;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) continue;

        const falloff = 1 - Math.sqrt(distSq) / radius;
        const smooth = falloff * falloff * (3 - 2 * falloff);
        const h1 = hash(cell.x, cell.y, 1);
        const h2 = hash(cell.x, cell.y, 2);
        const h3 = hash(cell.x, cell.y, 3);
        const h4 = hash(cell.x, cell.y, 4);

        let target;

        if (h1 < smooth * 0.45) {
          target = 0;
        } else if (h2 < smooth * 0.25) {
          target = last;
        } else {
          const magnitude = Math.round(smooth * last * strength * (0.2 + h3 * 0.8));
          target = cell.baseCharIndex + (h4 < 0.5 ? -magnitude : magnitude);
        }

        target = target < 0 ? 0 : target > last ? last : target;

        if (target !== cell.targetCharIndex) {
          cell.targetCharIndex = target;
          this._pointerCells.add(cell);
          changed = true;
        }
      }
    }

    if (changed) {
      this._morphing = true;
      this.start();
    }
  }

  _resetPointerTargets() {
    if (!this._pointerCells.size) return false;

    for (const cell of this._pointerCells) {
      cell.targetCharIndex = cell.baseCharIndex;
    }

    this._pointerCells.clear();
    this._morphing = true;
    return true;
  }

  _onResize() {
    if (this._resizeRaf) return;

    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.resize();
    });
  }
}
