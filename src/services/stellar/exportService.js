// services/stellar/exportService.js
import Transaction from "../../models/Transaction.js";
import logger from "../../config/logger.js";

/**
 * Transaction export service (#163).
 *
 * Builds a user-scoped transaction dataset (optionally filtered by date range
 * and status) and renders it as either CSV or a PDF report. Both renderers
 * include a summary-totals/statistics section.
 *
 * No third-party libraries are used:
 *   - CSV is assembled by hand with RFC-4180 style quoting/escaping.
 *   - PDF is produced by a small hand-rolled, dependency-free writer that emits
 *     a valid multi-page PDF 1.4 document using the built-in Courier font (a
 *     monospaced font, so the transaction table columns stay aligned). It
 *     returns a Buffer suitable for `Content-Type: application/pdf`.
 *
 * `amount` is stored on the Transaction model as a precision-preserving STRING,
 * so summary sums are computed with care and grouped per currency (a wallet can
 * hold transactions settled in several assets). Values that fail to parse as a
 * finite number are skipped from the numeric total but still counted.
 */

/**
 * The ordered set of columns exported to CSV and rendered in the PDF table.
 * Each column has a stable header, an accessor that derives the cell value from
 * a lean Transaction document, and a fixed width used only for PDF alignment.
 *
 * @type {Array<{ header: string, width: number, get: (tx: object) => string }>}
 */
const COLUMNS = [
  { header: "Transaction ID", width: 26, get: (tx) => String(tx._id || "") },
  { header: "Type", width: 9, get: (tx) => tx.type || "purchase" },
  { header: "Item Type", width: 9, get: (tx) => tx.itemType || "" },
  { header: "Item Title", width: 24, get: (tx) => tx.itemTitle || "" },
  { header: "Amount", width: 14, get: (tx) => (tx.amount != null ? String(tx.amount) : "") },
  { header: "Currency", width: 8, get: (tx) => tx.currency || "USDC" },
  { header: "Status", width: 10, get: (tx) => tx.status || "" },
  { header: "Network", width: 8, get: (tx) => tx.network || "" },
  { header: "Direction", width: 9, get: (tx) => tx.__direction || "" },
  { header: "Counterparty Wallet", width: 20, get: (tx) => tx.__counterpartyWallet || "" },
  { header: "Memo", width: 16, get: (tx) => tx.memo || "" },
  { header: "Stellar Tx Hash", width: 24, get: (tx) => tx.stellarTxHash || "" },
  { header: "Created At", width: 22, get: (tx) => toIso(tx.createdAt) },
  { header: "Confirmed At", width: 22, get: (tx) => toIso(tx.confirmedAt) },
];

/**
 * Statuses considered "successful" money movement for summary statistics.
 * @type {string[]}
 */
const SUCCESS_STATUSES = ["confirmed"];

/**
 * Safely convert a Date/ISO-ish value to an ISO 8601 string, or "" when absent.
 * @param {*} value - a Date, string, or nullish value
 * @returns {string} ISO 8601 timestamp or empty string
 */
function toIso(value) {
  if (!value) return "";
  try {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  } catch {
    return "";
  }
}

/**
 * Parse and validate the optional export filters coming from the request query.
 * Invalid dates or an unknown status throw so the controller can return 400.
 *
 * @param {object} [query] - raw request query object
 * @param {string} [query.startDate] - inclusive lower bound (parsed by Date)
 * @param {string} [query.endDate] - inclusive upper bound (parsed by Date)
 * @param {string} [query.status] - one Transaction status enum value
 * @returns {{ startDate?: Date, endDate?: Date, status?: string }} normalized filters
 */
export function parseFilters(query = {}) {
  const filters = {};

  if (query.startDate != null && query.startDate !== "") {
    const start = new Date(query.startDate);
    if (Number.isNaN(start.getTime())) {
      throw new Error("Invalid startDate; expected an ISO date string");
    }
    filters.startDate = start;
  }

  if (query.endDate != null && query.endDate !== "") {
    const end = new Date(query.endDate);
    if (Number.isNaN(end.getTime())) {
      throw new Error("Invalid endDate; expected an ISO date string");
    }
    filters.endDate = end;
  }

  if (
    filters.startDate &&
    filters.endDate &&
    filters.startDate.getTime() > filters.endDate.getTime()
  ) {
    throw new Error("startDate must not be after endDate");
  }

  if (query.status != null && query.status !== "") {
    const allowed = Transaction.schema.path("status").enumValues;
    if (!allowed.includes(query.status)) {
      throw new Error(
        `Invalid status '${query.status}'. Allowed: ${allowed.join(", ")}`
      );
    }
    filters.status = query.status;
  }

  return filters;
}

/**
 * Fetch the authenticated user's transactions (as buyer or creator) matching
 * the given filters, newest first. Each returned record is annotated with a
 * `__direction` ("outgoing" when the user is the buyer, "incoming" when the
 * creator) and `__counterpartyWallet` for the export, without mutating the DB.
 *
 * @param {string|import("mongoose").Types.ObjectId} userId - authenticated user id
 * @param {{ startDate?: Date, endDate?: Date, status?: string }} [filters] - normalized filters
 * @returns {Promise<object[]>} lean, annotated transaction documents
 */
export async function fetchUserTransactions(userId, filters = {}) {
  const query = { $or: [{ buyer: userId }, { creator: userId }] };

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = filters.startDate;
    if (filters.endDate) query.createdAt.$lte = filters.endDate;
  }

  const rows = await Transaction.find(query).sort({ createdAt: -1 }).lean();

  const userIdStr = String(userId);
  return rows.map((tx) => {
    const isBuyer = String(tx.buyer) === userIdStr;
    return {
      ...tx,
      __direction: isBuyer ? "outgoing" : "incoming",
      __counterpartyWallet: isBuyer ? tx.creatorWallet || "" : tx.buyerWallet || "",
    };
  });
}

/**
 * Compute summary totals/statistics over a set of transactions:
 *   - total record count
 *   - count broken down by status
 *   - amount totals grouped by currency (only successful/confirmed rows count
 *     toward the settled money total; a separate all-rows total is also given)
 *
 * @param {object[]} transactions - annotated transaction records
 * @returns {{
 *   totalCount: number,
 *   byStatus: Record<string, number>,
 *   confirmedByCurrency: Record<string, string>,
 *   totalByCurrency: Record<string, string>
 * }} summary statistics with amounts rendered as fixed-precision strings
 */
export function computeSummary(transactions) {
  const byStatus = {};
  const confirmedByCurrency = {};
  const totalByCurrency = {};

  for (const tx of transactions) {
    const status = tx.status || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;

    const currency = tx.currency || "USDC";
    const amount = Number(tx.amount);
    if (Number.isFinite(amount)) {
      totalByCurrency[currency] = ((totalByCurrency[currency] || 0) + amount);
      if (SUCCESS_STATUSES.includes(status)) {
        confirmedByCurrency[currency] =
          ((confirmedByCurrency[currency] || 0) + amount);
      }
    }
  }

  const fixCurrencyMap = (map) => {
    const out = {};
    for (const [code, sum] of Object.entries(map)) {
      out[code] = sum.toFixed(7); // Stellar assets have 7 decimals of precision
    }
    return out;
  };

  return {
    totalCount: transactions.length,
    byStatus,
    confirmedByCurrency: fixCurrencyMap(confirmedByCurrency),
    totalByCurrency: fixCurrencyMap(totalByCurrency),
  };
}

/**
 * Escape a single value for CSV output following RFC-4180 rules: wrap in double
 * quotes when the value contains a comma, quote, CR or LF, and double any
 * embedded quotes. A leading formula character is prefixed with a single quote
 * to defend against CSV-injection when the file is opened in a spreadsheet.
 *
 * @param {*} value - raw cell value
 * @returns {string} CSV-safe field
 */
function csvEscape(value) {
  let str = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Render the transactions and their summary as a CSV string.
 *
 * Layout: a header row, one row per transaction, a blank separator line, then a
 * "SUMMARY" block listing the record count, per-status counts, and per-currency
 * totals (settled/confirmed and overall).
 *
 * @param {object[]} transactions - annotated transaction records
 * @param {ReturnType<typeof computeSummary>} summary - precomputed summary
 * @returns {string} the full CSV document
 */
export function buildCsv(transactions, summary) {
  const lines = [];

  lines.push(COLUMNS.map((c) => csvEscape(c.header)).join(","));

  for (const tx of transactions) {
    lines.push(COLUMNS.map((c) => csvEscape(c.get(tx))).join(","));
  }

  lines.push("");
  lines.push(csvEscape("SUMMARY"));
  lines.push([csvEscape("Total Records"), csvEscape(summary.totalCount)].join(","));

  lines.push("");
  lines.push([csvEscape("Status"), csvEscape("Count")].join(","));
  for (const [status, count] of Object.entries(summary.byStatus)) {
    lines.push([csvEscape(status), csvEscape(count)].join(","));
  }

  lines.push("");
  lines.push(
    [csvEscape("Currency"), csvEscape("Confirmed Total"), csvEscape("All-Status Total")].join(",")
  );
  const currencies = new Set([
    ...Object.keys(summary.totalByCurrency),
    ...Object.keys(summary.confirmedByCurrency),
  ]);
  for (const code of currencies) {
    lines.push(
      [
        csvEscape(code),
        csvEscape(summary.confirmedByCurrency[code] || "0.0000000"),
        csvEscape(summary.totalByCurrency[code] || "0.0000000"),
      ].join(",")
    );
  }

  return lines.join("\r\n");
}

/**
 * Escape a JS string for use inside a PDF literal string object: backslash,
 * open/close parenthesis are escaped, and any non-printable-ASCII byte is
 * dropped so the built-in Courier (StandardEncoding) font renders it cleanly.
 *
 * @param {string} str - raw text
 * @returns {string} PDF-string-safe text
 */
function pdfEscape(str) {
  return String(str)
    .replace(/[^\x20-\x7E]/g, "") // keep printable ASCII only
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Fit a value into a fixed-width monospaced cell: truncate (with a trailing
 * ellipsis) when too long, or right-pad with spaces when short.
 *
 * @param {*} value - raw cell value
 * @param {number} width - target character width
 * @returns {string} exactly `width` characters
 */
function fitCell(value, width) {
  let str = value == null ? "" : String(value).replace(/[\r\n]+/g, " ");
  if (str.length > width) {
    str = width > 1 ? `${str.slice(0, width - 1)}…`.replace(/…/, "~") : str.slice(0, width);
  }
  return str.padEnd(width, " ");
}

/**
 * Compose the plain-text lines (table + summary) that make up the PDF report.
 * Returned as an array of already-fitted, single-line strings.
 *
 * @param {object[]} transactions - annotated transaction records
 * @param {ReturnType<typeof computeSummary>} summary - precomputed summary
 * @param {{ startDate?: Date, endDate?: Date, status?: string }} filters - applied filters
 * @returns {string[]} report lines
 */
function buildReportLines(transactions, summary, filters) {
  const lines = [];
  lines.push("Deen-Bridge - Transaction Export Report");
  lines.push(`Generated: ${new Date().toISOString()}`);

  const filterParts = [];
  if (filters.startDate) filterParts.push(`from ${toIso(filters.startDate)}`);
  if (filters.endDate) filterParts.push(`to ${toIso(filters.endDate)}`);
  if (filters.status) filterParts.push(`status=${filters.status}`);
  lines.push(`Filters: ${filterParts.length ? filterParts.join(" ") : "none"}`);
  lines.push("");

  const headerRow = COLUMNS.map((c) => fitCell(c.header, c.width)).join(" ");
  lines.push(headerRow);
  lines.push("-".repeat(headerRow.length));

  for (const tx of transactions) {
    lines.push(COLUMNS.map((c) => fitCell(c.get(tx), c.width)).join(" "));
  }

  if (transactions.length === 0) {
    lines.push("(no transactions match the selected filters)");
  }

  lines.push("");
  lines.push("=== SUMMARY ===");
  lines.push(`Total records: ${summary.totalCount}`);
  lines.push("");
  lines.push("Count by status:");
  for (const [status, count] of Object.entries(summary.byStatus)) {
    lines.push(`  ${fitCell(status, 12)} ${count}`);
  }
  lines.push("");
  lines.push("Totals by currency (confirmed / all statuses):");
  const currencies = new Set([
    ...Object.keys(summary.totalByCurrency),
    ...Object.keys(summary.confirmedByCurrency),
  ]);
  if (currencies.size === 0) {
    lines.push("  (none)");
  }
  for (const code of currencies) {
    const confirmed = summary.confirmedByCurrency[code] || "0.0000000";
    const all = summary.totalByCurrency[code] || "0.0000000";
    lines.push(`  ${fitCell(code, 8)} ${fitCell(confirmed, 18)} ${all}`);
  }

  return lines;
}

/**
 * Hand-rolled, dependency-free PDF 1.4 writer. Lays the given text lines onto
 * one or more US-Letter pages using the built-in Courier font, then serializes
 * a valid PDF (objects, cross-reference table, and trailer) into a Buffer.
 *
 * @param {string[]} textLines - already-fitted single-line strings
 * @returns {Buffer} a complete, valid PDF document
 */
function renderPdf(textLines) {
  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const MARGIN_X = 36;
  const TOP_Y = 756;
  const FONT_SIZE = 8;
  const LEADING = 10.5;
  const LINES_PER_PAGE = Math.floor((TOP_Y - 40) / LEADING);

  // Split the lines into pages.
  const pages = [];
  for (let i = 0; i < textLines.length; i += LINES_PER_PAGE) {
    pages.push(textLines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([""]);

  // Build the content stream for each page.
  const contentStreams = pages.map((pageLines) => {
    let stream = "BT\n";
    stream += `/F1 ${FONT_SIZE} Tf\n`;
    stream += `${LEADING} TL\n`;
    stream += `${MARGIN_X} ${TOP_Y} Td\n`;
    pageLines.forEach((line, idx) => {
      if (idx > 0) stream += "T*\n";
      stream += `(${pdfEscape(line)}) Tj\n`;
    });
    stream += "ET";
    return stream;
  });

  // Object plan:
  //   1: Catalog
  //   2: Pages
  //   3: Font (Courier)
  //   for each page p (0-based): pageObj = 4 + 2p, contentObj = 5 + 2p
  const numPages = pages.length;
  const objects = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  const kids = [];
  for (let p = 0; p < numPages; p++) {
    kids.push(`${4 + 2 * p} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${numPages} >>`;

  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";

  for (let p = 0; p < numPages; p++) {
    const pageObjNum = 4 + 2 * p;
    const contentObjNum = 5 + 2 * p;
    objects[pageObjNum] =
      `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> ` +
      `/Contents ${contentObjNum} 0 R >>`;

    const stream = contentStreams[p];
    // Length uses byte length of the stream body.
    const length = Buffer.byteLength(stream, "latin1");
    objects[contentObjNum] =
      `<< /Length ${length} >>\nstream\n${stream}\nendstream`;
  }

  // Serialize with a cross-reference table. Offsets are byte offsets from the
  // start of the file to the beginning of each object's "N 0 obj" line.
  const totalObjects = 3 + 2 * numPages;
  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; // binary comment marks a binary file
  const offsets = new Array(totalObjects + 1).fill(0);

  for (let n = 1; n <= totalObjects; n++) {
    offsets[n] = Buffer.byteLength(body, "latin1");
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${totalObjects + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let n = 1; n <= totalObjects; n++) {
    xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}

/**
 * Build a PDF report Buffer from transactions, their summary, and the applied
 * filters (for the report header).
 *
 * @param {object[]} transactions - annotated transaction records
 * @param {ReturnType<typeof computeSummary>} summary - precomputed summary
 * @param {{ startDate?: Date, endDate?: Date, status?: string }} filters - applied filters
 * @returns {Buffer} a complete, valid PDF document
 */
export function buildPdf(transactions, summary, filters) {
  const lines = buildReportLines(transactions, summary, filters);
  return renderPdf(lines);
}

/**
 * Top-level export helper: fetch the user's filtered transactions, compute the
 * summary, and produce the requested artifact.
 *
 * @param {object} params - inputs
 * @param {string|import("mongoose").Types.ObjectId} params.userId - authenticated user id
 * @param {"csv"|"pdf"} params.format - output format
 * @param {{ startDate?: Date, endDate?: Date, status?: string }} [params.filters] - normalized filters
 * @returns {Promise<{
 *   format: "csv"|"pdf",
 *   contentType: string,
 *   extension: string,
 *   body: string|Buffer,
 *   summary: ReturnType<typeof computeSummary>,
 *   count: number
 * }>} the rendered export payload and metadata
 */
export async function generateExport({ userId, format, filters = {} }) {
  const transactions = await fetchUserTransactions(userId, filters);
  const summary = computeSummary(transactions);

  logger.info(
    { userId: String(userId), format, count: transactions.length },
    "Generating transaction export"
  );

  if (format === "pdf") {
    return {
      format: "pdf",
      contentType: "application/pdf",
      extension: "pdf",
      body: buildPdf(transactions, summary, filters),
      summary,
      count: transactions.length,
    };
  }

  return {
    format: "csv",
    contentType: "text/csv; charset=utf-8",
    extension: "csv",
    body: buildCsv(transactions, summary),
    summary,
    count: transactions.length,
  };
}
