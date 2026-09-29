#!/usr/bin/env node
/**
 * Run the old and new parsers over the same PDF(s) and print the disagreements.
 *
 * Intended for validating this branch against real incoming quotes before anything is promoted.
 * The "old" side is read straight out of git at a chosen ref, so it is genuinely the shipped
 * code and not a copy that can drift.
 *
 *   node scripts/compare-parsers.mjs <file-or-directory>...
 *   node scripts/compare-parsers.mjs --ref <git-ref> <file>...     (default: the rollback tag)
 *   node scripts/compare-parsers.mjs --json <file>...              (machine-readable)
 *
 * Exit code is 0 whether or not the parsers agree — disagreement is the signal, not an error.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REF = 'pre-layout-parser-20260901';

const argv = process.argv.slice(2);
let ref = DEFAULT_REF;
let asJson = false;
const targets = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ref') ref = argv[++i];
  else if (argv[i] === '--json') asJson = true;
  else targets.push(argv[i]);
}
if (!targets.length) {
  console.error('usage: node scripts/compare-parsers.mjs [--ref <git-ref>] [--json] <file-or-dir>...');
  process.exit(2);
}

// pdf.js logs a standardFontDataUrl warning for every page it renders without bundled fonts.
// It is harmless and it drowns out anything that actually matters, so it is filtered here.
const realWarn = console.warn;
console.warn = (...args) => {
  const first = String(args[0] ?? '');
  if (/standardFontDataUrl|Indexing all PDF objects/.test(first)) return;
  realWarn(...args);
};

const { installIdentityCanvasShims, loadParserService, fileFromPath } = await import(
  pathToFileURL(path.join(repoRoot, 'test/support/harness.mjs')).href
);
installIdentityCanvasShims();

const ts = (await import(pathToFileURL(path.join(repoRoot, 'node_modules/typescript/lib/typescript.js')).href)).default;
const pdfjsWorker = pathToFileURL(path.join(repoRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href;
const pdfjsEntry = pathToFileURL(path.join(repoRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;

/** Build the parser as it existed at `ref`, straight from git. */
async function loadParserAtRef(gitRef) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${gitRef}^{commit}`], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    die(`unknown git ref "${gitRef}". The default baseline is the rollback tag ${DEFAULT_REF}.`);
  }
  const source = execFileSync('git', ['show', `${gitRef}:services/parserService.ts`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const patched = source
    .replace(/^import\s+pdfWorkerUrl\s+from\s+['"][^'"]*\?url['"];?$/m, `const pdfWorkerUrl = ${JSON.stringify(pdfjsWorker)};`)
    .replace(/^import\s*\{[^}]*\}\s*from\s*['"]\.\.\/types\.ts['"];?$/m, '')
    .replace(/^import\s*\{\s*readSpreadsheetRows\s*\}[^;]*;?$/m, 'const readSpreadsheetRows = async () => { throw new Error("n/a"); };')
    .replace(/import\(\s*['"]pdfjs-dist\/legacy\/build\/pdf\.mjs['"]\s*\)/g, `import(${JSON.stringify(pdfjsEntry)})`);
  const outDir = path.join(repoRoot, 'node_modules', '.parser-harness');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `parserService.at-${gitRef.replace(/[^\w.-]/g, '_')}.mjs`);
  fs.writeFileSync(out, ts.transpileModule(patched, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  return import(pathToFileURL(out).href);
}

/** Fail with a readable message on stderr and a non-zero exit, never a raw stack trace. */
function die(message) {
  console.error(`compare-parsers: ${message}`);
  process.exit(2);
}

/**
 * Resolve the arguments to a list of PDFs.
 *
 * Every failure here used to be an unhandled statSync throw.  With stdout redirected to a file
 * that produced a stack trace on screen and a zero-byte JSON file, which reads exactly like the
 * parser failing on every document when in fact nothing had been parsed at all.
 */
function collectPdfs(entries) {
  const files = [];
  for (const entry of entries) {
    const resolved = path.resolve(entry.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!fs.existsSync(resolved)) {
      die(`no such file or directory: ${entry}\n  Pass the real path to a PDF, or to a folder containing PDFs.`);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      const pdfs = fs.readdirSync(resolved).filter((n) => n.toLowerCase().endsWith('.pdf')).sort();
      if (!pdfs.length) die(`no .pdf files in ${entry}`);
      for (const name of pdfs) files.push(path.join(resolved, name));
    } else if (!resolved.toLowerCase().endsWith('.pdf')) {
      die(`not a PDF: ${entry}`);
    } else {
      files.push(resolved);
    }
  }
  if (!files.length) die('nothing to compare');
  return files;
}

async function run(parser, file) {
  try {
    const result = await parser.parsePdfFile(fileFromPath(file));
    return {
      ok: true,
      items: result.items.map((i) => ({
        partNo: i.partNo ?? '',
        qty: i.qty,
        unitPrice: i.unitPrice,
        desc: i.desc ?? '',
      })),
      // Only the new parser reports these.
      reconciliation: result.reconciliation ?? null,
      warnings: result.warnings ?? [],
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), items: [] };
  }
}

const oldParser = await loadParserAtRef(ref);
const newParser = await loadParserService();

const report = [];
for (const file of collectPdfs(targets)) {
  const before = await run(oldParser, file);
  const after = await run(newParser, file);
  const key = (i) => `${i.partNo}|${i.qty}|${i.unitPrice}`;
  const beforeKeys = before.items.map(key);
  const afterKeys = after.items.map(key);
  const identical = beforeKeys.length === afterKeys.length && beforeKeys.every((k, i) => k === afterKeys[i]);
  report.push({ file, before, after, identical });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  console.error(`compare-parsers: wrote ${report.length} result(s) to stdout.`);
} else {
  for (const entry of report) {
    console.log(`\n=== ${path.basename(entry.file)} ===`);
    const show = (label, side) => {
      if (!side.ok) {
        console.log(`  ${label}: FAILED — ${side.error}`);
        return;
      }
      console.log(`  ${label}: ${side.items.length} item(s)`);
      for (const i of side.items) {
        console.log(`      ${(i.partNo || '(blank)').padEnd(14)} qty=${String(i.qty).padEnd(4)} unit=${String(i.unitPrice).padEnd(10)} ${i.desc.slice(0, 46)}`);
      }
    };
    show(`old (${ref})`, entry.before);
    show('new (this branch)', entry.after);
    console.log(`  --> ${entry.identical ? 'AGREE' : 'DISAGREE'}`);
    if (entry.after.reconciliation) {
      const r = entry.after.reconciliation;
      console.log(`  reconciliation: itemsTotal=${r.itemsTotal} balanced=${r.balanced}`);
    }
    for (const warning of entry.after.warnings ?? []) console.log(`  ! ${warning}`);
  }
  const disagreements = report.filter((r) => !r.identical).length;
  console.log(`\n${report.length} file(s) compared, ${disagreements} disagreement(s). Review each before promoting.`);
}
