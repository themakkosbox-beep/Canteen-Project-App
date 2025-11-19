const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const pngToIcoFunc = pngToIco.default || pngToIco;

async function generate() {
  const root = path.resolve(__dirname, '..');
  const svgPath = path.join(root, 'assets', 'logo.svg');
  if (!fs.existsSync(svgPath)) {
    console.error('svg not found:', svgPath);
    process.exit(1);
  }

  const sizes = [16, 32, 48, 64, 128, 256];
  const tmpDir = path.join(root, 'tmp-icon');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  const pngPaths = [];
  for (const size of sizes) {
    const out = path.join(tmpDir, `icon-${size}.png`);
    // Render SVG to PNG at desired size.
    await sharp(svgPath)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(out);
    pngPaths.push(out);
  }

  const icoBuffer = await pngToIcoFunc(pngPaths);
  const icoPath = path.join(root, 'app-icon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('Written ico to', icoPath);

  // cleanup tmp
  try {
    pngPaths.forEach((p) => fs.unlinkSync(p));
    fs.rmdirSync(tmpDir);
  } catch (err) {
    // non-fatal
  }
}

generate().catch((err) => {
  console.error('Failed to generate icon:', err);
  process.exit(1);
});
