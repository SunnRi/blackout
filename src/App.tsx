import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Zap, ZapOff, MapPin, Clock, Loader2,
  CheckCircle2, Sun, Moon, Bell, BellOff, ChevronLeft,
  Search, Settings, ArrowDownUp,
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
function slotToTime(slot: Slot): string {
  return `${minutesToTime(slot.start)} — ${minutesToTime(slot.end)}`;
}

function slotDuration(slot: Slot): string {
  const mins = slot.end - slot.start;
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

function getNextEvent(slots: Slot[], now: KyivTime): { slot: Slot; isOutage: boolean; minutesUntil: number } | null {
  const cur = now.hours * 60 + now.minutes;
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const next = sorted.find((s) => s.start > cur);
  if (!next) return null;
  return {
    slot: next,
    isOutage: next.type === 'Definite',
    minutesUntil: next.start - cur,
  };
}

function formatCountdown(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} год ${m} хв`;
  if (h > 0) return `${h} год`;
  return `${m} хв`;
}

// ── 24h Timeline Bar ──────────────────────────────────────────
function TimelineBar({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const currentMin = now.hours * 60 + now.minutes;
  const nowPercent = (currentMin / 1440) * 100;

  const sorted = [...slots].sort((a, b) => a.start - b.start);

  return (
    <div className="relative">
      {/* Bar */}
      <div className="relative h-12 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
        {sorted.map((slot, i) => {
          const left = (slot.start / 1440) * 100;
          const width = ((slot.end - slot.start) / 1440) * 100;
          const isOff = slot.type === 'Definite';
          return (
            <div
              key={i}
              className={`absolute top-0 h-full ${isOff ? 'bg-red-500/50' : 'bg-emerald-500/40'}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${minutesToTime(slot.start)}—${minutesToTime(slot.end)} ${isOff ? 'відключення' : 'світло'}`}
            />
          );
        })}

        {/* Now marker */}
        <div className="absolute top-0 z-10 h-full w-0.5 bg-white shadow-lg" style={{ left: `${nowPercent}%` }}>
          <div className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-[#0a0e1a]" />
        </div>
      </div>

      {/* Hour labels */}
      <div className="mt-1.5 flex justify-between px-0.5 text-[10px] font-medium text-gray-600">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

// ── Next Event Card (big countdown) ───────────────────────────
function NextEventCard({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const nextEvent = getNextEvent(slots, now);
  const isCurrentlyOff = current?.type === 'Definite';

  if (!nextEvent) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
        <p className="text-sm text-gray-400">
          {isCurrentlyOff ? 'Графік відключень на сьогодні завершено' : 'На сьогодні відключень більше немає'}
        </p>
      </div>
    );
  }

  const countdown = formatCountdown(nextEvent.minutesUntil);
  const isNextOutage = nextEvent.isOutage;

  return (
    <div className={`rounded-2xl border p-5 transition-all ${
      isNextOutage
        ? 'border-red-500/30 bg-gradient-to-br from-red-500/15 to-transparent'
        : 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-transparent'
    }`}>
      <div className="flex items-center gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
          isNextOutage ? 'bg-red-500/20' : 'bg-emerald-500/20'
        }`}>
          {isNextOutage
            ? <ZapOff className="h-7 w-7 text-red-400" />
            : <Zap className="h-7 w-7 text-emerald-400" />
          }
        </div>
        <div className="flex-1">
          <p className={`text-xs font-medium uppercase tracking-wider ${
            isNextOutage ? 'text-red-400' : 'text-emerald-400'
          }`}>
            {isNextOutage ? 'Наступне відключення' : 'Світро ввімкнуть'}
          </p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{minutesToTime(nextEvent.slot.start)}</span>
            <span className="text-sm text-gray-400">— {minutesToTime(nextEvent.slot.end)}</span>
          </div>
          <p className="mt-1 text-sm text-gray-300">
            Через <span className={`font-semibold ${isNextOutage ? 'text-red-300' : 'text-emerald-300'}`}>{countdown}</span>
            {' · '}тривалість {slotDuration(nextEvent.slot)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Current Status Badge ──────────────────────────────────────
function CurrentStatusBadge({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';

  return (
    <div className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 ${
      isOff
        ? 'border-red-500/30 bg-red-500/10'
        : 'border-emerald-500/30 bg-emerald-500/10'
    }`}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
        isOff ? 'bg-red-500/20' : 'bg-emerald-500/20'
      }`}>
        {isOff
          ? <ZapOff className="h-5 w-5 text-red-400" />
          : <Zap className="h-5 w-5 text-emerald-400" />
        }
      </div>
      <div className="flex-1">
        <p className={`text-sm font-semibold ${isOff ? 'text-red-300' : 'text-emerald-300'}`}>
          {isOff ? 'Світла немає' : 'Світло є'}
        </p>
        {current && (
          <p className="text-xs text-gray-400">
            {isOff ? 'Відключення' : 'Живлення'}: {slotToTime(current)}
          </p>
        )}
      </div>
      <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
        isOff ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
      }`}>
        зараз
      </span>
    </div>
  );
}

// ── Schedule List (clear on/off blocks) ───────────────────────
function ScheduleList({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] py-6 text-center">
        <p className="text-sm text-gray-500">Відключень не заплановано</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {sorted.map((slot, i) => {
        const active = isSlotActive(slot, now);
        const isOff = slot.type === 'Definite';

        return (
          <div key={i}>
            {/* Connecting line */}
            {i > 0 && (
              <div className="ml-[22px] h-4 w-px bg-white/10" />
            )}
            <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
              active
                ? isOff
                  ? 'border-red-500/40 bg-red-500/15 ring-1 ring-red-500/20'
                  : 'border-emerald-500/40 bg-emerald-500/15 ring-1 ring-emerald-500/20'
                : isOff
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-emerald-500/20 bg-emerald-500/5'
            }`}>
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                isOff
                  ? active ? 'bg-red-500/30' : 'bg-red-500/15'
                  : active ? 'bg-emerald-500/30' : 'bg-emerald-500/15'
              }`}>
                {isOff
                  ? <ZapOff className={`h-5 w-5 ${active ? 'text-red-300' : 'text-red-400/70'}`} />
                  : <Zap className={`h-5 w-5 ${active ? 'text-emerald-300' : 'text-emerald-400/70'}`} />
                }
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">
                    {minutesToTime(slot.start)} — {minutesToTime(slot.end)}
                  </span>
                  {active && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      isOff ? 'bg-red-500/30 text-red-200' : 'bg-emerald-500/30 text-emerald-200'
                    }`}>
                      зараз
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs">
                  <span className={isOff ? 'text-red-300/80' : 'text-emerald-300/80'}>
                    {isOff ? 'Відключення' : 'Світло'}
                  </span>
                  <span className="text-gray-500">·</span>
                  <span className="text-gray-400">{slotDuration(slot)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Compact Queue Card ────────────────────────────────────────
function CompactQueueCard({
  queue, slots, isSelected, onSelect,
}: { queue: string; slots: Slot[]; isSelected: boolean; onSelect: () => void }) {
  const now = getKyivTime();
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const sorted = [...slots].sort((a, b) => a.start - b.start);

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left transition-all ${
        isSelected
          ? 'border-blue-500/50 bg-blue-500/10'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Черга {queue}</span>
        {current && (
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            isOff ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
          }`}>
            <div className={`h-1.5 w-1.5 rounded-full ${isOff ? 'bg-red-400' : 'bg-emerald-400'} animate-pulse`} />
            {isOff ? 'немає світла' : 'є світло'}
          </span>
        )}
      </div>
      {/* Mini timeline */}
      <div className="relative h-5 overflow-hidden rounded-md bg-white/[0.03]">
        {sorted.map((slot, i) => {
          const left = (slot.start / 1440) * 100;
          const width = ((slot.end - slot.start) / 1440) * 100;
          return (
            <div
              key={i}
              className={`absolute top-0 h-full ${slot.type === 'Definite' ? 'bg-red-500/50' : 'bg-emerald-500/40'}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
      </div>
    </button>
  );
}

// ── Day Tab ───────────────────────────────────────────────────
type DayTab = 'today' | 'tomorrow';

// ─── Main App ─────────────────────────────────────────────────
type View = 'schedule' | 'settings';

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

  // Load cities
  useEffect(() => {
    fetchCities()
      .then((data) => { setCities(data); setLoading(false); })
      .catch((err) => {
        console.error('Failed to load cities:', err);
        setApiError('Не вдалося завантажити список міст');
        setLoading(false);
      });
  }, []);

  // Load saved preferences
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

  // Auto-save
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

  // Fetch schedule when city changes
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
      .catch((err) => {
        console.error('Failed to load schedule:', err);
        setApiError('Не вдалося завантажити графік. Спробуйте пізніше.');
      })
      .finally(() => setScheduleLoading(false));
  }, [selectedCity]);

  // Update clock every 15s
  useEffect(() => {
    const interval = setInterval(() => setNow(getKyivTime()), 15000);
    return () => clearInterval(interval);
  }, []);

  // Filtered cities for search
  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return cities;
    const q = citySearch.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q) || c.slug.includes(q));
  }, [cities, citySearch]);

  // Current slots based on day tab
  const displaySchedule = dayTab === 'today' ? todaySchedule : tomorrowSchedule;
  const displaySlots = useMemo<Slot[]>(() => {
    if (!displaySchedule || !selectedGroup) return [];
    return displaySchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [displaySchedule, selectedGroup]);

  // Today's slots for status/timeline (always today regardless of tab)
  const todaySlots = useMemo<Slot[]>(() => {
    if (!todaySchedule || !selectedGroup) return [];
    return todaySchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [todaySchedule, selectedGroup]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e1a]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/8 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl px-4 py-6 sm:px-6">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {view === 'settings' && (
                <button
                  onClick={() => { setView('schedule'); hapticImpact('light'); }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] transition-colors hover:bg-white/[0.08]"
                >
                  <ChevronLeft className="h-5 w-5 text-white" />
                </button>
              )}
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-lg shadow-blue-500/20">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white sm:text-xl">
                  {view === 'schedule' ? 'Графік світла' : 'Налаштування'}
                </h1>
                <p className="text-xs text-gray-400">
                  {selectedCity?.name ?? 'Оберіть місто'}
                  {selectedGroup && ` · черга ${selectedGroup}`}
                </p>
              </div>
            </div>
            {view === 'schedule' && (
              <button
                onClick={() => { setView('settings'); hapticImpact('light'); }}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] transition-colors hover:bg-white/[0.08]"
              >
                <Settings className="h-5 w-5 text-blue-400" />
              </button>
            )}
          </div>
        </header>

        {/* ─── SCHEDULE VIEW ─── */}
        {view === 'schedule' && (
          <>
            {/* Clock */}
            <div className="mb-5 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] py-3">
              {now.hours >= 6 && now.hours < 20 ? (
                <Sun className="h-5 w-5 text-amber-400" />
              ) : (
                <Moon className="h-5 w-5 text-blue-300" />
              )}
              <span className="font-mono text-lg font-semibold tracking-wide text-white">{now.timeString}</span>
              <span className="text-sm text-gray-400">Київ</span>
            </div>

            {saved && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Налаштування збережено
              </div>
            )}

            {apiError && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {apiError}
              </div>
            )}

            {!selectedCity || !selectedGroup ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] py-12 text-center">
                <MapPin className="mb-3 h-10 w-10 text-gray-500" />
                <p className="mb-2 text-gray-400">Оберіть місто та чергу</p>
                <button
                  onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="mt-2 rounded-xl bg-blue-500/20 px-6 py-2.5 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/30"
                >
                  Налаштувати
                </button>
              </div>
            ) : scheduleLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
              </div>
            ) : (
              <>
                {/* Current status */}
                <div className="mb-4">
                  <CurrentStatusBadge slots={todaySlots} now={now} />
                </div>

                {/* Next event countdown */}
                <div className="mb-5">
                  <NextEventCard slots={todaySlots} now={now} />
                </div>

                {/* 24h timeline */}
                <div className="mb-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <h2 className="text-sm font-semibold text-gray-300">Графік на день</h2>
                  </div>
                  <TimelineBar slots={displaySlots} now={dayTab === 'today' ? now : { ...now, hours: 0, minutes: 0 }} />
                </div>

                {/* Day tabs */}
                <div className="mb-4 flex gap-2">
                  <button
                    onClick={() => { setDayTab('today'); hapticImpact('light'); }}
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                      dayTab === 'today'
                        ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                        : 'border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20'
                    }`}
                  >
                    Сьогодні
                  </button>
                  <button
                    onClick={() => { setDayTab('tomorrow'); hapticImpact('light'); }}
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                      dayTab === 'tomorrow'
                        ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                        : 'border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20'
                    }`}
                  >
                    Завтра
                  </button>
                </div>

                {/* Detailed schedule */}
                <div className="mb-5">
                  <ScheduleList
                    slots={displaySlots}
                    now={dayTab === 'today' ? now : { ...now, hours: 0, minutes: 0 }}
                  />
                </div>

                {/* Other queues */}
                {availableGroups.length > 1 && (
                  <div className="mb-5">
                    <div className="mb-3 flex items-center gap-2">
                      <ArrowDownUp className="h-4 w-4 text-gray-400" />
                      <h2 className="text-sm font-semibold text-gray-300">Інші черги — {selectedCity.name}</h2>
                    </div>
                    <div className="space-y-2">
                      {availableGroups.filter((q) => q !== selectedGroup).map((q) => {
                        const qSlots = todaySchedule?.schedules.find((s) => s.queue === q)?.slots ?? [];
                        if (qSlots.length === 0) return null;
                        return (
                          <CompactQueueCard
                            key={q}
                            queue={q}
                            slots={qSlots}
                            isSelected={false}
                            onSelect={() => { setSelectedGroup(q); hapticImpact('medium'); setDayTab('today'); }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                <footer className="mt-10 border-t border-white/5 pt-5 text-center">
                  <p className="text-xs text-gray-500">
                    Дані: Yasno API (Київ) та bezsvitla.com.ua (Київська область)
                  </p>
                  <p className="mt-2 text-xs text-gray-600">Час за київським поясом</p>
                </footer>
              </>
            )}
          </>
        )}

        {/* ─── SETTINGS VIEW ─── */}
        {view === 'settings' && (
          <>
            {saved && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Налаштування збережено
              </div>
            )}

            {/* City selection */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-medium text-gray-400">Місто</label>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={citySearch}
                  onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Пошук міста..."
                  className="w-full rounded-lg bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
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
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all ${
                      selectedCity?.slug === city.slug
                        ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                        : 'border-transparent text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    {city.name}
                  </button>
                ))}
                {filteredCities.length === 0 && (
                  <p className="py-4 text-center text-sm text-gray-500">Місто не знайдено</p>
                )}
              </div>
            </div>

            {/* Group selection */}
            {selectedCity && (
              <div className="mb-5">
                <label className="mb-2 block text-sm font-medium text-gray-400">
                  Черга відключення
                  {scheduleLoading && <span className="ml-2 text-gray-500">(завантаження...)</span>}
                </label>
                {scheduleLoading ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Завантаження черг...
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {(availableGroups.length > 0 ? availableGroups : ALL_GROUPS).map((group) => (
                      <button
                        key={group}
                        onClick={() => { setSelectedGroup(group); hapticImpact('light'); }}
                        className={`rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition-all ${
                          selectedGroup === group
                            ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
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
              <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {notifyEnabled ? <Bell className="h-4 w-4 text-blue-400" /> : <BellOff className="h-4 w-4 text-gray-500" />}
                    <h3 className="text-sm font-semibold text-white">Сповіщення</h3>
                  </div>
                  <button
                    onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                    className={`relative h-6 w-11 rounded-full transition-colors ${notifyEnabled ? 'bg-blue-500' : 'bg-white/10'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${notifyEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {notifyEnabled && (
                  <div>
                    <p className="mb-2 text-xs text-gray-500">Попереджати за:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[30, 60].map((mins) => (
                        <button
                          key={mins}
                          onClick={() => { setNotifyMinutes(mins); hapticImpact('light'); }}
                          className={`rounded-xl border px-4 py-2.5 text-center text-sm font-medium transition-all ${
                            notifyMinutes === mins
                              ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                              : 'border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20'
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
              className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-emerald-500 px-4 py-3.5 text-center font-medium text-white shadow-lg shadow-blue-500/20 transition-opacity hover:opacity-90"
            >
              Готово
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
