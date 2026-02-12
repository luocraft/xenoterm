const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '..', 'resources', 'icon.svg');
const outDir = path.join(__dirname, '..', 'resources');

async function main() {
  const svgBuffer = fs.readFileSync(svgPath);

  // Generate 512x512 PNG
  await sharp(svgBuffer, { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon.png'));
  console.log('✓ icon.png (512x512)');

  // Generate 256x256 PNG for ICO
  const png256 = await sharp(svgBuffer, { density: 300 })
    .resize(256, 256)
    .png()
    .toBuffer();
  console.log('✓ 256x256 buffer ready');

  // Build ICO file manually (single 256x256 PNG entry)
  const ico = buildIco([png256]);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log('✓ icon.ico (256x256)');

  console.log('\nDone! Files in resources/');
}

function buildIco(pngBuffers) {
  // ICO format: header (6 bytes) + entries (16 bytes each) + image data
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + entrySize * numImages;

  // Header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: 1 = ICO
  header.writeUInt16LE(numImages, 4);

  const entries = [];
  let currentOffset = dataOffset;

  for (const png of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(0, 0);           // width (0 = 256)
    entry.writeUInt8(0, 1);           // height (0 = 256)
    entry.writeUInt8(0, 2);           // color palette
    entry.writeUInt8(0, 3);           // reserved
    entry.writeUInt16LE(1, 4);        // color planes
    entry.writeUInt16LE(32, 6);       // bits per pixel
    entry.writeUInt32LE(png.length, 8);  // image size
    entry.writeUInt32LE(currentOffset, 12); // offset
    entries.push(entry);
    currentOffset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

main().catch(console.error);
