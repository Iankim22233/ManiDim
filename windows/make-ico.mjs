// Builds build-icon/icon.ico (PNG-compressed frames) from build-icon/i<size>.png
import { readFileSync, writeFileSync } from 'node:fs';
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => readFileSync(`build-icon/i${s}.png`));
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => { const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(off, 12); off += pngs[i].length; return e; });
writeFileSync('build-icon/icon.ico', Buffer.concat([head, ...dir, ...pngs]));
