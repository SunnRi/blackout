import { Zap, ZapOff } from 'lucide-react';
import { minutesToTime, type Slot } from '@/lib/yasno-api';
import { type KyivTime } from '@/lib/time';
import { formatCountdown, formatHours, pluralOutages } from '@/lib/format';
import { getCurrentSlot, getNextOnSlot, getNextOutageSlot } from '@/lib/schedule';
// ── Status blocks ─────────────────────────────────────────────
function StatusLine({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`fade-in-scale hover-lift d-card flex items-center gap-2.5 px-4 py-3 ${isOff ? 'pulse-red' : 'pulse-green'}`} data-tour="status">
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
    <div className={`glass-sheen fade-in-scale hover-lift d-card p-4 relative overflow-hidden ${isOff ? 'status-off' : 'status-on'}`} data-tour="status">
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
    <div className={`fade-in-scale hover-lift d-card p-5 text-center relative overflow-hidden ${isOff ? 'status-off' : 'status-on'}`} data-tour="status">
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
export { StatusLine, StatusCompact, StatusFull };