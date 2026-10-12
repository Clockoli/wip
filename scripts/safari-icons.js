import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const project = process.argv[2];
if (!project) throw new Error('Usage: node scripts/safari-icons.js PROJECT_DIRECTORY');
const svg = await readFile(new URL('../src/assets/clockoli.svg', import.meta.url), 'utf8');
const catalogs = [];
async function find(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (entry.name === 'AppIcon.appiconset') catalogs.push(child);
    else await find(child);
  }
}
await find(project);
if (!catalogs.length) throw new Error('Converter produced no AppIcon.appiconset');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const catalog of catalogs) {
    const images = [];
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = size * scale;
        const filename = `clockoli-${size}@${scale}x.png`;
        const base64 = await page.evaluate(async ({ svg, pixels }) => {
          const image = new Image();
          image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = pixels;
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, pixels, pixels);
          context.drawImage(image, 0, 0, pixels, pixels);
          return canvas.toDataURL('image/png').split(',')[1];
        }, { svg, pixels });
        await writeFile(path.join(catalog, filename), Buffer.from(base64, 'base64'));
        images.push({ idiom: 'mac', size: `${size}x${size}`, scale: `${scale}x`, filename });
      }
    }
    await writeFile(path.join(catalog, 'Contents.json'), `${JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2)}\n`);
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ catalogs: catalogs.length, largestIcon: 1024, source: 'src/assets/clockoli.svg' }));
