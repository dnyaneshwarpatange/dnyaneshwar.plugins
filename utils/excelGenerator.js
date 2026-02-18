const ExcelJS = require('exceljs');

// Color palette
const COLORS = {
  // Header
  headerBg: '1D4ED8',       // Blue-700
  headerFg: 'FFFFFF',
  // Compatible (green tones)
  compatibleBg: 'DCFCE7',   // Green-100
  compatibleFg: '166534',   // Green-800
  compatibleBadgeBg: '16A34A', // Green-600
  // Not compatible (red tones)
  notCompatibleBg: 'FEE2E2', // Red-100
  notCompatibleFg: '991B1B',  // Red-800
  notCompatibleBadgeBg: 'DC2626', // Red-600
  // Error (orange tones)
  errorBg: 'FEF3C7',         // Amber-100
  errorFg: '92400E',          // Amber-800
  errorBadgeBg: 'D97706',     // Amber-600
  // Alternating row
  rowAlt: 'F8FAFC',           // Slate-50
  rowNormal: 'FFFFFF',
  // Title
  titleBg: '0F172A',          // Slate-900
  titleFg: 'FFFFFF',
  // Metadata
  metaBg: 'EFF6FF',           // Blue-50
  metaBorder: '93C5FD',       // Blue-300
  // Section title
  sectionBg: 'DBEAFE',        // Blue-100
  sectionFg: '1E40AF',        // Blue-800
};

function borderStyle(color = '94A3B8') {
  const style = { style: 'thin', color: { argb: `FF${color}` } };
  return { top: style, left: style, bottom: style, right: style };
}

function applyHeaderRow(row, columns) {
  row.eachCell((cell, colNum) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.headerBg}` } };
    cell.font = { bold: true, color: { argb: `FF${COLORS.headerFg}` }, size: 11, name: 'Calibri' };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = borderStyle('2563EB');
  });
  row.height = 28;
}

function applyDataCell(cell, bgColor, fgColor, opts = {}) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgColor}` } };
  cell.font = {
    color: { argb: `FF${fgColor}` },
    size: opts.size || 10,
    bold: opts.bold || false,
    name: 'Calibri'
  };
  cell.alignment = {
    vertical: 'middle',
    horizontal: opts.align || 'left',
    wrapText: true
  };
  cell.border = borderStyle('CBD5E1');
}

/**
 * Generate a styled Excel workbook from compatibility results.
 * @param {Array} results - Array of plugin compatibility results
 * @param {string} productType - 'jira' or 'confluence'
 * @param {string} targetDCVersion - The target Data Center version checked
 * @returns {Buffer} Excel file as buffer
 */
async function generateExcel(results, productType, targetDCVersion) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Atlassian Compatibility Checker';
  workbook.lastModifiedBy = 'Atlassian Compatibility Checker';
  workbook.created = new Date();
  workbook.modified = new Date();

  const productLabel = productType === 'jira' ? 'Jira' : 'Confluence';
  const sheetName = `${productLabel} Compatibility`;

  const ws = workbook.addWorksheet(sheetName, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    },
    properties: { defaultRowHeight: 22 }
  });

  // ==== TITLE ROW ====
  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `${productLabel} Data Center — Plugin Compatibility Report`;
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.titleBg}` } };
  titleCell.font = { bold: true, size: 16, color: { argb: `FFFFFFFF` }, name: 'Calibri' };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 40;

  // ==== META INFO ROW ====
  ws.mergeCells('A2:H2');
  const metaCell = ws.getCell('A2');
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  metaCell.value = `Target DC Version: ${targetDCVersion}   |   Generated: ${now} IST   |   Plugins Checked: ${results.length}`;
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.metaBg}` } };
  metaCell.font = { size: 10, italic: true, color: { argb: 'FF1E40AF' }, name: 'Calibri' };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 22;

  // ==== SUMMARY ROW ====
  const compatible = results.filter(r => r.compatible === true).length;
  const notCompatible = results.filter(r => r.compatible === false).length;
  const errors = results.filter(r => r.error).length;
  const needsUpgrade = results.filter(r => r.compatible === false && r.compatibleVersions && r.compatibleVersions.length > 0).length;

  ws.mergeCells('A3:H3');
  const summaryCell = ws.getCell('A3');
  summaryCell.value = `✅ Compatible: ${compatible}   ❌ Not Compatible: ${notCompatible}   ⚠️ Needs Upgrade: ${needsUpgrade}   🔴 Errors: ${errors}`;
  summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
  summaryCell.font = { bold: true, size: 11, name: 'Calibri' };
  summaryCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(3).height = 24;

  // Spacer
  ws.getRow(4).height = 8;

  // ==== COLUMN HEADERS ====
  const columns = [
    { header: '#', key: 'num', width: 5 },
    { header: 'Plugin Name', key: 'name', width: 30 },
    { header: 'Current Version', key: 'currentVersion', width: 16 },
    { header: `Compatible with DC ${targetDCVersion}?`, key: 'compatible', width: 22 },
    { header: 'Recommended Version', key: 'recommended', width: 20 },
    { header: 'Compatible Version Range', key: 'range', width: 28 },
    { header: 'DC Compatibility (Recommended)', key: 'dcCompat', width: 34 },
    { header: 'Marketplace URL', key: 'url', width: 50 }
  ];

  ws.columns = columns;
  const headerRow = ws.getRow(5);
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
  });
  applyHeaderRow(headerRow, columns);

  // ==== DATA ROWS ====
  results.forEach((result, idx) => {
    const rowNum = idx + 6;
    const row = ws.getRow(rowNum);
    const isAlt = idx % 2 === 1;

    let compatStatus, compatBg, compatFg, rowBg;

    if (result.error && !result.compatible && result.compatibleVersions.length === 0) {
      compatStatus = '⚠️ Error';
      compatBg = COLORS.errorBg;
      compatFg = COLORS.errorFg;
      rowBg = isAlt ? 'FEF9EC' : COLORS.errorBg;
    } else if (result.compatible === true) {
      compatStatus = '✅ Compatible';
      compatBg = COLORS.compatibleBg;
      compatFg = COLORS.compatibleFg;
      rowBg = isAlt ? 'F0FDF4' : COLORS.compatibleBg;
    } else if (result.compatible === false) {
      compatStatus = '❌ Not Compatible';
      compatBg = COLORS.notCompatibleBg;
      compatFg = COLORS.notCompatibleFg;
      rowBg = isAlt ? 'FFF5F5' : COLORS.notCompatibleBg;
    } else {
      compatStatus = '❓ Unknown';
      compatBg = 'F1F5F9';
      compatFg = '475569';
      rowBg = isAlt ? COLORS.rowAlt : COLORS.rowNormal;
    }

    // Get recommended version's DC compatibility range
    let dcCompatText = '';
    if (result.compatibleVersions && result.compatibleVersions.length > 0) {
      // Find the recommended version's compat info
      const recVer = result.compatibleVersions.find(cv => cv.pluginVersion === result.recommendedVersion);
      if (recVer) {
        dcCompatText = recVer.compatibility || `DC ${recVer.compatibilityRange}`;
      }
    }

    const cellData = [
      { value: idx + 1, align: 'center' },
      { value: result.pluginName, bold: true },
      { value: result.currentVersion, align: 'center' },
      { value: compatStatus, align: 'center', bold: true },
      { value: result.recommendedVersion || (result.compatible ? result.currentVersion : 'N/A'), align: 'center' },
      { value: result.compatibleVersionRange || 'N/A', align: 'center' },
      { value: dcCompatText || 'N/A' },
      { value: result.pluginUrl }
    ];

    cellData.forEach((cellInfo, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = cellInfo.value;

      // Status column gets special color
      if (colIdx === 3) {
        applyDataCell(cell, compatBg, compatFg, { align: cellInfo.align || 'center', bold: cellInfo.bold });
      } else {
        applyDataCell(cell, rowBg, colIdx === 0 ? '64748B' : '1E293B', {
          align: cellInfo.align,
          bold: cellInfo.bold
        });
      }

      // URL as hyperlink
      if (colIdx === 7 && result.pluginUrl) {
        cell.value = { text: result.pluginUrl, hyperlink: result.pluginUrl };
        cell.font = {
          color: { argb: 'FF0C66E4' },
          underline: true,
          size: 10,
          name: 'Calibri'
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${rowBg}` } };
        cell.border = borderStyle('CBD5E1');
      }
    });

    row.height = 22;
  });

  // ==== DETAILS SHEET ====
  const wsDetails = workbook.addWorksheet(`${productLabel} - Version Details`, {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  // Detail sheet title
  wsDetails.mergeCells('A1:G1');
  const detailTitle = wsDetails.getCell('A1');
  detailTitle.value = `${productLabel} Plugin — Compatible Version Details for DC ${targetDCVersion}`;
  detailTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.titleBg}` } };
  detailTitle.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  detailTitle.alignment = { vertical: 'middle', horizontal: 'center' };
  wsDetails.getRow(1).height = 35;

  wsDetails.columns = [
    { key: 'pluginName', width: 30 },
    { key: 'pluginVersion', width: 18 },
    { key: 'compatibility', width: 50 },
    { key: 'compatibilityRange', width: 26 },
    { key: 'releaseDate', width: 16 },
    { key: 'releaseSummary', width: 30 },
    { key: 'isCurrentVersion', width: 20 }
  ];

  // Detail header
  const detailHeaders = ['Plugin Name', 'Plugin Version', 'DC Compatibility String', 'Version Range', 'Release Date', 'Release Summary', 'Is Current Version?'];
  const detailHeaderRow = wsDetails.getRow(2);
  detailHeaders.forEach((h, idx) => {
    detailHeaderRow.getCell(idx + 1).value = h;
  });
  applyHeaderRow(detailHeaderRow, detailHeaders);

  let detailRowNum = 3;
  results.forEach(result => {
    if (!result.compatibleVersions || result.compatibleVersions.length === 0) {
      const row = wsDetails.getRow(detailRowNum++);
      const isCurrentRow = false;
      const bg = 'FEE2E2';
      [result.pluginName, 'No compatible versions found', result.error || '', '', '', '', ''].forEach((val, idx) => {
        const cell = row.getCell(idx + 1);
        cell.value = val;
        applyDataCell(cell, bg, '991B1B', { bold: idx === 0 });
      });
      row.height = 20;
      return;
    }

    // Section heading per plugin
    wsDetails.mergeCells(`A${detailRowNum}:G${detailRowNum}`);
    const sectionCell = wsDetails.getCell(`A${detailRowNum}`);
    sectionCell.value = `  📦 ${result.pluginName} — Current: v${result.currentVersion} — ${result.compatibleVersions.length} compatible version(s) found`;
    sectionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.sectionBg}` } };
    sectionCell.font = { bold: true, size: 11, color: { argb: `FF${COLORS.sectionFg}` }, name: 'Calibri' };
    sectionCell.alignment = { vertical: 'middle' };
    wsDetails.getRow(detailRowNum).height = 24;
    detailRowNum++;

    result.compatibleVersions.forEach((cv, cvIdx) => {
      const row = wsDetails.getRow(detailRowNum++);
      const isCurrentVersion = cv.pluginVersion === result.currentVersion;
      const bg = isCurrentVersion
        ? COLORS.compatibleBg
        : (cvIdx % 2 === 0 ? 'FFFFFF' : COLORS.rowAlt);
      const fg = isCurrentVersion ? COLORS.compatibleFg : '1E293B';

      const vals = [
        result.pluginName,
        cv.pluginVersion + (isCurrentVersion ? ' ⭐ (current)' : ''),
        cv.compatibility || '',
        cv.compatibilityRange || '',
        cv.releaseDate || '',
        cv.releaseSummary || '',
        isCurrentVersion ? '✅ Yes' : 'No'
      ];

      vals.forEach((val, idx) => {
        const cell = row.getCell(idx + 1);
        cell.value = val;
        applyDataCell(cell, bg, fg, {
          bold: idx === 0 || isCurrentVersion,
          align: [0, 6].includes(idx) ? 'left' : (idx === 1 ? 'center' : 'left')
        });
      });
      row.height = 20;
    });
  });

  // ==== FREEZE PANES ====
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 5, activeCell: 'A6' }];
  wsDetails.views = [{ state: 'frozen', xSplit: 0, ySplit: 2, activeCell: 'A3' }];

  // Auto-filter on main sheet
  ws.autoFilter = { from: 'A5', to: 'H5' };

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = { generateExcel };
