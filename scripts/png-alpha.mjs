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
      interlace: data[12],
    };
  } else if (type === "IDAT") {
    idat.push(data);
  }
  pos += 12 + len;
}

const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
const bpp = channels * (ihdr.bitDepth / 8);
const stride = ihdr.width * bpp;
const raw = zlib.inflateSync(Buffer.concat(idat));

const out = Buffer.alloc(ihdr.height * stride);
for (let y = 0; y < ihdr.height; y++) {
  const filter = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[y * stride + x - bpp] : 0;
    const b = y > 0 ? out[(y - 1) * stride + x] : 0;
    const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
    let v = line[x];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[y * stride + x] = v & 0xff;
  }
}

let opaque = 0;
let transparent = 0;
let whiteOpaque = 0;
const corners = [];
for (let y = 0; y < ihdr.height; y++) {
  for (let x = 0; x < ihdr.width; x++) {
    const i = y * stride + x * bpp;
    const [r, g, b, a] = [out[i], out[i + 1], out[i + 2], out[i + 3]];
    if (a === 0) transparent++;
    else {
      opaque++;
      if (r > 235 && g > 235 && b > 235) whiteOpaque++;
    }
  }
}
for (const [x, y] of [
  [0, 0],
  [ihdr.width - 1, 0],
  [0, ihdr.height - 1],
  [ihdr.width - 1, ihdr.height - 1],
  [ihdr.width >> 1, ihdr.height >> 1],
]) {
  const i = y * stride + x * bpp;
  corners.push(`(${x},${y}) rgba(${out[i]},${out[i + 1]},${out[i + 2]},${out[i + 3]})`);
}

console.log(ihdr);
console.log({ total: ihdr.width * ihdr.height, opaque, transparent, whiteOpaque });
console.log(corners.join("\n"));
