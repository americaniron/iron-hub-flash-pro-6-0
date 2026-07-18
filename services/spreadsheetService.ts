const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;
const MAX_SPREADSHEET_ROWS = 10_000;
const SUPPORTED_EXTENSIONS = new Set(['csv', 'xls', 'xlsx']);

export type SpreadsheetRow = Record<string, unknown>;

function spreadsheetExtension(file: File): string {
  const match = file.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

function validateSpreadsheetFile(file: File): void {
  const extension = spreadsheetExtension(file);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Use a CSV, XLS, or XLSX spreadsheet.');
  }
  if (file.size <= 0 || file.size > MAX_SPREADSHEET_BYTES) {
    throw new Error('Spreadsheets must be between 1 byte and 10 MB.');
  }
}

export async function loadSpreadsheetLibrary() {
  return import('@e965/xlsx');
}

function safeCellValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return value == null ? null : String(value);
}

export async function readSpreadsheetRows(file: File): Promise<SpreadsheetRow[]> {
  validateSpreadsheetFile(file);
  const data = await file.arrayBuffer();
  const XLSX = await loadSpreadsheetLibrary();
  const workbook = XLSX.read(data, {
    type: 'array',
    cellFormula: false,
    cellHTML: false,
    sheetRows: MAX_SPREADSHEET_ROWS + 1,
  });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error('The spreadsheet does not contain a readable worksheet.');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
  if (rows.length > MAX_SPREADSHEET_ROWS) {
    throw new Error(`Spreadsheets are limited to ${MAX_SPREADSHEET_ROWS.toLocaleString()} data rows.`);
  }
  return rows.map((source) => {
    const row: SpreadsheetRow = Object.create(null);
    for (const [key, value] of Object.entries(source)) {
      const header = key.trim().slice(0, 200);
      if (header) row[header] = safeCellValue(value);
    }
    return row;
  });
}

export function spreadsheetSafeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function spreadsheetSafeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, spreadsheetSafeValue(value)]),
  ));
}
