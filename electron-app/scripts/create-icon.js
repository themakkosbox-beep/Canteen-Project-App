'use strict';

const fs = require('fs');
const path = require('path');

const width = 256;
const height = 256;

const xorSize = width * height * 4;
const andRowSize = Math.ceil(width / 32) * 4;
const andSize = andRowSize * height;

const colorFromHex = (hex) => {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    a: 0xff,
  };
};

const colors = {
  border: colorFromHex('31465A'),
  panel: colorFromHex('1F2A36'),
  monitorFrame: colorFromHex('F3F5F8'),
  monitorGlow: colorFromHex('E6EEF5'),
  monitorScreen: colorFromHex('172330'),
  monitorStand: colorFromHex('233244'),
  accent: colorFromHex('3EC5D3'),
  accentSoft: colorFromHex('6FE7F0'),
};

const xorBitmap = Buffer.alloc(xorSize, 0);

const setPixel = (x, y, color) => {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }
  const offset = (y * width + x) * 4;
  xorBitmap[offset + 0] = color.b;
  xorBitmap[offset + 1] = color.g;
  xorBitmap[offset + 2] = color.r;
  xorBitmap[offset + 3] = color.a;
};

const fillRect = (x, y, w, h, color) => {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      setPixel(xx, yy, color);
    }
  }
};

const fillRoundedRect = (x, y, w, h, radius, color) => {
  const innerX0 = x + radius;
  const innerX1 = x + w - radius - 1;
  const innerY0 = y + radius;
  const innerY1 = y + h - radius - 1;

  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const cx = xx + 0.5;
      const cy = yy + 0.5;
      let dx = 0;
      if (cx < innerX0) {
        dx = innerX0 - cx;
      } else if (cx > innerX1) {
        dx = cx - innerX1;
      }
      let dy = 0;
      if (cy < innerY0) {
        dy = innerY0 - cy;
      } else if (cy > innerY1) {
        dy = cy - innerY1;
      }
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(xx, yy, color);
      }
    }
  }
};

const drawCircle = (cx, cy, radius, thickness, color) => {
  const start = -Math.PI / 3;
  const end = Math.PI / 3;
  for (let angle = start; angle <= end; angle += Math.PI / 360) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let t = 0; t < thickness; t += 1) {
      const r = radius - thickness / 2 + t;
      const x = Math.round(cx + cos * r);
      const y = Math.round(cy + sin * r);
      setPixel(x, y, color);
    }
  }
};

// Background
fillRect(0, 0, width, height, colors.border);
fillRoundedRect(24, 24, 208, 184, 44, colors.panel);

// Monitor frame
fillRoundedRect(84, 70, 88, 66, 14, colors.monitorStand);
fillRoundedRect(90, 76, 76, 46, 12, colors.monitorFrame);
fillRoundedRect(96, 84, 64, 34, 8, colors.monitorScreen);
fillRoundedRect(102, 90, 52, 6, 3, colors.accent);
fillRoundedRect(102, 100, 38, 6, 3, colors.accentSoft);

// Stand and base
fillRect(120, 134, 16, 18, colors.monitorStand);
fillRoundedRect(96, 148, 64, 36, 12, colors.monitorStand);
fillRect(108, 160, 16, 12, colors.monitorFrame);
fillRect(132, 160, 16, 12, colors.monitorFrame);
fillRoundedRect(118, 166, 20, 8, 4, colors.monitorScreen);
fillRoundedRect(116, 172, 24, 8, 4, colors.monitorFrame);
fillRoundedRect(124, 178, 8, 8, 4, colors.accent);

// Contactless waves
drawCircle(172, 110, 34, 8, colors.accent);
drawCircle(172, 110, 50, 8, colors.accentSoft);
drawCircle(172, 110, 66, 8, colors.accent);

const andBitmap = Buffer.alloc(andSize);

const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);
iconDir.writeUInt16LE(1, 2);
iconDir.writeUInt16LE(1, 4);

const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);
bmpHeader.writeInt32LE(width, 4);
bmpHeader.writeInt32LE(height * 2, 8);
bmpHeader.writeUInt16LE(1, 12);
bmpHeader.writeUInt16LE(32, 14);
bmpHeader.writeUInt32LE(0, 16);
bmpHeader.writeUInt32LE(xorSize, 20);

const imageData = Buffer.concat([bmpHeader, xorBitmap, andBitmap]);

const entry = Buffer.alloc(16);
entry[0] = 0;
entry[1] = 0;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(imageData.length, 8);
entry.writeUInt32LE(iconDir.length + entry.length, 12);

const iconBuffer = Buffer.concat([iconDir, entry, imageData]);

const outputPath = path.resolve(__dirname, '..', 'assets', 'app-icon.ico');
fs.writeFileSync(outputPath, iconBuffer);

console.log(`Icon written to ${outputPath}`);
