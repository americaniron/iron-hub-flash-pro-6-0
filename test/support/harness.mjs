/**
 * Headless test harness.
 *
 * The parser is browser code: it is TypeScript, it imports the pdf.js worker through Vite's
 * `?url` suffix, and its image branch touches `document`.  None of that survives `node --test`,
 * which is why the parser had no tests and shipped a silent-corruption bug.  This module makes
 * the real source runnable under Node with no build step and no new dependency: TypeScript is
 * already a devDependency, so it is used to transpile on demand, and the browser-only edges are
 * shimmed rather than mocked away.
 *
 * `loadModule` is for the pure layout modules under services/parser — those need no shims.
 * `loadParserService` additionally rewrites the Vite/DOM edges so the legacy strategies and
 * `parsePdfFile` can be exercised end to end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cacheDir = path.join(repoRoot, 'node_modules', '.parser-harness');

const ts = (await import(pathToFileURL(path.join(repoRoot, 'node_modules/typescript/lib/typescript.js')).href))
  .default;

const pdfjsEntry = pathToFileURL(path.join(repoRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;
const pdfjsWorker = pathToFileURL(
  path.join(repoRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
).href;

/**
 * Transpile a TypeScript module and everything it imports into a cache directory.
 *
 * The whole graph has to go through TypeScript, not just the entry point.  Node 24 can load a
 * `.ts` file on its own, but its type stripping is purely syntactic: it erases annotations and
 * leaves `import { Column, cellText } from './geometry.ts'` intact, so importing an interface
 * blows up at runtime with "does not provide an export named 'Column'".  TypeScript's own emit
 * elides the type-only specifiers, which is exactly what is needed here.
 */
function transpileGraph(entryPath, rewriteSource) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const emitted = new Map();

  const cacheNameFor = (absolute) =>
    path.relative(repoRoot, absolute).replace(/[\\/]/g, '_').replace(/\.tsx?$/, '') + '.mjs';

  const emit = (absolute) => {
    if (emitted.has(absolute)) return emitted.get(absolute);
    const outName = cacheNameFor(absolute);
    const outPath = path.join(cacheDir, outName);
    emitted.set(absolute, outPath);

    let source = fs.readFileSync(absolute, 'utf8');
    if (rewriteSource) source = rewriteSource(source, absolute);

    // Rewrite each relative import to the cache copy of that module, emitting it first.
    source = source.replace(
      /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*)\2/g,
      (match, prefix, quote, spec) => {
        const target = path.resolve(path.dirname(absolute), spec);
        if (!fs.existsSync(target)) return match;
        emit(target);
        return `${prefix}${quote}./${cacheNameFor(target)}${quote}`;
      },
    );

    const js = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: absolute,
    }).outputText;
    fs.writeFileSync(outPath, js);
    return outPath;
  };

  return emit(entryPath);
}

/** Import a TypeScript module from the repo, with its whole local import graph transpiled. */
export async function loadModule(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  const out = transpileGraph(absolute);
  return import(pathToFileURL(out).href + '?v=' + Date.now());
}

/** Load services/parserService.ts with its Vite and DOM edges shimmed. */
export async function loadParserService() {
  installDomShims();
  const absolute = path.join(repoRoot, 'services/parserService.ts');
  const out = transpileGraph(absolute, (source, file) => {
    if (file !== absolute) return source;
    return source
      .replace(
        /^import\s+pdfWorkerUrl\s+from\s+['"][^'"]*\?url['"];?$/m,
        `const pdfWorkerUrl = ${JSON.stringify(pdfjsWorker)};`,
      )
      .replace(
        /import\(\s*['"]pdfjs-dist\/legacy\/build\/pdf\.mjs['"]\s*\)/g,
        `import(${JSON.stringify(pdfjsEntry)})`,
      );
  });
  return import(pathToFileURL(out).href + '?v=' + Date.now());
}

/**
 * Minimal browser surface.  `getContext()` returning null makes the image-extraction branch a
 * no-op, so snapshots never carry canvas output — the parser must produce identical line items
 * with and without images, and this keeps that honest.
 */
export function installDomShims() {
  if (globalThis.window) return;
  globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };
  globalThis.document = { createElement: () => ({ getContext: () => null, toDataURL: () => '' }) };
  globalThis.HTMLImageElement ??= class {};
  globalThis.HTMLCanvasElement ??= class {};
  globalThis.ImageBitmap ??= class {};
}

/** Build the parser's PageModel list straight from a PDF on disk, without the browser. */
export async function pageModelsFromPdf(pdfPath) {
  const pdfjs = await import(pdfjsEntry);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const [a, b, , , e, f] = item.transform;
      const fontSize = Math.hypot(a, b) || item.height || 9;
      const baselineFromTop = viewport.height - f;
      items.push({
        text: item.str,
        x0: e,
        x1: e + (item.width || 0),
        top: baselineFromTop - (item.height || fontSize),
        bottom: baselineFromTop,
        fontSize,
        fontName: item.fontName,
      });
    }
    pages.push({ pageNumber, width: viewport.width, height: viewport.height, items });
  }
  return pages;
}

/** File object for the browser-shaped `parsePdfFile` entry point. */
export function fileFromPath(pdfPath) {
  return new File([fs.readFileSync(pdfPath)], path.basename(pdfPath), { type: 'application/pdf' });
}
