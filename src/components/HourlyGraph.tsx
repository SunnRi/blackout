import { useMemo } from 'react';
import { Clock, Info } from 'lucide-react';
import { minutesToTime, type Slot } from '@/lib/yasno-api';
import { type KyivTime } from '@/lib/time';
import { formatHours, getRelativeUpdate } from '@/lib/format';
import { getHourStatus } from '@/lib/schedule';
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
export default HourlyGraph;