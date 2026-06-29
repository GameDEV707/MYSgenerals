// MYS Generals — self-contained QR code generator (no npm: the registry is blocked offline).
// Byte (8-bit) mode, error-correction level L, QR versions 1–10 (enough for any LAN URL).
// Implements ISO/IEC 18004: GF(256) Reed–Solomon, finder/alignment/timing patterns, format &
// version info (BCH), data masking with penalty-based mask selection. Output is a boolean matrix
// (true = dark module) that the lobby and the host launcher render. Written from the spec.

// ---- Galois field GF(256), primitive polynomial 0x11D ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gfMul(a: number, b: number): number { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }

// Reed–Solomon error-correction codewords for one data block.
function rsEncode(data: number[], ecLen: number): number[] {
  // generator polynomial
  const gen = [1];
  for (let i = 0; i < ecLen; i++) {
    for (let j = gen.length; j > 0; j--) gen[j] = (gen[j] ?? 0) ^ gfMul(gen[j - 1], EXP[i]);
    gen[0] = gfMul(gen[0], EXP[i]);
  }
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res.shift()!;
    res.push(0);
    for (let i = 0; i < gen.length; i++) res[i] ^= gfMul(gen[i], factor);
  }
  return res.slice(0, ecLen);
}

// ---- EC characteristics (level L), versions 1..10 ----
// [ecCodewordsPerBlock, group1Blocks, group1DataCount, group2Blocks, group2DataCount]
const EC_L: Record<number, [number, number, number, number, number]> = {
  1: [7, 1, 19, 0, 0], 2: [10, 1, 34, 0, 0], 3: [15, 1, 55, 0, 0], 4: [20, 1, 80, 0, 0],
  5: [26, 1, 108, 0, 0], 6: [18, 2, 68, 0, 0], 7: [20, 2, 78, 0, 0], 8: [24, 2, 97, 0, 0],
  9: [30, 2, 116, 0, 0], 10: [18, 2, 68, 2, 69],
};
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function dataCapacityBytes(v: number): number {
  const [ec, g1, d1, g2, d2] = EC_L[v];
  void ec;
  return g1 * d1 + g2 * d2;
}

// ---- BCH for format / version info ----
function bch(data: number, gen: number, glen: number): number {
  let d = data << (glen - 1);
  const dlen = (n: number) => { let b = 0; while (n) { b++; n >>= 1; } return b; };
  while (dlen(d) >= glen) d ^= gen << (dlen(d) - glen);
  return d;
}
function formatBits(mask: number): number {
  // level L = 0b01
  const data = (0b01 << 3) | mask;
  const rem = bch(data, 0b10100110111, 11);
  return ((data << 10) | rem) ^ 0b101010000010010;
}
function versionBits(v: number): number {
  const rem = bch(v, 0b1111100100101, 13);
  return (v << 12) | rem;
}

type Matrix = (boolean | null)[][];

function makePatterns(size: number, v: number): { m: Matrix; reserved: boolean[][] } {
  const m: Matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r: number, c: number, val: boolean) => { m[r][c] = val; reserved[r][c] = true; };

  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      set(rr, cc, dark);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

  // alignment patterns
  const centers = ALIGN[v];
  for (const r of centers) for (const c of centers) {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      set(r + dr, c + dc, dark);
    }
  }

  // dark module
  set(size - 8, 8, true);

  // reserve format areas
  for (let i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  // reserve version info (v>=7)
  if (v >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { reserved[size - 11 + j][i] = true; reserved[i][size - 11 + j] = true; }
  }
  return { m, reserved };
}

function placeData(m: Matrix, reserved: boolean[][], bits: number[], size: number): void {
  let idx = 0, dir = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = dir === -1 ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        m[row][cc] = idx < bits.length ? bits[idx] === 1 : false;
        idx++;
      }
    }
    dir = -dir;
  }
}

function applyMask(val: boolean, r: number, c: number, mask: number): boolean {
  let on = false;
  switch (mask) {
    case 0: on = (r + c) % 2 === 0; break;
    case 1: on = r % 2 === 0; break;
    case 2: on = c % 3 === 0; break;
    case 3: on = (r + c) % 3 === 0; break;
    case 4: on = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
    case 5: on = ((r * c) % 2) + ((r * c) % 3) === 0; break;
    case 6: on = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
    case 7: on = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
  }
  return on ? !val : val;
}

function penalty(grid: boolean[][], size: number): number {
  let p = 0;
  // rule 1: runs of 5+
  for (let r = 0; r < size; r++) {
    let runC = 1, runR = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) { runC++; if (runC === 5) p += 3; else if (runC > 5) p++; } else runC = 1;
      if (grid[c][r] === grid[c - 1][r]) { runR++; if (runR === 5) p += 3; else if (runR > 5) p++; } else runR = 1;
    }
  }
  // rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = grid[r][c];
    if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) p += 3;
  }
  // rule 3: finder-like patterns 1011101 with 4 light
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let r = 0; r < size; r++) for (let c = 0; c < size - 10; c++) {
    let a = true, b = true;
    for (let k = 0; k < 11; k++) { if (grid[r][c + k] !== pat1[k]) a = false; if (grid[r][c + k] !== pat2[k]) b = false; }
    if (a || b) p += 40;
    a = true; b = true;
    for (let k = 0; k < 11; k++) { if (grid[c + k][r] !== pat1[k]) a = false; if (grid[c + k][r] !== pat2[k]) b = false; }
    if (a || b) p += 40;
  }
  // rule 4: dark ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
  const pct = (dark * 100) / (size * size);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

// Encode a string to a QR boolean matrix. Returns null if the text is too long for v1..10.
export function qrMatrix(text: string): boolean[][] | null {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else { // UTF-8 encode
      const enc = unescape(encodeURIComponent(text.charAt(i)));
      for (let j = 0; j < enc.length; j++) bytes.push(enc.charCodeAt(j));
    }
  }

  // choose smallest version that fits (byte mode header: 4 + countBits)
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    const headerBytes = Math.ceil((4 + countBits) / 8);
    if (bytes.length + headerBytes <= dataCapacityBytes(v)) { version = v; break; }
  }
  if (version === 0) return null;

  const [ecLen, g1, d1, g2, d2] = EC_L[version];
  const totalData = g1 * d1 + g2 * d2;
  const countBits = version < 10 ? 8 : 16;

  // build bit stream
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                 // byte mode
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);
  // terminator
  const cap = totalData * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  // pad bytes
  const pads = [0xec, 0x11]; let pi = 0;
  while (bits.length < cap) { push(pads[pi % 2], 8); pi++; }

  // to data codewords
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; codewords.push(b); }

  // split into blocks, compute EC
  const blocks: { data: number[]; ec: number[] }[] = [];
  let off = 0;
  for (let i = 0; i < g1; i++) { const data = codewords.slice(off, off + d1); off += d1; blocks.push({ data, ec: rsEncode(data, ecLen) }); }
  for (let i = 0; i < g2; i++) { const data = codewords.slice(off, off + d2); off += d2; blocks.push({ data, ec: rsEncode(data, ecLen) }); }

  // interleave data then EC
  const finalCw: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) finalCw.push(b.data[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) finalCw.push(b.ec[i]);

  const finalBits: number[] = [];
  for (const cw of finalCw) for (let i = 7; i >= 0; i--) finalBits.push((cw >> i) & 1);

  const size = 17 + version * 4;
  const { m, reserved } = makePatterns(size, version);
  placeData(m, reserved, finalBits, size);

  // try all masks, pick lowest penalty
  let best: boolean[][] | null = null; let bestPen = Infinity; let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const g: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const base = m[r][c] ?? false;
      g[r][c] = reserved[r][c] ? base : applyMask(base, r, c, mask);
    }
    writeFormat(g, reserved, size, mask, version);
    const pen = penalty(g, size);
    if (pen < bestPen) { bestPen = pen; best = g; bestMask = mask; }
  }
  void bestMask;
  return best;
}

function writeFormat(g: boolean[][], reserved: boolean[][], size: number, mask: number, version: number): void {
  const fmt = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = ((fmt >> i) & 1) === 1;
    // around top-left
    if (i < 6) g[8][i] = bit;
    else if (i === 6) g[8][7] = bit;
    else if (i === 7) g[8][8] = bit;
    else if (i === 8) g[7][8] = bit;
    else g[14 - i][8] = bit;
    // around top-right / bottom-left
    if (i < 8) g[size - 1 - i][8] = bit;
    else g[8][size - 15 + i] = bit;
    reserved[8][i] = true;
  }
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >> i) & 1) === 1;
      const r = Math.floor(i / 3), c = i % 3;
      g[size - 11 + c][r] = bit;
      g[r][size - 11 + c] = bit;
    }
  }
}


// Render a QR matrix to a compact ASCII string (terminal) using half-block characters so two
// module rows share one text line. Includes a quiet zone. Used by the Node host launcher (M6).
export function qrAscii(m: boolean[][]): string {
  const size = m.length;
  const q = 2; // quiet zone
  const dark = (r: number, c: number) => r >= 0 && r < size && c >= 0 && c < size && m[r][c];
  const lines: string[] = [];
  for (let r = -q; r < size + q; r += 2) {
    let line = "";
    for (let c = -q; c < size + q; c++) {
      const top = dark(r, c), bot = dark(r + 1, c);
      // dark module shown as black; use upper/lower half blocks
      line += top && bot ? "\u2588" : top ? "\u2580" : bot ? "\u2584" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
