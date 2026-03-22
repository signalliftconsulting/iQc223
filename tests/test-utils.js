/* ============================================================
   Tests — Utility functions (escHtml, fmtNum, debounce, el)
   ============================================================ */

describe('escHtml', function() {
  it('escapes ampersand', function() {
    expect(escHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less-than', function() {
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than', function() {
    expect(escHtml('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes double quotes', function() {
    expect(escHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes', function() {
    expect(escHtml("it's")).toBe("it&#39;s");
  });

  it('handles all XSS chars at once', function() {
    expect(escHtml('<img src="x" onerror=\'alert(1)\'>&')).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;'
    );
  });

  it('converts non-string to string', function() {
    expect(escHtml(123)).toBe('123');
  });

  it('handles empty string', function() {
    expect(escHtml('')).toBe('');
  });

  it('handles null via String() coercion', function() {
    expect(escHtml(null)).toBe('null');
  });

  it('handles undefined via String() coercion', function() {
    expect(escHtml(undefined)).toBe('undefined');
  });

  it('leaves safe text unchanged', function() {
    expect(escHtml('Hello World 123')).toBe('Hello World 123');
  });
});

describe('fmtNum', function() {
  it('formats 1000 as 1K', function() {
    expect(fmtNum(1000)).toBe('1K');
  });

  it('formats 1500 as 1.5K', function() {
    expect(fmtNum(1500)).toBe('1.5K');
  });

  it('formats 10000 as 10K', function() {
    expect(fmtNum(10000)).toBe('10K');
  });

  it('formats 1000000 as 1M', function() {
    expect(fmtNum(1000000)).toBe('1M');
  });

  it('formats 2500000 as 2.5M', function() {
    expect(fmtNum(2500000)).toBe('2.5M');
  });

  it('formats 1200000 as 1.2M', function() {
    expect(fmtNum(1200000)).toBe('1.2M');
  });

  it('keeps small numbers as-is with locale formatting', function() {
    // 999 should not get K suffix
    var result = fmtNum(999);
    expect(result).toBe('999');
  });

  it('formats exactly at 1M boundary', function() {
    expect(fmtNum(1000000)).toBe('1M');
  });

  it('strips trailing .0 from K values', function() {
    // 2000 => 2.0K => 2K
    expect(fmtNum(2000)).toBe('2K');
  });

  it('strips trailing .0 from M values', function() {
    // 3000000 => 3.0M => 3M
    expect(fmtNum(3000000)).toBe('3M');
  });

  it('handles zero', function() {
    expect(fmtNum(0)).toBe('0');
  });
});

describe('debounce', function() {
  it('delays execution', function() {
    var count = 0;
    var fn = debounce(function() { count++; }, 50);
    fn();
    fn();
    fn();
    // Immediately after calling, count should still be 0
    expect(count).toBe(0);
  });

  it('returns a function', function() {
    var fn = debounce(function() {}, 100);
    expect(typeof fn).toBe('function');
  });

  it('coalesces rapid calls (async)', function() {
    // We can't easily test the async part synchronously,
    // but we can verify the debounce doesn't fire immediately
    var count = 0;
    var fn = debounce(function() { count++; }, 10);
    fn(); fn(); fn(); fn(); fn();
    expect(count).toBe(0);
  });
});

describe('el', function() {
  it('returns element by ID', function() {
    var div = document.createElement('div');
    div.id = 'test-el-target';
    document.body.appendChild(div);
    expect(el('test-el-target')).toBe(div);
    document.body.removeChild(div);
  });

  it('returns null for missing ID', function() {
    expect(el('nonexistent-id-xyz')).toBeNull();
  });
});

describe('fmtRenewalTime', function() {
  it('returns "today" for zero months', function() {
    expect(fmtRenewalTime(0)).toBe('today');
  });

  it('returns singular "month" for 1', function() {
    expect(fmtRenewalTime(1)).toBe('1 month');
  });

  it('returns plural "months" for > 1', function() {
    expect(fmtRenewalTime(6)).toBe('6 months');
  });

  it('returns dash for null', function() {
    expect(fmtRenewalTime(null)).toBe(' -');
  });
});

describe('fmtTime12', function() {
  it('converts 13:00 to 1:00 PM', function() {
    expect(fmtTime12('13:00')).toBe('1:00 PM');
  });

  it('converts 00:30 to 12:30 AM', function() {
    expect(fmtTime12('00:30')).toBe('12:30 AM');
  });

  it('converts 09:15 to 9:15 AM', function() {
    expect(fmtTime12('09:15')).toBe('9:15 AM');
  });

  it('converts 12:00 to 12:00 PM', function() {
    expect(fmtTime12('12:00')).toBe('12:00 PM');
  });

  it('returns empty for falsy input', function() {
    expect(fmtTime12('')).toBe('');
    expect(fmtTime12(null)).toBe('');
  });
});
