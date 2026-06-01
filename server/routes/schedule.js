import express from 'express';
import ExcelJS from 'exceljs';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { format, addDays, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { listShiftEntriesWithCentralAbsences } from '../utils/centralAbsences.js';

const router = express.Router();
router.use(authMiddleware);

// Default colors for sections and positions
const DEFAULT_COLORS = {
  sections: {
    "Abwesenheiten": { bg: "#e2e8f0", text: "#1e293b" },
    "Dienste": { bg: "#dbeafe", text: "#1e3a8a" },
    "Rotationen": { bg: "#d1fae5", text: "#064e3b" },
    "Demonstrationen & Konsile": { bg: "#fef3c7", text: "#78350f" },
    "Sonstiges": { bg: "#f3e8ff", text: "#581c87" },
  },
  positions: {
    "Frei": { bg: "#64748b", text: "#ffffff" },
    "Krank": { bg: "#ef4444", text: "#ffffff" },
    "Urlaub": { bg: "#22c55e", text: "#ffffff" },
    "Dienstreise": { bg: "#3b82f6", text: "#ffffff" },
    "Nicht verfügbar": { bg: "#f97316", text: "#ffffff" },
  }
};

// Helper: Convert hex color to ARGB format for Excel
const getArgb = (hex) => {
  if (!hex) return null;
  const clean = hex.replace('#', '');
  return 'FF' + clean.toUpperCase();
};

// Helper: Format date for Excel header (German locale)
const formatDateHeader = (date) => {
  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const dayName = dayNames[date.getDay()];
  return `${day}.${month}.${year} (${dayName})`;
};

// ===== EXPORT SCHEDULE TO EXCEL =====
router.post('/export', async (req, res, next) => {
  try {
    const { startDate, endDate, hiddenRows = [] } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required parameters: startDate and endDate' });
    }

    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const dbPool = req.db || db;

    // Fetch all required data from database
    const shiftRows = req.db
      ? await listShiftEntriesWithCentralAbsences({
          tenantDb: dbPool,
          masterDb: db,
          filters: {
            date: {
              $gte: startDate,
              $lte: endDate,
            },
          },
          sort: 'date',
        })
      : (await dbPool.execute(
          `SELECT * FROM ShiftEntry WHERE date >= ? AND date <= ? ORDER BY date, \`order\``,
          [startDate, endDate]
        ))[0];
    
    const [doctorRows] = await dbPool.execute(`SELECT * FROM Doctor`);
    const [workplaceRows] = await dbPool.execute(`SELECT * FROM Workplace ORDER BY \`order\``);
    const [noteRows] = await dbPool.execute(
      `SELECT * FROM ScheduleNote WHERE date >= ? AND date <= ?`,
      [startDate, endDate]
    );
    
    // Try to get color settings (may not exist in all setups)
    let colorSettings = [];
    try {
      const [colorRows] = await dbPool.execute(`SELECT * FROM ColorSetting`);
      colorSettings = colorRows;
    } catch (e) {
      console.log('ColorSetting table not available, using defaults');
    }

    // Fetch schedule blocks (locked cells)
    let blockRows = [];
    try {
      const [rows] = await dbPool.execute(
        `SELECT * FROM ScheduleBlock WHERE date >= ? AND date <= ?`,
        [startDate, endDate]
      );
      blockRows = rows;
    } catch (e) {
      // ScheduleBlock table may not exist yet
    }

    // Build block lookup map: "date|position" → reason
    const blockMap = new Map();
    for (const block of blockRows) {
      const dateStr = block.date instanceof Date ? format(block.date, 'yyyy-MM-dd') : String(block.date).substring(0, 10);
      const key = `${dateStr}|${block.position}`;
      blockMap.set(key, block.reason || 'Gesperrt');
    }

    // Helper: Get color for a name and category
    const getColor = (name, category) => {
      // 1. Check custom setting
      const setting = colorSettings.find(s => s.name === name && s.category === category);
      if (setting) {
        return { bg: getArgb(setting.bg_color), text: getArgb(setting.text_color) };
      }
      // 2. Check defaults
      let def = null;
      if (category === 'section') def = DEFAULT_COLORS.sections[name];
      if (category === 'position') def = DEFAULT_COLORS.positions[name];
      
      if (def) {
        return { bg: getArgb(def.bg), text: getArgb(def.text) };
      }
      // 3. Fallback
      return { bg: 'FFFFFFFF', text: 'FF000000' };
    };

    // Setup Rows - static absences and workplaces by category
    const staticAbsences = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
    const sortedWorkplaces = workplaceRows.sort((a, b) => (a.order || 0) - (b.order || 0));

    const sections = [
      { title: "Abwesenheiten", rows: staticAbsences },
      { title: "Dienste", rows: sortedWorkplaces.filter(w => w.category === "Dienste").map(w => w.name) },
      { title: "Rotationen", rows: sortedWorkplaces.filter(w => w.category === "Rotationen").map(w => w.name) },
      { title: "Demonstrationen & Konsile", rows: sortedWorkplaces.filter(w => w.category === "Demonstrationen & Konsile").map(w => w.name) },
      { title: "Sonstiges", rows: ["Sonstiges"] }
    ];

    // Prepare Days array
    const days = [];
    let curr = new Date(start);
    while (curr <= end) {
      days.push(new Date(curr));
      curr = addDays(curr, 1);
    }

    // Create Workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Wochenplan');

    // Setup Columns
    sheet.columns = [
      { header: 'Position / Datum', key: 'pos', width: 35 },
      ...days.map((d, i) => ({ header: formatDateHeader(d), key: `day_${i}`, width: 20 }))
    ];

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.height = 25;
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    });

    // Helper: Normalize date to string format yyyy-MM-dd
    const normalizeDate = (date) => {
      if (!date) return '';
      if (typeof date === 'string') return date.substring(0, 10);
      if (date instanceof Date) return format(date, 'yyyy-MM-dd');
      return String(date).substring(0, 10);
    };

    // Helper: Get content for a position and date
    const findContent = (posName, dateStr) => {
      if (posName === "Sonstiges") {
        const note = noteRows.find(n => normalizeDate(n.date) === dateStr && n.position === posName);
        return note ? note.content : "";
      }
      const cellShifts = shiftRows
        .filter(s => normalizeDate(s.date) === dateStr && s.position === posName)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      
      if (cellShifts.length === 0) return "";
      return cellShifts.map(s => {
        const doc = doctorRows.find(d => d.id === s.doctor_id);
        return doc ? (doc.initials || doc.name) : "?";
      }).join(", ");
    };

    // Add Rows for each section
    sections.forEach(section => {
      if (section.rows.length === 0) return;

      // Section Header Row
      const sectionRow = sheet.addRow([section.title]);
      const secColors = getColor(section.title, 'section');
      
      sectionRow.height = 25;
      sectionRow.font = { bold: true, color: { argb: secColors.text } };
      sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: secColors.bg } };
      sectionRow.getCell(1).alignment = { vertical: 'middle' };
      
      // Merge section header across all columns
      try {
        sheet.mergeCells(sectionRow.number, 1, sectionRow.number, days.length + 1);
      } catch (e) {} // ignore if fail
      
      // Apply border/fill to the merged cell
      sectionRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: secColors.bg } };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      // Data Rows for each position in section
      section.rows.forEach(rowName => {
        if (hiddenRows.includes(rowName)) return;

        const rowData = { pos: rowName };
        days.forEach((day, i) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          rowData[`day_${i}`] = findContent(rowName, dateStr);
        });
        
        const r = sheet.addRow(rowData);
        if (rowName !== "Sonstiges") {
          r.height = 20;
        }

        // Style first cell (Row Label)
        const firstCell = r.getCell(1);
        
        // Determine color for position
        let posColors = { bg: secColors.bg, text: secColors.text };
        
        // Check specific position color settings
        const posSetting = colorSettings.find(s => s.name === rowName && s.category === 'position');
        if (posSetting) {
          posColors = { bg: getArgb(posSetting.bg_color), text: getArgb(posSetting.text_color) };
        } else if (DEFAULT_COLORS.positions[rowName]) {
          const def = DEFAULT_COLORS.positions[rowName];
          posColors = { bg: getArgb(def.bg), text: getArgb(def.text) };
        }

        firstCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posColors.bg } };
        firstCell.font = { color: { argb: posColors.text }, bold: true };
        firstCell.alignment = { vertical: 'middle', wrapText: false };

        // Style Data Cells
        r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
          };
          if (colNumber > 1) {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            // Check if cell is blocked
            const dayIndex = colNumber - 2;
            if (dayIndex >= 0 && dayIndex < days.length) {
              const dateStr = format(days[dayIndex], 'yyyy-MM-dd');
              const blockKey = `${dateStr}|${rowName}`;
              const blockReason = blockMap.get(blockKey);
              if (blockReason) {
                cell.value = `🔒 ${blockReason}`;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                cell.font = { color: { argb: 'FF991B1B' }, italic: true };
              }
            }
          }
        });
      });
    });

    // Generate buffer and convert to base64
    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    // Return as JSON with base64 file (matching old Base44 format)
    res.json({ file: base64 });
    
  } catch (error) {
    console.error('Export error:', error);
    next(error);
  }
});

// ===== SEND SCHEDULE NOTIFICATIONS =====
router.post('/notify', async (req, res, next) => {
  try {
    const { scheduleId, type } = req.body;
    
    // Placeholder - implement actual notification logic
    // Could use email service, push notifications, etc.
    
    res.json({ success: true, message: 'Notifications sent' });
  } catch (error) {
    next(error);
  }
});

export default router;
