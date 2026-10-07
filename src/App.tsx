import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Zap, ZapOff, MapPin, Loader2, CheckCircle2,
  Bell, BellOff, ChevronLeft, Search, Settings,
  Sun, Moon, Clock, Info, X,
  Sparkles, ArrowRight, ArrowLeft, Check, RefreshCw, Keyboard,
  LayoutGrid, Gauge, Layers, Eye, History,
} from 'lucide-react';
import { supabase, type UserPreferences, type ScheduleChange } from '@/lib/supabase';
import { getKyivTime, type KyivTime } from '@/lib/time';
import {
  initTelegramWebApp, getTelegramUser, hapticImpact, hapticNotification,
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
type ThemeMode = 'auto' | 'light' | 'dark';
type Density = 'minimal' | 'standard' | 'extended';

const DENSITY_OPTIONS: { id: Density; name: string; desc: string; icon: typeof Gauge }[] = [
  { id: 'minimal', name: 'Мінімальний', desc: 'Тільки статус і найближчі події', icon: Gauge },
  { id: 'standard', name: 'Стандартний', desc: 'Статус, графік дня і список подій', icon: LayoutGrid },
  { id: 'extended', name: 'Розширений', desc: 'Все + статистика дня і обидва дні одразу', icon: Layers },
];

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  return (localStorage.getItem('themeMode') as ThemeMode) || 'auto';
}
function getInitialDensity(): Density {
  if (typeof window === 'undefined') return 'standard';
  return (localStorage.getItem('density') as Density) || 'standard';
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
    <div className={`glass-sheen fade-in-scale hover-lift d-card p-4 ${isOff ? 'pulse-red' : 'pulse-green'}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${isOff ? 'bg-red-500/12' : 'bg-emerald-500/12'}`}>
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
            <p className="text-sm" style={{ color: 'var(--on-positive)' }}>
              Увімкнуть о {minutesToTime(nextOn.slot.start)} · через {formatCountdown(nextOn.minutesUntil)}
            </p>
          )}
          {!isOff && nextOutage && (
            <p className="text-sm" style={{ color: 'var(--on-negative)' }}>
              Відключення о {minutesToTime(nextOutage.slot.start)} · через {formatCountdown(nextOutage.minutesUntil)}
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
    <div className={`glass-sheen fade-in-scale hover-lift d-card p-5 text-center ${isOff ? 'pulse-red' : 'pulse-green'}`}>
      <div className={`mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full ${isOff ? 'bg-red-500/12' : 'bg-emerald-500/12'}`}>
        {isOff
          ? <ZapOff className="flicker h-8 w-8" style={{ color: 'var(--on-negative)' }} />
          : <Zap className="neon-pulse h-8 w-8" style={{ color: 'var(--on-positive)' }} />}
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
          <div className="rounded-xl bg-emerald-500/8 px-3 py-2">
            <span className="text-sm" style={{ color: 'var(--on-positive)' }}>
              Увімкнуть о <b className="text-primary-c">{minutesToTime(nextOn.slot.start)}</b> · через {formatCountdown(nextOn.minutesUntil)}
            </span>
          </div>
        )}
        {!isOff && nextOutage && (
          <div className="rounded-xl bg-red-500/8 px-3 py-2">
            <span className="text-sm" style={{ color: 'var(--on-negative)' }}>
              Відключення о <b className="text-primary-c">{minutesToTime(nextOutage.slot.start)}</b> · через {formatCountdown(nextOutage.minutesUntil)}
            </span>
          </div>
        )}
        {!isOff && !nextOutage && (
          <p className="text-sm text-secondary-c">Більше відключень не заплановано</p>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-black/4 py-2 dark:bg-white/6">
          <p className="text-sm font-bold text-primary-c">{(offMins / 60).toFixed(1)}г</p>
          <p className="text-[9px] text-muted-c">без світла</p>
        </div>
        <div className="rounded-xl bg-black/4 py-2 dark:bg-white/6">
          <p className="text-sm font-bold text-primary-c">{((1440 - offMins) / 60).toFixed(1)}г</p>
          <p className="text-[9px] text-muted-c">зі світлом</p>
        </div>
        <div className="rounded-xl bg-black/4 py-2 dark:bg-white/6">
          <p className="text-sm font-bold text-primary-c">{outagesCount}</p>
          <p className="text-[9px] text-muted-c">відключень</p>
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

      <div className="d-card p-3">        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
          {Array.from({ length: 24 }, (_, hour) => {
            const status = getHourStatus(sorted, hour);
            const isCurrent = isToday && currentMin >= hour * 60 && currentMin < (hour + 1) * 60;
            const isPast = isToday && currentMin >= (hour + 1) * 60;

            let barClass = 'bar-green';
            if (status === 'off') barClass = 'bar-red';
            else if (status === 'partial') barClass = 'bar-red-soft';

            return (
              <div key={hour} className="graph-col flex flex-col items-center gap-1"
                data-tip={`${String(hour).padStart(2, '0')}:00 · ${status === 'on' ? 'є світло' : status === 'off' ? 'без світла' : 'частково'}`}>
                <div
                  className={`graph-bar-anim relative w-full rounded-md ${barClass} ${status === 'off' ? 'bar-red-live' : ''} ${isPast ? 'opacity-30' : ''} ${isCurrent ? 'glow-ring' : ''}`}
                  style={{ height: '44px', animationDelay: `${hour * 0.03}s` }}
                >
                  {isCurrent && (
                    <div className="absolute -top-1.5 left-1/2 now-marker">
                      <div className="h-2 w-2 rounded-full bg-blue-500 shadow-lg shadow-blue-500/60" />
                    </div>
                  )}
                </div>
                <span className={`text-[8px] font-medium ${isCurrent ? 'font-bold text-blue-500' : 'text-muted-c'}`}>
                  {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
                </span>
              </div>
            );
          })}
        </div>

        {showStats && isToday && (
          <div className="mt-3 border-t border-subtle-c pt-2.5">
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-1000"
                  style={{ width: `${(currentMin / 1440) * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-medium text-muted-c">{Math.round((currentMin / 1440) * 100)}% дня</span>
            </div>
          </div>
        )}
      </div>

      {updated && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-c">
          <Info className="h-3 w-3 shrink-0" />
          <span>Графік оновлено · останні зміни: {updated}</span>
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
              active ? (isOff ? 'bg-red-500/6' : 'bg-emerald-500/6') : isPast ? 'opacity-35' : ''
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
              active ? (isOff ? 'ring-1 ring-red-500/30' : 'ring-1 ring-emerald-500/30') : isPast ? 'opacity-40' : ''
            }`}
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
}) {
  const [citySearch, setCitySearch] = useState('');
  const filtered = useMemo(() => {
    if (!citySearch.trim()) return cities;
    const q = citySearch.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q));
  }, [cities, citySearch]);

  const totalSteps = 4;

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
              if (step === 3) { onFinish(); hapticNotification('success'); }
              else { setStep(step + 1); hapticImpact('light'); }
            }}
            disabled={(step === 1 && !selectedOblast) || (step === 2 && !selectedCity) || (step === 3 && !selectedGroup)}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl accent-bg py-4 text-base font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] disabled:opacity-40"
          >
            {step === 0 && <>Почнемо <ArrowRight className="h-5 w-5" /></>}
            {(step === 1 || step === 2) && <>Далі <ArrowRight className="h-5 w-5" /></>}
            {step === 3 && <><CheckCircle2 className="h-5 w-5" /> Готово</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change history ────────────────────────────────────────────
type ChangeGroup = {
  detectedAt: string;
  items: { queue: string; day: string; changeType: string; summary: string }[];
};

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

function formatDayLabel(day: string): string {
  return day === 'today' ? 'сьогодні' : 'завтра';
}

function ChangeHistory({ oblastSlug, citySlug }: { oblastSlug: string; citySlug: string }) {
  const [groups, setGroups] = useState<ChangeGroup[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setGroups(null); setError(false);
    supabase
      .from('schedule_change_log')
      .select('id, queue, day, change_type, summary, detected_at')
      .eq('oblast_slug', oblastSlug)
      .eq('city_slug', citySlug)
      .order('detected_at', { ascending: false })
      .limit(100)
      .then(({ data, error: err }) => {
        if (err) { setError(true); setGroups([]); return; }
        const byTime = new Map<string, ChangeGroup>();
        for (const r of (data ?? []) as ScheduleChange[]) {
          let g = byTime.get(r.detected_at);
          if (!g) { g = { detectedAt: r.detected_at, items: [] }; byTime.set(r.detected_at, g); }
          g.items.push({ queue: r.queue, day: r.day, changeType: r.change_type, summary: r.summary });
        }
        setGroups([...byTime.values()]);
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
          Графік для вашого міста стабільний. Ми перевіряємо оновлення кожні 30 хвилин — і тут з'явиться, що саме змінилося.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.detectedAt} className="d-card px-3.5 py-3 fade-in">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full accent-soft-bg">
              <RefreshCw className="h-3 w-3 accent-c" />
            </span>
            <span className="text-xs font-bold text-primary-c">{formatChangeTime(g.detectedAt)}</span>
          </div>
          <div className="space-y-1.5">
            {g.items.map((it, i) => (
              <div key={i} className="rounded-xl bg-black/4 px-3 py-2 dark:bg-white/6">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-md accent-soft-bg px-1.5 py-0.5 text-[10px] font-bold accent-c">Черга {it.queue}</span>
                  <span className="text-[10px] text-muted-c">{formatDayLabel(it.day)}</span>
                  {it.changeType === 'initial' && <span className="text-[10px] text-muted-c">· перший знімок</span>}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-secondary-c">{it.summary}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
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

  useEffect(() => { initTelegramWebApp(); }, []);

  // Auto theme follows Kyiv daytime (7:00–19:00 = light)
  const resolvedTheme: 'light' | 'dark' = useMemo(() => {
    if (themeMode === 'auto') {
      return now.hours >= 7 && now.hours < 19 ? 'light' : 'dark';
    }
    return themeMode;
  }, [themeMode, now]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  useEffect(() => { localStorage.setItem('themeMode', themeMode); }, [themeMode]);
  useEffect(() => { localStorage.setItem('density', density); }, [density]);

  // Notification settings are shared with the Telegram bot: refresh them
  // whenever the user opens the settings screen so bot-side edits show up.
  useEffect(() => {
    if (view !== 'settings' || !tgUser) return;
    supabase.from('user_preferences')
      .select('notify_enabled, notify_minutes_before')
      .eq('tg_user_id', tgUser.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const prefs = data as Pick<UserPreferences, 'notify_enabled' | 'notify_minutes_before'>;
        setNotifyEnabled(prefs.notify_enabled);
        setNotifyMinutes(prefs.notify_minutes_before);
      });
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

  useEffect(() => {
    if (!tgUser || !onboarded || cities.length === 0) return;
    supabase.from('user_preferences').select('*').eq('tg_user_id', tgUser.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          const prefs = data as UserPreferences;
          setNotifyEnabled(prefs.notify_enabled);
          setNotifyMinutes(prefs.notify_minutes_before);
          if (prefs.oblast_slug) {
            const oblast = oblasts.find((o) => o.slug === prefs.oblast_slug);
            if (oblast) setSelectedOblast(oblast);
          }
          if (prefs.city_slug) {
            const city = cities.find((c) => c.slug === prefs.city_slug);
            if (city) setSelectedCity(city);
          }
          if (prefs.queue_group) setSelectedGroup(prefs.queue_group);
        }
      });
  }, [tgUser, onboarded, oblasts, cities]);

  useEffect(() => {
    if (!tgUser || !selectedOblast || !selectedCity || !selectedGroup) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await supabase.from('user_preferences').upsert({
        tg_user_id: tgUser.id, tg_username: tgUser.username ?? null,
        oblast_slug: selectedOblast.slug,
        city_slug: selectedCity.slug, queue_group: selectedGroup,
        notify_enabled: notifyEnabled, notify_minutes_before: notifyMinutes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tg_user_id' });
      setSaved(true); hapticNotification('success');
      setTimeout(() => setSaved(false), 2000);
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
          onFinish={() => { localStorage.setItem('onboarded', '1'); setOnboarded(true); setView('schedule'); }}
        />
      </div>
    );
  }

  const isExtended = density === 'extended';

  return (
    <div className="design-glass min-h-screen bg-primary-c" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <Aurora />
      <div className="relative z-10 mx-auto max-w-lg px-4 py-4 sm:px-5">

        {/* ── Header ── */}
        <header className="mb-4 fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {view === 'settings' && (
                <button onClick={() => { setView('schedule'); hapticImpact('light'); }}
                  className="d-btn flex h-9 w-9 items-center justify-center rounded-full">
                  <ChevronLeft className="h-5 w-5 text-primary-c" />
                </button>
              )}
              <div className="logo-glow flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-sm">
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
                  setThemeMode(themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto');
                  hapticImpact('light');
                }}
                className="d-btn flex h-9 w-9 items-center justify-center rounded-full"
                aria-label="Тема"
                title={themeMode === 'auto' ? 'Авто (за часом доби)' : themeMode === 'light' ? 'Світла тема' : 'Темна тема'}
              >
                {themeMode === 'auto' && <Clock className="h-4 w-4 accent-c" />}
                {themeMode === 'light' && <Sun className="h-4 w-4 text-amber-400" />}
                {themeMode === 'dark' && <Moon className="h-4 w-4 text-slate-400" />}
              </button>
              {view === 'schedule' && (
                <button
                  onClick={() => {
                    const idx = DENSITY_OPTIONS.findIndex((o) => o.id === density);
                    setDensity(DENSITY_OPTIONS[(idx + 1) % DENSITY_OPTIONS.length].id);
                    hapticImpact('light');
                  }}
                  className="d-btn flex h-9 w-9 items-center justify-center rounded-full"
                  aria-label="Стиль відображення"
                  title={`Стиль: ${DENSITY_OPTIONS.find((o) => o.id === density)?.name}`}
                >
                  {density === 'minimal' && <Gauge className="h-4 w-4 accent-c" />}
                  {density === 'standard' && <LayoutGrid className="h-4 w-4 accent-c" />}
                  {density === 'extended' && <Layers className="h-4 w-4 accent-c" />}
                </button>
              )}
              {view === 'schedule' && selectedCity && (
                <button onClick={() => { setView('changes'); hapticImpact('light'); }}
                  className="d-btn flex h-9 w-9 items-center justify-center rounded-full"
                  aria-label="Оновлення графіка" title="Оновлення графіка">
                  <History className="h-4 w-4 accent-c" />
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
              <div className="underlay-breathe h-56 w-80 rounded-full bg-blue-500/20 blur-[90px]" />
            </div>
            <div className="pointer-events-none absolute -right-10 top-64 -z-10 h-40 w-40 rounded-full bg-emerald-500/15 blur-[70px]" />
            {density !== 'minimal' && (
              <div className="mb-4 text-center fade-in">
                <span className="clock-glow font-mono text-2xl font-bold tracking-tight text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>{now.timeString}</span>
                <span className="ml-2 text-xs text-muted-c">Київ</span>
              </div>
            )}

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
                      <CompactList slots={dayTab === 'today' ? todaySlots : tomorrowSlots} now={now} isToday={dayTab === 'today'} limit={3} />
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

                <footer className="mt-6 border-t border-subtle-c pt-3 text-center">
                  <p className="text-xs text-muted-c">Дані з офіційних та неофіційних джерел · Київський час</p>
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
              <span>Перевіряємо оновлення кожні 30 хв · {selectedCity.name}</span>
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
                {(['auto', 'light', 'dark'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setThemeMode(m); hapticImpact('light'); }}
                    className={`segmented-item flex-1 px-3 py-1.5 text-xs font-semibold ${themeMode === m ? 'active text-primary-c' : 'text-secondary-c'}`}
                  >
                    {m === 'auto' ? 'Авто' : m === 'light' ? 'Світла' : 'Темна'}
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
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${notifyEnabled ? 'accent-bg' : 'bg-black/10 dark:bg-white/10'}`}
                    aria-label="Сповіщення"
                  >
                    <span
                      className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200"
                      style={{ transform: notifyEnabled ? 'translateX(16px)' : 'translateX(0px)' }}
                    />
                  </button>
                </div>
                {notifyEnabled && (
                  <div className="mt-2.5">
                    <p className="mb-1.5 text-[11px] text-secondary-c">Попередити за:</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[30, 60].map((mins) => (
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

            {/* Replay onboarding */}
            <button
              onClick={() => {
                setObStep(0); setOnboarded(false); localStorage.removeItem('onboarded');
                setSelectedOblast(null); setSelectedCity(null); setSelectedGroup('');
                setTodaySchedule(null); setTomorrowSchedule(null);
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
