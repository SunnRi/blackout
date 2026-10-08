import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Zap, ZapOff, MapPin, Loader2, CheckCircle2,
  Bell, BellOff, ChevronLeft, Search, Settings,
  Sun, Moon, Clock, Info,
  Sparkles, ArrowRight, ArrowLeft, Check, RefreshCw, Keyboard,
  LayoutGrid, Gauge, Layers, History, Heart, ShieldCheck, ChevronDown,
  Plus, Minus,
} from 'lucide-react';
import { supabase, type ScheduleChange } from '@/lib/supabase';
import { getKyivTime, type KyivTime } from '@/lib/time';
import {
  initTelegramWebApp, getTelegramUser, getTelegramWebApp, getTelegramStartScreen, hapticImpact, hapticNotification,
  setTelegramThemeColors,
} from '@/lib/telegram';
import {
  fetchOblasts, fetchCities, fetchTodaySchedule, fetchTomorrowSchedule,
  minutesToTime, type Oblast, type City, type Slot, type CitySchedule,
} from '@/lib/yasno-api';

const ALL_GROUPS = ['1.1','1.2','2.1','2.2','3.1','3.2','4.1','4.2','5.1','5.2','6.1','6.2'];

// ── Helpers ───────────────────────────────────────────────────
function slotDuration(slot: Slot): string {
  const mins = slot.end - slot.start;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}г ${m}хв`;
  if (h > 0) return `${h}г`;
  return `${m}хв`;
}

function formatCountdown(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}г ${m}хв`;
  if (h > 0) return `${h}г`;
  return `${m}хв`;
}

function pluralHours(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'година';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'години';
  return 'годин';
}

function formatHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} ${pluralHours(h)}`;
  return `${h} ${pluralHours(h)} ${m} хвилин`;
}

function pluralOutages(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'відключення';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'відключення';
  return 'відключень';
}

function isSlotActive(slot: Slot, now: KyivTime): boolean {
  const cur = now.hours * 60 + now.minutes;
  return cur >= slot.start && cur < slot.end;
}

function getCurrentSlot(slots: Slot[], now: KyivTime): Slot | null {
  return slots.find((s) => isSlotActive(s, now)) ?? null;
}

function getNextOutageSlot(slots: Slot[], now: KyivTime): { slot: Slot; minutesUntil: number } | null {
  const cur = now.hours * 60 + now.minutes;
  const outages = slots.filter((s) => s.type === 'Definite' && s.start > cur).sort((a, b) => a.start - b.start);
  if (outages.length === 0) return null;
  return { slot: outages[0], minutesUntil: outages[0].start - cur };
}

function getNextOnSlot(slots: Slot[], now: KyivTime): { slot: Slot; minutesUntil: number } | null {
  const cur = now.hours * 60 + now.minutes;
  const ons = slots.filter((s) => s.type !== 'Definite' && s.start > cur).sort((a, b) => a.start - b.start);
  if (ons.length === 0) return null;
  return { slot: ons[0], minutesUntil: ons[0].start - cur };
}

function getRelativeUpdate(updated: string | null): string | null {
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

function timeGreeting(h: number): string {
  if (h < 6) return 'Доброї ночі';
  if (h < 12) return 'Доброго ранку';
  if (h < 18) return 'Доброго дня';
  return 'Доброго вечора';
}

function getHourStatus(sorted: Slot[], hour: number): 'on' | 'off' | 'partial' {
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

// ── Theme / Design / Density types ────────────────────────────
type ThemeMode = 'light' | 'dark';
type Density = 'minimal' | 'standard' | 'extended';

const DENSITY_OPTIONS: { id: Density; name: string; desc: string; icon: typeof Gauge }[] = [
  { id: 'minimal', name: 'Мінімальний', desc: 'Тільки статус і найближчі події', icon: Gauge },
  { id: 'standard', name: 'Стандартний', desc: 'Статус, графік дня і список подій', icon: LayoutGrid },
  { id: 'extended', name: 'Розширений', desc: 'Все + статистика дня і обидва дні одразу', icon: Layers },
];

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('themeMode');
  return saved === 'light' ? 'light' : 'dark';
}
function getInitialDensity(): Density {
  if (typeof window === 'undefined') return 'extended';
  const saved = localStorage.getItem('density');
  return saved === 'minimal' || saved === 'standard' ? saved : 'extended';
}

// ── Aurora background (glass design) ──────────────────────────
function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
    </div>
  );
}

// ── Status blocks ─────────────────────────────────────────────
function StatusLine({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`fade-in-scale hover-lift d-card flex items-center gap-2.5 px-4 py-3 ${isOff ? 'pulse-red' : 'pulse-green'}`}>
      <div
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOff ? 'bg-red-500' : 'bg-emerald-500'}`}
        style={{ boxShadow: isOff ? '0 0 10px rgba(255,59,48,0.7)' : '0 0 10px rgba(52,199,89,0.7)' }}
      />
      <span className="text-sm font-semibold text-primary-c">{isOff ? 'Без світла' : 'Є світло'}</span>
      {isOff && nextOn && <span className="text-xs text-secondary-c">· увімкнуть {minutesToTime(nextOn.slot.start)}</span>}
      {!isOff && nextOutage && <span className="text-xs text-secondary-c">· відключення {minutesToTime(nextOutage.slot.start)}</span>}
      {!isOff && !nextOutage && <span className="text-xs text-secondary-c">· без відключень</span>}
    </div>
  );
}

function StatusCompact({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`glass-sheen fade-in-scale hover-lift d-card p-4 relative overflow-hidden ${isOff ? 'status-off' : 'status-on'}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${isOff ? 'bg-red-500/15' : 'bg-emerald-500/15'}`}>
          {isOff
            ? <ZapOff className="flicker h-5 w-5" style={{ color: 'var(--on-negative)' }} />
            : <Zap className="neon-pulse h-5 w-5" style={{ color: 'var(--on-positive)' }} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-primary-c">
            {isOff ? 'Немає світла' : 'Світло є'}
            {current && (
              <span className="ml-2 text-sm font-normal text-secondary-c">
                {minutesToTime(current.start)}–{minutesToTime(current.end)}
              </span>
            )}
          </p>
          {isOff && nextOn && (
            <p className="text-sm text-secondary-c">
              Увімкнуть о <b className="text-primary-c">{minutesToTime(nextOn.slot.start)}</b>
              <span className="mx-1 text-muted-c">·</span>
              через {formatCountdown(nextOn.minutesUntil)}
            </p>
          )}
          {!isOff && nextOutage && (
            <p className="text-sm text-secondary-c">
              Відключення о <b className="text-primary-c">{minutesToTime(nextOutage.slot.start)}</b>
              <span className="mx-1 text-muted-c">·</span>
              через {formatCountdown(nextOutage.minutesUntil)}
            </p>
          )}
          {!isOff && !nextOutage && (
            <p className="text-sm text-secondary-c">Більше відключень не заплановано</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusFull({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  let offMins = 0;
  for (const s of slots) {
    if (s.type === 'Definite') offMins += s.end - s.start;
  }
  const outagesCount = slots.filter((s) => s.type === 'Definite').length;

  return (
    <div className={`fade-in-scale hover-lift d-card p-5 text-center relative overflow-hidden ${isOff ? 'status-off' : 'status-on'}`}>
      <div className={`mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full ${isOff ? 'bg-red-500/15' : 'bg-emerald-500/15'}`}>
        {isOff
          ? <ZapOff className="flicker h-8 w-8 text-red-500" />
          : <Zap className="neon-pulse h-8 w-8 text-emerald-500" />}
      </div>
      <h2 className="text-xl font-bold text-primary-c">
        {isOff ? 'Світла зараз немає' : 'Світло зараз є'}
      </h2>
      {current && (
        <p className="mt-0.5 text-sm text-secondary-c">
          {isOff ? 'Відключення' : 'Живлення'}:{' '}
          <span className="font-semibold text-primary-c">
            {minutesToTime(current.start)} — {minutesToTime(current.end)}
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-col gap-1.5">
        {isOff && nextOn && (
          <div className="rounded-xl bg-primary-c/5 px-3 py-2 ring-1 ring-inset ring-white/10 dark:ring-white/10" style={{ backgroundColor: 'color-mix(in srgb, var(--on-positive) 10%, transparent)' }}>
            <span className="text-sm text-secondary-c">
              Увімкнуть о <b className="text-primary-c">{minutesToTime(nextOn.slot.start)}</b>
              <span className="mx-1 text-muted-c">·</span>
              через {formatCountdown(nextOn.minutesUntil)}
            </span>
          </div>
        )}
        {!isOff && nextOutage && (
          <div className="rounded-xl px-3 py-2" style={{ backgroundColor: 'color-mix(in srgb, var(--on-negative) 10%, transparent)' }}>
            <span className="text-sm text-secondary-c">
              Відключення о <b className="text-primary-c">{minutesToTime(nextOutage.slot.start)}</b>
              <span className="mx-1 text-muted-c">·</span>
              через {formatCountdown(nextOutage.minutesUntil)}
            </span>
          </div>
        )}
        {!isOff && !nextOutage && (
          <p className="text-sm text-secondary-c">Більше відключень не заплановано</p>
        )}
      </div>
      <div className="mt-3 rounded-xl bg-black/4 px-3.5 py-3 dark:bg-white/6">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full">
          <div className="bg-red-400" style={{ width: `${(offMins / 1440) * 100}%` }} />
          <div className="bg-emerald-400" style={{ width: `${(1 - offMins / 1440) * 100}%` }} />
        </div>
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
            <span className="font-bold text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatHours(offMins)}</span>
            <span className="text-secondary-c">без світла</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
            <span className="font-bold text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatHours(1440 - offMins)}</span>
            <span className="text-secondary-c">зі світлом</span>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between border-t border-subtle-c pt-2 text-xs">
          <span className="text-muted-c">Відключень за день</span>
          <span className="font-bold text-primary-c">{outagesCount} {pluralOutages(outagesCount)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Graph ─────────────────────────────────────────────────────
function HourlyGraph({ slots, now, isToday, updated, showStats }: {
  slots: Slot[]; now: KyivTime; isToday: boolean; updated: string | null; showStats: boolean;
}) {
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;
  const sorted = useMemo(() => [...slots].sort((a, b) => a.start - b.start), [slots]);
  const slots24 = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({
    hour,
    status: getHourStatus(sorted, hour),
  })), [sorted]);
  const relUpdate = getRelativeUpdate(updated);
  return (
    <div className="fade-in-delay-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
            <span className="text-secondary-c">Є світло</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="text-secondary-c">Немає</span>
          </span>
        </div>
        {relUpdate && (
          <span className="flex items-center gap-1 text-xs text-muted-c">
            <Clock className="h-3 w-3" />{relUpdate}
          </span>
        )}
      </div>

      <div className="d-card graph-aura p-3">
        <div className="relative mb-1 h-4">
          <div className="flex justify-between pt-0.5">
            {[0, 6, 12, 18].map((h) => (
              <span key={h} className="text-[8px] font-medium text-muted-c">{String(h).padStart(2, '0')}</span>
            ))}
            <span className="text-[8px] font-medium text-muted-c">24</span>
          </div>
          {isToday && currentMin >= 0 && (
            <div className="tl-now absolute -top-0.5 z-10" style={{ left: `${(currentMin / 1440) * 100}%` }}>
              <div className="-translate-x-1/2 rounded-full bg-blue-500 px-1.5 py-px text-[8px] font-bold text-white shadow-lg shadow-blue-500/50">
                {minutesToTime(currentMin)}
              </div>
            </div>
          )}
        </div>
        <div className="relative flex h-4 gap-[3px]" style={{ padding: '0 1px' }}>
          {slots24.map(({ hour, status }) => {
            const isPast = isToday && currentMin >= (hour + 1) * 60;
            const barClass = status === 'on' ? 'tl-on' : 'tl-off';

            return (
              <div key={hour} className="flex h-full flex-1">
                <div
                  className={`graph-bar-anim relative w-full rounded-[3px] ${barClass} ${isPast ? 'tl-past' : ''}`}
                  style={{ animationDelay: `${hour * 0.03}s` }}
                />
              </div>
            );
          })}
          {isToday && currentMin >= 0 && (
            <div
              className="tl-now absolute bottom-[-2px] top-[-2px] z-10 w-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.9)]"
              style={{ left: `calc(${(currentMin / 1440) * 100}% - 1.5px + 1px)` }}
            />
          )}
        </div>

        {showStats && isToday && (() => {
          let offMins = 0;
          for (const s of sorted) {
            if (s.type !== 'Definite') continue;
            const overlapStart = Math.max(s.start, 0);
            const overlapEnd = Math.min(s.end, 1440);
            if (overlapEnd > overlapStart) offMins += overlapEnd - overlapStart;
          }
          return (
            <div className="mt-2.5 flex items-center justify-between border-t border-subtle-c pt-2">
              <span className="text-[10px] text-muted-c">
                Сьогодні без світла: <b className="text-primary-c">{formatHours(offMins)}</b>
              </span>
              {relUpdate && (
                <span className="flex items-center gap-1 text-[10px] text-muted-c">
                  <Clock className="h-3 w-3" />{relUpdate}
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {updated && isToday && relUpdate && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-c">
          <Info className="h-3 w-3 shrink-0" />
          <span>Графік оновлено {relUpdate}</span>
        </p>
      )}
    </div>
  );
}

// ── Event lists ───────────────────────────────────────────────
function CompactList({ slots, now, isToday, limit }: { slots: Slot[]; now: KyivTime; isToday: boolean; limit?: number }) {
  const sorted = useMemo(() => [...slots].sort((a, b) => a.start - b.start), [slots]);
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;

  if (sorted.length === 0) return (
    <div className="d-card py-6 text-center fade-in-delay-3">
      <p className="text-sm text-secondary-c">Графік поки не доступний</p>
    </div>
  );

  let shown = sorted;
  if (limit !== undefined) {
    const currentIdx = sorted.findIndex((s) => isSlotActive(s, now));
    if (currentIdx >= 0) {
      shown = sorted.slice(Math.max(0, currentIdx - 1), currentIdx + 2);
    } else {
      const nextIdx = sorted.findIndex((s) => s.start > currentMin);
      shown = sorted.slice(Math.max(0, nextIdx < 0 ? 0 : nextIdx - 1), nextIdx < 0 ? sorted.length : nextIdx + 2);
    }
  }

  return (
    <div className="d-card overflow-hidden fade-in-delay-3">
      {shown.map((slot, i) => {
        const isOff = slot.type === 'Definite';
        const active = isToday && isSlotActive(slot, now);
        const isPast = isToday && currentMin >= slot.end;
        const dotColor = isOff ? 'var(--on-negative)' : 'var(--on-positive)';

        return (
          <div
            key={`${slot.start}-${i}`}
            className={`row-hover flex items-center gap-3 px-4 py-2.5 ${i < shown.length - 1 ? 'border-b border-subtle-c' : ''} ${
              active
                ? isOff
                  ? 'bg-red-500/15 ring-1 ring-inset ring-red-500/25'
                  : 'bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/25'
                : isPast ? 'opacity-35' : ''
            }`}
          >
            <div
              className={`h-2 w-2 shrink-0 rounded-full ${active ? 'now-marker' : ''}`}
              style={{ background: dotColor, ...(active ? { boxShadow: `0 0 8px ${dotColor}` } : {}) }}
            />
            <span className="text-sm font-semibold text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {minutesToTime(slot.start)}–{minutesToTime(slot.end)}
            </span>
            {active && (
              <span className="rounded-full accent-soft-bg accent-c px-1.5 py-0.5 text-[10px] font-bold">зараз</span>
            )}
            <span className="ml-auto text-xs text-muted-c">
              {isOff ? 'без світла' : 'є світло'} · {slotDuration(slot)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ComfortableList({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const sorted = useMemo(() => [...slots].sort((a, b) => a.start - b.start), [slots]);
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;

  if (sorted.length === 0) return (
    <div className="d-card py-8 text-center fade-in-delay-3">
      <Zap className="mx-auto mb-2 h-7 w-7 text-muted-c" />
      <p className="text-sm text-secondary-c">Графік поки не доступний</p>
    </div>
  );

  return (
    <div className="space-y-2 fade-in-delay-3">
      {sorted.map((slot, i) => {
        const isOff = slot.type === 'Definite';
        const active = isToday && isSlotActive(slot, now);
        const isPast = isToday && currentMin >= slot.end;

        return (
          <div
            key={i}
            className={`d-card hover-lift flex items-center gap-3 px-4 py-3 ${
              active
                ? isOff
                  ? 'ring-1 ring-inset ring-red-500/30'
                  : 'ring-1 ring-inset ring-emerald-500/30'
                : isPast ? 'opacity-40' : ''
            }`}
            style={active ? { backgroundColor: isOff ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)' } : undefined}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isOff ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
              {isOff
                ? <ZapOff className="h-5 w-5" style={{ color: 'var(--on-negative)' }} />
                : <Zap className="h-5 w-5" style={{ color: 'var(--on-positive)' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {minutesToTime(slot.start)} — {minutesToTime(slot.end)}
                </span>
                {active && (
                  <span className="rounded-full accent-soft-bg accent-c px-1.5 py-0.5 text-[10px] font-bold">зараз</span>
                )}
              </div>
              <p className={`text-xs ${isOff ? 'text-red-400/70 dark:text-red-300/60' : 'text-emerald-500/70 dark:text-emerald-300/60'}`}>
                {isOff ? 'Немає світла' : 'Є світло'} · {slotDuration(slot)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────
function Onboarding({
  step, setStep, oblasts, selectedOblast, setSelectedOblast,
  cities, selectedCity, setSelectedCity, selectedGroup, setSelectedGroup,
  onFinish, scheduleLoading, citiesLoading, availableGroups,
  tgUser, notifyEnabled, setNotifyEnabled, notifyMinutes, setNotifyMinutes,
}: {
  step: number;
  setStep: (n: number) => void;
  oblasts: Oblast[];
  selectedOblast: Oblast | null;
  setSelectedOblast: (o: Oblast) => void;
  cities: City[];
  selectedCity: City | null;
  setSelectedCity: (c: City) => void;
  selectedGroup: string;
  setSelectedGroup: (g: string) => void;
  onFinish: () => void;
  scheduleLoading: boolean;
  citiesLoading: boolean;
  availableGroups: string[];
  tgUser: { id: number; username?: string } | null;
  notifyEnabled: boolean;
  setNotifyEnabled: (v: boolean) => void;
  notifyMinutes: number;
  setNotifyMinutes: (v: number) => void;
}) {
  const [citySearch, setCitySearch] = useState(() => selectedCity?.name ?? '');
  const filtered = useMemo(() => {
    if (!citySearch.trim()) return cities;
    const q = citySearch.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q));
  }, [cities, citySearch]);

  const totalSteps = 5;

  return (
    <div className="relative min-h-screen bg-primary-c" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <Aurora />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-8">
        <div className="mb-6 flex justify-center gap-1.5">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 accent-bg' : i < step ? 'w-1.5 accent-bg opacity-50' : 'w-1.5 bg-black/10 dark:bg-white/15'
              }`}
            />
          ))}
        </div>

        <div className="flex flex-1 flex-col" key={step}>
          {step === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center text-center fade-in-right">
              <div className="logo-bounce mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-xl shadow-blue-500/30">
                <Zap className="h-12 w-12 text-white" />
              </div>
              <p className="mb-1 text-base text-secondary-c">{timeGreeting(getKyivTime().hours)}!</p>
              <h1 className="text-3xl font-extrabold text-primary-c">Графік світла</h1>
              <p className="mt-3 max-w-xs text-base text-secondary-c">
                Дізнавайтесь, коли буде світло у вашій черзі — швидко і просто
              </p>
              <div className="d-btn mt-6 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs text-secondary-c">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Налаштування займе менше хвилини
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-1 flex-col fade-in-right">
              <h2 className="text-2xl font-extrabold text-primary-c">Ваша область</h2>
              <p className="mb-3 mt-1 text-sm text-secondary-c">Оберіть область або місто Київ</p>
              <div className="d-panel scroll-touch space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl p-1.5" style={{ height: 'min(320px, 42vh)', WebkitOverflowScrolling: 'touch' }}>
                {oblasts.map((oblast) => (
                  <button
                    key={oblast.slug}
                    onClick={() => { setSelectedOblast(oblast); hapticImpact('light'); setStep(Math.max(step, 2)); }}
                    className={`flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                      selectedOblast?.slug === oblast.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c active:bg-black/5 dark:active:bg-white/5'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{oblast.name}</span>
                    {selectedOblast?.slug === oblast.slug && <Check className="ml-auto h-4 w-4 shrink-0" />}
                  </button>
                ))}
                {oblasts.length === 0 && <p className="py-6 text-center text-sm text-muted-c">Не вдалося завантажити</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-1 flex-col fade-in-right">
              <h2 className="text-2xl font-extrabold text-primary-c">Ваше місто</h2>
              <p className="mb-3 mt-1 text-sm text-secondary-c">Оберіть місто, щоб ми показали правильний графік</p>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-c" />
                <input
                  type="text" value={citySearch} onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Пошук міста..."
                  className="d-panel w-full rounded-xl py-2.5 pl-10 pr-3 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div className="mb-3 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(10,132,255,0.08)' }}>
                <Keyboard className="mt-0.5 h-4 w-4 shrink-0 accent-c" />
                <p className="text-xs leading-relaxed text-secondary-c">
                  <b className="text-primary-c">Почніть вводити назву міста</b> — список відфільтрується автоматично. Київ також шукайте тут.
                </p>
              </div>
              <div className="d-panel scroll-touch space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl p-1.5" style={{ height: 'min(320px, 42vh)', WebkitOverflowScrolling: 'touch' }}>
                {citiesLoading ? (
                  <div className="flex items-center justify-center py-8 text-secondary-c">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження міст...
                  </div>
                ) : (
                  <>
                    {filtered.map((city) => (
                      <button
                        key={city.slug}
                        onClick={() => { setSelectedCity(city); setSelectedGroup(''); hapticImpact('light'); }}
                        className={`flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                          selectedCity?.slug === city.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c active:bg-black/5 dark:active:bg-white/5'
                        }`}
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{city.name}</span>
                        {selectedCity?.slug === city.slug && <Check className="ml-auto h-4 w-4 shrink-0" />}
                      </button>
                    ))}
                    {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted-c">Не знайдено</p>}
                  </>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-1 flex-col fade-in-right">
              <h2 className="text-2xl font-extrabold text-primary-c">Ваша черга</h2>
              <p className="mb-4 mt-1 text-sm text-secondary-c">Черга вказана у вашому рахунку за електроенергію</p>
              {scheduleLoading ? (
                <div className="flex flex-1 items-center justify-center text-secondary-c">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження черг...
                </div>
              ) : (
                <div className="grid flex-1 grid-cols-4 content-start gap-2">
                  {(availableGroups.length > 0 ? availableGroups : ALL_GROUPS).map((group) => (
                    <button
                      key={group}
                      onClick={() => { setSelectedGroup(group); hapticImpact('light'); }}
                      className={`rounded-2xl px-2 py-4 text-center text-base font-bold transition-all ${
                        selectedGroup === group ? 'accent-soft-bg accent-c ring-2 ring-blue-500/40' : 'd-btn text-secondary-c hover:scale-105'
                      }`}
                    >{group}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-1 flex-col items-center justify-center text-center fade-in-right">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl accent-soft-bg">
                <Bell className="h-12 w-12 accent-c" />
              </div>
              <h2 className="text-2xl font-extrabold text-primary-c">Сповіщення</h2>
              <p className="mt-2 max-w-xs text-sm text-secondary-c">
                Хочете отримувати повідомлення про відключення світла і за скільки хвилин попереджати?
              </p>
              {tgUser && (
                <div className="d-card mt-5 w-full px-3.5 py-3 text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {notifyEnabled ? <Bell className="h-3.5 w-3.5 accent-c" /> : <BellOff className="h-3.5 w-3.5 text-muted-c" />}
                      <h3 className="text-xs font-bold text-primary-c">Сповіщення</h3>
                    </div>
                    <button
                      onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                      style={{ width: 38, height: 20, padding: 0, border: 'none', flexShrink: 0 }}
                      className={`relative inline-block rounded-full transition-colors ${notifyEnabled ? 'accent-bg' : 'bg-black/10 dark:bg-white/10'}`}
                      aria-label="Сповіщення"
                    >
                      <span
                        style={{
                          position: 'absolute', left: 2, top: 2, width: 16, height: 16,
                          transform: notifyEnabled ? 'translateX(18px)' : 'translateX(0px)',
                        }}
                        className="block rounded-full bg-white shadow-sm transition-transform duration-200"
                      />
                    </button>
                  </div>
                  {notifyEnabled && (
                    <div className="mt-2.5">
                      <p className="mb-1.5 text-[11px] text-secondary-c">Попередити за:</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[15, 30, 60].map((mins) => (
                          <button
                            key={mins}
                            onClick={() => { setNotifyMinutes(mins); hapticImpact('light'); }}
                            className={`rounded-lg px-3 py-1.5 text-center text-xs font-semibold transition-all ${
                              notifyMinutes === mins ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'd-btn text-secondary-c'
                            }`}
                          >{mins} хв</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-2.5 flex items-center gap-1 text-[10px] text-muted-c">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    Налаштування спільні з Telegram-ботом — змініть у будь-якому місці
                  </p>
                </div>
              )}
              <p className="mt-4 max-w-xs text-xs text-muted-c">
                Цей крок можна пропустити — налаштувати сповіщення можна пізніше в налаштуваннях або в боті.
              </p>
            </div>
          )}

        </div>

        <div className="mx-auto mt-6 flex w-full gap-2">
          {step > 0 && (
            <button
              onClick={() => { setStep(step - 1); hapticImpact('light'); }}
              className="d-btn flex h-14 w-14 items-center justify-center rounded-2xl text-primary-c"
              aria-label="Назад"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => {
              if (step === 4) { onFinish(); hapticNotification('success'); }
              else { setStep(step + 1); hapticImpact('light'); }
            }}
            disabled={(step === 1 && !selectedOblast) || (step === 2 && !selectedCity) || (step === 3 && !selectedGroup)}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl accent-bg py-4 text-base font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] disabled:opacity-40"
          >
            {step === 0 && <>Почнемо <ArrowRight className="h-5 w-5" /></>}
            {(step === 1 || step === 2) && <>Далі <ArrowRight className="h-5 w-5" /></>}
            {step === 3 && <>Далі <ArrowRight className="h-5 w-5" /></>}
            {step === 4 && <><CheckCircle2 className="h-5 w-5" /> Готово</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change history ────────────────────────────────────────────
type DiffSlot = { start: number; end: number; type: string };
type ChangeGroup = {
  detectedAt: string;
  items: { queue: string; day: string; scheduleDate: string | null; changeType: string; summary: string; oldSlots: DiffSlot[] | null; newSlots: DiffSlot[] | null }[];
};

function parseSlotRows(json: unknown): DiffSlot[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((s) => s as Partial<DiffSlot>)
    .filter((s) => typeof s.start === 'number' && typeof s.end === 'number' && typeof s.type === 'string')
    .map((s) => ({ start: s.start as number, end: s.end as number, type: s.type as string }));
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatChangeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'щойно';
  if (diffMin < 60) return `${diffMin} хв тому`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} год тому`;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month} ${hh}:${mm}`;
}

const MONTHS_UK = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

function formatScheduleDate(scheduleDate: string | null, day: string): string {
  if (!scheduleDate) return formatDayLabel(day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(scheduleDate + 'T00:00:00');
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.getTime() === today.getTime()) return 'сьогодні';
  if (d.getTime() === tomorrow.getTime()) return 'завтра';
  const dayNum = d.getDate();
  const monthName = MONTHS_UK[d.getMonth()];
  return `${dayNum} ${monthName}`;
}

function formatDayLabel(day: string): string {
  return day === 'today' ? 'сьогодні' : 'завтра';
}

const isOffSlot = (s: DiffSlot) => s.type === 'Definite' || s.type === 'off';

// Візуальне порівняння "Було / Стало": два рядки з часовими шкалами, де
// червоні сегменти — відключення. Додані хвилини підсвічені червоним рамком,
// прибрані — зеленим. Знизу короткий людський підсумок.
// Сравнение "Було / Стало": строки с временем, где зачёркнуто старое и
// показано новое, плюс цветные бейджи что добавилось и что отменилось.
// Просте відображення змін: лише кольорові бейджі — додані відключення
// червоним, скасовані — зеленим. Без «Було / Стало», без шкал.
function DiffTimeline({ oldSlots, newSlots }: { oldSlots: DiffSlot[]; newSlots: DiffSlot[] }) {
  const keyOf = (s: DiffSlot) => `${s.start}-${s.end}`;
  const oldOff = oldSlots.filter(isOffSlot);
  const newOff = newSlots.filter(isOffSlot);
  const oldKeys = new Set(oldOff.map(keyOf));
  const newKeys = new Set(newOff.map(keyOf));

  const added = newOff.filter((s) => !oldKeys.has(keyOf(s)));
  const removed = oldOff.filter((s) => !newKeys.has(keyOf(s)));

  const fmt = (m: number) => formatMinutes(m === 1440 ? 1439 : m);
  const fmtRange = (s: DiffSlot) => `${fmt(s.start)} – ${fmt(s.end)}`;

  if (added.length === 0 && removed.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-secondary-c">Час відключень не змінився</p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1">
      {added.map((s, i) => (
        <div
          key={`a${i}`}
          className="flex items-center gap-1.5 rounded-lg bg-red-500/12 px-2.5 py-1.5"
          style={{ color: 'var(--on-negative)' }}
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            Додалося {fmtRange(s)}
          </span>
        </div>
      ))}
      {removed.map((s, i) => (
        <div
          key={`r${i}`}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/12 px-2.5 py-1.5"
          style={{ color: 'var(--on-positive)' }}
        >
          <Minus className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            Скасовано {fmtRange(s)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChangeHistory({ oblastSlug, citySlug }: { oblastSlug: string; citySlug: string }) {
  const [groups, setGroups] = useState<ChangeGroup[] | null>(null);
  const [error, setError] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [changeDayTab, setChangeDayTab] = useState<'today' | 'tomorrow'>('today');
  useEffect(() => {
    setGroups(null); setError(false);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from('schedule_change_log')
      .select('id, queue, day, schedule_date, change_type, summary, detected_at, old_slots, new_slots')
      .eq('oblast_slug', oblastSlug)
      .eq('city_slug', citySlug)
      .gte('detected_at', since)
      .order('detected_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) { setError(true); setGroups([]); return; }
        const byTime = new Map<string, ChangeGroup>();
        for (const r of (data ?? []) as ScheduleChange[]) {
          let g = byTime.get(r.detected_at);
          if (!g) { g = { detectedAt: r.detected_at, items: [] }; byTime.set(r.detected_at, g); }
          g.items.push({
            queue: r.queue, day: r.day, scheduleDate: r.schedule_date, changeType: r.change_type, summary: r.summary,
            oldSlots: parseSlotRows(r.old_slots), newSlots: parseSlotRows(r.new_slots),
          });
        }
        setGroups([...byTime.values()]);
      });
    supabase
      .from('schedule_check_state')
      .select('last_checked_at')
      .eq('oblast_slug', oblastSlug)
      .eq('city_slug', citySlug)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { last_checked_at: string } | null;
        setLastChecked(row?.last_checked_at ?? null);
      });
  }, [oblastSlug, citySlug]);

  if (groups === null) {
    return (
      <div className="flex items-center justify-center py-12 text-secondary-c">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження історії...
      </div>
    );
  }

  if (error) {
    return (
      <div className="d-card py-10 text-center">
        <History className="mx-auto mb-2 h-10 w-10 text-muted-c" />
        <p className="text-sm text-secondary-c">Не вдалося завантажити історію</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="d-card py-10 text-center fade-in">
        <History className="mx-auto mb-2 h-10 w-10 text-muted-c" />
        <p className="text-sm font-semibold text-primary-c">Змін ще не було</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-secondary-c">
          Ми стежимо за графіком вашого міста — щойно енергетики щось змінять, тут з'явиться, що саме змінилося: нові відключення, скасовані чи перенесені за часом.
        </p>
      </div>
    );
  }

  const filteredGroups = groups.filter((g) =>
    g.items.some((it) => {
      const label = formatScheduleDate(it.scheduleDate, it.day);
      return changeDayTab === 'today' ? label === 'сьогодні' : label === 'завтра';
    }),
  );

  const hasToday = groups.some((g) => g.items.some((it) => formatScheduleDate(it.scheduleDate, it.day) === 'сьогодні'));
  const hasTomorrow = groups.some((g) => g.items.some((it) => formatScheduleDate(it.scheduleDate, it.day) === 'завтра'));

  return (
    <div className="space-y-3">
      {/* Day tabs */}
      <div className="flex justify-center fade-in-delay-1">
        <div className="segmented">
          <button onClick={() => { setChangeDayTab('today'); hapticImpact('light'); }}
            className={`segmented-item px-5 py-1.5 text-sm font-semibold ${changeDayTab === 'today' ? 'active text-primary-c' : 'text-secondary-c'}`}
          >Сьогодні</button>
          <button onClick={() => { setChangeDayTab('tomorrow'); hapticImpact('light'); }}
            className={`segmented-item px-5 py-1.5 text-sm font-semibold ${changeDayTab === 'tomorrow' ? 'active text-primary-c' : 'text-secondary-c'}`}
          >Завтра{hasTomorrow && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />}</button>
        </div>
      </div>

      {lastChecked && (
        <div className="d-card px-3.5 py-2.5 text-center fade-in">
          <p className="text-[11px] text-muted-c">Перевірено {formatChangeTime(lastChecked)}</p>
        </div>
      )}

      {filteredGroups.length === 0 ? (
        <div className="d-card py-10 text-center fade-in">
          <History className="mx-auto mb-2 h-10 w-10 text-muted-c" />
          <p className="text-sm font-semibold text-primary-c">
            {changeDayTab === 'today' ? 'Сьогодні змін не було' : 'На завтра змін ще немає'}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-secondary-c">
            {changeDayTab === 'today'
              ? 'Ми стежимо за графіком — щойно енергетики щось змінять, тут з\'явиться, що саме.'
              : 'Щойно з\'явиться оновлений графік на завтра, побачите його тут.'}
          </p>
        </div>
      ) : (
        <>
          {/* All changes from the last 24 hours, latest emphasized */}
          {filteredGroups.map((g, gi) => (
            <div key={g.detectedAt} className={`d-card px-3.5 py-3 fade-in ${gi === 0 ? 'ring-2 ring-blue-500/30' : 'opacity-75'}`}
              style={gi === 0 ? { backgroundColor: 'rgba(59,130,246,0.06)' } : undefined}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full ${gi === 0 ? 'accent-soft-bg' : 'bg-black/5 dark:bg-white/8'}`}>
                  <RefreshCw className={`h-3 w-3 ${gi === 0 ? 'accent-c' : 'text-muted-c'}`} />
                </span>
                <span className="text-xs font-bold text-primary-c">
                  {formatChangeTime(g.detectedAt)}{gi === 0 && ' · найсвіжіше'}
                </span>
              </div>
              <div className="space-y-1.5">
                {g.items
                  .filter((it) => {
                    const label = formatScheduleDate(it.scheduleDate, it.day);
                    return changeDayTab === 'today' ? label === 'сьогодні' : label === 'завтра';
                  })
                  .map((it, i) => (
                    <div key={i} className="rounded-xl bg-black/4 px-3 py-2 dark:bg-white/6">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md accent-soft-bg px-1.5 py-0.5 text-[10px] font-bold accent-c">Черга {it.queue}</span>
                      </div>
                      {it.oldSlots && it.newSlots && (it.oldSlots.length > 0 || it.newSlots.length > 0) ? (
                        <DiffTimeline oldSlots={it.oldSlots} newSlots={it.newSlots} />
                      ) : (
                        <p className="mt-1 text-xs leading-relaxed text-secondary-c">{it.summary}</p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
type View = 'schedule' | 'changes' | 'settings';
type DayTab = 'today' | 'tomorrow';

function App() {
  const [view, setView] = useState<View>('schedule');
  const [dayTab, setDayTab] = useState<DayTab>('today');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<KyivTime>(getKyivTime());
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [density, setDensity] = useState<Density>(getInitialDensity);
  const [onboarded, setOnboarded] = useState<boolean>(() => localStorage.getItem('onboarded') === '1');
  const [prefsChecked, setPrefsChecked] = useState(() => !getTelegramUser());
  const [obStep, setObStep] = useState(0);

  const [oblasts, setOblasts] = useState<Oblast[]>([]);
  const [selectedOblast, setSelectedOblast] = useState<Oblast | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [todaySchedule, setTodaySchedule] = useState<CitySchedule | null>(null);
  const [tomorrowSchedule, setTomorrowSchedule] = useState<CitySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [citySearchSettings, setCitySearchSettings] = useState('');

  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyMinutes, setNotifyMinutes] = useState(60);
  const [saved, setSaved] = useState(false);

  const tgUser = useMemo(() => getTelegramUser(), []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedCityKeyRef = useRef<string>('');
  // True once the user picks anything themselves; the saved-settings restore
  // must never overwrite a choice the user just made.
  const hasSelectionRef = useRef(false);
  hasSelectionRef.current = Boolean(selectedOblast || selectedCity || selectedGroup);

  // Red dot on the history button: set when the latest change for this city is
  // newer than the last time the user opened the changes tab.
  const [unseenChanges, setUnseenChanges] = useState(false);
  const lastSeenChangeRef = useRef<string>('');
  const [densityMenuOpen, setDensityMenuOpen] = useState(false);

  // Deep link from the bot's "schedule updated" notification: the button opens
  // the mini app with ?screen=changes, landing the user straight on the change
  // history once their city is restored.
  const [pendingView, setPendingView] = useState<View | null>(() => {
    const screen = getTelegramStartScreen();
    return screen === 'changes' ? 'changes' : null;
  });

  useEffect(() => {
    if (!selectedOblast || !selectedCity) return;
    let cancelled = false;
    const fetchState = () => {
      supabase
        .from('schedule_check_state')
        .select('last_change_at')
        .eq('oblast_slug', selectedOblast.slug)
        .eq('city_slug', selectedCity.slug)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          const latest = (data as { last_change_at: string | null } | null)?.last_change_at ?? '';
          setUnseenChanges(Boolean(latest) && latest > (lastSeenChangeRef.current ?? ''));
        });
    };
    fetchState();
    const interval = setInterval(fetchState, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedOblast, selectedCity]);

  // Opening the changes tab marks everything as seen — server-side so it
  // travels with the user's Telegram account across devices/sessions.
  useEffect(() => {
    if (view !== 'changes') return;
    const ts = new Date().toISOString();
    lastSeenChangeRef.current = ts;
    setUnseenChanges(false);
    const tg = getTelegramWebApp();
    if (tg?.initData) {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          initData: tg.initData,
          markChangesSeen: true,
          patch: {
            oblast_slug: selectedOblast?.slug ?? '',
            city_slug: selectedCity?.slug ?? '',
          },
        }),
      }).catch(() => { /* best-effort */ });
    }
  }, [view, selectedOblast, selectedCity]);

  // Apply the deep-linked screen once onboarding state is resolved and the
  // city is restored — the changes view needs oblast + city to render.
  useEffect(() => {
    if (!pendingView || !onboarded || !prefsChecked || !selectedOblast || !selectedCity) return;
    setView(pendingView);
    setPendingView(null);
  }, [pendingView, onboarded, prefsChecked, selectedOblast, selectedCity]);

  useEffect(() => { initTelegramWebApp(); }, []);

  // Theme is always one of light/dark; default is light.
  const resolvedTheme: 'light' | 'dark' = themeMode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    setTelegramThemeColors(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => { localStorage.setItem('themeMode', themeMode); }, [themeMode]);
  useEffect(() => { localStorage.setItem('density', density); }, [density]);

  // Notification settings are shared with the Telegram bot: refresh them
  // whenever the user opens the settings screen so bot-side edits show up.
  // Goes through the user-prefs edge function, which verifies the Telegram
  // initData signature server-side before returning anything.
  useEffect(() => {
    if (view !== 'settings' || !tgUser) return;
    const tg = getTelegramWebApp();
    if (!tg?.initData) return;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json() as { prefs?: { notify_enabled: boolean; notify_minutes_before: number } | null };
        if (json.prefs) {
          setNotifyEnabled(json.prefs.notify_enabled);
          setNotifyMinutes(json.prefs.notify_minutes_before);
        }
      })
      .catch(() => { /* settings stay local */ });
  }, [view, tgUser]);

  useEffect(() => {
    fetchOblasts()
      .then((data) => { setOblasts(data); setLoading(false); })
      .catch(() => { setApiError('Не вдалося завантажити список областей'); setLoading(false); });
  }, []);

  // Load cities when oblast changes
  useEffect(() => {
    if (!selectedOblast) { setCities([]); return; }
    setCitiesLoading(true);
    fetchCities(selectedOblast.slug)
      .then((data) => setCities(data))
      .catch(() => setCities([]))
      .finally(() => setCitiesLoading(false));
  }, [selectedOblast]);

  // Load saved settings right away: if the user already picked a city and queue,
  // restore them and skip onboarding even when the local flag was lost.
  // The restore itself still needs the city catalog to map slugs -> names.
  useEffect(() => {
    if (!tgUser || oblasts.length === 0) return;
    const tg = getTelegramWebApp();
    if (!tg?.initData) { setPrefsChecked(true); return; }
    let cancelled = false;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then(async (r) => {
        if (!r.ok) { setPrefsChecked(true); return; }
        const json = await r.json() as {
          prefs?: {
            notify_enabled: boolean; notify_minutes_before: number;
            oblast_slug: string | null; city_slug: string | null; city_name: string | null; queue_group: string | null;
            last_seen_changes_at: string | null;
          } | null;
          city_seen_at?: string | null;
        };
        if (cancelled) return;
        const prefs = json.prefs;
        if (prefs && !hasSelectionRef.current) {
          setNotifyEnabled(prefs.notify_enabled);
          setNotifyMinutes(prefs.notify_minutes_before);
          // Use per-city seen timestamp if available, fall back to legacy.
          const seenAt = json.city_seen_at ?? prefs.last_seen_changes_at;
          if (seenAt) lastSeenChangeRef.current = seenAt;
          if (prefs.oblast_slug) {
            const oblast = oblasts.find((o) => o.slug === prefs.oblast_slug);
            if (oblast) setSelectedOblast(oblast);
          }
          if (prefs.city_slug && prefs.queue_group) {
            if (prefs.city_name) setSelectedCity({ slug: prefs.city_slug, name: prefs.city_name });
            setSelectedGroup(prefs.queue_group);
            setOnboarded(true);
            localStorage.setItem('onboarded', '1');
          }
        }
        setPrefsChecked(true);
      })
      .catch(() => { if (!cancelled) setPrefsChecked(true); });
    return () => { cancelled = true; };
  }, [tgUser, oblasts]);

  useEffect(() => {
    if (!tgUser || !selectedOblast || !selectedCity || !selectedGroup) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const tgW = getTelegramWebApp();
      if (!tgW?.initData) return;
      const prefKey = `${selectedOblast.slug}|${selectedCity.slug}|${selectedGroup}`;
      try {
        // Check stored prefs via the authenticated edge function to compare
        // against current selection before saving.
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ initData: tgW.initData }),
        });
        if (!r.ok) return;
        const json = await r.json() as {
          prefs?: { oblast_slug: string | null; city_slug: string | null; queue_group: string | null } | null;
        };
        const stored = json.prefs;
        const storedKey = stored
          ? `${stored.oblast_slug ?? ''}|${stored.city_slug ?? ''}|${stored.queue_group ?? ''}`
          : '';
        const changed = storedKey !== prefKey;
        if (changed) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({
              initData: tgW.initData,
              patch: {
                oblast_slug: selectedOblast.slug,
                city_slug: selectedCity.slug,
                city_name: selectedCity.name,
                queue_group: selectedGroup,
                notify_enabled: notifyEnabled,
                notify_minutes_before: notifyMinutes,
              },
            }),
          });
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-bot`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              action: 'prefs_saved',
              initData: tgW.initData,
              city: selectedCity.name,
              queue: selectedGroup,
            }),
          });
          setSaved(true); hapticNotification('success');
          setTimeout(() => setSaved(false), 2000);
        }
      } catch { /* best-effort */ }
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [tgUser, selectedOblast, selectedCity, selectedGroup, notifyEnabled, notifyMinutes]);

  useEffect(() => {
    if (!selectedOblast || !selectedCity) return;
    const key = `${selectedOblast.slug}/${selectedCity.slug}`;
    const isFirstLoad = loadedCityKeyRef.current !== key;
    loadedCityKeyRef.current = key;
    if (isFirstLoad) setScheduleLoading(true);
    setApiError(null);
    Promise.all([
      fetchTodaySchedule(selectedOblast.slug, selectedCity.slug),
      fetchTomorrowSchedule(selectedOblast.slug, selectedCity.slug),
    ])
      .then(([today, tomorrow]) => {
        setTodaySchedule(today); setTomorrowSchedule(tomorrow);
        const groups = today.schedules.map((s) => s.queue).sort();
        setAvailableGroups(groups.length > 0 ? groups : ALL_GROUPS);
      })
      .catch(() => { if (isFirstLoad) setApiError('Не вдалося завантажити графік. Спробуйте пізніше.'); })
      .finally(() => { if (isFirstLoad) setScheduleLoading(false); });
  }, [selectedOblast, selectedCity, refreshTick]);

  // Auto-refresh schedules every 30 minutes (silent, without loader)
  useEffect(() => {
    const interval = setInterval(() => setRefreshTick((t) => t + 1), 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(getKyivTime()), 15000);
    return () => clearInterval(interval);
  }, []);

  const displaySchedule = dayTab === 'today' ? todaySchedule : tomorrowSchedule;
  const displaySlots = useMemo<Slot[]>(() => {
    if (!displaySchedule || !selectedGroup) return [];
    return displaySchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [displaySchedule, selectedGroup]);

  const todaySlots = useMemo<Slot[]>(() => {
    if (!todaySchedule || !selectedGroup) return [];
    return todaySchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [todaySchedule, selectedGroup]);

  const tomorrowSlots = useMemo<Slot[]>(() => {
    if (!tomorrowSchedule || !selectedGroup) return [];
    return tomorrowSchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [tomorrowSchedule, selectedGroup]);

  const filteredSettingsCities = useMemo(() => {
    if (!citySearchSettings.trim()) return cities;
    const q = citySearchSettings.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q));
  }, [cities, citySearchSettings]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-primary-c">
      <div className="text-center">
        <Loader2 className="mx-auto h-9 w-9 animate-spin accent-c" />
        <p className="mt-2 text-sm text-secondary-c">Завантаження...</p>
      </div>
    </div>
  );

  if (!prefsChecked) return (
    <div className="flex min-h-screen items-center justify-center bg-primary-c">
      <div className="text-center">
        <Loader2 className="mx-auto h-9 w-9 animate-spin accent-c" />
        <p className="mt-2 text-sm text-secondary-c">Завантаження...</p>
      </div>
    </div>
  );

  if (!onboarded) {
    return (
      <div className="design-glass">
        <Onboarding
          step={obStep} setStep={setObStep}
          oblasts={oblasts}
          selectedOblast={selectedOblast} setSelectedOblast={setSelectedOblast}
          cities={cities}
          selectedCity={selectedCity} setSelectedCity={setSelectedCity}
          selectedGroup={selectedGroup} setSelectedGroup={setSelectedGroup}
          scheduleLoading={scheduleLoading} citiesLoading={citiesLoading} availableGroups={availableGroups}
          tgUser={tgUser}
          notifyEnabled={notifyEnabled} setNotifyEnabled={setNotifyEnabled}
          notifyMinutes={notifyMinutes} setNotifyMinutes={setNotifyMinutes}
          onFinish={() => { localStorage.setItem('onboarded', '1'); setOnboarded(true); setView('schedule'); }}
        />
      </div>
    );
  }

  const isExtended = density === 'extended';

  return (
    <div className="design-glass min-h-screen bg-primary-c" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <Aurora />
      <div className="relative z-10 mx-auto max-w-lg px-4 py-4 sm:px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>

        {/* ── Header ── */}
        <header className="relative z-50 mb-4 fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {view === 'settings' && (
                <button onClick={() => { setView('schedule'); hapticImpact('light'); }}
                  className="d-btn flex h-9 w-9 items-center justify-center rounded-full">
                  <ChevronLeft className="h-5 w-5 text-primary-c" />
                </button>
              )}
              <div className="logo-glow flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 shadow-sm shadow-indigo-500/40">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight text-primary-c">
                  {view === 'schedule' ? 'Графік світла' : view === 'changes' ? 'Оновлення графіка' : 'Налаштування'}
                </h1>
                {selectedCity && view !== 'settings' ? (
                  <button onClick={() => { setView('settings'); hapticImpact('light'); }}
                    className="flex items-center gap-1 text-xs accent-c">
                    <MapPin className="h-3 w-3" />
                    {selectedCity.name}{selectedGroup && ` · ${selectedGroup}`}
                  </button>
                ) : !selectedCity && view !== 'settings' ? (
                  <p className="text-xs text-secondary-c">Україна</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setThemeMode(themeMode === 'light' ? 'dark' : 'light');
                  hapticImpact('light');
                }}
                className="d-btn flex h-9 w-9 items-center justify-center rounded-full"
                aria-label="Тема"
                title={themeMode === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
              >
                {themeMode === 'light'
                  ? <Moon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  : <Sun className="h-4 w-4 text-amber-400" />}
              </button>
              {view === 'schedule' && (
                <div className="relative">
                  <button
                    onClick={() => { setDensityMenuOpen((o) => !o); hapticImpact('light'); }}
                    className={`d-btn flex h-9 w-9 items-center justify-center rounded-full ${densityMenuOpen ? 'ring-2 ring-blue-500/40' : ''}`}
                    aria-label="Стиль відображення"
                    title="Стиль відображення"
                  >
                    {density === 'minimal' && <Gauge className="h-4 w-4 accent-c" />}
                    {density === 'standard' && <LayoutGrid className="h-4 w-4 accent-c" />}
                    {density === 'extended' && <Layers className="h-4 w-4 accent-c" />}
                  </button>
                  {densityMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setDensityMenuOpen(false)} />
                      <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl d-panel menu-solid fade-in-menu">
                        {DENSITY_OPTIONS.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => { setDensity(o.id); setDensityMenuOpen(false); hapticImpact('light'); }}
                            className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                              density === o.id ? 'accent-soft-bg' : 'hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                          >
                            <o.icon className={`h-4 w-4 shrink-0 ${density === o.id ? 'accent-c' : 'text-muted-c'}`} />
                            <span className="min-w-0">
                              <span className={`block text-xs font-semibold ${density === o.id ? 'accent-c' : 'text-primary-c'}`}>{o.name}</span>
                              <span className="block truncate text-[10px] text-muted-c">{o.desc}</span>
                            </span>
                            {density === o.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0 accent-c" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {view === 'schedule' && selectedCity && (
                <button onClick={() => { setView('changes'); hapticImpact('light'); }}
                  className="relative d-btn flex h-9 w-9 items-center justify-center rounded-full"
                  aria-label="Оновлення графіка" title="Оновлення графіка">
                  <History className="h-4 w-4 accent-c" />
                  {unseenChanges && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
                    </span>
                  )}
                </button>
              )}
              {view === 'schedule' && (
                <button onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="d-btn flex h-9 w-9 items-center justify-center rounded-full">
                  <Settings className="h-4 w-4 accent-c" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── SCHEDULE VIEW ── */}
        {view === 'schedule' && (
          <div className="relative isolate">
            <div className="pointer-events-none absolute inset-x-0 -top-6 -z-10 flex justify-center">
              <div className="underlay-breathe h-56 w-80 rounded-full bg-indigo-500/25 blur-[90px]" />
            </div>
            <div className="pointer-events-none absolute -right-10 top-64 -z-10 h-40 w-40 rounded-full bg-violet-500/15 blur-[70px]" />
                <div className="mb-4 text-center fade-in">
                  <div className="clock-glow font-mono text-5xl font-bold tracking-tight text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>{now.timeString}</div>
                </div>

            {saved && (
              <div className="mb-3 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/8 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300 fade-in">
                <CheckCircle2 className="h-3.5 w-3.5" /> Збережено
              </div>
            )}

            {apiError && (
              <div className="mb-3 rounded-xl bg-red-500/8 px-3 py-2.5 text-sm" style={{ color: 'var(--on-negative)' }}>{apiError}</div>
            )}

            {!selectedCity || !selectedGroup ? (
              <div className="d-card flex flex-col items-center justify-center py-12 text-center fade-in-scale">
                <MapPin className="mb-3 h-12 w-12 text-muted-c" />
                <h2 className="mb-1.5 text-lg font-bold text-primary-c">Оберіть місто та чергу</h2>
                <p className="mb-4 max-w-xs text-sm text-secondary-c">Це можна зробити в налаштуваннях</p>
                <button onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="rounded-xl accent-bg px-6 py-3 text-sm font-semibold text-white transition-all hover:scale-[1.02]">
                  Перейти до налаштувань
                </button>
              </div>
            ) : scheduleLoading ? (
              <div className="flex flex-col items-center justify-center py-12 fade-in">
                <Loader2 className="h-8 w-8 animate-spin accent-c" />
                <p className="mt-2 text-sm text-secondary-c">Завантаження графіку...</p>
              </div>
            ) : (
              <>
                {/* Auto-refresh info */}
                <div className="mb-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-c">
                  <RefreshCw className="h-3 w-3 animate-[spin_9s_linear_infinite]" />
                  <span>Перевіряємо оновлення кожні 30 хв</span>
                </div>

                {/* Status by density */}
                {density === 'minimal' && <div className="mb-3"><StatusLine slots={todaySlots} now={now} /></div>}
                {density === 'standard' && <div className="mb-3"><StatusCompact slots={todaySlots} now={now} /></div>}
                {density === 'extended' && <div className="mb-3"><StatusFull slots={todaySlots} now={now} /></div>}

                {/* Day tabs — hidden in extended (both days shown) */}
                {density !== 'extended' && (
                  <div className="mb-3 flex justify-center fade-in-delay-1">
                    <div className="segmented">
                      <button onClick={() => { setDayTab('today'); hapticImpact('light'); }}
                        className={`segmented-item px-5 py-1.5 text-sm font-semibold ${dayTab === 'today' ? 'active text-primary-c' : 'text-secondary-c'}`}
                      >Сьогодні</button>
                      <button onClick={() => { setDayTab('tomorrow'); hapticImpact('light'); }}
                        className={`segmented-item px-5 py-1.5 text-sm font-semibold ${dayTab === 'tomorrow' ? 'active text-primary-c' : 'text-secondary-c'}`}
                      >Завтра{tomorrowSlots.length === 0 && (
                        <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 align-middle" />
                      )}</button>
                    </div>
                  </div>
                )}

                {/* Graph — standard/extended only */}
                {density !== 'minimal' && (
                  <div className="mb-4">
                    {dayTab === 'tomorrow' && displaySlots.length === 0 ? (
                      <div className="d-card flex flex-col items-center justify-center gap-2 py-8 text-center fade-in">
                        <Clock className="h-7 w-7 text-muted-c" />
                        <p className="max-w-xs px-4 text-sm text-secondary-c">Графік відключень ще не опубліковано. Очікуємо оновлення інформації</p>
                      </div>
                    ) : (
                      <HourlyGraph
                        key={dayTab}
                        slots={displaySlots} now={now} isToday={dayTab === 'today'}
                        updated={displaySchedule?.updated ?? null}
                        showStats={isExtended}
                      />
                    )}
                  </div>
                )}

                {/* Lists */}
                {density === 'minimal' && (
                  <div className="mb-4">
                    {dayTab === 'tomorrow' && tomorrowSlots.length === 0 ? (
                      <div className="d-card flex flex-col items-center justify-center gap-2 py-8 text-center fade-in">
                        <Clock className="h-7 w-7 text-muted-c" />
                        <p className="max-w-xs px-4 text-sm text-secondary-c">Графік відключень ще не опубліковано. Очікуємо оновлення інформації</p>
                      </div>
                    ) : (
                      <CompactList slots={dayTab === 'today' ? todaySlots : tomorrowSlots} now={now} isToday={dayTab === 'today'} />
                    )}
                  </div>
                )}
                               {density === 'standard' && (
                  <div className="mb-4">
                    {dayTab === 'tomorrow' && displaySlots.length === 0 ? (
                      <div className="d-card flex flex-col items-center justify-center gap-2 py-8 text-center fade-in">
                        <Clock className="h-7 w-7 text-muted-c" />
                        <p className="max-w-xs px-4 text-sm text-secondary-c">Графік відключень ще не опубліковано. Очікуємо оновлення інформації</p>
                      </div>
                    ) : (
                      <CompactList slots={displaySlots} now={now} isToday={dayTab === 'today'} />
                    )}
                  </div>
                )}
                {density === 'extended' && (
                  <>
                    <div className="mb-2 mt-1 text-xs font-bold uppercase tracking-wide text-secondary-c">Сьогодні</div>
                    <div className="mb-4"><ComfortableList slots={todaySlots} now={now} isToday={true} /></div>
                    {tomorrowSlots.length > 0 && (
                      <>
                        <div className="mb-2 mt-1 text-xs font-bold uppercase tracking-wide text-secondary-c">Завтра</div>
                        <div className="mb-4"><ComfortableList slots={tomorrowSlots} now={now} isToday={false} /></div>
                      </>
                    )}
                  </>
                )}

                <footer className="mt-6 border-t border-subtle-c pt-3">
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex items-start gap-1.5">
                      <ShieldCheck className="mt-px h-3 w-3 shrink-0 text-muted-c" />
                      <p className="text-[10px] leading-tight text-muted-c">
                        Дані з відкритих джерел.<br />Лише інформаційні, для особистого використання.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 dark:bg-white/8">
                      <span className="text-[10px] leading-none text-muted-c">Зроблено з</span>
                      <Heart className="h-2.5 w-2.5 shrink-0 fill-current text-red-400" />
                      <span className="text-[10px] leading-none text-muted-c">, by wt.rvng</span>
                    </div>
                  </div>
                </footer>
              </>
            )}
          </div>
        )}

        {/* ── CHANGES VIEW ── */}
        {view === 'changes' && selectedOblast && selectedCity && (
          <div className="fade-in">
            <p className="mb-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-c">
              <RefreshCw className="h-3 w-3" />
              <span>Стежимо за графіком · {selectedCity.name}</span>
            </p>
            <ChangeHistory oblastSlug={selectedOblast.slug} citySlug={selectedCity.slug} />
            <button
              onClick={() => { setView('schedule'); hapticImpact('light'); }}
              className="d-btn mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-secondary-c transition-all hover:scale-[1.01]"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> До графіка
            </button>
          </div>
        )}

        {/* ── SETTINGS VIEW ── */}
        {view === 'settings' && (
          <div className="fade-in space-y-3">
            {saved && (
              <div className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/8 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Збережено
              </div>
            )}

            {/* Theme */}
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-secondary-c">Тема</h3>
              <div className="segmented flex w-full">
                {(['light', 'dark'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setThemeMode(m); hapticImpact('light'); }}
                    className={`segmented-item flex-1 px-3 py-1.5 text-xs font-semibold ${themeMode === m ? 'active text-primary-c' : 'text-secondary-c'}`}
                  >
                    {m === 'light' ? 'Світла' : 'Темна'}
                  </button>
                ))}
              </div>
            </div>

            {/* Oblast */}
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-secondary-c">Область</h3>
              <select
                value={selectedOblast?.slug ?? ''}
                onChange={(e) => {
                  const oblast = oblasts.find((o) => o.slug === e.target.value);
                  if (oblast) { setSelectedOblast(oblast); setSelectedCity(null); setSelectedGroup(''); setTodaySchedule(null); setTomorrowSchedule(null); hapticImpact('light'); }
                }}
                className="d-panel w-full appearance-none rounded-xl px-3 py-2 text-sm text-primary-c outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                <option value="" disabled>Оберіть область...</option>
                {oblasts.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
              </select>
            </div>

            {/* City */}
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-secondary-c">Місто</h3>
              <div className="relative mb-1.5">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-c" />
                <input
                  type="text" value={citySearchSettings} onChange={(e) => setCitySearchSettings(e.target.value)}
                  placeholder="Пошук міста..."
                  className="d-panel w-full rounded-xl py-2 pl-10 pr-3 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div className="d-panel scroll-touch space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl p-1.5" style={{ height: 'min(260px, 38vh)', WebkitOverflowScrolling: 'touch' }}>
                {!selectedOblast ? (
                  <p className="py-3 text-center text-xs text-muted-c">Спочатку оберіть область</p>
                ) : citiesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-3 text-xs text-secondary-c"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Завантаження...</div>
                ) : (
                  <>
                    {filteredSettingsCities.map((city) => (
                      <button
                        key={city.slug}
                        onClick={() => { setSelectedCity(city); setSelectedGroup(''); setTodaySchedule(null); setTomorrowSchedule(null); hapticImpact('light'); }}
                        className={`flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                          selectedCity?.slug === city.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c active:bg-black/5 dark:active:bg-white/5'
                        }`}
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{city.name}</span>
                        {selectedCity?.slug === city.slug && <Check className="ml-auto h-4 w-4 shrink-0" />}
                      </button>
                    ))}
                    {filteredSettingsCities.length === 0 && <p className="py-3 text-center text-xs text-muted-c">Не знайдено</p>}
                  </>
                )}
              </div>
            </div>

            {/* Queue */}
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-secondary-c">Черга</h3>
              {scheduleLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-secondary-c"><Loader2 className="h-4 w-4 animate-spin" /> Завантаження...</div>
              ) : (
                <div className="grid grid-cols-6 gap-1">
                  {(availableGroups.length > 0 ? availableGroups : ALL_GROUPS).map((group) => (
                    <button
                      key={group}
                      onClick={() => { setSelectedGroup(group); hapticImpact('light'); }}
                      className={`rounded-lg px-1 py-2 text-center text-xs font-bold transition-all ${
                        selectedGroup === group ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'd-btn text-secondary-c hover:scale-105'
                      }`}
                    >{group}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Notifications */}
            {tgUser && (
              <div className="d-card px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {notifyEnabled ? <Bell className="h-3.5 w-3.5 accent-c" /> : <BellOff className="h-3.5 w-3.5 text-muted-c" />}
                    <h3 className="text-xs font-bold text-primary-c">Сповіщення</h3>
                  </div>
                  <button
                    onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                    style={{ width: 38, height: 20, padding: 0, border: 'none', flexShrink: 0 }}
                    className={`relative inline-block rounded-full transition-colors ${notifyEnabled ? 'accent-bg' : 'bg-black/10 dark:bg-white/10'}`}
                    aria-label="Сповіщення"
                  >
                    <span
                      style={{
                        position: 'absolute', left: 2, top: 2, width: 16, height: 16,
                        transform: notifyEnabled ? 'translateX(18px)' : 'translateX(0px)',
                      }}
                      className="block rounded-full bg-white shadow-sm transition-transform duration-200"
                    />
                  </button>
                </div>
                {notifyEnabled && (
                  <div className="mt-2.5">
                    <p className="mb-1.5 text-[11px] text-secondary-c">Попередити за:</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[15, 30, 60].map((mins) => (
                        <button
                          key={mins}
                          onClick={() => { setNotifyMinutes(mins); hapticImpact('light'); }}
                          className={`rounded-lg px-3 py-1.5 text-center text-xs font-semibold transition-all ${
                            notifyMinutes === mins ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'd-btn text-secondary-c'
                          }`}
                        >{mins} хв</button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-2.5 flex items-center gap-1 text-[10px] text-muted-c">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  Налаштування спільні з Telegram-ботом — змініть у будь-якому місці
                </p>
              </div>
            )}

            {/* Replay onboarding — keep existing selections so the user can
                just click through and only change what they want */}
            <button
              onClick={() => {
                const startStep = !selectedOblast ? 1 : !selectedCity ? 2 : !selectedGroup ? 3 : 1;
                setObStep(startStep); setOnboarded(false); localStorage.removeItem('onboarded');
                hapticImpact('light');
              }}
              className="d-btn flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-secondary-c transition-all hover:scale-[1.01]"
            >
              <Sparkles className="h-3.5 w-3.5" /> Пройти налаштування знову
            </button>

            <button
              onClick={() => { setView('schedule'); hapticImpact('light'); }}
              className="w-full rounded-xl accent-bg px-4 py-2.5 text-center text-sm font-bold text-white shadow-sm transition-all hover:scale-[1.02]"
            >Готово</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
