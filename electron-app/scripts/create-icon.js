'use strict';

const fs = require('fs');
const path = require('path');

const width = 256;
const height = 256;

const xorSize = width * height * 4;
const andRowSize = Math.ceil(width / 32) * 4;
const andSize = andRowSize * height;

const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0); // reserved
iconDir.writeUInt16LE(1, 2); // type: icon
iconDir.writeUInt16LE(1, 4); // count

const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0); // biSize
bmpHeader.writeInt32LE(width, 4); // biWidth
bmpHeader.writeInt32LE(height * 2, 8); // biHeight includes XOR + AND
bmpHeader.writeUInt16LE(1, 12); // biPlanes
bmpHeader.writeUInt16LE(32, 14); // biBitCount
bmpHeader.writeUInt32LE(0, 16); // biCompression (BI_RGB)
bmpHeader.writeUInt32LE(xorSize, 20); // biSizeImage

const xorBitmap = Buffer.alloc(xorSize);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    xorBitmap[offset + 0] = 0xB0; // B
    xorBitmap[offset + 1] = 0x6C; // G
    xorBitmap[offset + 2] = 0x2B; // R
    xorBitmap[offset + 3] = 0xFF; // A
  }
}

const andBitmap = Buffer.alloc(andSize); // all zeros -> fully opaque mask

const imageData = Buffer.concat([bmpHeader, xorBitmap, andBitmap]);

const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 stored as 0
entry[1] = 0; // height 256 stored as 0
entry[2] = 0; // color count
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bit count
entry.writeUInt32LE(imageData.length, 8); // bytes in resource
entry.writeUInt32LE(iconDir.length + entry.length, 12); // image offset

const iconBuffer = Buffer.concat([iconDir, entry, imageData]);

const outputPath = path.resolve(__dirname, '..', 'assets', 'app-icon.ico');
fs.writeFileSync(outputPath, iconBuffer);

console.log(`Icon written to ${outputPath}`);
