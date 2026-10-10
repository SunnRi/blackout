import {
  CheckCircle2, Clock, Heart, Loader2, MapPin, MessageCircle, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { type City, type CitySchedule, type Oblast, type Slot } from '@/lib/yasno-api';
import { type KyivTime } from '@/lib/time';
import { type DayTab, type View } from '@/types';
import { type Density } from '@/lib/appearance';
import { hapticImpact } from '@/lib/telegram';
import HourlyGraph from './HourlyGraph';
import { ComfortableList, CompactList } from './ScheduleLists';
import { StatusCompact, StatusFull, StatusLine } from './StatusCards';

type ScheduleViewProps = {
  now: KyivTime;
  dayTab: DayTab;
  setDayTab: (t: DayTab) => void;
  saved: boolean;
  apiError: string | null;
  selectedCity: City | null;
  selectedGroup: string;
  setView: (v: View) => void;
  scheduleLoading: boolean;
  density: Density;
  todaySlots: Slot[];
  tomorrowSlots: Slot[];
  displaySlots: Slot[];
  displaySchedule: CitySchedule | null;
  altOblast: Oblast | null;
  altCity: City | null;
  altGroup: string;
  switchLocation: (l: 'home' | 'work') => void;
  activeLocation: 'home' | 'work';
  homeLabel: string;
  altLabel: string;
};

export default function ScheduleView({
  apiError, activeLocation, altCity, altGroup, altLabel, altOblast,
  dayTab, density, displaySchedule, displaySlots, homeLabel, now, saved,
  scheduleLoading, selectedCity, selectedGroup, setDayTab, setView,
  switchLocation, todaySlots, tomorrowSlots,
}: ScheduleViewProps) {
  const isExtended = density === 'extended';
  return (
          <div className="relative isolate">
            <div className="pointer-events-none absolute inset-x-0 -top-6 -z-10 flex justify-center">
              <div className="underlay-breathe h-56 w-80 rounded-full bg-indigo-500/25 blur-[90px]" />
            </div>
            <div className="pointer-events-none absolute -right-10 top-64 -z-10 h-40 w-40 rounded-full bg-violet-500/15 blur-[70px]" />
                <div className="mb-4 text-center fade-in">
                  <div className="clock-glow font-mono text-5xl font-bold tracking-tight text-primary-c" style={{ fontVariantNumeric: 'tabular-nums' }}>{now.timeString}</div>
                </div>

                {/* Location tabs — shown once a second location is set */}
                {altOblast && altCity && altGroup && (
                  <div className="mb-3 flex justify-center fade-in">
                    <div className="segmented">
                      <button onClick={() => { switchLocation('home'); }}
                        className={`segmented-item px-5 py-1.5 text-sm font-semibold ${activeLocation === 'home' ? 'active text-primary-c' : 'text-secondary-c'}`}
                      >{homeLabel.trim() || 'Дім'}</button>
                      <button onClick={() => { switchLocation('work'); }}
                        className={`segmented-item px-5 py-1.5 text-sm font-semibold ${activeLocation === 'work' ? 'active text-primary-c' : 'text-secondary-c'}`}
                      >{altLabel.trim() || 'Робота'}</button>
                    </div>
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
                  <div className="mb-3 flex justify-center fade-in-delay-1" data-tour="daytabs">
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
                  <div className="mb-4" data-tour="graph">
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
                    <div className="flex items-center gap-2">
                      <a
                        href="https://t.me/wt_rvng"
                        target="_blank"
                        rel="noreferrer"
                        className="d-btn flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold text-secondary-c transition-colors hover:text-primary-c"
                        aria-label="Є помилка?"
                      >
                        <MessageCircle className="h-3.5 w-3.5 accent-c" />
                        Є помилка?
                      </a>
                      <div className="flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 dark:bg-white/8">
                        <span className="text-[10px] leading-none text-muted-c">Зроблено з</span>
                        <Heart className="h-2.5 w-2.5 shrink-0 fill-current text-red-400" />
                        <span className="text-[10px] leading-none text-muted-c">, by wt_rvng</span>
                      </div>
                    </div>
                  </div>
                </footer>
              </>
            )}
          </div>
  );
}
