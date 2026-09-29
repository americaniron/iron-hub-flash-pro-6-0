/**
 * Paste and spreadsheet imports.
 *
 * These bypassed part-number validation entirely: the same legacy strategies that returned
 * "25 LBS" and "SUMMARY OF CHARGES" from a PDF could still do it from pasted text, because only
 * the PDF entry point was guarded. The two paths are guarded differently on purpose — see the
 * `requireFamilyMatch` note in services/parser/validate.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadParserService } from './support/harness.mjs';

const parser = await loadParserService();
const validate = await loadModule('services/parser/validate.ts');

test('pasted text with a real part number imports unchanged', () => {
  const { items } = parser.parseTextData('2 539-0546 Transmission Gasket Kit 2086.82');
  assert.equal(items.length, 1);
  assert.equal(items[0].partNo, '539-0546');
  assert.equal(items[0].qty, 2);
  assert.equal(items[0].unitPrice, 2086.82);

  const reman = parser.parseTextData('1 10R-7672 REMAN INJECTOR 526.73');
  assert.equal(reman.items[0].partNo, '10R-7672');
});

test('the paste path no longer turns a description into a part number', () => {
  // This is the real bug, reproduced on the path that had no guard at all: the legacy strategy
  // reads the first word of the description as the part number, exactly as it did on the
  // IRON HUB invoice where it returned "HYDRAULIC". It is now refused with the reason named.
  assert.throws(
    () => parser.parseTextData('1 HYDRAULIC CONTROL VALVE 24.46'),
    (error) => {
      assert.match(error.message, /HYDRAULIC/);
      assert.match(error.message, /matches no known part-number family/);
      return true;
    },
  );
});

test('a paste that yields nothing at all is not reported as a rejection', () => {
  // No candidates is different from candidates that were refused; only the second names them.
  const { items } = parser.parseTextData('');
  assert.deepEqual(items, []);
});

test('a declared spreadsheet part number survives a family mismatch', () => {
  // Aftermarket catalogues use shapes no Caterpillar family matches. The user mapped the column
  // and said it is the part number; refusing it would break a working import.
  const { accepted, warnings } = validate.validateItems(
    [{ partNo: 'P551670', desc: 'Fuel filter', unitPrice: 18.4 }],
    { requireFamilyMatch: false },
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].partNo, 'P551670');
  assert.match(warnings.join(' '), /does not match a known part-number family/);
});

test('relaxing the family rule does not relax the shape vetoes', () => {
  // A weight, a price or a heading in the part-number column is still refused, declared or not.
  const { accepted, rejected } = validate.validateItems(
    [
      { partNo: '25 LBS', desc: '', unitPrice: 1 },
      { partNo: '$24.46', desc: '', unitPrice: 1 },
      { partNo: 'SUMMARY OF CHARGES', desc: '', unitPrice: 1 },
      { partNo: 'FG-1234-A', desc: 'Aftermarket', unitPrice: 1 },
    ],
    { requireFamilyMatch: false },
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].partNo, 'FG-1234-A');
  assert.equal(rejected.length, 3);
});

test('inferred sources still require a family match', () => {
  const { accepted, rejected } = validate.validateItems(
    [{ partNo: 'P551670', desc: 'Fuel filter', unitPrice: 18.4 }],
    { requireFamilyMatch: true },
  );
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 1);
});

test('every import path is guarded, not just the PDF one', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { repoRoot } = await import('./support/harness.mjs');
  const src = fs.readFileSync(path.join(repoRoot, 'services/parserService.ts'), 'utf8');
  assert.match(src, /parseTextData[\s\S]{0,900}validateItems\(result\.items, \{ requireFamilyMatch: true \}\)/);
  assert.match(src, /validateItems\(rows, \{ requireFamilyMatch: false \}\)/);
});
