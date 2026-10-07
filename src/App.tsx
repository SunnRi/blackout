import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Zap, ZapOff, MapPin, Loader2, CheckCircle2,
  Bell, BellOff, ChevronLeft, Search, Settings,
  Sun, Moon, AlertTriangle, Clock, Info, X,
  Palette, Sparkles, ArrowRight, ArrowLeft, Check, Smartphone,
  LayoutGrid, Gauge, Radio,
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

function greeting(): string {
  const h = getKyivTime().hours;
  if (h < 6) return 'Доброї ночі';
  if (h < 12) return 'Доброго ранку';
  if (h < 18) return 'Доброго дня';
  return 'Доброго вечора';
}

// ── Theme + Display Style ─────────────────────────────────────
type Theme = 'light' | 'dark';
type DisplayStyle = 'ios' | 'compact' | 'minimal' | 'neon';

const STYLE_OPTIONS: { id: DisplayStyle; name: string; desc: string; icon: typeof LayoutGrid }[] = [
  { id: 'ios', name: 'iOS', desc: 'Класичний стиль Apple: великі картки, деталі', icon: Smartphone },
  { id: 'compact', name: 'Компактний', desc: 'Стиснуто, але з графіком і деталями', icon: LayoutGrid },
  { id: 'minimal', name: 'Мінімальний', desc: 'Максимум корисного — мінімум зайвого', icon: Gauge },
  { id: 'neon', name: 'Неон', desc: 'Темний стиль зі світними акцентами', icon: Radio },
];

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('theme') as Theme | null;
  if (saved) return saved;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function getInitialStyle(): DisplayStyle {
  if (typeof window === 'undefined') return 'ios';
  return (localStorage.getItem('displayStyle') as DisplayStyle) || 'ios';
}

// ── Status components ─────────────────────────────────────────
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
    </div>
  );
}

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
            ? <ZapOff className="h-5 w-5" style={{ color: 'var(--on-negative)' }} />
            : <Zap className="h-5 w-5" style={{ color: 'var(--on-positive)' }} />}
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
        <span className="text-xs text-secondary-c">· увімкнуть {minutesToTime(nextOn.slot.start)}</span>
      )}
      {!isOff && nextOutage && (
        <span className="text-xs text-secondary-c">· відключення {minutesToTime(nextOutage.slot.start)}</span>
      )}
      {!isOff && !nextOutage && (
        <span className="text-xs text-secondary-c">· без відключень</span>
      )}
    </div>
  );
}

function StatusNeon({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);
  const color = isOff ? 'var(--neon-red)' : 'var(--neon-green)';

  return (
    <div className="fade-in-scale neon-container p-5 text-center">
      <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: `${color}1f` }}>
        {isOff
          ? <ZapOff className="h-7 w-7 neon-pulse" style={{ color }} />
          : <Zap className="h-7 w-7 neon-pulse" style={{ color }} />}
      </div>
      <h2 className="text-lg font-bold" style={{ color, textShadow: `0 0 12px ${color}55` }}>
        {isOff ? 'СВІТЛА НЕМАЄ' : 'СВІТЛО Є'}
      </h2>
      {current && (
        <p className="mt-0.5 text-sm text-secondary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {minutesToTime(current.start)} — {minutesToTime(current.end)}
        </p>
      )}
      {isOff && nextOn && (
        <p className="mt-2 text-sm" style={{ color: 'var(--neon-green)' }}>
          ▸ увімкнуть о {minutesToTime(nextOn.slot.start)} · через {formatCountdown(nextOn.minutesUntil)}
        </p>
      )}
      {!isOff && nextOutage && (
        <p className="mt-2 text-sm" style={{ color: 'var(--neon-red)' }}>
          ▸ відключення о {minutesToTime(nextOutage.slot.start)} · через {formatCountdown(nextOutage.minutesUntil)}
        </p>
      )}
      {!isOff && !nextOutage && (
        <p className="mt-2 text-sm text-secondary-c">▸ відключень більше немає</p>
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

// ── Hour status helper ────────────────────────────────────────
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

// ── Main Graph (beautiful, animated) ──────────────────────────
function HourlyGraph({ slots, now, isToday, updated, neon }: {
  slots: Slot[]; now: KyivTime; isToday: boolean; updated: string | null; neon?: boolean;
}) {
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;
  const sorted = useMemo(() => [...slots].sort((a, b) => a.start - b.start), [slots]);
  const relUpdate = getRelativeUpdate(updated);

  return (
    <div className={neon ? 'fade-in-delay-2' : 'fade-in-delay-2'}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${neon ? 'bg-emerald-500' : 'bg-emerald-500/70'}`} />
            <span className="text-secondary-c">Є світло</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${neon ? 'bg-red-500' : 'bg-red-500/70'}`} />
            <span className="text-secondary-c">Немає</span>
          </span>
        </div>
        {relUpdate && (
          <span className="flex items-center gap-1 text-xs text-muted-c">
            <Clock className="h-3 w-3" />{relUpdate}
          </span>
        )}
      </div>

      <div className={neon ? 'neon-container p-3' : 'apple-card p-3'}>
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
          {Array.from({ length: 24 }, (_, hour) => {
            const status = getHourStatus(sorted, hour);
            const isCurrent = isToday && currentMin >= hour * 60 && currentMin < (hour + 1) * 60;
            const isPast = isToday && currentMin >= (hour + 1) * 60;

            let barClass = neon ? 'bar-green-neon' : 'bar-green';
            if (status === 'off') barClass = neon ? 'bar-red-neon' : 'bar-red';
            else if (status === 'partial') barClass = 'opacity-60 ' + (neon ? 'bar-red-neon' : 'bar-red');

            return (
              <div key={hour} className="flex flex-col items-center gap-1">
                <div
                  className={`graph-bar-anim relative w-full rounded-md ${barClass} ${isPast ? 'opacity-30' : ''} ${
                    isCurrent ? (neon ? 'ring-2' : 'ring-2') : ''
                  }`}
                  style={{
                    height: '44px',
                    animationDelay: `${hour * 0.03}s`,
                    ...(isCurrent ? { boxShadow: neon ? '0 0 12px rgba(10,132,255,0.5)' : '0 0 10px rgba(10,132,255,0.35)' } : {}),
                    ...(isCurrent ? { outline: '2px solid rgba(10,132,255,0.8)', outlineOffset: '1px' } : {}),
                  }}
                >
                  {isCurrent && (
                    <div className="absolute -top-1.5 left-1/2 now-marker">
                      <div className="h-2 w-2 rounded-full bg-blue-500 shadow-lg shadow-blue-500/60" />
                    </div>
                  )}
                </div>
                <span className={`text-[8px] font-medium ${
                  isCurrent ? 'text-blue-500 dark:text-blue-400 font-bold' : 'text-muted-c'
                }`}>
                  {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress line for today */}
        {isToday && (
          <div className="mt-2 flex items-center gap-2 px-0.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-1000"
                style={{ width: `${(currentMin / 1440) * 100}%` }}
              />
            </div>
            <span className="text-[9px] font-medium text-muted-c">
              {Math.round((currentMin / 1440) * 100)}% дня
            </span>
          </div>
        )}
      </div>

      {relUpdate && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-c">
          <Info className="h-3 w-3 shrink-0" />
          Графік оновлено: <span className="font-medium text-secondary-c">{relUpdate}</span>
          {updated && ` · ${updated}`}
        </p>
      )}
    </div>
  );
}

// ── Minimal thin bar graph ────────────────────────────────────
function MinimalGraph({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;
  const sorted = useMemo(() => [...slots].sort((a, b) => a.start - b.start), [slots]);

  return (
    <div className="fade-in-delay-2">
      <div className="apple-card p-2">
        <div className="flex h-7 gap-px overflow-hidden rounded-lg">
          {Array.from({ length: 24 }, (_, hour) => {
            const status = getHourStatus(sorted, hour);
            const isCurrent = isToday && currentMin >= hour * 60 && currentMin < (hour + 1) * 60;
            const isPast = isToday && currentMin >= (hour + 1) * 60;

            let bg = 'bar-green';
            if (status === 'off') bg = 'bar-red';
            else if (status === 'partial') bg = 'bar-red opacity-50';
            if (isPast) bg += ' opacity-25';
            if (isCurrent) bg = 'bg-blue-500/80';

            return (
              <div
                key={hour}
                className={`graph-bar-anim h-full flex-1 rounded-sm ${bg}`}
                style={{ animationDelay: `${hour * 0.02}s`, transformOrigin: 'bottom' }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[8px] text-muted-c">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
    </div>
  );
}

// ── Event lists ───────────────────────────────────────────────
function CompactList({ slots, now, isToday, neon }: { slots: Slot[]; now: KyivTime; isToday: boolean; neon?: boolean }) {
  const sorted = useMemo(() => [...slots].sort((a, b) => a.start - b.start), [slots]);
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;

  if (sorted.length === 0) return (
    <div className={`${neon ? 'neon-container' : 'apple-card'} py-6 text-center fade-in-delay-3`}>
      <p className="text-sm text-secondary-c">Графік поки не доступний</p>
    </div>
  );

  return (
    <div className={`${neon ? 'neon-container' : 'apple-card'} overflow-hidden fade-in-delay-3`}>
      {sorted.map((slot, i) => {
        const isOff = slot.type === 'Definite';
        const active = isToday && isSlotActive(slot, now);
        const isPast = isToday && currentMin >= slot.end;
        const dotColor = isOff ? 'var(--on-negative)' : 'var(--on-positive)';

        return (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-2.5 ${i < sorted.length - 1 ? 'border-b border-subtle-c' : ''} ${
              active ? (isOff ? 'bg-red-500/6' : 'bg-emerald-500/6') : isPast ? 'opacity-35' : ''
            }`}
          >
            <div
              className={`h-2 w-2 shrink-0 rounded-full ${active ? 'now-marker' : ''}`}
              style={{
                background: dotColor,
                left: active ? undefined : 0,
                ...(active ? { boxShadow: `0 0 8px ${dotColor}` } : {}),
              }}
            />
            <span className="text-sm font-semibold text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {minutesToTime(slot.start)}–{minutesToTime(slot.end)}
            </span>
            {active && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${neon ? 'text-blue-400' : 'accent-soft-bg accent-c'}`}>
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

function ComfortableList({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const sorted = useMemo(() => [...slots].sort((a, b) => a.start - b.start), [slots]);
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
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold accent-soft-bg accent-c">зараз</span>
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

// ── Style Picker (list with hints) ────────────────────────────
function StylePicker({ style, onChange, compact }: { style: DisplayStyle; onChange: (s: DisplayStyle) => void; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {STYLE_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const selected = style === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => { onChange(opt.id); hapticImpact('light'); }}
            className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-all ${
              selected ? 'apple-card ring-2 ring-blue-500/40' : 'glass hover:scale-[1.01]'
            }`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              selected ? 'accent-soft-bg' : 'bg-black/5 dark:bg-white/10'
            }`}>
              <Icon className={`h-5 w-5 ${selected ? 'accent-c' : 'text-secondary-c'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold ${selected ? 'accent-c' : 'text-primary-c'}`}>{opt.name}</p>
              <p className="mt-0.5 text-xs text-secondary-c">{opt.desc}</p>
            </div>
            {selected && <Check className="h-5 w-5 shrink-0 accent-c" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────
function Onboarding({
  step, setStep, cities, selectedCity, setSelectedCity, selectedGroup, setSelectedGroup,
  displayStyle, setDisplayStyle, onFinish, scheduleLoading, availableGroups,
}: {
  step: number;
  setStep: (n: number) => void;
  cities: City[];
  selectedCity: City | null;
  setSelectedCity: (c: City) => void;
  selectedGroup: string;
  setSelectedGroup: (g: string) => void;
  displayStyle: DisplayStyle;
  setDisplayStyle: (s: DisplayStyle) => void;
  onFinish: () => void;
  scheduleLoading: boolean;
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
    <div className="flex min-h-screen flex-col bg-primary-c px-6 py-8" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Progress dots */}
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

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col" key={step}>
        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center text-center fade-in-right">
            <div className="logo-bounce mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-xl shadow-blue-500/30">
              <Zap className="h-12 w-12 text-white" />
            </div>
            <p className="mb-1 text-base text-secondary-c">{greeting()}!</p>
            <h1 className="text-3xl font-extrabold text-primary-c">Графік світла</h1>
            <p className="mt-3 max-w-xs text-base text-secondary-c">
              Дізнавайтесь, коли буде світло у вашій черзі — швидко і просто
            </p>
            <div className="mt-6 flex items-center gap-1.5 rounded-full glass px-4 py-2 text-xs text-secondary-c">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              Налаштування займе менше хвилини
            </div>
          </div>
        )}

        {/* Step 1: City */}
        {step === 1 && (
          <div className="flex flex-1 flex-col fade-in-right">
            <h2 className="text-2xl font-extrabold text-primary-c">Ваше місто</h2>
            <p className="mb-4 mt-1 text-sm text-secondary-c">Оберіть місто, щоб ми показали правильний графік</p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-c" />
              <input
                type="text" value={citySearch} onChange={(e) => setCitySearch(e.target.value)}
                placeholder="Пошук міста..."
                className="w-full rounded-xl glass py-3 pl-10 pr-3 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            <div className="max-h-80 flex-1 space-y-1 overflow-y-auto rounded-2xl glass p-2">
              {filtered.map((city) => (
                <button
                  key={city.slug}
                  onClick={() => { setSelectedCity(city); setSelectedGroup(''); hapticImpact('light'); }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                    selectedCity?.slug === city.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <MapPin className="h-4 w-4 shrink-0" />
                  {city.name}
                  {selectedCity?.slug === city.slug && <Check className="ml-auto h-4 w-4" />}
                </button>
              ))}
              {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted-c">Не знайдено</p>}
            </div>
          </div>
        )}

        {/* Step 2: Queue */}
        {step === 2 && (
          <div className="flex flex-1 flex-col fade-in-right">
            <h2 className="text-2xl font-extrabold text-primary-c">Ваша черга</h2>
            <p className="mb-4 mt-1 text-sm text-secondary-c">
              Черга вказана у вашому рахунку за електроенергію
            </p>
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
                      selectedGroup === group ? 'accent-soft-bg accent-c ring-2 ring-blue-500/40' : 'glass text-secondary-c hover:scale-105'
                    }`}
                  >{group}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Style */}
        {step === 3 && (
          <div className="flex flex-1 flex-col fade-in-right">
            <div className="mb-1 flex items-center gap-2">
              <Palette className="h-6 w-6 accent-c" />
              <h2 className="text-2xl font-extrabold text-primary-c">Стиль</h2>
            </div>
            <p className="mb-4 mt-1 text-sm text-secondary-c">
              Оберіть, як виглядатиме графік — потім можна змінити в налаштуваннях
            </p>
            <div className="flex-1 overflow-y-auto">
              <StylePicker style={displayStyle} onChange={setDisplayStyle} />
            </div>
          </div>
        )}
      </div>

      {/* Nav buttons */}
      <div className="mx-auto mt-6 flex w-full max-w-md gap-2">
        {step > 0 && (
          <button
            onClick={() => { setStep(step - 1); hapticImpact('light'); }}
            className="flex h-13 w-14 items-center justify-center rounded-2xl glass text-primary-c"
            aria-label="Назад"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <button
          onClick={() => {
            if (step === 3) { onFinish(); hapticNotification('success'); }
            else if (step === 1 && !selectedCity) return;
            else if (step === 2 && !selectedGroup) return;
            else { setStep(step + 1); hapticImpact('light'); }
          }}
          disabled={(step === 1 && !selectedCity) || (step === 2 && !selectedGroup)}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl accent-bg py-4 text-base font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] disabled:opacity-40"
        >
          {step === 0 && <>Почнемо <ArrowRight className="h-5 w-5" /></>}
          {step === 1 && <>Далі <ArrowRight className="h-5 w-5" /></>}
          {step === 2 && <>Далі <ArrowRight className="h-5 w-5" /></>}
          {step === 3 && <><CheckCircle2 className="h-5 w-5" /> Готово</>}
        </button>
      </div>
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
  const [displayStyle, setDisplayStyle] = useState<DisplayStyle>(getInitialStyle);
  const [onboarded, setOnboarded] = useState<boolean>(() => localStorage.getItem('onboarded') === '1');
  const [obStep, setObStep] = useState(0);

  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [todaySchedule, setTodaySchedule] = useState<CitySchedule | null>(null);
  const [tomorrowSchedule, setTomorrowSchedule] = useState<CitySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
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
    localStorage.setItem('displayStyle', displayStyle);
  }, [displayStyle]);

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

  // Onboarding flow
  if (!onboarded) {
    return (
      <Onboarding
        step={obStep}
        setStep={setObStep}
        cities={cities}
        selectedCity={selectedCity}
        setSelectedCity={setSelectedCity}
        selectedGroup={selectedGroup}
        setSelectedGroup={setSelectedGroup}
        displayStyle={displayStyle}
        setDisplayStyle={setDisplayStyle}
        scheduleLoading={scheduleLoading}
        availableGroups={availableGroups}
        onFinish={() => {
          localStorage.setItem('onboarded', '1');
          setOnboarded(true);
        }}
      />
    );
  }

  const isNeon = displayStyle === 'neon';

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
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); hapticImpact('light'); }}
                className="flex h-9 w-9 items-center justify-center rounded-full glass"
                aria-label="Тема"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
              </button>
              {view === 'schedule' && (
                <button
                  onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="flex h-9 w-9 items-center justify-center rounded-full glass"
                >
                  <Settings className="h-4 w-4 accent-c" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── SCHEDULE VIEW ── */}
        {view === 'schedule' && (
          <>
            {displayStyle !== 'minimal' && displayStyle !== 'neon' && (
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
                {showEmergency && <div className="mb-3"><EmergencyBanner onDismiss={() => { setShowEmergency(false); hapticImpact('light'); }} /></div>}

                {/* Status by style */}
                {displayStyle === 'ios' && <div className="mb-3"><StatusHero slots={todaySlots} now={now} /></div>}
                {displayStyle === 'compact' && <div className="mb-3"><StatusPill slots={todaySlots} now={now} /></div>}
                {displayStyle === 'minimal' && <div className="mb-3"><StatusMinimal slots={todaySlots} now={now} /></div>}
                {displayStyle === 'neon' && <div className="mb-3"><StatusNeon slots={todaySlots} now={now} /></div>}

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
                  {displayStyle === 'minimal'
                    ? <MinimalGraph slots={displaySlots} now={now} isToday={dayTab === 'today'} />
                    : <HourlyGraph
                        slots={displaySlots} now={now} isToday={dayTab === 'today'}
                        updated={displaySchedule?.updated ?? null}
                        neon={isNeon}
                      />}
                </div>

                {/* Event list */}
                <div className="mb-4">
                  {displayStyle === 'ios'
                    ? <ComfortableList slots={displaySlots} now={now} isToday={dayTab === 'today'} />
                    : <CompactList slots={displaySlots} now={now} isToday={dayTab === 'today'} neon={isNeon} />}
                </div>

                <footer className="mt-6 border-t pt-3 text-center" style={{ borderColor: 'var(--border-subtle)' }}>
                  <p className="text-xs text-muted-c">bezsvitla.com.ua · Київський час</p>
                </footer>
              </>
            )}
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

            {/* Display style */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Palette className="h-4 w-4 accent-c" />
                <h3 className="text-base font-bold text-primary-c">Стиль відображення</h3>
              </div>
              <StylePicker style={displayStyle} onChange={setDisplayStyle} compact />
            </div>

            {/* City */}
            <div>
              <h3 className="mb-2 text-base font-bold text-primary-c">Місто</h3>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-2xl glass p-1.5">
                {cities.map((city) => (
                  <button
                    key={city.slug}
                    onClick={() => { setSelectedCity(city); setSelectedGroup(''); setTodaySchedule(null); setTomorrowSchedule(null); hapticImpact('light'); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                      selectedCity?.slug === city.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    {city.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Queue */}
            <div className="fade-in">
              <h3 className="mb-2 text-base font-bold text-primary-c">Черга</h3>
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
                        selectedGroup === group ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'glass text-secondary-c hover:scale-105'
                      }`}
                    >{group}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Notifications */}
            {tgUser && (
              <div className="apple-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {notifyEnabled ? <Bell className="h-4 w-4 accent-c" /> : <BellOff className="h-4 w-4 text-muted-c" />}
                    <h3 className="text-sm font-bold text-primary-c">Сповіщення</h3>
                  </div>
                  <button
                    onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                    className={`relative h-6 w-10 rounded-full transition-colors ${notifyEnabled ? 'accent-bg' : 'bg-black/10 dark:bg-white/10'}`}
                  >
                    <span
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                      style={{ transform: notifyEnabled ? 'translateX(18px)' : 'translateX(2px)' }}
                    />
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
                            notifyMinutes === mins ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'glass text-secondary-c'
                          }`}
                        >{mins} хв</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Replay onboarding */}
            <button
              onClick={() => { setObStep(0); setOnboarded(false); localStorage.removeItem('onboarded'); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl glass px-4 py-3 text-sm font-medium text-secondary-c transition-all hover:scale-[1.01]"
            >
              <Sparkles className="h-4 w-4" /> Пройти налаштування знову
            </button>

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
