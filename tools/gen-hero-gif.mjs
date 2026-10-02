import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

/* Renders the glitching RAKTAPYAS banner as assets/hero.gif.
   The glyph font is extracted from index.html so this tool never drifts
   from the live site. Requires ffmpeg on PATH.

   node tools/gen-hero-gif.mjs [index.html] [out.gif] */

const ROOT = join(import.meta.dirname, '..');
const SRC = process.argv[2] || join(ROOT, 'index.html');
const OUT = process.argv[3] || join(ROOT, 'assets', 'hero.gif');

const SCALE = 2;      // image px per glyph px
const GLYPH = 8;      // glyph cell, in glyph px
const CELL_H = 9;     // vertical cell, 1px gap so rows do not fuse
const PAD = 10;
const FRAMES = 24;
const FPS = 12;
const GLOW = 6;       // glow radius, image px
const MAX_CORRUPT = 30;
const ATTEMPTS = 7;  // spawn rolls per frame; sets how busy the glitch reads
const HALO = 0.42;    // glow strength
const TTL_MIN = 2;    // corruption lifetime, in frames
const TTL_MAX = 5;

/* palette — mirrors :root in index.html */
const VOID = [0x03, 0x02, 0x04];
const CRIM = [0xdc, 0x14, 0x3c];
const DRIP = [0xff, 0x2e, 0x56];
const ASH = [0xe6, 0xdb, 0xd3];
/* one entry per compositing layer: crimson core, drip corruption, ash bleed */
const COLORS = [CRIM, DRIP, ASH];
const L_CRIM = 0, L_DRIP = 1, L_ASH = 2;

/* ---------- 8x8 glyph bitmaps ---------- */
const solid = () => Array.from({ length: GLYPH }, () => '#'.repeat(GLYPH));
const blank = () => Array.from({ length: GLYPH }, () => '.'.repeat(GLYPH));
const mk = (fn) => Array.from({ length: GLYPH }, (_, r) =>
  Array.from({ length: GLYPH }, (_, c) => (fn(r, c) ? '#' : '.')).join(''));

const GLYPHS = {
  '█': solid(),
  '░': mk((r, c) => r % 2 === 0 && c % 2 === 0),
  '▒': mk((r, c) => (r + c) % 2 === 0),
  '▓': mk((r, c) => !(r % 2 === 0 && c % 2 === 0)),
  '▄': mk((r) => r >= 4),
  '▀': mk((r) => r < 4),
  '═': mk((r) => r === 4),
  '║': mk((r, c) => c === 4),
  '╔': mk((r, c) => r >= 4 && c <= 3),
  '╗': mk((r, c) => r >= 4 && c >= 4),
  '╚': mk((r, c) => r <= 3 && c >= 4),
  '╝': mk((r, c) => r <= 3 && c <= 3),
  ' ': blank(),
};

const unknown = new Set();
function bitmap(ch) {
  const g = GLYPHS[ch];
  if (!g) { unknown.add(ch); return GLYPHS[' ']; }
  return g;
}

/* ---------- extract font, name and glitch ramp from index.html ---------- */
const html = readFileSync(SRC, 'utf8');
const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`could not extract ${what} from ${SRC}`);
  return m[1];
};
const F = new Function(`return (${pick(/const F=(\{[\s\S]*?\n\S*\})/, 'glyph font F')})`)();
const NAME = pick(/const NAME='([^']*)'/, 'NAME');
const GLITCH = pick(/const GLITCH='([^']*)'/, 'GLITCH ramp');

const ROWS = [0, 1, 2, 3, 4, 5].map((i) => NAME.split('').map((c) => F[c][i]).join(' '));
const WIDTH = Math.max(...ROWS.map((r) => r.length));
const HEIGHT = ROWS.length;

console.log(`${NAME}  ${WIDTH}x${HEIGHT} cells  ramp="${GLITCH}"`);

/* ---------- deterministic rng, so rebuilds are reproducible ---------- */
let seed = 0x9e3779b9;
function rnd() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0x100000000;
}
const pick1 = (a) => a[Math.floor(rnd() * a.length)];

/* ---------- canvas ---------- */
const cw = GLYPH * SCALE;
const chh = CELL_H * SCALE;
const W = WIDTH * cw + PAD * 2;
const H = HEIGHT * chh + PAD * 2;
const N = W * H;

const clamp = (v, hi) => (v < 0 ? 0 : v >= hi ? hi - 1 : v);

function boxBlur(src, r) {
  const tmp = new Float32Array(N);
  const out = new Float32Array(N);
  const win = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + clamp(i, W)];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / win;
      acc -= src[row + clamp(x - r, W)];
      acc += src[row + clamp(x + r + 1, W)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[clamp(i, H) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / win;
      acc -= tmp[clamp(y - r, H) * W + x];
      acc += tmp[clamp(y + r + 1, H) * W + x];
    }
  }
  return out;
}

/* ---------- simulate corruption, mirroring renderArt() in index.html ---------- */
function buildCells() {
  const frames = [];
  /* a cell spawned on frame f lives through f + ttl - 1. Spawning must stop
     early enough that the last possible cell dies before the final frame,
     so the tail is clean and the loop closes without a pop:
     (SPAWN_UNTIL - 1) + TTL_MAX - 1 <= FRAMES - 2 */
  const SPAWN_UNTIL = FRAMES - TTL_MAX - 1;
  let corrupt = [];

  for (let f = 0; f < FRAMES; f++) {
    corrupt.forEach((c) => { c.ttl--; });
    corrupt = corrupt.filter((c) => c.ttl > 0);

    /* frame 0 stays pristine so the loop wraps from a clean frame */
    for (let a = 0; a < ATTEMPTS; a++) {
      if (f === 0 || f >= SPAWN_UNTIL || corrupt.length >= MAX_CORRUPT) break;
      if (rnd() >= 0.5) continue;
      const r = Math.floor(rnd() * HEIGHT);
      const c = Math.floor(rnd() * WIDTH);
      if (ROWS[r][c] !== ' ' && !corrupt.some((x) => x.r === r && x.c === c)) {
        corrupt.push({ r, c, ch: pick1(GLITCH), ttl: TTL_MIN + Math.floor(rnd() * (TTL_MAX - TTL_MIN + 1)) });
      }
    }

    /* brightness pulse, same ~1% cadence as the live page */
    const pulse = rnd() < 0.12 ? 1.6 : 1.0;
    const t = f / FPS;

    const cells = ROWS.map((row, r) => {
      /* per-row sway, matching the site's sine drift */
      const sway = Math.round(Math.sin(t * 3.1 + r * 0.9));
      const chars = [];
      for (let c = 0; c < WIDTH; c++) {
        const hit = corrupt.find((x) => x.r === r && x.c === c);
        chars.push({
          ch: hit ? hit.ch : (row[c] ?? ' '),
          layer: hit
            ? (rnd() < 0.12 ? L_ASH : L_DRIP)
            : (rnd() < 0.06 ? L_DRIP : L_CRIM),
        });
      }
      return { chars, sway };
    });

    frames.push({ cells, pulse, corrupt: corrupt.length });
  }
  return frames;
}

/* ---------- rasterize one frame to RGB bytes ---------- */
function rasterize({ cells, pulse }) {
  const layers = COLORS.map(() => new Float32Array(N));

  cells.forEach((row, r) => {
    const oy = PAD + r * chh;
    for (let c = 0; c < WIDTH; c++) {
      const { ch, layer } = row.chars[c];
      const bits = bitmap(ch);
      const buf = layers[layer];
      const ox = PAD + c * cw + row.sway * SCALE;
      for (let gy = 0; gy < GLYPH; gy++) {
        if (bits[gy].indexOf('#') === -1) continue;
        for (let gx = 0; gx < GLYPH; gx++) {
          if (bits[gy][gx] !== '#') continue;
          const px = ox + gx * SCALE;
          const py = oy + gy * SCALE;
          for (let dy = 0; dy < SCALE; dy++) {
            const yy = py + dy;
            if (yy < 0 || yy >= H) continue;
            for (let dx = 0; dx < SCALE; dx++) {
              const xx = px + dx;
              if (xx < 0 || xx >= W) continue;
              buf[yy * W + xx] = 1;
            }
          }
        }
      }
    }
  });

  const glows = layers.map((l) => boxBlur(l, GLOW));
  const px = Buffer.alloc(N * 3);

  for (let i = 0; i < N; i++) {
    const out = [VOID[0], VOID[1], VOID[2]];
    for (let k = 0; k < 3; k++) {
      let v = out[k];
      /* every layer feeds every channel: colour[layer][channel] */
      for (let l = 0; l < 3; l++) {
        const rgb = COLORS[l][k];
        v += layers[l][i] * pulse * rgb;
        v += glows[l][i] * HALO * rgb;
      }
      out[k] = Math.min(255, v);
    }
    px[i * 3] = Math.round(out[0]);
    px[i * 3 + 1] = Math.round(out[1]);
    px[i * 3 + 2] = Math.round(out[2]);
  }
  return px;
}

/* ---------- write PPM frames, then mux with ffmpeg ---------- */
/* HERO_DUMP=<dir> keeps the raw PPM frames and skips the ffmpeg mux. */
const DUMP = process.env.HERO_DUMP || '';
const dir = DUMP ? (mkdirSync(DUMP, { recursive: true }), DUMP)
                 : mkdtempSync(join(tmpdir(), 'hero-'));
const frames = buildCells();
try {
  frames.forEach((frame, i) => {
    const head = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
    writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.ppm`), Buffer.concat([head, rasterize(frame)]));
  });

  if (DUMP) {
    console.log(`dumped ${FRAMES} ppm frames to ${dir}`);
    process.exit(0);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-framerate', String(FPS),
    '-i', join(dir, 'f%04d.ppm'),
    '-filter_complex',
    '[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a',
    '-loop', '0',
    OUT,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (unknown.size) console.warn(`unmapped glyphs: ${[...unknown].map((c) => JSON.stringify(c)).join(' ')}`);

/* loop seam check: by construction no corruption can survive into the last
   two frames or into frame 0, so the gif must not pop when it wraps */
const seamFrames = [FRAMES - 2, FRAMES - 1, 0];
const seam = seamFrames.map((i) => frames[i].corrupt);
if (seam.some((n) => n !== 0)) {
  console.warn(`WARNING: loop seam not clean — frames ${seamFrames.join(',')}: ${seam.join(',')}`);
} else {
  console.log(`loop seam clean (frames ${seamFrames.join(',')})`);
}
console.log(`corruption/frame: ${frames.map((f) => f.corrupt).join(' ')}`);
console.log(`${OUT}  ${W}x${H}  ${FRAMES}f @ ${FPS}fps`);