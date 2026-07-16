import {
  createPickupSummaryReportData,
  type PickupSummaryPayload,
  type PickupSummaryReport,
  type PickupSummaryReportData,
} from "./pickup-summary-report-data";

const landscapePdfPage = {
  height: 612,
  margin: 28,
  width: 792,
};

const portraitPdfPage = {
  height: 792,
  margin: 28,
  width: 612,
};

type PdfPageLayout = typeof landscapePdfPage;

type PdfPage = PdfPageLayout & {
  content: string;
};

export async function downloadPickupSummaryReports(
  payload: PickupSummaryPayload,
) {
  const reportData = createPickupSummaryReportData(payload);
  const filename = getPickupSummaryFilename(
    reportData.fileDate,
    payload.exportFormat,
    payload.reports,
  );
  const blob =
    payload.exportFormat === "pdf"
      ? createPickupSummaryPdf(reportData)
      : createPickupSummaryWorkbook(reportData);

  downloadBlob(blob, filename);
}

function getPickupSummaryFilename(
  fileDate: string,
  exportFormat: "pdf" | "xlsx",
  reports: PickupSummaryReport[],
) {
  const extension = exportFormat === "pdf" ? "pdf" : "xlsx";

  if (reports.length !== 1) {
    return `pickup-summary-${fileDate}.${extension}`;
  }

  return reports[0] === "pull_sheet"
    ? `pull-sheet-${fileDate}.${extension}`
    : `order-summary-${fileDate}.${extension}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function createPickupSummaryPdf(reportData: PickupSummaryReportData) {
  const pages = reportData.reports.flatMap((report) =>
    report === "pull_sheet"
      ? buildPullSheetPdfPages(reportData)
      : buildOrderSummaryPdfPages(reportData),
  );

  return new Blob([buildPdfDocument(pages)], {
    type: "application/pdf",
  });
}

function buildPullSheetPdfPages(reportData: PickupSummaryReportData) {
  return buildTablePdfPages({
    columns: [
      { align: "left", label: "Breed / Variety", width: 240 },
      { align: "center", label: "Sex", width: 95 },
      { align: "center", label: "Qty", width: 86 },
    ],
    dateLabel: reportData.generatedDateLabel,
    layout: portraitPdfPage,
    rows: reportData.pullSheetRows.map((row) => [
      row.breedOrVariety,
      row.sex,
      row.quantity,
    ]),
    title: "PULL SHEET",
    totals: ["TOTAL BIRDS", "", reportData.pullSheetTotalBirds],
  });
}

function buildOrderSummaryPdfPages(reportData: PickupSummaryReportData) {
  return buildTablePdfPages({
    columns: [
      { align: "center", label: "Order #", width: 70 },
      { align: "left", label: "Contact name", width: 145 },
      { align: "left", label: "Phone", width: 120 },
      { align: "left", label: "Email", width: 220 },
      { align: "center", label: "Total birds", width: 80 },
      { align: "right", label: "Order total", width: 101 },
    ],
    dateLabel: reportData.generatedDateLabel,
    layout: landscapePdfPage,
    rows: reportData.orderSummaryRows.map((row) => [
      `#${row.orderNumber}`,
      row.customerName,
      row.phone,
      row.email,
      row.totalBirds,
      formatCurrency(row.totalValue),
    ]),
    title: "ORDER SUMMARY",
    totals: [
      "",
      "",
      "",
      "TOTALS",
      reportData.orderSummaryTotals.birds,
      formatCurrency(reportData.orderSummaryTotals.value),
    ],
  });
}

function buildTablePdfPages({
  columns,
  dateLabel,
  layout,
  rows,
  title,
  totals,
}: {
  columns: Array<{
    align: "center" | "left" | "right";
    label: string;
    width: number;
  }>;
  dateLabel: string;
  layout: PdfPageLayout;
  rows: Array<Array<number | string>>;
  title: string;
  totals: Array<number | string>;
}) {
  const pages: PdfPage[] = [];
  const rowHeight = 25;
  const headerHeight = 28;
  const startX = layout.margin;
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const bottomY = layout.margin + rowHeight;
  let rowIndex = 0;

  do {
    const commands: string[] = [];
    let y = layout.height - layout.margin;

    drawPdfText(commands, title, startX, y, 22, "bold");
    drawPdfText(
      commands,
      `Date:  ${dateLabel}`,
      layout.width - layout.margin - 190,
      y,
      18,
      "regular",
    );
    y -= 38;

    drawPdfTableRow({
      bold: true,
      columns,
      commands,
      row: columns.map((column) => column.label),
      rowHeight: headerHeight,
      startX,
      tableWidth,
      y,
    });
    y -= headerHeight;

    while (rowIndex < rows.length && y - rowHeight >= bottomY) {
      drawPdfTableRow({
        bold: false,
        columns,
        commands,
        row: rows[rowIndex],
        rowHeight,
        startX,
        tableWidth,
        y,
      });
      y -= rowHeight;
      rowIndex += 1;
    }

    if (rowIndex >= rows.length) {
      drawPdfTableRow({
        bold: true,
        columns,
        commands,
        row: totals,
        rowHeight,
        startX,
        tableWidth,
        y,
      });
    }

    pages.push({
      ...layout,
      content: commands.join("\n"),
    });
  } while (rowIndex < rows.length);

  return pages;
}

function drawPdfTableRow({
  bold,
  columns,
  commands,
  row,
  rowHeight,
  startX,
  tableWidth,
  y,
}: {
  bold: boolean;
  columns: Array<{
    align: "center" | "left" | "right";
    label: string;
    width: number;
  }>;
  commands: string[];
  row: Array<number | string>;
  rowHeight: number;
  startX: number;
  tableWidth: number;
  y: number;
}) {
  drawPdfRect(commands, startX, y - rowHeight, tableWidth, rowHeight);

  let x = startX;
  columns.forEach((column, index) => {
    if (index > 0) {
      drawPdfLine(commands, x, y, x, y - rowHeight);
    }

    const value = String(row[index] ?? "");
    const fontSize = 12;
    const textWidth = estimatePdfTextWidth(value, fontSize);
    const textX =
      column.align === "right"
        ? x + column.width - textWidth - 12
        : column.align === "center"
          ? x + (column.width - textWidth) / 2
          : x + 12;

    drawPdfText(
      commands,
      value,
      textX,
      y - rowHeight + 8,
      fontSize,
      bold ? "bold" : "regular",
    );
    x += column.width;
  });
}

function drawPdfText(
  commands: string[],
  value: string,
  x: number,
  y: number,
  size: number,
  weight: "bold" | "regular",
) {
  commands.push(
    `BT /${weight === "bold" ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(
      2,
    )} Td (${escapePdfText(value)}) Tj ET`,
  );
}

function drawPdfRect(
  commands: string[],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  commands.push(
    `0.6 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(
      2,
    )} re S`,
  );
}

function drawPdfLine(
  commands: string[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  commands.push(
    `0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(
      2,
    )} l S`,
  );
}

function buildPdfDocument(pages: PdfPage[]) {
  const objects: string[] = [];
  const fontRegularId = 3;
  const fontBoldId = 4;
  const firstPageId = 5;
  const kids = pages
    .map((_, index) => `${firstPageId + index * 2} 0 R`)
    .join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[fontRegularId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Arial >>";
  objects[fontBoldId] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Arial-Bold >>";

  pages.forEach((page, index) => {
    const pageId = firstPageId + index * 2;
    const contentId = pageId + 1;

    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
      `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    offsets[objectId] = pdf.length;
    pdf += `${objectId} 0 obj\n${objects[objectId]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";

  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    pdf += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }

  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function escapePdfText(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function estimatePdfTextWidth(value: string, fontSize: number) {
  return value.length * fontSize * 0.52;
}

export function createPickupSummaryWorkbook(reportData: PickupSummaryReportData) {
  const sheets = reportData.reports.map((report, index) =>
    report === "pull_sheet"
      ? buildPullSheetWorksheet(reportData, index + 1)
      : buildOrderSummaryWorksheet(reportData, index + 1),
  );
  const files = buildWorkbookFiles(sheets);

  return new Blob([createZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function buildPullSheetWorksheet(
  reportData: PickupSummaryReportData,
  sheetId: number,
) {
  const rows = [
    {
      cells: [
        stringCell("Breed / Variety", 1),
        stringCell("Sex", 1),
        stringCell("Qty", 1),
      ],
    },
    ...reportData.pullSheetRows.map((row) => ({
      cells: [
        stringCell(row.breedOrVariety, 2),
        stringCell(row.sex, 2),
        numberCell(row.quantity, 3),
      ],
    })),
    {
      cells: [
        stringCell("TOTAL BIRDS", 5),
        stringCell("", 5),
        numberCell(reportData.pullSheetTotalBirds, 6),
      ],
    },
  ];

  return {
    columns: [26, 18, 10],
    name: "Pull Sheet",
    path: `xl/worksheets/sheet${sheetId}.xml`,
    relId: `rId${sheetId}`,
    xml: buildWorksheetXml(rows, [26, 18, 10]),
  };
}

function buildOrderSummaryWorksheet(
  reportData: PickupSummaryReportData,
  sheetId: number,
) {
  const rows = [
    {
      cells: [
        stringCell("Order #", 1),
        stringCell("Contact name", 1),
        stringCell("Phone", 1),
        stringCell("Email", 1),
        stringCell("Total birds", 1),
        stringCell("Order total", 1),
      ],
    },
    ...reportData.orderSummaryRows.map((row) => ({
      cells: [
        stringCell(`#${row.orderNumber}`, 2),
        stringCell(row.customerName, 2),
        stringCell(row.phone, 2),
        stringCell(row.email, 2),
        numberCell(row.totalBirds, 3),
        numberCell(row.totalValue, 4),
      ],
    })),
    {
      cells: [
        stringCell("", 5),
        stringCell("", 5),
        stringCell("", 5),
        stringCell("TOTALS", 5),
        numberCell(reportData.orderSummaryTotals.birds, 6),
        numberCell(reportData.orderSummaryTotals.value, 7),
      ],
    },
  ];

  return {
    columns: [12, 24, 18, 36, 14, 14],
    name: "Order Summary",
    path: `xl/worksheets/sheet${sheetId}.xml`,
    relId: `rId${sheetId}`,
    xml: buildWorksheetXml(rows, [12, 24, 18, 36, 14, 14]),
  };
}

function buildWorkbookFiles(
  sheets: Array<{
    name: string;
    path: string;
    relId: string;
    xml: string;
  }>,
) {
  return [
    {
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (sheet) =>
      `<Override PartName="/${sheet.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("")}
</Types>`,
    },
    {
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (sheet, index) =>
      `<Relationship Id="${sheet.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
        index + 1
      }.xml"/>`,
  )
  .join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets
  .map(
    (sheet, index) =>
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="${
        sheet.relId
      }"/>`,
  )
  .join("")}
</sheets>
</workbook>`,
    },
    {
      path: "xl/styles.xml",
      content: workbookStylesXml,
    },
    ...sheets.map((sheet) => ({
      path: sheet.path,
      content: sheet.xml,
    })),
  ];
}

function buildWorksheetXml(
  rows: Array<{ cells: Array<WorksheetCell> }>,
  columnWidths: number[],
) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${columnWidths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("")}</cols>
<sheetData>
${rows
  .map(
    (row, rowIndex) =>
      `<row r="${rowIndex + 1}">${row.cells
        .map((cell, cellIndex) => renderWorksheetCell(cell, rowIndex + 1, cellIndex))
        .join("")}</row>`,
  )
  .join("")}
</sheetData>
</worksheet>`;
}

type WorksheetCell =
  | {
      style: number;
      type: "number";
      value: number;
    }
  | {
      style: number;
      type: "string";
      value: string;
    };

function stringCell(value: string, style: number): WorksheetCell {
  return { style, type: "string", value };
}

function numberCell(value: number, style: number): WorksheetCell {
  return { style, type: "number", value };
}

function renderWorksheetCell(
  cell: WorksheetCell,
  rowIndex: number,
  cellIndex: number,
) {
  const ref = `${columnName(cellIndex + 1)}${rowIndex}`;

  if (cell.type === "number") {
    return `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr" s="${cell.style}"><is><t>${escapeXml(
    cell.value,
  )}</t></is></c>`;
}

function columnName(index: number) {
  let name = "";
  let current = index;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - remainder) / 26);
  }

  return name;
}

const workbookStylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="$#,##0.00"/><numFmt numFmtId="165" formatCode="0"/></numFmts>
<fonts count="2"><font><name val="Arial"/><family val="2"/><sz val="11"/></font><font><b/><name val="Arial"/><family val="2"/><sz val="11"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyNumberFormat="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function createZip(files: Array<{ content: string; path: string }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = textBytes(file.path);
    const contentBytes = textBytes(file.content);
    const crc = crc32(contentBytes);
    const localHeader = createZipLocalHeader(nameBytes, contentBytes.length, crc);
    const centralHeader = createZipCentralHeader(
      nameBytes,
      contentBytes.length,
      crc,
      offset,
    );

    localParts.push(localHeader, contentBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + contentBytes.length;
  });

  const centralOffset = offset;
  const centralDirectory = concatBytes(centralParts);
  const endRecord = createZipEndRecord(
    files.length,
    centralDirectory.length,
    centralOffset,
  );

  return concatBytes([...localParts, centralDirectory, endRecord]);
}

function createZipLocalHeader(
  nameBytes: Uint8Array,
  size: number,
  crc: number,
) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  header.set(nameBytes, 30);

  return header;
}

function createZipCentralHeader(
  nameBytes: Uint8Array,
  size: number,
  crc: number,
  offset: number,
) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);

  return header;
}

function createZipEndRecord(
  fileCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);

  return record;
}

function concatBytes(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });

  return bytes;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}
