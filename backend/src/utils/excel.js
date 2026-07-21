const ExcelJS = require('exceljs');

function sanitizeSheetName(value = 'Datos') {
  return String(value).replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Datos';
}

function sanitizeFileName(value = 'export') {
  return String(value)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'export';
}

function getColumnLetter(index) {
  let current = index + 1;
  let result = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

function applyHeaderStyle(cell) {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '1F4E78' },
  };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = {
    top: { style: 'thin', color: { argb: 'D9E2F3' } },
    left: { style: 'thin', color: { argb: 'D9E2F3' } },
    bottom: { style: 'thin', color: { argb: 'D9E2F3' } },
    right: { style: 'thin', color: { argb: 'D9E2F3' } },
  };
}

function applyBodyStyle(cell) {
  cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: 'E5E7EB' } },
    left: { style: 'thin', color: { argb: 'E5E7EB' } },
    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
    right: { style: 'thin', color: { argb: 'E5E7EB' } },
  };
}

function applyLinkStyle(cell) {
  cell.font = {
    ...(cell.font || {}),
    color: { argb: '0563C1' },
    underline: true,
  };
}

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ZENTRA';
  workbook.created = new Date();
  return workbook;
}

function prepareWorksheet(worksheet, columns = []) {
  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || 18,
    style: column.style || {},
  }));

  if (!columns.length) {
    return worksheet;
  }

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => applyHeaderStyle(cell));

  worksheet.autoFilter = {
    from: 'A1',
    to: `${getColumnLetter(columns.length - 1)}1`,
  };

  return worksheet;
}

function addWorksheetRows(worksheet, columns = [], rows = []) {
  rows.forEach((row) => {
    const excelRow = worksheet.addRow(row);
    excelRow.eachCell((cell, columnNumber) => {
      applyBodyStyle(cell);

      const column = columns[columnNumber - 1];
      if (!column) return;

      if (column.type === 'date' && cell.value) {
        cell.numFmt = 'dd/mm/yyyy';
      }
      if (column.type === 'datetime' && cell.value) {
        cell.numFmt = 'dd/mm/yyyy hh:mm';
      }
      if (column.type === 'number' && cell.value !== null && cell.value !== undefined && cell.value !== '') {
        cell.numFmt = '#,##0.00';
      }
      if (column.type === 'integer' && cell.value !== null && cell.value !== undefined && cell.value !== '') {
        cell.numFmt = '#,##0';
      }
      if (column.type === 'link' && cell.value) {
        if (typeof cell.value === 'string') {
          cell.value = { text: cell.value, hyperlink: cell.value };
        }
        if (cell.value?.hyperlink) {
          applyLinkStyle(cell);
        }
      }
    });
  });
}

async function sendWorkbook(res, workbook, fileName) {
  // Generar el archivo completo antes de responder evita descargas truncadas
  // por proxies o navegadores cuando la respuesta se envia por streaming.
  const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${sanitizeFileName(fileName)}.xlsx"`
  );
  res.setHeader('Content-Length', String(workbookBuffer.length));

  res.status(200).end(workbookBuffer);
}

async function sendExcelWorkbook(res, {
  fileName,
  sheetName,
  columns = [],
  rows = [],
}) {
  const workbook = createWorkbook();
  const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  prepareWorksheet(worksheet, columns);
  addWorksheetRows(worksheet, columns, rows);
  await sendWorkbook(res, workbook, fileName);
}

function extractCellValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || '').join('');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return value.result;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'text')) {
      return value.text;
    }
  }

  return value;
}

function normalizeHeaderKey(value = '') {
  return String(extractCellValue(value) || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readWorksheetRows(worksheet, { headerRowNumber = 1 } = {}) {
  const headerRow = worksheet.getRow(headerRowNumber);
  const headers = [];

  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber] = normalizeHeaderKey(cell.value) || `column_${columnNumber}`;
  });

  const rows = [];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const record = { __rowNum: rowNumber };
    let hasValues = false;
    const maxColumns = Math.max(headers.length - 1, row.cellCount);

    for (let columnNumber = 1; columnNumber <= maxColumns; columnNumber += 1) {
      const key = headers[columnNumber];
      if (!key) continue;

      const rawValue = extractCellValue(row.getCell(columnNumber).value);
      const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;

      if (value !== null && value !== undefined && value !== '') {
        hasValues = true;
      }

      record[key] = value;
    }

    if (hasValues) {
      rows.push(record);
    }
  }

  return rows;
}

async function readWorkbookFromBuffer(buffer) {
  const workbook = createWorkbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

module.exports = {
  ExcelJS,
  addWorksheetRows,
  createWorkbook,
  prepareWorksheet,
  readWorkbookFromBuffer,
  readWorksheetRows,
  sendExcelWorkbook,
  sendWorkbook,
};
