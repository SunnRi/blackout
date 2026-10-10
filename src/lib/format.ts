import type { Slot } from './yasno-api';

export function slotDuration(slot: Slot): string {
  const mins = slot.end - slot.start;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}г ${m}хв`;
  if (h > 0) return `${h}г`;
  return `${m}хв`;
}

export function formatCountdown(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}г ${m}хв`;
  if (h > 0) return `${h}г`;
  return `${m}хв`;
}

export function pluralHours(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'година';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'години';
  return 'годин';
}

export function formatHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} ${pluralHours(h)}`;
  return `${h} ${pluralHours(h)} ${m} хвилин`;
}

export function pluralOutages(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'відключення';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'відключення';
  return 'відключень';
}

export function timeGreeting(h: number): string {
  if (h < 6) return 'Доброї ночі';
  if (h < 12) return 'Доброго ранку';
  if (h < 18) return 'Доброго дня';
  return 'Доброго вечора';
}

// Parses "dd.mm.yyyy hh:mm" timestamps from Yasno and renders a relative label
// like "щойно", "15 хв тому", "3 год тому" or "2 дн тому".
export function getRelativeUpdate(updated: string | null): string | null {
  if (!updated) return null;
  const match = updated.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return updated;
  const [, dd, mm, yyyy, hh, min] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+03:00`);
  const diff = Date.now() - date.getTime();
  if (diff < 0) return updated;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'щойно';
  if (mins < 60) return `${mins} хв тому`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} год тому`;
  const days = Math.floor(hours / 24);
  return `${days} дн тому`;
}