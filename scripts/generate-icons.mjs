// Render every bitmap from the same SVG. Uses the same local browser setup as ui-e2e.mjs.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { crc32, deflateSync, inflateSync } from "node:zlib";
const { chromium } = createRequire(
  resolve(
    process.env.FABRICWORLD_CHECKOUT ||
      resolve(import.meta.dirname, "../../FabricWorld"),
    "web/package.json",
  ),
)("playwright");
const publicDir = resolve(import.meta.dirname, "../web/public");
const source = await readFile(resolve(publicDir, "favicon.svg"), "utf8");
// Canvas prioritizes encoding speed. Recompress its IDAT stream losslessly for smaller downloads.
function compressPNG(png) {
  const chunks = [];
  const imageData = [];
  for (let offset = 8; offset < png.length; ) {
    const size = png.readUInt32BE(offset);
    const chunk = png.subarray(offset, offset + size + 12);
    if (chunk.toString("ascii", 4, 8) === "IDAT")
      imageData.push(chunk.subarray(8, 8 + size));
    else chunks.push(chunk);
    offset += size + 12;
  }
  const data = deflateSync(inflateSync(Buffer.concat(imageData)), { level: 9 });
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("IDAT", 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([
    png.subarray(0, 8),
    ...chunks.slice(0, -1),
    chunk,
    chunks.at(-1),
  ]);
}
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || "chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  for (const [name, size, fullBleed] of [
    ["favicon-32.png", 32, false],
    ["apple-touch-icon.png", 180, true],
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ]) {
    const png = await page.evaluate(
      async ({ source, size, fullBleed }) => {
        const svg = new DOMParser().parseFromString(source, "image/svg+xml");
        if (svg.querySelector("parsererror"))
          throw new Error("Invalid icon SVG");
        // iOS and Android apply their own silhouettes; fill the entire tile for those icons.
        if (fullBleed) svg.querySelector("#tile").setAttribute("rx", "0");
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        });
        const url = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          canvas.getContext("2d").drawImage(image, 0, 0, size, size);
          return canvas.toDataURL("image/png").split(",")[1];
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      { source, size, fullBleed },
    );
    await writeFile(
      resolve(publicDir, name),
      compressPNG(Buffer.from(png, "base64")),
    );
    console.log(`Generated ${name} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
