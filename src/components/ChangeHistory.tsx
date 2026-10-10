import { useEffect, useState } from 'react';
import { History, Loader2, Minus, MoveRight, Plus, RefreshCw } from 'lucide-react';
import { supabase, type ScheduleChange } from '@/lib/supabase';
import { hapticImpact } from '@/lib/telegram';
// ── Change history ────────────────────────────────────────────
type DiffSlot = { start: number; end: number; type: string };
type ChangeItem = {
  queue: string;
  day: string;
  scheduleDate: string | null;
  changeType: string;
  summary: string;
  oldSlots: DiffSlot[] | null;
  newSlots: DiffSlot[] | null;
  supplementedAt?: string | null;
};
type ChangeGroup = {
  detectedAt: string;
  supplementedAt?: string | null;
  items: ChangeItem[];
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

function formatKyivHourMinute(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('uk-UA', {
      timeZone: 'Europe/Kyiv',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function formatChangeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const timeStr = formatKyivHourMinute(iso);
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return `щойно (${timeStr})`;
  if (diffMin < 60) return `${timeStr} · ${diffMin} хв тому`;
  const dKyiv = d.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' });
  const nowKyiv = now.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' });
  if (dKyiv === nowKyiv) {
    const diffH = Math.floor(diffMin / 60);
    return `${timeStr} · ${diffH} год тому`;
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month} о ${timeStr}`;
}

function clusterScheduleChanges(records: ScheduleChange[]): ChangeGroup[] {
  if (!records || records.length === 0) return [];

  // Sort chronologically ascending to detect clusters within 2-3 hours
  const sorted = [...records].sort(
    (a, b) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime()
  );

  const CLUSTER_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours window

  type Cluster = {
    firstDetectedAt: string;
    lastDetectedAt: string;
    records: ScheduleChange[];
  };

  const clusters: Cluster[] = [];
  let currentCluster: Cluster | null = null;

  for (const r of sorted) {
    const t = new Date(r.detected_at).getTime();
    if (!currentCluster) {
      currentCluster = { firstDetectedAt: r.detected_at, lastDetectedAt: r.detected_at, records: [r] };
      clusters.push(currentCluster);
    } else {
      const prevTime = new Date(currentCluster.lastDetectedAt).getTime();
      if (t - prevTime <= CLUSTER_GAP_MS) {
        currentCluster.lastDetectedAt = r.detected_at;
        currentCluster.records.push(r);
      } else {
        currentCluster = { firstDetectedAt: r.detected_at, lastDetectedAt: r.detected_at, records: [r] };
        clusters.push(currentCluster);
      }
    }
  }

  const groups: ChangeGroup[] = clusters.map((cluster) => {
    const firstMs = new Date(cluster.firstDetectedAt).getTime();
    const lastMs = new Date(cluster.lastDetectedAt).getTime();
    const isSupplemented = lastMs - firstMs >= 5 * 60 * 1000;

    // Combine queue updates within the same cluster
    const itemsMap = new Map<string, {
      firstItem: ScheduleChange;
      lastItem: ScheduleChange;
      amended: boolean;
    }>();

    for (const r of cluster.records) {
      const key = `${r.queue}|${r.day}|${r.schedule_date ?? ''}`;
      const existing = itemsMap.get(key);
      if (!existing) {
        itemsMap.set(key, { firstItem: r, lastItem: r, amended: false });
      } else {
        existing.lastItem = r;
        existing.amended = true;
      }
    }

    const items: ChangeItem[] = [];
    for (const [, { firstItem, lastItem, amended }] of itemsMap) {
      const oldSlots = parseSlotRows(firstItem.old_slots);
      const newSlots = parseSlotRows(lastItem.new_slots);
      const itemLastMs = new Date(lastItem.detected_at).getTime();
      items.push({
        queue: lastItem.queue,
        day: lastItem.day,
        scheduleDate: lastItem.schedule_date,
        changeType: lastItem.change_type,
        summary: lastItem.summary,
        oldSlots,
        newSlots,
        supplementedAt: amended && itemLastMs - firstMs >= 5 * 60 * 1000 ? lastItem.detected_at : null,
      });
    }

    return {
      detectedAt: cluster.firstDetectedAt,
      supplementedAt: isSupplemented ? cluster.lastDetectedAt : null,
      items,
    };
  });

  // Sort descending so the latest active cluster is on top
  groups.sort((a, b) => {
    const timeA = new Date(a.supplementedAt ?? a.detectedAt).getTime();
    const timeB = new Date(b.supplementedAt ?? b.detectedAt).getTime();
    return timeB - timeA;
  });

  return groups;
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
const keyOf = (s: DiffSlot) => `${s.start}-${s.end}`;

// Візуальне порівняння "Було / Стало": два рядки з часовими шкалами, де
// червоні сегменти — відключення. Додані хвилини підсвічені червоним рамком,
// прибрані — зеленим. Знизу короткий людський підсумок.
// Сравнение "Було / Стало": строки с временем, где зачёркнуто старое и
// показано новое, плюс цветные бейджи что добавилось и что отменилось.
// Просте відображення змін: лише кольорові бейджі — додані відключення
// червоним, скасовані — зеленим. Без «Було / Стало», без шкал.
function DiffTimeline({ oldSlots, newSlots }: { oldSlots: DiffSlot[]; newSlots: DiffSlot[] }) {
  const oldOff = oldSlots.filter(isOffSlot);
  const newOff = newSlots.filter(isOffSlot);
  const oldKeys = new Set(oldOff.map(keyOf));
  const newKeys = new Set(newOff.map(keyOf));

  const added = newOff.filter((s) => !oldKeys.has(keyOf(s)));
  const removed = oldOff.filter((s) => !newKeys.has(keyOf(s)));

  // Match a removed slot to the added slot that replaced it (overlapping time).
  const shifted: { from: DiffSlot; to: DiffSlot }[] = [];
  const usedRemoved = new Set<number>();
  const pureAdded: DiffSlot[] = [];
  for (const a of added) {
    const idx = removed.findIndex((r, i) =>
      !usedRemoved.has(i) && r.start < a.end && a.start < r.end);
    if (idx >= 0) {
      usedRemoved.add(idx);
      shifted.push({ from: removed[idx], to: a });
    } else {
      pureAdded.push(a);
    }
  }
  const pureRemoved = removed.filter((_, i) => !usedRemoved.has(i));

  const fmt = (m: number) => formatMinutes(m === 1440 ? 1439 : m);
  const fmtRange = (s: DiffSlot) => `${fmt(s.start)}–${fmt(s.end)}`;

  if (shifted.length === 0 && pureAdded.length === 0 && pureRemoved.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-secondary-c">Час відключень не змінився</p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {shifted.map(({ from, to }, i) => (
        <div key={`sh${i}`} className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5">
          <MoveRight className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="text-xs font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <span className="text-secondary-c line-through decoration-1 opacity-70">{fmtRange(from)}</span>
            <span className="diff-arrow mx-1.5 inline-block text-amber-500">→</span>
            <span className="text-primary-c">{fmtRange(to)}</span>
          </span>
        </div>
      ))}
      {pureAdded.map((s, i) => (
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
      {pureRemoved.map((s, i) => (
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
        setGroups(clusterScheduleChanges((data ?? []) as ScheduleChange[]));
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
          {filteredGroups.map((g, gi) => {
            const isSupplemented = Boolean(g.supplementedAt && g.supplementedAt !== g.detectedAt);
            const supplementedTime = g.supplementedAt ? formatKyivHourMinute(g.supplementedAt) : '';

            return (
              <div key={g.detectedAt} className={`d-card px-3.5 py-3 fade-in ${gi === 0 ? 'ring-2 ring-blue-500/30' : 'opacity-75'}`}
                style={gi === 0 ? { backgroundColor: 'rgba(59,130,246,0.06)' } : undefined}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${gi === 0 ? 'accent-soft-bg' : 'bg-black/5 dark:bg-white/8'}`}>
                    <RefreshCw className={`h-3 w-3 ${gi === 0 ? 'accent-c' : 'text-muted-c'}`} />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-xs font-bold text-primary-c">
                      {formatChangeTime(g.detectedAt)}
                    </span>
                    {isSupplemented && (
                      <span className="text-xs font-semibold text-amber-500 dark:text-amber-400">
                        (Доповнено о {supplementedTime})
                      </span>
                    )}
                    {gi === 0 && (
                      <span className="text-xs font-bold text-primary-c">· найсвіжіше</span>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {g.items
                    .filter((it) => {
                      const label = formatScheduleDate(it.scheduleDate, it.day);
                      return changeDayTab === 'today' ? label === 'сьогодні' : label === 'завтра';
                    })
                    .map((it, i) => (
                      <div key={i} className="rounded-xl bg-black/4 px-3 py-2 dark:bg-white/6">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="rounded-md accent-soft-bg px-1.5 py-0.5 text-[10px] font-bold accent-c">Черга {it.queue}</span>
                          {it.supplementedAt && (
                            <span className="text-[10px] text-muted-c">
                              Доповнено о {formatKyivHourMinute(it.supplementedAt)}
                            </span>
                          )}
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
            );
          })}
        </>
      )}
    </div>
  );
}
export default ChangeHistory;