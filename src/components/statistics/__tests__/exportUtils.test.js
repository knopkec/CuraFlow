import { beforeEach, describe, expect, it, vi } from 'vitest';

import { escapeCsvCell, escapeHtmlCell, exportStatisticsPdf, sanitizeSpreadsheetCell } from '../exportUtils';

const staticMockInstance = vi.hoisted(() => ({
  internal: {
    pageSize: {
      getWidth: () => 800,
      getHeight: () => 600,
    },
  },
  setFont: vi.fn(),
  setFontSize: vi.fn(),
  text: vi.fn(),
  addPage: vi.fn(),
  splitTextToSize: vi.fn((line) => [line]),
  save: vi.fn(),
}));

const { mockJsPDF } = vi.hoisted(() => {
  const calls = [];
  function mockJsPDF(...args) {
    calls.push(args);
    return staticMockInstance;
  }
  mockJsPDF._calls = calls;
  return { mockJsPDF };
});

vi.mock('jspdf', () => ({ jsPDF: mockJsPDF, default: mockJsPDF }));

const mockStats = {
  serviceItems: ['Früh', 'Spät', 'Nacht'],
  rotationItems: ['Bereitschaft'],
  byDoctor: [
    {
      name: 'Anna Adler',
      role: 'Fachärztin',
      totalDienste: 12,
      totalRotationen: 3,
      breakdown: { Früh: 5, Spät: 4, Nacht: 3, Bereitschaft: 3 },
    },
    {
      name: 'Ben Bauer',
      role: 'Assistenzarzt',
      totalDienste: 10,
      totalRotationen: 2,
      breakdown: { Früh: 4, Spät: 3, Nacht: 3, Bereitschaft: 2 },
    },
  ],
};

describe('sanitizeSpreadsheetCell', () => {
  it('prefixes dangerous spreadsheet formulas with an apostrophe', () => {
    expect(sanitizeSpreadsheetCell('=1+1')).toBe("'=1+1");
    expect(sanitizeSpreadsheetCell('+cmd')).toBe("'+cmd");
    expect(sanitizeSpreadsheetCell('-hidden')).toBe("'-hidden");
    expect(sanitizeSpreadsheetCell('@user')).toBe("'@user");
  });

  it('leaves safe values unchanged', () => {
    expect(sanitizeSpreadsheetCell('Anna Adler')).toBe('Anna Adler');
    expect(sanitizeSpreadsheetCell(12)).toBe('12');
  });
});

describe('escapeCsvCell', () => {
  it('escapes quotes and neutralizes spreadsheet formulas', () => {
    expect(escapeCsvCell('=SUM("A1:A2")')).toBe('"\'=SUM(""A1:A2"")"');
  });
});

describe('escapeHtmlCell', () => {
  it('escapes html and neutralizes spreadsheet formulas', () => {
    expect(escapeHtmlCell('=<script>alert("x")</script>')).toBe("'=&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});

describe('exportStatisticsPdf', () => {
  beforeEach(() => {
    staticMockInstance.setFont.mockClear();
    staticMockInstance.setFontSize.mockClear();
    staticMockInstance.text.mockClear();
    staticMockInstance.addPage.mockClear();
    staticMockInstance.splitTextToSize.mockClear();
    staticMockInstance.save.mockClear();
    staticMockInstance.splitTextToSize.mockImplementation((line) => [line]);
    mockJsPDF._calls.length = 0;
  });

  it('creates a landscape A4 PDF with compress enabled', () => {
    exportStatisticsPdf({ stats: mockStats, year: '2026', month: 'all', title: 'Test Statistik' });

    expect(mockJsPDF._calls).toEqual([
      [{ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true }],
    ]);
  });

  it('writes title, year and filter text', () => {
    exportStatisticsPdf({ stats: mockStats, year: '2026', month: 'all', title: 'Test Statistik' });

    expect(staticMockInstance.setFont).toHaveBeenCalledWith('helvetica', 'bold');
    expect(staticMockInstance.setFontSize).toHaveBeenCalledWith(16);
    expect(staticMockInstance.text).toHaveBeenCalledWith('Test Statistik', 40, 40);
    expect(staticMockInstance.text).toHaveBeenCalledWith('Exportjahr: 2026', 40, 64);
    expect(staticMockInstance.text).toHaveBeenCalledWith('Filter: Ganzes Jahr', 40, 76);
  });

  it('writes monthly filter text when month is specified', () => {
    exportStatisticsPdf({ stats: mockStats, year: '2026', month: '3', title: 'Test' });

    expect(staticMockInstance.text).toHaveBeenCalledWith('Filter: Monat 4', 40, 76);
  });

  it('writes header and data rows with courier font at size 8', () => {
    exportStatisticsPdf({ stats: mockStats, year: '2026', month: 'all', title: 'Test' });

    expect(staticMockInstance.setFont).toHaveBeenCalledWith('courier', 'bold');
    expect(staticMockInstance.setFont).toHaveBeenCalledWith('courier', 'normal');
    expect(staticMockInstance.setFontSize).toHaveBeenCalledWith(8);
    expect(staticMockInstance.text).toHaveBeenCalled();
  });

  it('adds a new page when content exceeds one page', () => {
    staticMockInstance.splitTextToSize.mockImplementation((line) => new Array(60).fill(line));

    exportStatisticsPdf({ stats: mockStats, year: '2026', month: 'all', title: 'Test' });

    expect(staticMockInstance.addPage).toHaveBeenCalled();
  });

  it('saves with the correct filename for full year', () => {
    exportStatisticsPdf({ stats: mockStats, year: '2026', month: 'all', title: 'Test' });

    expect(staticMockInstance.save).toHaveBeenCalledWith('statistik_2026_gesamt.pdf');
  });

  it('saves with the correct filename for a specific month', () => {
    exportStatisticsPdf({ stats: mockStats, year: '2026', month: '0', title: 'Test' });

    expect(staticMockInstance.save).toHaveBeenCalledWith('statistik_2026_monat-01.pdf');
  });

  it('handles empty doctor list without crashing', () => {
    const emptyStats = { serviceItems: [], rotationItems: [], byDoctor: [] };

    expect(() => {
      exportStatisticsPdf({ stats: emptyStats, year: '2026', month: 'all', title: 'Empty' });
    }).not.toThrow();
  });
});
