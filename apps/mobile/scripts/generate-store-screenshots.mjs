#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, '..');
const inputPath = join(mobileDir, 'store-assets', 'screenshots', 'scenes.json');
const outputDir = join(mobileDir, 'store-assets', 'screenshots', 'generated');
const manifestPath = join(outputDir, 'manifest.json');
const { product, subtitle, scenes, sizes } = JSON.parse(readFileSync(inputPath, 'utf8'));

mkdirSync(outputDir, { recursive: true });

const escapeXml = (value = '') => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const wrap = (text, maxChars) => {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
};
const textLines = (lines, x, y, size, color, weight = 500, lineHeight = Math.round(size * 1.22), anchor = 'start') => lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(line)}</text>`).join('\n');

function screenshotSvg(scene, size, index) {
  const { width, height } = size;
  const scale = width / 1290;
  const top = 190 * scale;
  const margin = 96 * scale;
  const headlineSize = Math.max(52, 74 * scale);
  const phoneW = width * 0.72;
  const phoneH = Math.min(height * 0.58, phoneW * 1.95);
  const phoneX = (width - phoneW) / 2;
  const phoneY = height - phoneH - 120 * scale;
  const cardX = phoneX + phoneW * 0.11;
  const cardY = phoneY + phoneH * 0.18;
  const cardW = phoneW * 0.78;
  const badgeY = cardY + phoneH * 0.36;
  const bodyLines = wrap(scene.body, 34).slice(0, 5);
  const headlineLines = wrap(scene.headline, 24).slice(0, 2);
  const footerLines = wrap(scene.footer, 42).slice(0, 2);
  const badgeEls = scene.badges.map((badge, i) => {
    const bx = cardX + 38 * scale + (i % 2) * cardW * 0.43;
    const by = badgeY + Math.floor(i / 2) * 54 * scale;
    const bw = Math.min(cardW * 0.38, 120 * scale + badge.length * 13 * scale);
    return `<rect x="${bx}" y="${by}" width="${bw}" height="38" rx="19" fill="#FEF3C7"/><text x="${bx + 18 * scale}" y="${by + 25}" fill="#92400E" font-size="${22 * scale}" font-weight="700">${escapeXml(badge)}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#0F172A"/><stop offset="0.55" stop-color="#1E3A8A"/><stop offset="1" stop-color="#F59E0B"/></linearGradient>
    <linearGradient id="phone" x1="0" x2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#020617"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="28" stdDeviation="32" flood-color="#020617" flood-opacity="0.35"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${width * 0.12}" cy="${height * 0.12}" r="${width * 0.38}" fill="#60A5FA" opacity="0.18"/>
  <circle cx="${width * 0.92}" cy="${height * 0.7}" r="${width * 0.42}" fill="#FDE68A" opacity="0.2"/>
  <text x="${margin}" y="${top}" fill="#FDE68A" font-size="${28 * scale}" font-weight="800" letter-spacing="3">${escapeXml(product.toUpperCase())}</text>
  ${textLines(headlineLines, margin, top + 90 * scale, headlineSize, '#FFFFFF', 900, headlineSize * 1.08)}
  <text x="${margin}" y="${top + 95 * scale + headlineLines.length * headlineSize * 1.08}" fill="#DBEAFE" font-size="${30 * scale}" font-weight="500">${escapeXml(subtitle)}</text>
  <rect x="${phoneX}" y="${phoneY}" width="${phoneW}" height="${phoneH}" rx="${80 * scale}" fill="url(#phone)" filter="url(#shadow)"/>
  <rect x="${phoneX + 24 * scale}" y="${phoneY + 24 * scale}" width="${phoneW - 48 * scale}" height="${phoneH - 48 * scale}" rx="${60 * scale}" fill="#F8FAFC"/>
  <rect x="${phoneX + phoneW * 0.37}" y="${phoneY + 44 * scale}" width="${phoneW * 0.26}" height="${20 * scale}" rx="${10 * scale}" fill="#020617" opacity="0.82"/>
  <text x="${cardX}" y="${phoneY + phoneH * 0.12}" fill="#64748B" font-size="${23 * scale}" font-weight="800" letter-spacing="2">${escapeXml(scene.kicker.toUpperCase())}</text>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${phoneH * 0.58}" rx="${34 * scale}" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="2"/>
  <text x="${cardX + 38 * scale}" y="${cardY + 72 * scale}" fill="#0F172A" font-size="${38 * scale}" font-weight="850">${escapeXml(scene.screenTitle)}</text>
  ${textLines(bodyLines, cardX + 38 * scale, cardY + 128 * scale, 25 * scale, '#334155', 500, 35 * scale)}
  ${badgeEls}
  <rect x="${cardX + 38 * scale}" y="${cardY + phoneH * 0.45}" width="${cardW - 76 * scale}" height="${76 * scale}" rx="${24 * scale}" fill="#F59E0B"/>
  <text x="${cardX + cardW / 2}" y="${cardY + phoneH * 0.45 + 49 * scale}" fill="#111827" font-size="${27 * scale}" font-weight="850" text-anchor="middle">${escapeXml(scene.primaryAction)}</text>
  <rect x="${cardX + 38 * scale}" y="${cardY + phoneH * 0.45 + 96 * scale}" width="${cardW - 76 * scale}" height="${68 * scale}" rx="${22 * scale}" fill="#F1F5F9"/>
  <text x="${cardX + cardW / 2}" y="${cardY + phoneH * 0.45 + 139 * scale}" fill="#334155" font-size="${25 * scale}" font-weight="800" text-anchor="middle">${escapeXml(scene.secondaryAction)}</text>
  ${textLines(footerLines, cardX + 38 * scale, cardY + phoneH * 0.58 - 42 * scale, 21 * scale, '#64748B', 600, 27 * scale)}
  <text x="${width - margin}" y="${height - 60 * scale}" fill="#FFFFFF" opacity="0.72" font-size="${24 * scale}" text-anchor="end">${String(index + 1).padStart(2, '0')} / ${scenes.length}</text>
</svg>`;
}

const magick = spawnSync('magick', ['-version'], { encoding: 'utf8' });
const canRenderPng = magick.status === 0;
const manifest = { generatedAt: new Date().toISOString(), input: inputPath, pngRenderer: canRenderPng ? 'magick' : null, files: [] };

for (let i = 0; i < scenes.length; i += 1) {
  for (const size of sizes) {
    const scene = scenes[i];
    const base = `${String(i + 1).padStart(2, '0')}-${scene.id}-${size.id}-${size.width}x${size.height}`;
    const svgPath = join(outputDir, `${base}.svg`);
    const pngPath = join(outputDir, `${base}.png`);
    writeFileSync(svgPath, screenshotSvg(scene, size, i));
    const entry = { scene: scene.id, size: size.id, label: size.label, width: size.width, height: size.height, svg: svgPath };
    if (canRenderPng) {
      const result = spawnSync('magick', [svgPath, '-strip', pngPath], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`magick failed for ${svgPath}: ${result.stderr || result.stdout}`);
      }
      entry.png = pngPath;
    }
    manifest.files.push(entry);
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${manifest.files.length} screenshot exports in ${outputDir}`);
console.log(canRenderPng ? 'PNG renderer: magick' : 'PNG renderer unavailable; SVG exports only');
