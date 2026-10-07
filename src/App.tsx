import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Zap, ZapOff, MapPin, Loader2, CheckCircle2,
  Bell, BellOff, ChevronLeft, Search, Settings,
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
function slotDuration(slot: Slot): string {
  const mins = slot.end - slot.start;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} год ${m} хв`;
  if (h > 0) return `${h} год`;
  return `${m} хв`;
}

function formatCountdown(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} год ${m} хв`;
  if (h > 0) return `${h} год`;
  return `${m} хв`;
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

// ── Big Status Hero ──────────────────────────────────────────
function StatusHero({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';

  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`fade-in rounded-3xl p-6 text-center ${
      isOff
        ? 'bg-gradient-to-b from-red-500/20 to-red-500/5 border-2 border-red-500/30 pulse-red'
        : 'bg-gradient-to-b from-emerald-500/20 to-emerald-500/5 border-2 border-emerald-500/30 pulse-green'
    }`}>
      <div className={`mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full ${
        isOff ? 'bg-red-500/20' : 'bg-emerald-500/20'
      }`}>
        {isOff
          ? <ZapOff className="h-10 w-10 text-red-400" />
          : <Zap className="h-10 w-10 text-emerald-400" />
        }
      </div>

      <h2 className={`text-2xl font-bold ${isOff ? 'text-red-300' : 'text-emerald-300'}`}>
        {isOff ? 'Світла зараз немає' : 'Світло зараз є'}
      </h2>

      {current && (
        <p className="mt-1 text-base text-gray-300">
          {isOff ? 'Відключення' : 'Живлення'}:{' '}
          <span className="font-semibold text-white">
            {minutesToTime(current.start)} — {minutesToTime(current.end)}
          </span>
        </p>
      )}

      {/* What happens next */}
      <div className="mt-4 space-y-2">
        {isOff && nextOn && (
          <div className="rounded-2xl bg-emerald-500/10 px-4 py-3">
            <p className="text-base text-emerald-200">
              Світло увімкнуть о <span className="font-bold text-white">{minutesToTime(nextOn.slot.start)}</span>
            </p>
            <p className="text-sm text-gray-400">через {formatCountdown(nextOn.minutesUntil)}</p>
          </div>
        )}
        {!isOff && nextOutage && (
          <div className="rounded-2xl bg-red-500/10 px-4 py-3">
            <p className="text-base text-red-200">
              Відключення о <span className="font-bold text-white">{minutesToTime(nextOutage.slot.start)}</span>
            </p>
            <p className="text-sm text-gray-400">
              через {formatCountdown(nextOutage.minutesUntil)} · тривалість {slotDuration(nextOutage.slot)}
            </p>
          </div>
        )}
        {!isOff && !nextOutage && (
          <p className="text-sm text-gray-400">Більше відключень сьогодні не заплановано</p>
        )}
      </div>
    </div>
  );
}

// ── Visual 24h Graph ─────────────────────────────────────────
function HourlyGraph({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;
  const sorted = [...slots].sort((a, b) => a.start - b.start);

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
      {/* Legend */}
      <div className="mb-3 flex items-center justify-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-3.5 rounded bg-emerald-500/60" />
          <span className="text-gray-300">Є світло</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-3.5 rounded bg-red-500/60" />
          <span className="text-gray-300">Немає світла</span>
        </span>
      </div>

      {/* Graph grid */}
      <div className="relative rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
        <div className="grid grid-cols-12 gap-1 sm:gap-1.5">
          {Array.from({ length: 24 }, (_, hour) => {
            const status = getHourStatus(hour);
            const isCurrent = isToday && currentMin >= hour * 60 && currentMin < (hour + 1) * 60;
            const isPast = isToday && currentMin >= (hour + 1) * 60;

            let bgClass = '';
            if (status === 'off') bgClass = 'bg-red-500/60';
            else if (status === 'partial-off') bgClass = 'bg-red-500/35';
            else if (status === 'partial-on') bgClass = 'bg-emerald-500/35';
            else bgClass = 'bg-emerald-500/50';

            if (isPast) bgClass += ' opacity-40';

            return (
              <div key={hour} className="flex flex-col items-center gap-1">
                <div
                  className={`graph-bar relative w-full rounded-lg ${bgClass} ${
                    isCurrent ? 'ring-2 ring-white/60' : ''
                  }`}
                  style={{
                    height: '48px',
                    animationDelay: `${hour * 0.03}s`,
                  }}
                >
                  {isCurrent && (
                    <div className="absolute -top-1.5 left-1/2 now-marker">
                      <div className="h-2.5 w-2.5 rounded-full bg-white shadow-lg shadow-white/50" />
                    </div>
                  )}
                </div>
                <span className={`text-[9px] font-medium sm:text-[10px] ${
                  isCurrent ? 'text-white font-bold' : 'text-gray-500'
                }`}>
                  {String(hour).padStart(2, '0')}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Simple Event List ────────────────────────────────────────
function EventList({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] py-8 text-center fade-in-delay-3">
        <Zap className="mx-auto mb-2 h-8 w-8 text-gray-600" />
        <p className="text-base text-gray-400">Графік поки не доступний</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 fade-in-delay-3">
      {sorted.map((slot, i) => {
        const isOff = slot.type === 'Definite';
        const active = isToday && isSlotActive(slot, now);
        const isPast = isToday && currentMin >= slot.end;

        return (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 transition-all ${
              active
                ? isOff
                  ? 'border-red-500/50 bg-red-500/15'
                  : 'border-emerald-500/50 bg-emerald-500/15'
                : isPast
                  ? 'border-white/5 bg-white/[0.01] opacity-50'
                  : isOff
                    ? 'border-red-500/20 bg-red-500/5'
                    : 'border-emerald-500/20 bg-emerald-500/5'
            }`}
          >
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
              isOff ? 'bg-red-500/20' : 'bg-emerald-500/20'
            }`}>
              {isOff
                ? <ZapOff className="h-6 w-6 text-red-400" />
                : <Zap className="h-6 w-6 text-emerald-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white">
                  {minutesToTime(slot.start)} — {minutesToTime(slot.end)}
                </span>
                {active && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    isOff ? 'bg-red-500/30 text-red-200' : 'bg-emerald-500/30 text-emerald-200'
                  }`}>
                    зараз
                  </span>
                )}
              </div>
              <p className={`text-sm ${isOff ? 'text-red-300/80' : 'text-emerald-300/80'}`}>
                {isOff ? 'Немає світла' : 'Є світло'} · {slotDuration(slot)}
              </p>
            </div>
          </div>
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

  const [cities, setCities] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [todaySchedule, setTodaySchedule] = useState<CitySchedule | null>(null);
  const [tomorrowSchedule, setTomorrowSchedule] = useState<CitySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [citySearch, setCitySearch] = useState('');

  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyMinutes, setNotifyMinutes] = useState(60);
  const [saved, setSaved] = useState(false);

  const tgUser = useMemo(() => getTelegramUser(), []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { initTelegramWebApp(); }, []);

  useEffect(() => {
    fetchCities()
      .then((data) => { setCities(data); setLoading(false); })
      .catch(() => {
        setApiError('Не вдалося завантажити список міст');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!tgUser || cities.length === 0) return;
    supabase
      .from('user_preferences')
      .select('*')
      .eq('tg_user_id', tgUser.id)
      .maybeSingle()
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
      await supabase.from('user_preferences').upsert(
        {
          tg_user_id: tgUser.id,
          tg_username: tgUser.username ?? null,
          city_slug: selectedCity.slug,
          queue_group: selectedGroup,
          notify_enabled: notifyEnabled,
          notify_minutes_before: notifyMinutes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tg_user_id' },
      );
      setSaved(true);
      hapticNotification('success');
      setTimeout(() => setSaved(false), 2000);
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [tgUser, selectedCity, selectedGroup, notifyEnabled, notifyMinutes]);

  useEffect(() => {
    if (!selectedCity) return;
    setScheduleLoading(true);
    setApiError(null);
    Promise.all([
      fetchTodaySchedule(selectedCity.slug),
      fetchTomorrowSchedule(selectedCity.slug),
    ])
      .then(([today, tomorrow]) => {
        setTodaySchedule(today);
        setTomorrowSchedule(tomorrow);
        const groups = today.schedules.map((s) => s.queue).sort();
        setAvailableGroups(groups.length > 0 ? groups : ALL_GROUPS);
      })
      .catch(() => {
        setApiError('Не вдалося завантажити графік. Спробуйте пізніше.');
      })
      .finally(() => setScheduleLoading(false));
  }, [selectedCity]);

  useEffect(() => {
    const interval = setInterval(() => setNow(getKyivTime()), 15000);
    return () => clearInterval(interval);
  }, []);

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e1a]">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-400" />
          <p className="mt-3 text-base text-gray-400">Завантаження...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/8 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl px-4 py-5 sm:px-6">
        {/* ── Header ── */}
        <header className="mb-5 fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {view === 'settings' && (
                <button
                  onClick={() => { setView('schedule'); hapticImpact('light'); }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]"
                >
                  <ChevronLeft className="h-5 w-5 text-white" />
                </button>
              )}
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-lg shadow-blue-500/20">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">
                  {view === 'schedule' ? 'Графік світла' : 'Налаштування'}
                </h1>
                {selectedCity && view === 'schedule' && (
                  <button
                    onClick={() => { setView('settings'); hapticImpact('light'); }}
                    className="flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {selectedCity.name}
                    {selectedGroup && ` · черга ${selectedGroup}`}
                  </button>
                )}
                {!selectedCity && view === 'schedule' && (
                  <p className="text-sm text-gray-400">Київська область</p>
                )}
              </div>
            </div>
            {view === 'schedule' && (
              <button
                onClick={() => { setView('settings'); hapticImpact('light'); }}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] transition-colors hover:bg-white/[0.08]"
              >
                <Settings className="h-5 w-5 text-blue-400" />
              </button>
            )}
          </div>
        </header>

        {/* ── SCHEDULE VIEW ── */}
        {view === 'schedule' && (
          <>
            {/* Time */}
            <div className="mb-5 text-center fade-in">
              <span className="font-mono text-3xl font-bold tracking-wider text-white">{now.timeString}</span>
              <p className="text-sm text-gray-400">час у Києві</p>
            </div>

            {saved && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300 fade-in">
                <CheckCircle2 className="h-4 w-4" /> Збережено
              </div>
            )}

            {apiError && (
              <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 fade-in">
                {apiError}
              </div>
            )}

            {!selectedCity || !selectedGroup ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] py-16 text-center fade-in">
                <MapPin className="mb-4 h-14 w-14 text-gray-500" />
                <h2 className="mb-2 text-xl font-bold text-white">Оберіть ваше місто</h2>
                <p className="mb-5 max-w-xs text-base text-gray-400">
                  Щоб побачити графік відключень, оберіть місто та вашу чергу
                </p>
                <button
                  onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-500/20 transition-opacity hover:opacity-90"
                >
                  Обрати місто
                </button>
              </div>
            ) : scheduleLoading ? (
              <div className="flex flex-col items-center justify-center py-16 fade-in">
                <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
                <p className="mt-3 text-base text-gray-400">Завантаження графіку...</p>
              </div>
            ) : (
              <>
                {/* Status hero */}
                <div className="mb-5">
                  <StatusHero slots={todaySlots} now={now} />
                </div>

                {/* Day tabs */}
                <div className="mb-4 flex gap-2 fade-in-delay-1">
                  <button
                    onClick={() => { setDayTab('today'); hapticImpact('light'); }}
                    className={`flex-1 rounded-2xl border-2 px-4 py-3 text-base font-semibold transition-all ${
                      dayTab === 'today'
                        ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                        : 'border-white/10 bg-white/[0.03] text-gray-400'
                    }`}
                  >
                    Сьогодні
                  </button>
                  <button
                    onClick={() => { setDayTab('tomorrow'); hapticImpact('light'); }}
                    className={`flex-1 rounded-2xl border-2 px-4 py-3 text-base font-semibold transition-all ${
                      dayTab === 'tomorrow'
                        ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                        : 'border-white/10 bg-white/[0.03] text-gray-400'
                    }`}
                  >
                    Завтра
                  </button>
                </div>

                {/* Visual hourly graph */}
                <div className="mb-5">
                  <h3 className="mb-2 text-center text-base font-semibold text-gray-300 fade-in-delay-2">
                    Графік по годинах
                  </h3>
                  <HourlyGraph
                    slots={displaySlots}
                    now={now}
                    isToday={dayTab === 'today'}
                  />
                </div>

                {/* Event list */}
                <div className="mb-5">
                  <h3 className="mb-3 text-center text-base font-semibold text-gray-300 fade-in-delay-3">
                    Розклад на {dayTab === 'today' ? 'сьогодні' : 'завтра'}
                  </h3>
                  <EventList
                    slots={displaySlots}
                    now={now}
                    isToday={dayTab === 'today'}
                  />
                </div>

                {/* Updated info */}
                {displaySchedule?.updated && (
                  <p className="mb-5 text-center text-xs text-gray-500 fade-in-delay-4">
                    Оновлено: {displaySchedule.updated}
                  </p>
                )}

                <footer className="mt-8 border-t border-white/5 pt-4 text-center">
                  <p className="text-xs text-gray-600">
                    Дані: bezsvitla.com.ua · Час за Києвом
                  </p>
                </footer>
              </>
            )}
          </>
        )}

        {/* ── SETTINGS VIEW ── */}
        {view === 'settings' && (
          <div className="fade-in">
            {saved && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Збережено
              </div>
            )}

            {/* Step 1: City */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/20 text-sm font-bold text-blue-300">1</span>
                <h3 className="text-lg font-bold text-white">Оберіть місто</h3>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={citySearch}
                  onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Знайти місто..."
                  className="w-full rounded-xl bg-white/5 py-3 pl-11 pr-4 text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-2">
                {filteredCities.map((city) => (
                  <button
                    key={city.slug}
                    onClick={() => {
                      setSelectedCity(city);
                      setSelectedGroup('');
                      setTodaySchedule(null);
                      setTomorrowSchedule(null);
                      hapticImpact('light');
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base transition-all ${
                      selectedCity?.slug === city.slug
                        ? 'border-blue-500/60 bg-blue-500/15 text-blue-200 font-semibold'
                        : 'border-transparent text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <MapPin className="h-5 w-5 shrink-0" />
                    {city.name}
                  </button>
                ))}
                {filteredCities.length === 0 && (
                  <p className="py-6 text-center text-base text-gray-500">Місто не знайдено</p>
                )}
              </div>
            </div>

            {/* Step 2: Queue */}
            {selectedCity && (
              <div className="mb-6 fade-in">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/20 text-sm font-bold text-blue-300">2</span>
                  <h3 className="text-lg font-bold text-white">Оберіть вашу чергу</h3>
                </div>
                <p className="mb-3 text-sm text-gray-400">
                  Черга вказана у вашому рахунку за електроенергію або на сайті ДТЕК
                </p>
                {scheduleLoading ? (
                  <div className="flex items-center gap-2 py-4 text-base text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin" /> Завантаження...
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {(availableGroups.length > 0 ? availableGroups : ALL_GROUPS).map((group) => (
                      <button
                        key={group}
                        onClick={() => { setSelectedGroup(group); hapticImpact('light'); }}
                        className={`rounded-xl border-2 px-3 py-3 text-center text-base font-bold transition-all ${
                          selectedGroup === group
                            ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                            : 'border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20'
                        }`}
                      >
                        {group}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Notifications */}
            {tgUser && (
              <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {notifyEnabled ? <Bell className="h-5 w-5 text-blue-400" /> : <BellOff className="h-5 w-5 text-gray-500" />}
                    <h3 className="text-base font-bold text-white">Сповіщення</h3>
                  </div>
                  <button
                    onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                    className={`relative h-7 w-12 rounded-full transition-colors ${notifyEnabled ? 'bg-blue-500' : 'bg-white/10'}`}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${notifyEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {notifyEnabled && (
                  <div>
                    <p className="mb-2 text-sm text-gray-400">Попередити за:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[30, 60].map((mins) => (
                        <button
                          key={mins}
                          onClick={() => { setNotifyMinutes(mins); hapticImpact('light'); }}
                          className={`rounded-xl border-2 px-4 py-3 text-center text-base font-semibold transition-all ${
                            notifyMinutes === mins
                              ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                              : 'border-white/10 bg-white/[0.03] text-gray-400'
                          }`}
                        >
                          {mins} хвилин
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => { setView('schedule'); hapticImpact('light'); }}
              className="w-full rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 px-4 py-4 text-center text-lg font-bold text-white shadow-lg shadow-blue-500/20 transition-opacity hover:opacity-90"
            >
              Готово
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
