/* ============================================================
   Tests — Scoring engine (calcScore, normalization, getStatus)
   ============================================================ */

describe('npsNormalized', function() {
  it('returns 50 for null', function() {
    expect(npsNormalized(null)).toBe(50);
  });

  it('returns 0 for NPS 0', function() {
    expect(npsNormalized(0)).toBe(0);
  });

  it('returns 100 for NPS 10', function() {
    expect(npsNormalized(10)).toBe(100);
  });

  it('returns 70 for NPS 7', function() {
    expect(npsNormalized(7)).toBe(70);
  });

  it('returns 50 for NPS 5', function() {
    expect(npsNormalized(5)).toBe(50);
  });
});

describe('csatNormalized', function() {
  it('returns 50 for null', function() {
    expect(csatNormalized(null)).toBe(50);
  });

  it('returns 0 for CSAT 1', function() {
    expect(csatNormalized(1)).toBe(0);
  });

  it('returns 100 for CSAT 5', function() {
    expect(csatNormalized(5)).toBe(100);
  });

  it('returns 50 for CSAT 3', function() {
    expect(csatNormalized(3)).toBe(50);
  });

  it('returns 75 for CSAT 4', function() {
    expect(csatNormalized(4)).toBe(75);
  });
});

describe('npsCategory', function() {
  it('returns Promoter for 9', function() {
    expect(npsCategory(9)).toBe('Promoter');
  });

  it('returns Promoter for 10', function() {
    expect(npsCategory(10)).toBe('Promoter');
  });

  it('returns Passive for 7', function() {
    expect(npsCategory(7)).toBe('Passive');
  });

  it('returns Passive for 8', function() {
    expect(npsCategory(8)).toBe('Passive');
  });

  it('returns Detractor for 6', function() {
    expect(npsCategory(6)).toBe('Detractor');
  });

  it('returns Detractor for 0', function() {
    expect(npsCategory(0)).toBe('Detractor');
  });

  it('returns N/A for null', function() {
    expect(npsCategory(null)).toBe('N/A');
  });
});

describe('csatCategory', function() {
  it('returns Good for 4', function() {
    expect(csatCategory(4)).toBe('Good');
  });

  it('returns Good for 5', function() {
    expect(csatCategory(5)).toBe('Good');
  });

  it('returns Neutral for 3', function() {
    expect(csatCategory(3)).toBe('Neutral');
  });

  it('returns Poor for 2', function() {
    expect(csatCategory(2)).toBe('Poor');
  });

  it('returns Poor for 1', function() {
    expect(csatCategory(1)).toBe('Poor');
  });

  it('returns N/A for null', function() {
    expect(csatCategory(null)).toBe('N/A');
  });
});

describe('calcScore — basic signals', function() {
  var equalWeights = { logins: 15, adoption: 30, tickets: 10, nps: 15, csat: 5, days: 15, growth: 10 };

  it('returns score between 0 and 100', function() {
    var r = calcScore({ logins: 15, adoption: 50, tickets: 2, nps: 7, csat: 3, days: 30, growth: 'mild' }, equalWeights);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('returns 100 for perfect signals', function() {
    var r = calcScore({ logins: 30, adoption: 100, tickets: 0, nps: 10, csat: 5, days: 0, growth: 'strong' }, equalWeights);
    expect(r.score).toBe(100);
  });

  it('returns low score for worst signals', function() {
    var r = calcScore({ logins: 0, adoption: 0, tickets: 10, nps: 0, csat: 1, days: 180, growth: 'none' }, equalWeights);
    expect(r.score).toBeLessThanOrEqual(15);
  });

  it('handles all null signals (defaults to 50 neutral)', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: null, nps: null, csat: null, days: null, growth: 'na' }, equalWeights);
    expect(r.score).toBe(50);
  });

  it('handles missing growth signal', function() {
    var r = calcScore({ logins: 15, adoption: 50, tickets: 1, nps: 8, csat: 4, days: 10, growth: undefined }, equalWeights);
    expect(r.score).toBeGreaterThan(0);
  });

  it('caps logins normalization at 30 days', function() {
    var r1 = calcScore({ logins: 30, adoption: null, tickets: null, nps: null, csat: null, days: null, growth: 'na' }, equalWeights);
    var r2 = calcScore({ logins: 60, adoption: null, tickets: null, nps: null, csat: null, days: null, growth: 'na' }, equalWeights);
    // Both should produce the same score since logins cap at 30
    expect(r1.score).toBe(r2.score);
  });

  it('tickets normalization: 0 tickets = 100', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: 0, nps: null, csat: null, days: null, growth: 'na' }, equalWeights);
    expect(r.signals.tickets_n).toBe(100);
  });

  it('tickets normalization: 5 tickets = 0', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: 5, nps: null, csat: null, days: null, growth: 'na' }, equalWeights);
    expect(r.signals.tickets_n).toBe(0);
  });

  it('days normalization: 0 days = 100', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: null, nps: null, csat: null, days: 0, growth: 'na' }, equalWeights);
    expect(r.signals.days_n).toBe(100);
  });

  it('days normalization: 180 days = 0', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: null, nps: null, csat: null, days: 180, growth: 'na' }, equalWeights);
    expect(r.signals.days_n).toBe(0);
  });

  it('growth signal: strong = 100', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: null, nps: null, csat: null, days: null, growth: 'strong' }, equalWeights);
    expect(r.signals.growth_n).toBe(100);
  });

  it('growth signal: mild = 65', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: null, nps: null, csat: null, days: null, growth: 'mild' }, equalWeights);
    expect(r.signals.growth_n).toBe(65);
  });

  it('growth signal: none = 25', function() {
    var r = calcScore({ logins: null, adoption: null, tickets: null, nps: null, csat: null, days: null, growth: 'none' }, equalWeights);
    expect(r.signals.growth_n).toBe(25);
  });

  it('includes signals object in result', function() {
    var r = calcScore({ logins: 15, adoption: 50, tickets: 2, nps: 7, csat: 3, days: 30, growth: 'mild' }, equalWeights);
    expect(typeof r.signals).toBe('object');
    expect(typeof r.signals.logins_n).toBe('number');
    expect(typeof r.signals.adoption_n).toBe('number');
  });
});

describe('getStatus — default thresholds (critical=25, risk=50, watch=65, healthy=90)', function() {
  // Tests against the DEFAULT_THRESHOLDS from state.js
  // Score < 25 = critical, < 50 = risk, < 65 = watch, < 90 = healthy, >= 90 = expand

  it('returns critical for score 0', function() {
    expect(getStatus(0)).toBe('critical');
  });

  it('returns critical for score 24', function() {
    expect(getStatus(24)).toBe('critical');
  });

  it('returns risk at threshold boundary 25', function() {
    expect(getStatus(25)).toBe('risk');
  });

  it('returns risk for score 49', function() {
    expect(getStatus(49)).toBe('risk');
  });

  it('returns watch at threshold boundary 50', function() {
    expect(getStatus(50)).toBe('watch');
  });

  it('returns watch for score 64', function() {
    expect(getStatus(64)).toBe('watch');
  });

  it('returns healthy at threshold boundary 65', function() {
    expect(getStatus(65)).toBe('healthy');
  });

  it('returns healthy for score 89', function() {
    expect(getStatus(89)).toBe('healthy');
  });

  it('returns expand at threshold boundary 90', function() {
    expect(getStatus(90)).toBe('expand');
  });

  it('returns expand for score 100', function() {
    expect(getStatus(100)).toBe('expand');
  });
});

describe('decodeFeedbackPair', function() {
  it('decodes pipe-separated NPS|CSAT', function() {
    var r = decodeFeedbackPair('9|4');
    expect(r.nps).toBe(9);
    expect(r.csat).toBe(4);
  });

  it('decodes NPS only (empty CSAT)', function() {
    var r = decodeFeedbackPair('8|');
    expect(r.nps).toBe(8);
    expect(r.csat).toBeNull();
  });

  it('decodes CSAT only (empty NPS)', function() {
    var r = decodeFeedbackPair('|3');
    expect(r.nps).toBeNull();
    expect(r.csat).toBe(3);
  });

  it('returns nulls for empty string', function() {
    var r = decodeFeedbackPair('');
    expect(r.nps).toBeNull();
    expect(r.csat).toBeNull();
  });

  it('returns nulls for null', function() {
    var r = decodeFeedbackPair(null);
    expect(r.nps).toBeNull();
    expect(r.csat).toBeNull();
  });

  it('handles legacy "promoter" string', function() {
    var r = decodeFeedbackPair('promoter');
    expect(r.nps).toBe(10);
  });

  it('handles legacy "detractor" string', function() {
    var r = decodeFeedbackPair('detractor');
    expect(r.nps).toBe(3);
  });

  it('handles bare NPS number', function() {
    var r = decodeFeedbackPair('7');
    expect(r.nps).toBe(7);
  });
});

describe('encodeFeedbackPair', function() {
  it('encodes both values', function() {
    expect(encodeFeedbackPair(9, 4)).toBe('9|4');
  });

  it('encodes NPS only', function() {
    expect(encodeFeedbackPair(8, null)).toBe('8|');
  });

  it('encodes CSAT only', function() {
    expect(encodeFeedbackPair(null, 3)).toBe('|3');
  });

  it('returns empty for both null', function() {
    expect(encodeFeedbackPair(null, null)).toBe('');
  });
});
