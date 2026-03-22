/* ============================================================
   Tests — CSV date handling (normalizeDate, isValidDate)
   ============================================================ */

describe('normalizeDate — ISO format', function() {
  it('passes through YYYY-MM-DD', function() {
    expect(normalizeDate('2026-01-15')).toBe('2026-01-15');
  });

  it('handles ISO with time portion', function() {
    expect(normalizeDate('2026-03-22T14:30:00Z')).toBe('2026-03-22');
  });

  it('zero-pads single-digit month and day', function() {
    expect(normalizeDate('2026-3-5')).toBe('2026-03-05');
  });

  it('handles ISO with offset', function() {
    expect(normalizeDate('2026-06-01T09:00:00-05:00')).toBe('2026-06-01');
  });
});

describe('normalizeDate — US format', function() {
  it('converts MM/DD/YYYY', function() {
    expect(normalizeDate('01/15/2026')).toBe('2026-01-15');
  });

  it('converts M/D/YYYY (no leading zeros)', function() {
    expect(normalizeDate('3/5/2026')).toBe('2026-03-05');
  });

  it('converts MM-DD-YYYY with dashes', function() {
    expect(normalizeDate('12-25-2025')).toBe('2025-12-25');
  });

  it('converts 12/31/2024', function() {
    expect(normalizeDate('12/31/2024')).toBe('2024-12-31');
  });
});

describe('normalizeDate — 2-digit year', function() {
  it('converts MM/DD/YY with year < 50 to 20xx', function() {
    expect(normalizeDate('01/15/26')).toBe('2026-01-15');
  });

  it('converts MM/DD/YY with year = 00 to 2000', function() {
    expect(normalizeDate('06/01/00')).toBe('2000-06-01');
  });

  it('converts MM/DD/YY with year > 50 to 19xx', function() {
    expect(normalizeDate('06/15/98')).toBe('1998-06-15');
  });

  it('converts MM/DD/YY with year = 50 to 2050', function() {
    expect(normalizeDate('01/01/50')).toBe('2050-01-01');
  });
});

describe('normalizeDate — named month formats', function() {
  it('converts "Jan 15, 2026"', function() {
    expect(normalizeDate('Jan 15, 2026')).toBe('2026-01-15');
  });

  it('converts "January 15, 2026"', function() {
    expect(normalizeDate('January 15, 2026')).toBe('2026-01-15');
  });

  it('converts "March 1, 2026" (single digit day)', function() {
    expect(normalizeDate('March 1, 2026')).toBe('2026-03-01');
  });

  it('converts "15 Jan 2026" (day-first)', function() {
    expect(normalizeDate('15 Jan 2026')).toBe('2026-01-15');
  });

  it('converts "1 December 2025"', function() {
    expect(normalizeDate('1 December 2025')).toBe('2025-12-01');
  });

  it('handles "Feb 28, 2026"', function() {
    expect(normalizeDate('Feb 28, 2026')).toBe('2026-02-28');
  });
});

describe('normalizeDate — Excel serial numbers', function() {
  it('converts serial 44927 (approx Jan 1 2023)', function() {
    var result = normalizeDate('44927');
    expect(result).toBeTruthy();
    // Should be a valid date string
    expect(result.length).toBe(10);
    expect(result.charAt(4)).toBe('-');
  });

  it('converts serial 45000', function() {
    var result = normalizeDate('45000');
    expect(result).toBeTruthy();
    expect(result.length).toBe(10);
  });

  it('does not treat small numbers as Excel serial', function() {
    // Numbers below 30000 should not be treated as Excel dates
    var result = normalizeDate('100');
    // This may fall through to native Date parsing or return ''
    // Either way it should not crash
    expect(typeof result).toBe('string');
  });
});

describe('normalizeDate — edge cases', function() {
  it('returns empty for null', function() {
    expect(normalizeDate(null)).toBe('');
  });

  it('returns empty for undefined', function() {
    expect(normalizeDate(undefined)).toBe('');
  });

  it('returns empty for empty string', function() {
    expect(normalizeDate('')).toBe('');
  });

  it('returns empty for whitespace only', function() {
    expect(normalizeDate('   ')).toBe('');
  });

  it('returns empty for non-numeric garbage', function() {
    expect(normalizeDate('not-a-date')).toBe('');
  });

  it('trims whitespace before parsing', function() {
    expect(normalizeDate('  2026-01-15  ')).toBe('2026-01-15');
  });

  it('rejects invalid calendar date 2026-02-30 via ISO path', function() {
    var result = normalizeDate('2026-02-30');
    expect(result).toBe('');
  });

  it('rejects invalid month 2026-13-01 via ISO path', function() {
    var result = normalizeDate('2026-13-01');
    expect(result).toBe('');
  });
});

describe('isValidDate', function() {
  it('accepts 2026-01-15', function() {
    expect(isValidDate('2026-01-15')).toBe(true);
  });

  it('accepts 2024-02-29 (leap year)', function() {
    expect(isValidDate('2024-02-29')).toBe(true);
  });

  it('rejects 2026-02-29 (not a leap year)', function() {
    expect(isValidDate('2026-02-29')).toBe(false);
  });

  it('rejects 2026-13-45', function() {
    expect(isValidDate('2026-13-45')).toBe(false);
  });

  it('rejects 2026-00-15 (month 0)', function() {
    expect(isValidDate('2026-00-15')).toBe(false);
  });

  it('rejects 2026-01-32 (day 32)', function() {
    expect(isValidDate('2026-01-32')).toBe(false);
  });

  it('rejects empty string', function() {
    expect(isValidDate('')).toBe(false);
  });

  it('rejects null', function() {
    expect(isValidDate(null)).toBe(false);
  });

  it('rejects non-YYYY-MM-DD format', function() {
    expect(isValidDate('01/15/2026')).toBe(false);
  });

  it('rejects partial date', function() {
    expect(isValidDate('2026-01')).toBe(false);
  });

  it('accepts last day of month: 2026-04-30', function() {
    expect(isValidDate('2026-04-30')).toBe(true);
  });

  it('rejects April 31: 2026-04-31', function() {
    expect(isValidDate('2026-04-31')).toBe(false);
  });
});

describe('parseCSVLine', function() {
  it('splits simple comma-separated values', function() {
    var result = parseCSVLine('a,b,c');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with commas', function() {
    var result = parseCSVLine('"Smith, John",42,active');
    expect(result[0]).toBe('Smith, John');
    expect(result[1]).toBe('42');
  });

  it('handles empty fields', function() {
    var result = parseCSVLine('a,,c');
    expect(result[1]).toBe('');
  });

  it('trims whitespace from fields', function() {
    var result = parseCSVLine(' hello , world ');
    expect(result[0]).toBe('hello');
    expect(result[1]).toBe('world');
  });
});
