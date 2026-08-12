import fs from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2];
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
    };
  } else if (type === "IDAT") idat.push(data);
  pos += 12 + len;
}

const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
const bpp = channels * (ihdr.bitDepth / 8);
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

// Per-row run spans of "mostly opaque" pixels, plus ASCII art.
for (let y = 0; y < ihdr.height; y++) {
  let art = "";
  const spans = [];
  let start = -1;
  for (let x = 0; x < ihdr.width; x++) {
    const a = out[y * stride + x * bpp + 3];
    art += a > 200 ? "#" : a > 60 ? "+" : ".";
    if (a > 128 && start < 0) start = x;
    if (a <= 128 && start >= 0) {
      spans.push([start, x - 1]);
      start = -1;
    }
  }
  if (start >= 0) spans.push([start, ihdr.width - 1]);
  console.log(String(y).padStart(2), art, JSON.stringify(spans));
}
