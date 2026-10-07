import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Zap, ZapOff, MapPin, Loader2, CheckCircle2,
  Bell, BellOff, ChevronLeft, Search, Settings,
  Sun, Moon, AlertTriangle, Navigation, Clock,
  Info, LayoutGrid, Rows3, Gauge, X,
} from 'lucide-react';
import { supabase, type UserPreferences } from '@/lib/supabase';
import { getKyivTime, type KyivTime } from '@/lib/time';
import {
  initTelegramWebApp, getTelegramUser, hapticImpact, hapticNotification,
} from '@/lib/telegram';
import {
  fetchCities, fetchTodaySchedule, fetchTomorrowSchedule,
  minutesToTime, type City, type Slot, type CitySchedule,
} from '@/lib/yasno-api';

const ALL_GROUPS = ['1.1','1.2','2.1','2.2','3.1','3.2','4.1','4.2','5.1','5.2','6.1','6.2'];

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  kyiv:        { lat: 50.4501, lon: 30.5234 },
  berezan:     { lat: 50.3160, lon: 31.4750 },
  'bila-tserkva': { lat: 49.7968, lon: 30.1188 },
  bohuslav:    { lat: 49.0900, lon: 30.8150 },
  boryspil:    { lat: 50.3530, lon: 30.9530 },
  boyarka:     { lat: 50.3290, lon: 30.3010 },
  brovary:     { lat: 50.5110, lon: 30.7870 },
  bucha:       { lat: 50.5480, lon: 30.2130 },
  vasylkiv:    { lat: 50.1840, lon: 30.3200 },
  vyshhorod:   { lat: 50.5840, lon: 30.4730 },
  vyshneve:    { lat: 50.3860, lon: 30.3760 },
  irpin:       { lat: 50.5220, lon: 30.2500 },
  kaharlyk:    { lat: 49.9550, lon: 30.9600 },
  myronivka:   { lat: 49.5430, lon: 30.8700 },
  obukhiv:     { lat: 50.1220, lon: 30.6350 },
  pereiaslav:  { lat: 50.0770, lon: 31.4520 },
  ruzhyn:      { lat: 49.4470, lon: 28.6950 },
  slavutych:   { lat: 51.5200, lon: 30.4500 },
  tetiiv:      { lat: 49.7300, lon: 30.0500 },
  uzyn:        { lat: 49.8330, lon: 30.3000 },
  fastiv:      { lat: 50.0760, lon: 29.8840 },
  yahotyn:     { lat: 50.2810, lon: 31.7830 },
};

function findNearestCity(lat: number, lon: number, cities: City[]): City | null {
  let nearest: City | null = null;
  let minDist = Infinity;
  for (const city of cities) {
    const coords = CITY_COORDS[city.slug];
    if (!coords) continue;
    const dist = Math.hypot(coords.lat - lat, coords.lon - lon);
    if (dist < minDist) { minDist = dist; nearest = city; }
  }
  if (minDist > 0.8) return null;
  return nearest;
}

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

// ── Theme + Display Mode ──────────────────────────────────────
type Theme = 'light' | 'dark';
type DisplayMode = 'compact' | 'comfortable' | 'minimal';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('theme') as Theme | null;
  if (saved) return saved;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function getInitialDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'comfortable';
  return (localStorage.getItem('displayMode') as DisplayMode) || 'comfortable';
}

// ── Compact Status Pill ───────────────────────────────────────
function StatusPill({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`fade-in-scale apple-card p-4 ${isOff ? 'pulse-red' : 'pulse-green'}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
          isOff ? 'bg-red-500/12' : 'bg-emerald-500/12'
        }`}>
          {isOff
            ? <ZapOff className="h-5.5 w-5.5" style={{ color: 'var(--on-negative)' }} />
            : <Zap className="h-5.5 w-5.5" style={{ color: 'var(--on-positive)' }} />}
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

// ── Big Status Hero (Comfortable) ─────────────────────────────
function StatusHero({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`fade-in-scale apple-card p-5 text-center ${isOff ? 'pulse-red' : 'pulse-green'}`}>
      <div className={`mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full ${
        isOff ? 'bg-red-500/12' : 'bg-emerald-500/12'
      }`}>
        {isOff
          ? <ZapOff className="h-8 w-8" style={{ color: 'var(--on-negative)' }} />
          : <Zap className="h-8 w-8" style={{ color: 'var(--on-positive)' }} />}
      </div>
      <h2 className="text-xl font-bold text-primary-c">
        {isOff ? 'Світла зараз немає' : 'Світло зараз є'}
      </h2>
      {current && (
        <p className="mt-0.5 text-sm text-secondary-c">
          {isOff ? 'Відключення' : 'Живлення'}: {' '}
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
    </div>
  );
}

// ── Minimal Status (one line) ─────────────────────────────────
function StatusMinimal({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`fade-in-scale flex items-center gap-2.5 rounded-2xl px-4 py-3 ${
      isOff ? 'bg-red-500/8' : 'bg-emerald-500/8'
    }`}>
      <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOff ? 'bg-red-500' : 'bg-emerald-500'}`} />
      <span className="text-sm font-semibold text-primary-c">
        {isOff ? 'Без світла' : 'Є світло'}
      </span>
      {isOff && nextOn && (
        <span className="text-xs text-secondary-c">
          · увімкнуть {minutesToTime(nextOn.slot.start)}
        </span>
      )}
      {!isOff && nextOutage && (
        <span className="text-xs text-secondary-c">
          · відключення {minutesToTime(nextOutage.slot.start)}
        </span>
      )}
      {!isOff && !nextOutage && (
        <span className="text-xs text-secondary-c">· без відключень</span>
      )}
    </div>
  );
}

// ── Emergency Banner ──────────────────────────────────────────
function EmergencyBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fade-in flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 pulse-amber">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
      <p className="flex-1 text-sm text-amber-700 dark:text-amber-200/90">
        <b>Аварійний режим.</b> Звичайний графік може не діяти.
      </p>
      <button onClick={onDismiss} className="shrink-0 text-amber-500/60 hover:opacity-70">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Compact Graph ─────────────────────────────────────────────
function CompactGraph({ slots, now, isToday, updated }: { slots: Slot[]; now: KyivTime; isToday: boolean; updated: string | null }) {
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const relUpdate = getRelativeUpdate(updated);

  function getHourStatus(hour: number): 'on' | 'off' | 'partial' {
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

  return (
    <div className="fade-in-delay-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-emerald-500/60" />
            <span className="text-secondary-c">Є</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-red-500/60" />
            <span className="text-secondary-c">Немає</span>
          </span>
        </div>
        {relUpdate && (
          <span className="flex items-center gap-1 text-xs text-muted-c">
            <Clock className="h-3 w-3" />{relUpdate}
          </span>
        )}
      </div>
      <div className="apple-card p-2.5">
        <div className="grid grid-cols-24 gap-0.5" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
          {Array.from({ length: 24 }, (_, hour) => {
            const status = getHourStatus(hour);
            const isCurrent = isToday && currentMin >= hour * 60 && currentMin < (hour + 1) * 60;
            const isPast = isToday && currentMin >= (hour + 1) * 60;

            let bg = 'bg-emerald-500/45';
            if (status === 'off') bg = 'bg-red-500/55';
            else if (status === 'partial') bg = 'bg-red-500/30';
            if (isPast) bg += ' opacity-30';

            return (
              <div key={hour} className="flex flex-col items-center gap-0.5">
                <div
                  className={`graph-bar w-full rounded ${bg} ${isCurrent ? 'ring-1 ring-blue-400/70' : ''}`}
                  style={{ height: '28px', animationDelay: `${hour * 0.02}s` }}
                >
                  {isCurrent && (
                    <div className="absolute -top-1 left-1/2 now-marker">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    </div>
                  )}
                </div>
                {hour % 3 === 0 && (
                  <span className={`text-[8px] ${isCurrent ? 'text-blue-500 dark:text-blue-400 font-bold' : 'text-muted-c'}`}>
                    {String(hour).padStart(2, '0')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {relUpdate && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-c">
          <Info className="h-3 w-3 shrink-0" />
          Оновлено: <span className="font-medium text-secondary-c">{relUpdate}</span>
        </p>
      )}
    </div>
  );
}

// ── Comfortable Graph ─────────────────────────────────────────
function ComfortableGraph({ slots, now, isToday, updated }: { slots: Slot[]; now: KyivTime; isToday: boolean; updated: string | null }) {
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const relUpdate = getRelativeUpdate(updated);

  function getHourStatus(hour: number): 'on' | 'off' | 'partial-on' | 'partial-off' {
    const hourStart = hour * 60;
    const hourEnd = (hour + 1) * 60;
    let offMinutes = 0;
    for (const s of sorted) {
      if (s.type !== 'Definite') continue;
      const overlapStart = Math.max(s.start, hourStart);
      const overlapEnd = Math.min(s.end, hourEnd);
      if (overlapEnd > overlapStart) offMinutes += overlapEnd - overlapStart;
    }
    if (offMinutes >= 60) return 'off';
    if (offMinutes >= 30) return 'partial-off';
    if (offMinutes > 0) return 'partial-on';
    return 'on';
  }

  return (
    <div className="fade-in-delay-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-emerald-500/55" />
            <span className="text-secondary-c">Є світло</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-red-500/55" />
            <span className="text-secondary-c">Немає</span>
          </span>
        </div>
        {relUpdate && (
          <span className="flex items-center gap-1 text-xs text-muted-c">
            <Clock className="h-3 w-3" />{relUpdate}
          </span>
        )}
      </div>
      <div className="apple-card p-3">
        <div className="grid grid-cols-12 gap-1">
          {Array.from({ length: 24 }, (_, hour) => {
            const status = getHourStatus(hour);
            const isCurrent = isToday && currentMin >= hour * 60 && currentMin < (hour + 1) * 60;
            const isPast = isToday && currentMin >= (hour + 1) * 60;

            let bg = 'bg-emerald-500/45';
            if (status === 'off') bg = 'bg-red-500/55';
            else if (status === 'partial-off') bg = 'bg-red-500/35';
            else if (status === 'partial-on') bg = 'bg-emerald-500/25';
            if (isPast) bg += ' opacity-30';

            return (
              <div key={hour} className="flex flex-col items-center gap-1">
                <div
                  className={`graph-bar relative w-full rounded-lg ${bg} ${isCurrent ? 'ring-2 ring-blue-400/70' : ''}`}
                  style={{ height: '38px', animationDelay: `${hour * 0.022}s` }}
                >
                  {isCurrent && (
                    <div className="absolute -top-1 left-1/2 now-marker">
                      <div className="h-2 w-2 rounded-full bg-blue-500 shadow-sm" />
                    </div>
                  )}
                </div>
                <span className={`text-[8px] ${isCurrent ? 'text-blue-500 dark:text-blue-400 font-bold' : 'text-muted-c'}`}>
                  {hour % 2 === 0 ? String(hour).padStart(2, '0') : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {relUpdate && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-c">
          <Info className="h-3 w-3 shrink-0" />
          Оновлено: <span className="font-medium text-secondary-c">{relUpdate}</span>{updated && ` · ${updated}`}
        </p>
      )}
    </div>
  );
}

// ── Minimal Graph (thin bar) ──────────────────────────────────
function MinimalGraph({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;
  const sorted = [...slots].sort((a, b) => a.start - b.start);

  function getHourStatus(hour: number): 'on' | 'off' | 'partial' {
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

  return (
    <div className="fade-in-delay-2">
      <div className="apple-card p-2">
        <div className="flex h-6 gap-px overflow-hidden rounded-lg">
          {Array.from({ length: 24 }, (_, hour) => {
            const status = getHourStatus(hour);
            const isCurrent = isToday && currentMin >= hour * 60 && currentMin < (hour + 1) * 60;
            const isPast = isToday && currentMin >= (hour + 1) * 60;

            let bg = 'bg-emerald-500/50';
            if (status === 'off') bg = 'bg-red-500/55';
            else if (status === 'partial') bg = 'bg-red-500/30';
            if (isPast) bg += ' opacity-25';
            if (isCurrent) bg = 'bg-blue-500/70';

            return <div key={hour} className={`graph-bar h-full flex-1 ${bg}`} style={{ animationDelay: `${hour * 0.015}s` }} />;
          })}
        </div>
        <div className="mt-1 flex justify-between text-[8px] text-muted-c">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
    </div>
  );
}

// ── Compact Event List ────────────────────────────────────────
function CompactList({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;

  if (sorted.length === 0) return (
    <div className="apple-card py-6 text-center fade-in-delay-3">
      <p className="text-sm text-secondary-c">Графік поки не доступний</p>
    </div>
  );

  return (
    <div className="apple-card overflow-hidden fade-in-delay-3">
      {sorted.map((slot, i) => {
        const isOff = slot.type === 'Definite';
        const active = isToday && isSlotActive(slot, now);
        const isPast = isToday && currentMin >= slot.end;

        return (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-2.5 ${
              i < sorted.length - 1 ? 'border-b' : ''
            } ${active ? (isOff ? 'bg-red-500/6' : 'bg-emerald-500/6') : isPast ? 'opacity-35' : ''}`}
            style={{ borderBottomColor: 'var(--border-subtle)' }}
          >
            <div className={`h-2 w-2 shrink-0 rounded-full ${isOff ? 'bg-red-500' : 'bg-emerald-500'} ${active ? 'ring-2 ring-offset-1 ring-offset-transparent' : ''}`}
              style={active ? { boxShadow: `0 0 6px ${isOff ? 'var(--on-negative)' : 'var(--on-positive)'}` } : {}}
            />
            <span className="text-sm font-semibold text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {minutesToTime(slot.start)}–{minutesToTime(slot.end)}
            </span>
            {active && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold accent-soft-bg accent-c">
                зараз
              </span>
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

// ── Comfortable Event List ────────────────────────────────────
function ComfortableList({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;

  if (sorted.length === 0) return (
    <div className="apple-card py-8 text-center fade-in-delay-3">
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
            className={`apple-card flex items-center gap-3 px-4 py-3 ${
              active ? (isOff ? 'ring-1 ring-red-500/30' : 'ring-1 ring-emerald-500/30') : isPast ? 'opacity-40' : ''
            }`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isOff ? 'bg-red-500/10' : 'bg-emerald-500/10'
            }`}>
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
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold accent-soft-bg accent-c">
                    зараз
                  </span>
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

// ── Display Mode Switcher ─────────────────────────────────────
function DisplayModeSwitcher({ mode, onChange }: { mode: DisplayMode; onChange: (m: DisplayMode) => void }) {
  const modes: { id: DisplayMode; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'minimal', label: 'Міні', icon: Gauge },
    { id: 'comfortable', label: 'Комфорт', icon: LayoutGrid },
    { id: 'compact', label: 'Компакт', icon: Rows3 },
  ];
  return (
    <div className="segmented">
      {modes.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            onClick={() => { onChange(m.id); hapticImpact('light'); }}
            className={`segmented-item flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold ${
              mode === m.id ? 'active text-primary-c' : 'text-secondary-c'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
type View = 'schedule' | 'settings';
type DayTab = 'today' | 'tomorrow';

function App() {
  const [view, setView] = useState<View>('schedule');
  const [dayTab, setDayTab] = useState<DayTab>('today');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<KyivTime>(getKyivTime());
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(getInitialDisplayMode);

  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [todaySchedule, setTodaySchedule] = useState<CitySchedule | null>(null);
  const [tomorrowSchedule, setTomorrowSchedule] = useState<CitySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [citySearch, setCitySearch] = useState('');
  const [geoDetecting, setGeoDetecting] = useState(false);
  const [showEmergency, setShowEmergency] = useState(true);

  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyMinutes, setNotifyMinutes] = useState(60);
  const [saved, setSaved] = useState(false);

  const tgUser = useMemo(() => getTelegramUser(), []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { initTelegramWebApp(); }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('displayMode', displayMode);
  }, [displayMode]);

  useEffect(() => {
    fetchCities()
      .then((data) => { setCities(data); setLoading(false); })
      .catch(() => { setApiError('Не вдалося завантажити список міст'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!tgUser || cities.length === 0) return;
    supabase.from('user_preferences').select('*').eq('tg_user_id', tgUser.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          const prefs = data as UserPreferences;
          setNotifyEnabled(prefs.notify_enabled);
          setNotifyMinutes(prefs.notify_minutes_before);
          if (prefs.city_slug) {
            const city = cities.find((c) => c.slug === prefs.city_slug);
            if (city) setSelectedCity(city);
          }
          if (prefs.queue_group) setSelectedGroup(prefs.queue_group);
        }
      });
  }, [tgUser, cities]);

  useEffect(() => {
    if (!tgUser || !selectedCity || !selectedGroup) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await supabase.from('user_preferences').upsert({
        tg_user_id: tgUser.id, tg_username: tgUser.username ?? null,
        city_slug: selectedCity.slug, queue_group: selectedGroup,
        notify_enabled: notifyEnabled, notify_minutes_before: notifyMinutes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tg_user_id' });
      setSaved(true); hapticNotification('success');
      setTimeout(() => setSaved(false), 2000);
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [tgUser, selectedCity, selectedGroup, notifyEnabled, notifyMinutes]);

  useEffect(() => {
    if (!selectedCity) return;
    setScheduleLoading(true); setApiError(null);
    Promise.all([fetchTodaySchedule(selectedCity.slug), fetchTomorrowSchedule(selectedCity.slug)])
      .then(([today, tomorrow]) => {
        setTodaySchedule(today); setTomorrowSchedule(tomorrow);
        const groups = today.schedules.map((s) => s.queue).sort();
        setAvailableGroups(groups.length > 0 ? groups : ALL_GROUPS);
      })
      .catch(() => { setApiError('Не вдалося завантажити графік. Спробуйте пізніше.'); })
      .finally(() => setScheduleLoading(false));
  }, [selectedCity]);

  useEffect(() => {
    const interval = setInterval(() => setNow(getKyivTime()), 15000);
    return () => clearInterval(interval);
  }, []);

  const detectCity = useCallback(() => {
    if (cities.length === 0) return;
    setGeoDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nearest = findNearestCity(pos.coords.latitude, pos.coords.longitude, cities);
        if (nearest) {
          setSelectedCity(nearest); setSelectedGroup('');
          setTodaySchedule(null); setTomorrowSchedule(null);
          hapticImpact('medium');
        }
        setGeoDetecting(false);
      },
      () => { setGeoDetecting(false); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }, [cities]);

  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return cities;
    const q = citySearch.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q));
  }, [cities, citySearch]);

  const displaySchedule = dayTab === 'today' ? todaySchedule : tomorrowSchedule;
  const displaySlots = useMemo<Slot[]>(() => {
    if (!displaySchedule || !selectedGroup) return [];
    return displaySchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [displaySchedule, selectedGroup]);

  const todaySlots = useMemo<Slot[]>(() => {
    if (!todaySchedule || !selectedGroup) return [];
    return todaySchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [todaySchedule, selectedGroup]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-primary-c">
      <div className="text-center">
        <Loader2 className="mx-auto h-9 w-9 animate-spin accent-c" />
        <p className="mt-2 text-sm text-secondary-c">Завантаження...</p>
      </div>
    </div>
  );

  // Render schedule content based on display mode
  const renderScheduleContent = () => {
    if (scheduleLoading) return (
      <div className="flex flex-col items-center justify-center py-12 fade-in">
        <Loader2 className="h-8 w-8 animate-spin accent-c" />
        <p className="mt-2 text-sm text-secondary-c">Завантаження...</p>
      </div>
    );

    return (
      <>
        {showEmergency && <div className="mb-3"><EmergencyBanner onDismiss={() => { setShowEmergency(false); hapticImpact('light'); }} /></div>}

        {/* Status */}
        {displayMode === 'minimal' && <div className="mb-3"><StatusMinimal slots={todaySlots} now={now} /></div>}
        {displayMode === 'comfortable' && <div className="mb-3"><StatusHero slots={todaySlots} now={now} /></div>}
        {displayMode === 'compact' && <div className="mb-3"><StatusPill slots={todaySlots} now={now} /></div>}

        {/* Day tabs */}
        <div className="mb-3 flex justify-center fade-in-delay-1">
          <div className="segmented">
            <button
              onClick={() => { setDayTab('today'); hapticImpact('light'); }}
              className={`segmented-item px-5 py-1.5 text-sm font-semibold ${dayTab === 'today' ? 'active text-primary-c' : 'text-secondary-c'}`}
            >Сьогодні</button>
            <button
              onClick={() => { setDayTab('tomorrow'); hapticImpact('light'); }}
              className={`segmented-item px-5 py-1.5 text-sm font-semibold ${dayTab === 'tomorrow' ? 'active text-primary-c' : 'text-secondary-c'}`}
            >Завтра</button>
          </div>
        </div>

        {/* Graph */}
        <div className="mb-4">
          {displayMode === 'minimal' && <MinimalGraph slots={displaySlots} now={now} isToday={dayTab === 'today'} />}
          {displayMode === 'comfortable' && <ComfortableGraph slots={displaySlots} now={now} isToday={dayTab === 'today'} updated={displaySchedule?.updated ?? null} />}
          {displayMode === 'compact' && <CompactGraph slots={displaySlots} now={now} isToday={dayTab === 'today'} updated={displaySchedule?.updated ?? null} />}
        </div>

        {/* Event list */}
        <div className="mb-4">
          {displayMode === 'minimal' && <CompactList slots={displaySlots} now={now} isToday={dayTab === 'today'} />}
          {displayMode === 'comfortable' && <ComfortableList slots={displaySlots} now={now} isToday={dayTab === 'today'} />}
          {displayMode === 'compact' && <CompactList slots={displaySlots} now={now} isToday={dayTab === 'today'} />}
        </div>

        {displaySchedule?.updated && displayMode !== 'minimal' && (
          <p className="mb-4 text-center text-xs text-muted-c">Оновлено: {displaySchedule.updated}</p>
        )}

        <footer className="mt-6 border-t pt-3 text-center" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-xs text-muted-c">bezsvitla.com.ua · Київський час</p>
        </footer>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-primary-c" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="relative mx-auto max-w-lg px-4 py-4 sm:px-5">

        {/* ── Header ── */}
        <header className="mb-4 fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {view === 'settings' && (
                <button
                  onClick={() => { setView('schedule'); hapticImpact('light'); }}
                  className="flex h-9 w-9 items-center justify-center rounded-full glass"
                >
                  <ChevronLeft className="h-5 w-5 text-primary-c" />
                </button>
              )}
              <div className="flex h-10 w-10 items-center justify-center rounded-xl accent-bg shadow-sm">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-primary-c leading-tight">
                  {view === 'schedule' ? 'Графік світла' : 'Налаштування'}
                </h1>
                {selectedCity && view === 'schedule' ? (
                  <button onClick={() => { setView('settings'); hapticImpact('light'); }}
                    className="flex items-center gap-1 text-xs accent-c">
                    <MapPin className="h-3 w-3" />
                    {selectedCity.name}{selectedGroup && ` · ${selectedGroup}`}
                  </button>
                ) : !selectedCity && view === 'schedule' ? (
                  <p className="text-xs text-secondary-c">Київська область</p>
                ) : null}
              </div>
            </div>
            {view === 'schedule' && (
              <div className="flex items-center gap-1.5">
                <DisplayModeSwitcher mode={displayMode} onChange={setDisplayMode} />
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); hapticImpact('light'); }}
                className="flex h-9 w-9 items-center justify-center rounded-full glass"
                aria-label="Тема"
              >
                {theme === 'dark' ? <Sun className="h-4.5 w-4.5 text-amber-400" /> : <Moon className="h-4.5 w-4.5 text-slate-600" />}
              </button>
              {view === 'schedule' && (
                <button
                  onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="flex h-9 w-9 items-center justify-center rounded-full glass"
                >
                  <Settings className="h-4.5 w-4.5 accent-c" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── SCHEDULE VIEW ── */}
        {view === 'schedule' && (
          <>
            {displayMode !== 'minimal' && (
              <div className="mb-4 text-center fade-in">
                <span className="font-mono text-2xl font-bold tracking-tight text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>{now.timeString}</span>
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
              <div className="flex flex-col items-center justify-center apple-card py-12 text-center fade-in-scale">
                <MapPin className="mb-3 h-12 w-12 text-muted-c" />
                <h2 className="mb-1.5 text-lg font-bold text-primary-c">Оберіть місто</h2>
                <p className="mb-4 max-w-xs text-sm text-secondary-c">Оберіть місто та чергу, щоб побачити графік</p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => { setView('settings'); hapticImpact('light'); }}
                    className="rounded-xl accent-bg px-6 py-3 text-sm font-semibold text-white transition-all hover:scale-[1.02]">
                    Обрати місто
                  </button>
                  <button onClick={detectCity} disabled={geoDetecting}
                    className="flex items-center justify-center gap-2 rounded-xl glass px-5 py-2.5 text-sm font-medium text-secondary-c disabled:opacity-50">
                    {geoDetecting ? <><Loader2 className="h-4 w-4 animate-spin" /> Визначаю...</> : <><Navigation className="h-4 w-4" /> За геолокацією</>}
                  </button>
                </div>
              </div>
            ) : renderScheduleContent()}
          </>
        )}

        {/* ── SETTINGS VIEW ── */}
        {view === 'settings' && (
          <div className="fade-in space-y-5">
            {saved && (
              <div className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/8 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Збережено
              </div>
            )}

            {/* Display mode setting */}
            <div className="apple-card p-4">
              <h3 className="mb-3 text-sm font-bold text-primary-c">Відображення</h3>
              <div className="flex justify-center">
                <DisplayModeSwitcher mode={displayMode} onChange={setDisplayMode} />
              </div>
            </div>

            {/* Step 1: City */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full accent-soft-bg text-xs font-bold accent-c">1</span>
                  <h3 className="text-base font-bold text-primary-c">Місто</h3>
                </div>
                <button onClick={detectCity} disabled={geoDetecting}
                  className="flex items-center gap-1 rounded-lg glass px-2.5 py-1.5 text-xs font-medium text-secondary-c disabled:opacity-50">
                  {geoDetecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                  Авто
                </button>
              </div>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-c" />
                <input
                  type="text" value={citySearch} onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Пошук міста..."
                  className="w-full rounded-xl glass py-2.5 pl-10 pr-3 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl glass p-1.5">
                {filteredCities.map((city) => (
                  <button
                    key={city.slug}
                    onClick={() => { setSelectedCity(city); setSelectedGroup(''); setTodaySchedule(null); setTomorrowSchedule(null); hapticImpact('light'); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                      selectedCity?.slug === city.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c hover:bg-black/4 dark:hover:bg-white/5'
                    }`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    {city.name}
                  </button>
                ))}
                {filteredCities.length === 0 && <p className="py-4 text-center text-sm text-muted-c">Не знайдено</p>}
              </div>
            </div>

            {/* Step 2: Queue */}
            {selectedCity && (
              <div className="fade-in">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full accent-soft-bg text-xs font-bold accent-c">2</span>
                  <h3 className="text-base font-bold text-primary-c">Черга</h3>
                </div>
                <p className="mb-2 text-xs text-secondary-c">Вказана у рахунку за електроенергію</p>
                {scheduleLoading ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-secondary-c"><Loader2 className="h-4 w-4 animate-spin" /> Завантаження...</div>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {(availableGroups.length > 0 ? availableGroups : ALL_GROUPS).map((group) => (
                      <button
                        key={group}
                        onClick={() => { setSelectedGroup(group); hapticImpact('light'); }}
                        className={`rounded-lg px-2 py-2.5 text-center text-sm font-bold transition-all ${
                          selectedGroup === group ? 'accent-soft-bg accent-c ring-1' : 'glass text-secondary-c hover:scale-105'
                        }`}
                      >{group}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Notifications */}
            {tgUser && (
              <div className="apple-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {notifyEnabled ? <Bell className="h-4.5 w-4.5 accent-c" /> : <BellOff className="h-4.5 w-4.5 text-muted-c" />}
                    <h3 className="text-sm font-bold text-primary-c">Сповіщення</h3>
                  </div>
                  <button
                    onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                    className={`relative h-6 w-10 rounded-full transition-colors ${notifyEnabled ? 'accent-bg' : 'bg-black/10 dark:bg-white/10'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${notifyEnabled ? 'translate-x-4.5' : 'translate-x-0.5'}`}
                      style={{ transform: notifyEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
                  </button>
                </div>
                {notifyEnabled && (
                  <div>
                    <p className="mb-2 text-xs text-secondary-c">Попередити за:</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[30, 60].map((mins) => (
                        <button
                          key={mins}
                          onClick={() => { setNotifyMinutes(mins); hapticImpact('light'); }}
                          className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition-all ${
                            notifyMinutes === mins ? 'accent-soft-bg accent-c ring-1' : 'glass text-secondary-c'
                          }`}
                        >{mins} хв</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => { setView('schedule'); hapticImpact('light'); }}
              className="w-full rounded-xl accent-bg px-4 py-3.5 text-center text-base font-bold text-white shadow-sm transition-all hover:scale-[1.02]"
            >Готово</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
