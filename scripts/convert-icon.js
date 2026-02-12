const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '..', 'resources', 'icon.svg');
const outDir = path.join(__dirname, '..', 'resources');

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const svgBuffer = fs.readFileSync(svgPath);

  // Generate 512x512 PNG
  await sharp(svgBuffer, { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon.png'));
  console.log('✓ icon.png (512x512)');

  // Generate multi-size PNG buffers for ICO
  const pngBuffers = [];
  for (const size of ICO_SIZES) {
    const buf = await sharp(svgBuffer, { density: 300 })
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(buf);
    console.log(`✓ ${size}x${size} buffer ready`);
  }

  // Build ICO file with all sizes
  const ico = buildIco(pngBuffers, ICO_SIZES);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log('✓ icon.ico (multi-size)');

  console.log('\nDone! Files in resources/');
}

function buildIco(pngBuffers, sizes) {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + entrySize * numImages;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(numImages, 4);

  const entries = [];
  let currentOffset = dataOffset;

  for (let i = 0; i < pngBuffers.length; i++) {
    const png = pngBuffers[i];
    const size = sizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(currentOffset, 12);
    entries.push(entry);
    currentOffset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

main().catch(console.error);
