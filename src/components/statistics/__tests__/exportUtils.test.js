import { describe, expect, it } from 'vitest';

import { escapeCsvCell, escapeHtmlCell, sanitizeSpreadsheetCell } from '../exportUtils';

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
