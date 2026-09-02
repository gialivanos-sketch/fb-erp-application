// ============================================================
// Client-side spreadsheet file parser for file ingestion
// (Import Quote, bulk uploads). Two paths:
//  - CSV/delimited text: parsed by a small dependency-free
//    parser (handles Greek locale semicolon delimiters, quoted
//    fields, escaped quotes, Windows/Unix line endings).
//  - Real binary .xlsx/.xls: parsed via SheetJS (`xlsx` package),
//    which reads the workbook's first sheet and converts it to
//    the same row/column shape the CSV path produces, so every
//    downstream consumer (pick, rowsToObjects, parsePrice) works
//    identically regardless of which file type was uploaded.
// ============================================================
import * as XLSX from "xlsx";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** Parses raw CSV text into a header row + data rows. Auto-detects
 * whether the file uses "," or ";" as the field delimiter by
 * checking which is more common in the first line. */
export function parseCsv(text: string): ParsedTable {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = normalized.split("\n")[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ";" : ",";

  const allRows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === delimiter) {
      row.push(field.trim());
      field = "";
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field.trim());
      allRows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }
  // Flush the final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    allRows.push(row);
  }

  const nonEmptyRows = allRows.filter((r) => r.some((cell) => cell.length > 0));
  if (nonEmptyRows.length === 0) return { headers: [], rows: [] };

  const [headers, ...rows] = nonEmptyRows;
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Reads a File object as plain text using FileReader. Used for the
 * CSV/TSV path only — do not use this for real binary .xlsx/.xls files,
 * which will read as garbled text; use readXlsxAsTable (or the combined
 * parseSpreadsheetFile helper below) for those instead. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsText(file, "UTF-8");
  });
}

/** Reads a real binary .xlsx/.xls/.ods file via SheetJS and returns its
 * first sheet in the same {headers, rows} shape parseCsv() produces, so
 * both file types feed the same downstream mapping logic. Cell values
 * come back as their displayed text (numbers included), which is what
 * the existing pick()/parsePrice() pipeline already expects to handle —
 * a price cell formatted as currency in Excel comes through as text like
 * "1,85 €" or "1.85", exactly like a CSV export would. */
export async function readXlsxAsTable(file: File): Promise<ParsedTable> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheetName];
  // raw:false renders each cell as its displayed string (respecting
  // Excel's own number/date formatting) rather than an underlying JS
  // number/Date object, matching what parseCsv would hand back for the
  // same spreadsheet exported as CSV.
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const asStrings = matrix.map((row) => row.map((cell) => (cell == null ? "" : String(cell).trim())));
  const nonEmptyRows = asStrings.filter((r) => r.some((cell) => cell.length > 0));
  if (nonEmptyRows.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = nonEmptyRows;
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Single entry point for file ingestion: detects CSV/TSV text files vs.
 * real binary Excel workbooks by file extension and MIME type, and
 * routes to the matching parser. Callers should use this instead of
 * calling parseCsv/readFileAsText or readXlsxAsTable directly, so a
 * genuine .xlsx upload doesn't silently get treated as garbled text. */
export async function parseSpreadsheetFile(file: File): Promise<ParsedTable> {
  const name = file.name.toLowerCase();
  const isBinaryExcel =
    name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm") || name.endsWith(".ods") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel";
  if (isBinaryExcel) return readXlsxAsTable(file);
  const text = await readFileAsText(file);
  return parseCsv(text);
}

/** Maps a parsed table's rows into objects keyed by a normalized
 * (lowercased, trimmed) version of the header, so callers can look
 * up columns case-insensitively regardless of exact header casing
 * used in the source file (e.g. "Product Name" vs "product_name"). */
export function rowsToObjects(table: ParsedTable): Record<string, string>[] {
  const normalizedHeaders = table.headers.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  return table.rows.map((row) => {
    const obj: Record<string, string> = {};
    normalizedHeaders.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    return obj;
  });
}

/** Looks up a value from a normalized-key row object by trying a list
 * of candidate column names (also normalized), returning the first
 * non-empty match. Lets ingestion tolerate varied header naming. */
export function pick(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const key = c.toLowerCase().replace(/[\s_-]+/g, "");
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

/** Cleans a price string from a spreadsheet into a plain decimal string
 * safe to pass to Number(). Handles the common Greek/EU export formats:
 *  - currency symbols and whitespace: "1,85 €" / "€1.85" / "1.85 EUR"
 *  - comma as the decimal separator: "1,85" -> "1.85"
 *  - thousands separators combined with a comma decimal: "1.234,50" -> "1234.50"
 * Falls back to "0" for anything that doesn't resolve to a valid number,
 * rather than letting a malformed price string silently become NaN
 * wherever it's later used in a calculation. */
export function parsePrice(raw: string): string {
  if (!raw) return "0";
  let s = raw.trim();
  // Strip currency symbols/codes and any remaining whitespace.
  s = s.replace(/[€$£]|EUR|USD|GBP/gi, "").trim();
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Both separators present: the last one is the decimal separator,
    // the other is a thousands separator to strip. "1.234,50" -> "1234.50"
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Only a comma present -> it's the decimal separator (Greek/EU style).
    s = s.replace(",", ".");
  }
  s = s.replace(/[^0-9.\-]/g, "");
  const num = Number(s);
  return Number.isFinite(num) ? String(num) : "0";
}

/** Δημιουργεί και κατεβάζει ένα πραγματικό .xlsx αρχείο από έναν πίνακα
 * επίπεδων αντικειμένων -- κάθε αντικείμενο γίνεται μία γραμμή, τα
 * κλειδιά του γίνονται επικεφαλίδες στηλών (με τη σειρά που εμφανίζονται
 * στο πρώτο αντικείμενο). Χρησιμοποιεί την πλευρά "εγγραφής" της ίδιας
 * SheetJS βιβλιοθήκης που ήδη χρησιμοποιείται για ανάγνωση παραπάνω
 * (XLSX.utils.json_to_sheet + XLSX.writeFile), ώστε να μην προστίθεται
 * νέα εξάρτηση. Το XLSX.writeFile ενεργοποιεί απευθείας το κατέβασμα
 * του browser -- δεν χρειάζεται χειροκίνητο Blob/URL.createObjectURL. */
export function exportRowsToExcel(rows: Record<string, string | number>[], filename: string, sheetName: string = "Sheet1"): void {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** Δημιουργεί και κατεβάζει ένα .xlsx αρχείο με ΠΟΛΛΑΠΛΑ φύλλα -- ένα
 * φύλλο ανά στοιχείο του `sheets`, όπου κάθε φύλλο δίνεται σαν πίνακας
 * γραμμών (array of arrays, όχι αντικειμένων), για πλήρη έλεγχο της
 * διάταξης (π.χ. να μοιάζει με μια ολόκληρη φόρμα συνταγής και όχι μόνο
 * με έναν επίπεδο πίνακα). Χρησιμοποιεί XLSX.utils.aoa_to_sheet αντί για
 * json_to_sheet ακριβώς γι' αυτόν τον λόγο. Τα ονόματα φύλλων καθαρίζονται
 * από μη επιτρεπτούς χαρακτήρες του Excel και κονταίνονται στο όριο των
 * 31 χαρακτήρων· αν προκύψει διπλότυπο όνομα μετά το κόψιμο, προστίθεται
 * αριθμός στο τέλος ώστε να παραμείνει μοναδικό. */
export function exportSheetsToExcel(sheets: { name: string; rows: (string | number)[][] }[], filename: string): void {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    let base = sheet.name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Sheet";
    let name = base;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${base.slice(0, 28)} ${n}`;
      n++;
    }
    usedNames.add(name);
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
