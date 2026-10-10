import { useMemo } from 'react';
import { Zap, ZapOff } from 'lucide-react';
import { minutesToTime, type Slot } from '@/lib/yasno-api';
import { type KyivTime } from '@/lib/time';
import { slotDuration } from '@/lib/format';
import { isSlotActive } from '@/lib/schedule';
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
export { CompactList, ComfortableList };