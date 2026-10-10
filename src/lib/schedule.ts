import type { Slot } from './yasno-api';
import type { KyivTime } from './time';

// Standard queue groups used across Ukraine (1.1 ... 6.2).
export const ALL_GROUPS = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];

export function isSlotActive(slot: Slot, now: KyivTime): boolean {
  const cur = now.hours * 60 + now.minutes;
  return cur >= slot.start && cur < slot.end;
}

export function getCurrentSlot(slots: Slot[], now: KyivTime): Slot | null {
  return slots.find((s) => isSlotActive(s, now)) ?? null;
}

export function getNextOutageSlot(slots: Slot[], now: KyivTime): { slot: Slot; minutesUntil: number } | null {
  const cur = now.hours * 60 + now.minutes;
  const outages = slots.filter((s) => s.type === 'Definite' && s.start > cur).sort((a, b) => a.start - b.start);
  if (outages.length === 0) return null;
  return { slot: outages[0], minutesUntil: outages[0].start - cur };
}

export function getNextOnSlot(slots: Slot[], now: KyivTime): { slot: Slot; minutesUntil: number } | null {
  const cur = now.hours * 60 + now.minutes;
  const ons = slots.filter((s) => s.type !== 'Definite' && s.start > cur).sort((a, b) => a.start - b.start);
  if (ons.length === 0) return null;
  return { slot: ons[0], minutesUntil: ons[0].start - cur };
}

// Whether an hour of the day is fully on, fully off, or mixed. "partial" means
// the hour contains some outage minutes but less than 45 of them.
export function getHourStatus(sorted: Slot[], hour: number): 'on' | 'off' | 'partial' {
  const hourStart = hour * 60;
  const hourEnd = (hour + 1) * 60;
  let offMinutes = 0;
  for (const s of sorted) {
    if (s.type !== 'Definite') continue;
    const overlapStart = Math.max(s.start, hourStart);
    const overlapEnd = Math.min(s.end, hourEnd);
    if (overlapEnd > overlapStart) offMinutes += overlapEnd - overlapStart;
  }
  if (offMinutes >= 45) return 'off';
  if (offMinutes > 0) return 'partial';
  return 'on';
}