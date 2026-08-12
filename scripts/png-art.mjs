import { decodePng } from "./png-decode.mjs";

const { width, height, rgba } = decodePng(process.argv[2]);
console.log({ width, height });

const header = Array.from({ length: width }, (_, x) => (x % 10 === 0 ? String((x / 10) % 10) : " ")).join("");
console.log("   " + header);

for (let y = 0; y < height; y++) {
  let art = "";
  const spans = [];
  let start = -1;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    // "red" = clearly saturated red, not white/greyish
    const isRed = a > 128 && r > 120 && r - Math.max(g, b) > 60;
    const isWhite = a > 128 && r > 200 && g > 200 && b > 200;
    art += isRed ? "#" : isWhite ? "." : a > 128 ? "o" : " ";
    if (isRed && start < 0) start = x;
    if (!isRed && start >= 0) { spans.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) spans.push([start, width - 1]);
  console.log(String(y).padStart(2) + " " + art + " " + JSON.stringify(spans));
}
