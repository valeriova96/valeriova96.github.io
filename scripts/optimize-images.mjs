#!/usr/bin/env node
import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { resolve, dirname, extname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = join(REPO_ROOT, 'public');
const BOOKS_JSON = join(PUBLIC_DIR, 'files', 'books.json');
const LOGO_SRC = join(PUBLIC_DIR, 'images', 'logo.png');

const BOOK_COVER_MAX_WIDTH = 400;
const BOOK_COVER_JPG_QUALITY = 78;

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function optimizeBookCovers() {
  console.log('\n== Pass 1: book covers ==');
  const raw = await readFile(BOOKS_JSON, 'utf8');
  const books = JSON.parse(raw);
  let mutated = false;

  for (const book of books) {
    if (!book.image) continue;
    const relPath = book.image.replace(/^\/+/, '');
    const absPath = join(PUBLIC_DIR, relPath);

    if (!(await fileExists(absPath))) {
      console.warn(`  SKIP (missing): ${relPath}`);
      continue;
    }

    const ext = extname(absPath).toLowerCase();
    const isPng = ext === '.png';
    const targetExt = isPng ? '.jpg' : ext;
    const targetAbs = isPng
      ? join(dirname(absPath), basename(absPath, ext) + '.jpg')
      : absPath;

    const buf = await sharp(absPath)
      .resize({ width: BOOK_COVER_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: BOOK_COVER_JPG_QUALITY, mozjpeg: true })
      .toBuffer();

    await writeFile(targetAbs, buf);
    if (isPng) {
      await unlink(absPath);
      const newRel = relPath.replace(/\.png$/i, '.jpg');
      book.image = newRel.startsWith('images/') ? newRel : `images/${basename(targetAbs)}`;
      mutated = true;
      console.log(`  ${relPath} → ${book.image} (${(buf.length / 1024).toFixed(1)} KB)`);
    } else {
      console.log(`  ${relPath} → overwritten (${(buf.length / 1024).toFixed(1)} KB)`);
    }
  }

  if (mutated) {
    await writeFile(BOOKS_JSON, JSON.stringify(books, null, 2) + '\n');
    console.log('  books.json updated.');
  }
}

async function generateFavicons() {
  console.log('\n== Pass 2: favicon set ==');
  if (!(await fileExists(LOGO_SRC))) {
    console.warn(`  SKIP: ${LOGO_SRC} not found. (Already deleted in a prior run?)`);
    return;
  }

  const favicon32 = await sharp(LOGO_SRC).resize(32, 32).png().toBuffer();
  await writeFile(join(PUBLIC_DIR, 'favicon-32.png'), favicon32);
  console.log(`  favicon-32.png (${(favicon32.length / 1024).toFixed(1)} KB)`);

  const apple = await sharp(LOGO_SRC).resize(180, 180).png().toBuffer();
  await writeFile(join(PUBLIC_DIR, 'apple-touch-icon.png'), apple);
  console.log(`  apple-touch-icon.png (${(apple.length / 1024).toFixed(1)} KB)`);

  // sharp's .ico encoder isn't built into the default install; emit a 32px PNG renamed .ico
  // as a fallback. Every modern browser accepts a PNG inside an .ico URL.
  await writeFile(join(PUBLIC_DIR, 'favicon.ico'), favicon32);
  console.log(`  favicon.ico (PNG payload, ${(favicon32.length / 1024).toFixed(1)} KB)`);
}

await optimizeBookCovers();
await generateFavicons();
console.log('\nDone.');
