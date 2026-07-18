export type CsvValue = string | number | null;

export interface CsvOptions {
  alwaysQuote?: boolean;
  neutralizeFormulas?: boolean;
  lineEnding?: "\n" | "\r\n";
  bom?: boolean;
}

const FORMULA_PREFIX = /^[=+\-@]/;
const CSV_SPECIAL_CHARACTER = /[",\n\r]/;

function encodeCsvCell(value: CsvValue, options: CsvOptions): string {
  const text = value === null ? "" : String(value);
  const safeText = options.neutralizeFormulas && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return options.alwaysQuote || CSV_SPECIAL_CHARACTER.test(safeText)
    ? `"${safeText.replaceAll('"', '""')}"`
    : safeText;
}

export function serializeCsv(
  table: ReadonlyArray<ReadonlyArray<CsvValue>>,
  options: CsvOptions = {},
): string {
  const lineEnding = options.lineEnding ?? "\n";
  return table
    .map((row) => row.map((value) => encodeCsvCell(value, options)).join(","))
    .join(lineEnding);
}

export function downloadCsv(
  filename: string,
  table: ReadonlyArray<ReadonlyArray<CsvValue>>,
  options: CsvOptions = {},
): void {
  const csv = serializeCsv(table, options);
  const prefix = options.bom ? String.fromCharCode(0xfeff) : "";
  const url = URL.createObjectURL(new Blob([prefix + csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
