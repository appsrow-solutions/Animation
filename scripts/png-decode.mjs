import fs from "node:fs";
import zlib from "node:zlib";

export function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (ihdr.bitDepth !== 8 || ihdr.interlace !== 0) {
    throw new Error(`unsupported png: depth=${ihdr.bitDepth} interlace=${ihdr.interlace}`);
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  const bpp = channels;
  const stride = ihdr.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(ihdr.height * stride);
  for (let y = 0; y < ihdr.height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }

  const rgba = Buffer.alloc(ihdr.width * ihdr.height * 4);
  for (let i = 0, n = ihdr.width * ihdr.height; i < n; i++) {
    const s = i * bpp;
    const d = i * 4;
    if (channels === 4) {
      rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = out[s + 3];
    } else if (channels === 3) {
      rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = 255;
    } else if (channels === 2) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = out[s + 1];
    } else {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = 255;
    }
  }
  return { width: ihdr.width, height: ihdr.height, rgba };
}
