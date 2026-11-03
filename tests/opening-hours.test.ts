import { describe, expect, it } from 'vitest';
import { easterSunday, holidayOn, nrwHolidaysForYear } from '@/data/holidays';
import { formatHours, openingHours } from '@/data/company';
import { computeOpenStatus, formatClockDisplay, resolveDayPlan } from '@/lib/opening-hours';
import type { OpenPlanContext } from '@/lib/opening-hours';

/** Build a Date that is this wall-clock time in Europe/Berlin. */
function berlinDate(isoDate: string, hh: number, mm: number): Date {
  // Use a formatter round-trip via explicit offset approximation:
  // pick UTC instant and verify with Intl; adjust if needed.
  const [y, m, d] = isoDate.split('-').map(Number);
  let guess = Date.UTC(y!, m! - 1, d!, hh - 1, mm, 0); // CET-ish start
  for (let i = 0; i < 8; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const got = `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')} ${String(get('hour')).padStart(2, '0')}:${String(get('minute')).padStart(2, '0')}`;
    const want = `${isoDate} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (got === want) return new Date(guess);
    const diffMin =
      (hh - get('hour')) * 60 +
      (mm - get('minute')) +
      (Number(isoDate.slice(8, 10)) - get('day')) * 24 * 60;
    guess += diffMin * 60_000;
  }
  return new Date(guess);
}

describe('NRW holidays', () => {
  it('computes Easter 2026 correctly', () => {
    const e = easterSunday(2026);
    expect(e.getFullYear()).toBe(2026);
    expect(e.getMonth() + 1).toBe(4);
    expect(e.getDate()).toBe(5);
  });

  it('includes fixed and movable NRW holidays', () => {
    const list = nrwHolidaysForYear(2026);
    expect(list.find((h) => h.date === '2026-01-01')?.name).toBe('Neujahr');
    expect(list.find((h) => h.date === '2026-04-03')?.name).toBe('Karfreitag');
    expect(list.find((h) => h.date === '2026-04-06')?.name).toBe('Ostermontag');
    expect(list.find((h) => h.date === '2026-06-04')?.name).toBe('Fronleichnam');
    expect(list.find((h) => h.date === '2026-12-25')?.name).toBe('1. Weihnachtstag');
  });

  it('resolves holidayOn', () => {
    expect(holidayOn('2026-10-03')?.name).toBe('Tag der Deutschen Einheit');
    expect(holidayOn('2026-10-04')).toBeNull();
  });
});

describe('computeOpenStatus with holidays', () => {
  it('shows closed with holiday name on Neujahr even midday', () => {
    const s = computeOpenStatus(berlinDate('2026-01-01', 10, 0));
    expect(s.state).toBe('closed');
    expect(s.reason).toBe('holiday');
    expect(s.holiday?.name).toBe('Neujahr');
    expect(s.label).toContain('Neujahr');
    expect(s.label).toMatch(/geschlossen/i);
    expect(s.shortLabel).toMatch(/Feiertag/i);
    expect(s.todayLabel).toContain('Feiertag');
  });

  it('after midnight into a holiday stays closed and names the holiday', () => {
    const s = computeOpenStatus(berlinDate('2026-12-25', 0, 15));
    expect(s.state).toBe('closed');
    expect(s.reason).toBe('holiday');
    expect(s.holiday?.name).toBe('1. Weihnachtstag');
    expect(s.shortLabel).toMatch(/Feiertag/i);
    expect(s.label).toContain('1. Weihnachtstag');
    expect(s.compactLabel).toBe('Feiertag');
  });

  it('marks German Unity Day 2026 as holiday', () => {
    const s = computeOpenStatus(berlinDate('2026-10-03', 14, 0));
    expect(s.reason).toBe('holiday');
    expect(s.holiday?.name).toBe('Tag der Deutschen Einheit');
    expect(s.label).toContain('Tag der Deutschen Einheit');
  });

  it('opens on a normal weekday morning with responsive pill copy', () => {
    // 2026-01-07 is a Wednesday — morning slot closes 13:00
    const s = computeOpenStatus(berlinDate('2026-01-07', 9, 30));
    expect(s.state).toBe('open');
    expect(s.label).toBe('Heute geöffnet bis 13 Uhr');
    expect(s.shortLabel).toBe('Geöffnet bis 13 Uhr');
    expect(s.compactLabel).toBe('Bis 13 Uhr geöffnet');
    if (s.state === 'open') expect(s.closesAt).toBe('13:00');
  });

  it('formats afternoon close as 17 Uhr on weekday', () => {
    const s = computeOpenStatus(berlinDate('2026-01-07', 15, 0));
    expect(s.state).toBe('open');
    expect(s.label).toBe('Heute geöffnet bis 17 Uhr');
    expect(s.shortLabel).toBe('Geöffnet bis 17 Uhr');
  });

  it('skips holidays when announcing next open', () => {
    // Friday 2026-01-02 evening – next open should skip nothing weird; New Year was day before
    const s = computeOpenStatus(berlinDate('2026-04-03', 12, 0)); // Karfreitag
    expect(s.state).toBe('closed');
    expect(s.reason).toBe('holiday');
    if (s.state === 'closed') {
      expect(s.opensNext).toBeTruthy();
      expect(s.opensNext).not.toMatch(/heute/i);
    }
  });
});

describe('opening precedence manual > special > holiday > weekly', () => {
  it('manual closed beats holiday and weekly', () => {
    // 2026-01-07 Wednesday (normal open day)
    const ctx: OpenPlanContext = {
      manual: [{ date: '2026-01-07', closed: true, label: 'Betriebsintern geschlossen' }],
    };
    const s = computeOpenStatus(berlinDate('2026-01-07', 10, 0), undefined, ctx);
    expect(s.state).toBe('closed');
    expect(s.reason).toBe('manual');
    expect(s.label).toContain('Betriebsintern');
  });

  it('manual open hours beat NRW holiday closure', () => {
    const ctx: OpenPlanContext = {
      manual: [
        {
          date: '2026-01-01',
          hours: [{ opens: '10:00', closes: '14:00' }],
          label: 'Neujahrs-Sonderöffnung',
        },
      ],
    };
    const s = computeOpenStatus(berlinDate('2026-01-01', 11, 0), undefined, ctx);
    expect(s.state).toBe('open');
    expect(s.reason).toBe('manual');
    expect(s.label).toMatch(/geöffnet/i);
  });

  it('special day beats holiday when no manual', () => {
    const ctx: OpenPlanContext = {
      special: [{ date: '2026-10-03', closed: true, label: 'Inventur' }],
    };
    const plan = resolveDayPlan('2026-10-03', 'Saturday', 2026, ctx);
    expect(plan.kind).toBe('closed');
    expect(plan.reason).toBe('special');
  });

  it('special open hours beat weekly when no manual', () => {
    // Sunday normally closed
    const ctx: OpenPlanContext = {
      special: [
        {
          date: '2026-01-11',
          hours: [{ opens: '11:00', closes: '15:00' }],
          label: 'Tag der offenen Tür',
        },
      ],
    };
    const s = computeOpenStatus(berlinDate('2026-01-11', 12, 0), undefined, ctx);
    expect(s.state).toBe('open');
    expect(s.reason).toBe('special');
  });

  it('holiday policy closed still closes without overrides', () => {
    const plan = resolveDayPlan('2026-05-01', 'Friday', 2026, { holidayPolicy: 'closed' });
    expect(plan.kind).toBe('closed');
    expect(plan.reason).toBe('holiday');
  });

  it('manual wins over special on same date', () => {
    const ctx: OpenPlanContext = {
      manual: [{ date: '2026-01-10', closed: true, label: 'Manuell zu' }],
      special: [
        {
          date: '2026-01-10',
          hours: [{ opens: '09:00', closes: '13:00' }],
          label: 'Special offen',
        },
      ],
    };
    const plan = resolveDayPlan('2026-01-10', 'Saturday', 2026, ctx);
    expect(plan.kind).toBe('closed');
    expect(plan.reason).toBe('manual');
  });
});

describe('formatClockDisplay + pill copy variants', () => {
  it('drops :00 minutes for badge clocks', () => {
    expect(formatClockDisplay('13:00')).toBe('13');
    expect(formatClockDisplay('09:00')).toBe('9');
    expect(formatClockDisplay('18:30')).toBe('18:30');
  });

  it('lists Saturday as geschlossen and treats it as a closed day', () => {
    const saturday = openingHours.find((p) => p.schemaDays.includes('Saturday'));
    expect(saturday?.hours).toEqual([]);
    expect(formatHours(saturday!)).toBe('geschlossen');
    const plan = resolveDayPlan('2026-01-10', 'Saturday', 2026);
    expect(plan.kind).toBe('closed');
  });

  it('uses Heute geschlossen on Sunday', () => {
    const s = computeOpenStatus(berlinDate('2026-01-11', 12, 0));
    expect(s.state).toBe('closed');
    expect(s.reason).toBe('sunday');
    expect(s.label).toBe('Heute geschlossen');
    expect(s.shortLabel).toBe('Geschlossen');
  });

  it('uses Aktuell geschlossen outside weekday hours with next-open hint', () => {
    const s = computeOpenStatus(berlinDate('2026-01-07', 20, 0));
    expect(s.state).toBe('closed');
    expect(s.reason).toBe('outside');
    expect(s.label).toBe('Aktuell geschlossen');
    if (s.state === 'closed') {
      expect(s.opensNext).toMatch(/Öffnet morgen um/i);
    }
  });

  it('Allerheiligen 2026 is a closed NRW holiday', () => {
    const s = computeOpenStatus(berlinDate('2026-11-01', 11, 0));
    expect(s.reason).toBe('holiday');
    expect(s.holiday?.name).toBe('Allerheiligen');
    expect(s.label).toContain('Allerheiligen');
  });
});
