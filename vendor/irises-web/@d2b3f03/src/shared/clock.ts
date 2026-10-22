import type { CircadianSlot, ClockInfo } from './types';

const DAY_MS = 86_400_000;
export const CYCLE_ANCHOR_MS = Date.UTC(2026, 0, 1);

export const ENERGY: Record<CircadianSlot, number> = {
  dead_night: 30,
  early_morning: 45,
  morning_sharp: 70,
  afternoon_dip: 40,
  afternoon_peak: 90,
  evening: 70,
  pre_sleep: 35,
};

export const SLOT_LABEL: Record<CircadianSlot, string> = {
  dead_night: 'DEAD NIGHT',
  early_morning: 'EARLY MORNING',
  morning_sharp: 'MORNING SHARP',
  afternoon_dip: 'AFTERNOON DIP',
  afternoon_peak: 'AFTERNOON PEAK',
  evening: 'EVENING',
  pre_sleep: 'PRE-SLEEP',
};

const LATE: readonly CircadianSlot[] = ['dead_night', 'pre_sleep'];

export function safeTz(tz: unknown): string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function hourInZone(nowMs: number, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), hour: 'numeric', hourCycle: 'h23' })
    .format(new Date(nowMs));
  return Number.parseInt(h, 10) % 24;
}

export function slotForHour(hour: number): CircadianSlot {
  if (hour < 5) return 'dead_night';
  if (hour < 9) return 'early_morning';
  if (hour < 12) return 'morning_sharp';
  if (hour < 15) return 'afternoon_dip';
  if (hour < 18) return 'afternoon_peak';
  if (hour < 22) return 'evening';
  return 'pre_sleep';
}

export function cycleDay(nowMs: number, anchorMs: number = CYCLE_ANCHOR_MS): number {
  const days = Math.floor((nowMs - anchorMs) / DAY_MS);
  return (((days % 28) + 28) % 28) + 1;
}

export function cycleLoad(day: number): number {
  if (day <= 5) return Math.round(80 - (day - 1) * 6);
  if (day <= 13) return 25;
  if (day === 14) return 10;
  return Math.round(40 + ((day - 15) / 13) * 45);
}

export function clockLabel(nowMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz(tz), weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

export function computeClock(nowMs: number, tz: string): ClockInfo {
  const zone = safeTz(tz);
  const hour = hourInZone(nowMs, zone);
  const slot = slotForHour(hour);
  const day = cycleDay(nowMs);
  return {
    slot,
    hour,
    energy: ENERGY[slot],
    cycleDay: day,
    cycleLoad: cycleLoad(day),
    late: LATE.includes(slot),
    label: clockLabel(nowMs, zone),
  };
}
