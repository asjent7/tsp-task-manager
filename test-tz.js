// Unit tests for Google Calendar datetime parsing helpers.
// Run with: node test-tz.js
// These functions run on a UTC server, so they must extract the LOCAL time
// directly from the embedded offset in the ISO string — never use Date.getHours().

function parseGoogleDt(dtStr) {
  if (!dtStr || !dtStr.includes('T')) return null;
  const localMatch = dtStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}[+-]\d{2}:\d{2}$/);
  if (localMatch) return { date: localMatch[1], time: localMatch[2] };
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function googleDurMins(startStr, endStr) {
  if (!endStr) return 60;
  return Math.round((new Date(endStr) - new Date(startStr)) / 60000);
}

let pass = 0, fail = 0;

function check(label, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { console.log(`  expected: ${JSON.stringify(expected)}`); console.log(`  got:      ${JSON.stringify(got)}`); fail++; }
  else pass++;
}

// parseGoogleDt — EDT (UTC-4), active Mar–Nov
check('EDT morning',          parseGoogleDt('2026-10-07T09:00:00-04:00'), { date: '2026-10-07', time: '09:00' });
check('EDT afternoon',        parseGoogleDt('2026-10-07T17:30:00-04:00'), { date: '2026-10-07', time: '17:30' });
check('EDT early morning',    parseGoogleDt('2026-10-07T05:00:00-04:00'), { date: '2026-10-07', time: '05:00' });

// parseGoogleDt — EST (UTC-5), active Nov–Mar
check('EST afternoon',        parseGoogleDt('2026-01-15T14:00:00-05:00'), { date: '2026-01-15', time: '14:00' });
check('EST morning',          parseGoogleDt('2026-02-28T08:30:00-05:00'), { date: '2026-02-28', time: '08:30' });
check('EST noon',             parseGoogleDt('2026-12-01T12:00:00-05:00'), { date: '2026-12-01', time: '12:00' });

// DST spring-forward: 2026-03-08 — clocks go 2:00am → 3:00am (EST→EDT)
check('DST spring-forward before (1am EST)', parseGoogleDt('2026-03-08T01:00:00-05:00'), { date: '2026-03-08', time: '01:00' });
check('DST spring-forward after  (3am EDT)', parseGoogleDt('2026-03-08T03:00:00-04:00'), { date: '2026-03-08', time: '03:00' });
check('DST spring-forward after  (4am EDT)', parseGoogleDt('2026-03-08T04:00:00-04:00'), { date: '2026-03-08', time: '04:00' });

// DST fall-back: 2026-11-01 — clocks go 2:00am → 1:00am (EDT→EST)
check('DST fall-back before  (1am EDT)', parseGoogleDt('2026-11-01T01:00:00-04:00'), { date: '2026-11-01', time: '01:00' });
check('DST fall-back after   (1am EST)', parseGoogleDt('2026-11-01T01:00:00-05:00'), { date: '2026-11-01', time: '01:00' });
check('DST fall-back after   (2am EST)', parseGoogleDt('2026-11-01T02:00:00-05:00'), { date: '2026-11-01', time: '02:00' });

// parseGoogleDt — UTC "Z" suffix (Google returns UTC when timeZone param absent)
// EDT = UTC-4, so 13:15Z → 09:15 ET; 09:00Z → 05:00 ET
check('UTC Z: afternoon EDT',    parseGoogleDt('2026-10-09T13:15:00Z'), { date: '2026-10-09', time: '09:15' });
check('UTC Z: morning EDT',      parseGoogleDt('2026-10-07T09:00:00Z'), { date: '2026-10-07', time: '05:00' });
// 03:30Z on Oct 6 = 23:30 ET on Oct 5 — date rolls back
check('UTC Z: date rollover EDT', parseGoogleDt('2026-10-06T03:30:00Z'), { date: '2026-10-05', time: '23:30' });
// EST = UTC-5 (winter)
check('UTC Z: afternoon EST',    parseGoogleDt('2026-01-15T19:00:00Z'), { date: '2026-01-15', time: '14:00' });
check('UTC Z: morning EST',      parseGoogleDt('2026-02-10T13:30:00Z'), { date: '2026-02-10', time: '08:30' });

// Null / edge cases
check('null input',           parseGoogleDt(null), null);
check('empty string',         parseGoogleDt(''),   null);
check('all-day date (no T)',  parseGoogleDt('2026-10-07'), null);

// googleDurMins — duration is always UTC-safe (ms difference)
check('60min EDT',            googleDurMins('2026-10-07T09:00:00-04:00', '2026-10-07T10:00:00-04:00'), 60);
check('90min EDT',            googleDurMins('2026-10-07T09:00:00-04:00', '2026-10-07T10:30:00-04:00'), 90);
check('30min EST',            googleDurMins('2026-01-15T14:00:00-05:00', '2026-01-15T14:30:00-05:00'), 30);
check('120min overnight EDT', googleDurMins('2026-10-07T23:00:00-04:00', '2026-10-08T01:00:00-04:00'), 120);
// 1h span crossing the DST spring-forward gap: 1:30am EST → 3:30am EDT = 60 real minutes
check('DST spring-forward span (60 real min)', googleDurMins('2026-03-08T01:30:00-05:00', '2026-03-08T03:30:00-04:00'), 60);
// no endStr defaults to 60
check('no end defaults to 60', googleDurMins('2026-10-07T09:00:00-04:00', null), 60);
check('no end undefined',      googleDurMins('2026-10-07T09:00:00-04:00', undefined), 60);

// Confirm the OLD broken approach would have failed these
function brokenGetHours(dtStr) { return new Date(dtStr).getUTCHours(); }
const brokenEDT = brokenGetHours('2026-10-07T05:00:00-04:00'); // should be 5, gets 9
const brokenEST = brokenGetHours('2026-01-15T14:00:00-05:00'); // should be 14, gets 19
check('OLD approach broken for EDT (sanity)', brokenEDT !== 5, true);
check('OLD approach broken for EST (sanity)', brokenEST !== 14, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
