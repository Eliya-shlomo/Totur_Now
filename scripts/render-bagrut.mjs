#!/usr/bin/env node
/**
 * The bench fixture, one PNG per page — PR 6a.3, step one.
 *
 * `docs/fixtures/bagrut-50.pdf` is 50 merged Bagrut exam pages. This renders each one
 * to `docs/fixtures/bagrut-50/page-NN.png`, and **those PNGs are committed**. The bench
 * therefore reproduces on a machine that has never had a PDF renderer installed, and a
 * change in how a page is rasterised shows up as a diff in review rather than as a
 * quiet shift in next week's scores.
 *
 * ## Why a dependency, when the spec said to look for `pdftoppm` first
 *
 * It looked. `pdftotext.exe` is the only Poppler binary in this environment — no
 * `pdftoppm` beside it, and no `mutool`, `gs`, `magick` or PyMuPDF anywhere on the
 * PATH. So the choice was a dependency or a hand-installed binary that no teammate
 * would have, and the dependency wins because the PNGs are committed: `pdfjs-dist` and
 * `@napi-rs/canvas` are needed to *change* the fixture, never to run the bench.
 *
 * ## Why the Hebrew is pixels and not text
 *
 * Because it cannot be anything else. The embedded fonts carry no `ToUnicode` map, so
 * `pdftotext -layout` returns digits, Latin and whitespace with zero Hebrew codepoints
 * under UTF-8, CP1255, CP1252 and Latin-1. Building a text fixture would need a vision
 * pass in the middle, which puts an LLM between the test and the thing under test.
 *
 * Images are also the honest fixture: students photograph their exercises, which is
 * §4.1's premise and 6a.2's whole subject.
 *
 * ## The width
 *
 * `RENDER_WIDTH` is 1600 because that is where the pipeline lands anyway.
 * `CLOUDINARY_CLASSIFICATION_TRANSFORM` is `f_jpg,q_auto,w_1600`, so 6a.2 hands Gemini
 * a 1600-wide JPEG however large the upload was. Rendering wider would inflate the
 * committed fixture to buy pixels Cloudinary throws away before the model sees them.
 *
 *   node scripts/render-bagrut.mjs [--pdf <path>] [--out <dir>] [--width <px>] [--page N]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

// pdf.js reaches for these three as globals while it builds a page, and Node has none
// of them. They are assigned before the library is imported, because the legacy build
// captures what it finds at module evaluation time — assigning them afterwards leaves
// it holding the `undefined` it already read.
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PDF = resolve(ROOT, 'docs/fixtures/bagrut-50.pdf');
const DEFAULT_OUT = resolve(ROOT, 'docs/fixtures/bagrut-50');
const RENDER_WIDTH = 1600;

const args = parseArgs(process.argv.slice(2));
const pdfPath = args.pdf ? resolve(args.pdf) : DEFAULT_PDF;
const outDir = args.out ? resolve(args.out) : DEFAULT_OUT;
const width = Number(args.width ?? RENDER_WIDTH);
const onlyPage = args.page ? Number(args.page) : null;

await main();

async function main() {
  const bytes = await readFile(pdfPath).catch(() => {
    die(`cannot read ${pdfPath}`);
  });

  // `isEvalSupported: false` because a fixture renderer has no business compiling font
  // programs with `eval`, and the worker is disabled because there is no second thread
  // worth starting for 50 pages run once.
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await task.promise;

  await mkdir(outDir, { recursive: true });

  say(`${doc.numPages} pages in ${pdfPath}`);

  const pages = onlyPage ? [onlyPage] : range(1, doc.numPages);
  let written = 0;

  for (const pageNumber of pages) {
    const page = await doc.getPage(pageNumber);
    // Scale from the page's own width so a fixture of mixed page sizes still comes out
    // at one width. Height follows whatever the page's aspect ratio is.
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / unscaled.width });

    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');

    // White first. A PDF page paints no background, and a transparent PNG flattened
    // against black is a page of unreadable dark-on-dark for whoever reviews it — and
    // for the model, which is the same problem with worse consequences.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const file = resolve(outDir, `page-${String(pageNumber).padStart(2, '0')}.png`);
    await writeFile(file, canvas.toBuffer('image/png'));

    written += 1;
    say(`page ${pageNumber} → ${canvas.width}×${canvas.height}`);
    page.cleanup();
  }

  // The loading task owns the teardown, not the document — `doc.destroy` does not
  // exist in pdf.js 6, and without this the process hangs on an idle worker port.
  await task.destroy();
  say(`${written} PNGs in ${outDir}`);
}

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const next = argv[i + 1];

    if (next === undefined || next.startsWith('--')) {
      parsed[token.slice(2)] = true;
    } else {
      parsed[token.slice(2)] = next;
      i += 1;
    }
  }

  return parsed;
}

function say(message) {
  console.log(`  ${message}`);
}

function die(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}
