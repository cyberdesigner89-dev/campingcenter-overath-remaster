import { openingHours, type OpeningPeriod } from '@/data/company';
import { holidayOn, holidaysAround, type PublicHoliday } from '@/data/holidays';
import {
  holidayOpenPolicy as defaultHolidayPolicy,
  manualOpenOverrides as defaultManual,
  specialOpenDays as defaultSpecial,
  type DayHours,
  type HolidayOpenPolicy,
  type ManualOpenOverride,
  type SpecialOpenDay,
} from '@/data/opening-overrides';

export type OpenReason = 'manual' | 'special' | 'holiday' | 'hours' | 'sunday' | 'outside';

/** Optional injection for tests / future admin payloads. */
export interface OpenPlanContext {
  manual?: ManualOpenOverride[];
  special?: SpecialOpenDay[];
  holidayPolicy?: HolidayOpenPolicy;
}

const defaultCtx = (): Required<OpenPlanContext> => ({
  manual: defaultManual,
  special: defaultSpecial,
  holidayPolicy: defaultHolidayPolicy,
});

/** Responsive pill copy — one calculation, three lengths for available space. */
export type PillCopy = {
  /** Desktop / wide: longest accurate wording */
  label: string;
  /** Mobile / tablet utility row */
  shortLabel: string;
  /** Very narrow viewports */
  compactLabel: string;
};

export type OpenStatus =
  | ({
      state: 'open';
      closesAt: string;
      todayLabel: string;
      holiday: null;
      reason: OpenReason;
    } & PillCopy)
  | ({
      state: 'closed';
      opensNext: string | null;
      todayLabel: string;
      holiday: PublicHoliday | null;
      reason: OpenReason;
    } & PillCopy);

/** "13:00" → "13", "13:30" → "13:30" (badge-friendly German clock). */
export function formatClockDisplay(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  if (!h) return hhmm;
  if (!m || m === '00') return String(Number(h));
  return `${Number(h)}:${m}`;
}

function openPillCopy(closesAt: string): PillCopy {
  const clock = formatClockDisplay(closesAt);
  return {
    label: `Heute geöffnet bis ${clock} Uhr`,
    shortLabel: `Geöffnet bis ${clock} Uhr`,
    compactLabel: `Bis ${clock} Uhr geöffnet`,
  };
}

function closedPillCopy(
  reason: OpenReason,
  planLabel: string,
  holidayName: string | null,
): PillCopy {
  if (reason === 'holiday') {
    const name = holidayName || planLabel || 'Feiertag';
    return {
      label: `Heute geschlossen – ${name}`,
      shortLabel: `Feiertag · Geschlossen`,
      compactLabel: 'Feiertag',
    };
  }
  if (reason === 'manual' || reason === 'special') {
    const text = planLabel || 'Sonderöffnungszeiten';
    return {
      label: text,
      shortLabel: text.length > 22 ? 'Sonderöffnungszeiten' : text,
      compactLabel: text.length > 16 ? 'Sonderzeiten' : text,
    };
  }
  if (reason === 'sunday') {
    return {
      label: 'Heute geschlossen',
      shortLabel: 'Geschlossen',
      compactLabel: 'Geschlossen',
    };
  }
  return {
    label: 'Aktuell geschlossen',
    shortLabel: 'Geschlossen',
    compactLabel: 'Geschlossen',
  };
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function berlinParts(date = new Date()): {
  day: string;
  minutes: number;
  dayIndex: number;
  isoDate: string;
  year: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = get('month');
  const dayNum = get('day');
  const day = get('weekday') || dayNames[date.getDay()]!;
  return {
    day,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    dayIndex: dayNames.indexOf(day),
    isoDate: `${year}-${month}-${dayNum}`,
    year,
  };
}

/** @deprecated use berlinParts */
export const berlinNow = (date = new Date()) => {
  const p = berlinParts(date);
  return { day: p.day, minutes: p.minutes, dayIndex: p.dayIndex };
};

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

function periodForDay(day: string, schedule: OpeningPeriod[] = openingHours): OpeningPeriod | undefined {
  return schedule.find((p) => p.schemaDays.includes(day));
}

function formatTodayHours(p: OpeningPeriod | undefined): string {
  if (!p) return 'Heute planmäßig geschlossen';
  return `Regulär heute: ${p.hours.map((h) => `${h.opens}–${h.closes}`).join(' · ')} Uhr`;
}

function formatOverrideHours(hours: DayHours): string {
  return hours.map((h) => `${h.opens}–${h.closes}`).join(' · ') + ' Uhr';
}

function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d! + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function weekdayIndexFromIso(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}

type DayPlan =
  | { kind: 'closed'; reason: OpenReason; label: string; holiday: PublicHoliday | null }
  | { kind: 'hours'; reason: OpenReason; hours: DayHours; label: string; holiday: PublicHoliday | null };

/**
 * Precedence: manual > special > holiday policy > weekly.
 */
export function resolveDayPlan(
  isoDate: string,
  weekdayName: string,
  year = Number(isoDate.slice(0, 4)),
  ctx: OpenPlanContext = {},
): DayPlan {
  const { manual, special, holidayPolicy } = { ...defaultCtx(), ...ctx };

  const manualHit = manual.find((o) => o.date === isoDate);
  if (manualHit) return planFromOverride(manualHit, 'manual');

  const specialHit = special.find((o) => o.date === isoDate);
  if (specialHit) return planFromOverride(specialHit, 'special');

  const holiday = holidayOn(isoDate, year);
  if (holiday && holidayPolicy === 'closed') {
    return {
      kind: 'closed',
      reason: 'holiday',
      label: holiday.name,
      holiday,
    };
  }

  const weekly = periodForDay(weekdayName);
  if (!weekly?.hours[0]) {
    return { kind: 'closed', reason: 'sunday', label: 'Planmäßig geschlossen', holiday };
  }
  return {
    kind: 'hours',
    reason: 'hours',
    hours: weekly.hours,
    label: formatTodayHours(weekly),
    holiday: holidayPolicy === 'weekly' ? holiday : null,
  };
}

function planFromOverride(o: ManualOpenOverride | SpecialOpenDay, reason: 'manual' | 'special'): DayPlan {
  if (o.closed || !o.hours?.length) {
    return { kind: 'closed', reason, label: o.label, holiday: null };
  }
  return { kind: 'hours', reason, hours: o.hours, label: o.label, holiday: null };
}

function nextOpenLabel(fromIso: string, fromMinutes: number, ctx: OpenPlanContext = {}): string | null {
  for (let offset = 0; offset < 14; offset++) {
    const iso = addCalendarDays(fromIso, offset);
    const dayIndex = weekdayIndexFromIso(iso);
    const day = dayNames[dayIndex]!;
    const plan = resolveDayPlan(iso, day, Number(iso.slice(0, 4)), ctx);
    if (plan.kind !== 'hours' || !plan.hours[0]) continue;

    if (offset === 0) {
      const later = plan.hours.find((h) => toMin(h.opens) > fromMinutes);
      if (later) return `Öffnet heute um ${later.opens} Uhr`;
      continue;
    }

    const first = plan.hours[0];
    if (offset === 1) return `Öffnet morgen um ${first.opens} Uhr`;
    const when = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(
      new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))),
    );
    return `Öffnet am ${when} um ${first.opens} Uhr`;
  }
  return null;
}

export function computeOpenStatus(
  date = new Date(),
  _schedule: OpeningPeriod[] = openingHours,
  ctx: OpenPlanContext = {},
): OpenStatus {
  const now = berlinParts(date);
  const plan = resolveDayPlan(now.isoDate, now.day, now.year, ctx);
  const opensNext = nextOpenLabel(now.isoDate, now.minutes, ctx);

  if (plan.kind === 'closed') {
    const pill = closedPillCopy(plan.reason, plan.label, plan.holiday?.name ?? null);
    if (plan.reason === 'holiday') {
      return {
        state: 'closed',
        reason: 'holiday',
        holiday: plan.holiday,
        opensNext,
        todayLabel: `Heute Feiertag: ${plan.label} – wir haben geschlossen`,
        ...pill,
      };
    }
    if (plan.reason === 'manual' || plan.reason === 'special') {
      return {
        state: 'closed',
        reason: plan.reason,
        holiday: null,
        opensNext,
        todayLabel: plan.label,
        ...pill,
      };
    }
    return {
      state: 'closed',
      reason: plan.reason,
      holiday: null,
      opensNext,
      todayLabel: plan.label,
      ...pill,
    };
  }

  const openSlot = plan.hours.find((h) => now.minutes >= toMin(h.opens) && now.minutes < toMin(h.closes));
  if (openSlot) {
    const todayLabel =
      plan.reason === 'manual' || plan.reason === 'special'
        ? `${plan.label}: ${formatOverrideHours(plan.hours)}`
        : plan.label;
    return {
      state: 'open',
      reason: plan.reason,
      holiday: null,
      closesAt: openSlot.closes,
      todayLabel,
      ...openPillCopy(openSlot.closes),
    };
  }

  const reason: OpenReason =
    plan.reason === 'manual' || plan.reason === 'special'
      ? plan.reason
      : now.day === 'Sunday' || !periodForDay(now.day)
        ? 'sunday'
        : 'outside';

  return {
    state: 'closed',
    reason,
    holiday: null,
    opensNext,
    todayLabel:
      plan.reason === 'manual' || plan.reason === 'special'
        ? `${plan.label}: ${formatOverrideHours(plan.hours)}`
        : plan.label,
    ...closedPillCopy(reason, plan.label, null),
  };
}

export function schedulePayload(schedule: OpeningPeriod[] = openingHours) {
  return schedule.flatMap((p) =>
    p.schemaDays.map((d) => ({
      d,
      h: p.hours.map((h) => [h.opens, h.closes] as [string, string]),
      short: p.shortDays,
      label: formatHoursLabel(p),
    })),
  );
}

/** Inline-Boot: Wochenplan + Feiertage + Overrides + Policy. */
export function openingBootPayload(year = new Date().getFullYear()) {
  const { manual, special, holidayPolicy } = defaultCtx();
  return {
    schedule: schedulePayload(),
    holidays: holidaysAround(year)
      .concat(holidaysAround(year + 1))
      .filter((h, i, arr) => arr.findIndex((x) => x.date === h.date) === i),
    holidayPolicy,
    manual: manual.map((o) => ({
      date: o.date,
      closed: Boolean(o.closed || !o.hours?.length),
      hours: (o.hours ?? []).map((h) => [h.opens, h.closes] as [string, string]),
      label: o.label,
    })),
    special: special.map((o) => ({
      date: o.date,
      closed: Boolean(o.closed || !o.hours?.length),
      hours: (o.hours ?? []).map((h) => [h.opens, h.closes] as [string, string]),
      label: o.label,
    })),
  };
}

function formatHoursLabel(p: OpeningPeriod): string {
  if (!p.hours.length) return `${p.shortDays}: geschlossen`;
  return `${p.shortDays}: ${p.hours.map((h) => `${h.opens}–${h.closes}`).join(' · ')} Uhr`;
}
