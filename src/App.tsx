import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Zap, ZapOff, MapPin, Loader2, CheckCircle2,
  Bell, BellOff, ChevronLeft, Search, Settings,
  Sun, Moon, AlertTriangle, Navigation, Clock,
  Info,
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

// ── Kyiv oblast city coordinate mapping for geolocation ──────
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
    if (dist < minDist) {
      minDist = dist;
      nearest = city;
    }
  }
  if (minDist > 0.8) return null;
  return nearest;
}

// ── Helpers ───────────────────────────────────────────────────
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

function getRelativeUpdate(updated: string | null): string | null {
  if (!updated) return null;
  // bezsvitla format: "07.10.2026 14:30"
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

// ── Theme ─────────────────────────────────────────────────────
type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('theme') as Theme | null;
  if (saved) return saved;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

// ── Status Hero ───────────────────────────────────────────────
function StatusHero({ slots, now }: { slots: Slot[]; now: KyivTime }) {
  const current = getCurrentSlot(slots, now);
  const isOff = current?.type === 'Definite';
  const nextOutage = getNextOutageSlot(slots, now);
  const nextOn = getNextOnSlot(slots, now);

  return (
    <div className={`fade-in-scale rounded-3xl p-6 text-center glass-strong ${
      isOff ? 'pulse-red' : 'pulse-green'
    }`}>
      <div className={`mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full ${
        isOff ? 'bg-red-500/15' : 'bg-emerald-500/15'
      }`}>
        {isOff
          ? <ZapOff className="h-10 w-10" style={{ color: 'var(--on-negative)' }} />
          : <Zap className="h-10 w-10" style={{ color: 'var(--on-positive)' }} />
        }
      </div>
      <h2 className="text-2xl font-extrabold text-primary-c">
        {isOff ? 'Світла зараз немає' : 'Світло зараз є'}
      </h2>
      {current && (
        <p className="mt-1 text-base text-secondary-c">
          {isOff ? 'Відключення' : 'Живлення'}:{' '}
          <span className="font-semibold text-primary-c">
            {minutesToTime(current.start)} — {minutesToTime(current.end)}
          </span>
        </p>
      )}
      <div className="mt-4 space-y-2">
        {isOff && nextOn && (
          <div className="rounded-2xl bg-emerald-500/10 px-4 py-3">
            <p className="text-base" style={{ color: 'var(--on-positive)' }}>
              Світло увімкнуть о <span className="font-bold text-primary-c">{minutesToTime(nextOn.slot.start)}</span>
            </p>
            <p className="text-sm text-secondary-c">через {formatCountdown(nextOn.minutesUntil)}</p>
          </div>
        )}
        {!isOff && nextOutage && (
          <div className="rounded-2xl bg-red-500/10 px-4 py-3">
            <p className="text-base" style={{ color: 'var(--on-negative)' }}>
              Відключення о <span className="font-bold text-primary-c">{minutesToTime(nextOutage.slot.start)}</span>
            </p>
            <p className="text-sm text-secondary-c">
              через {formatCountdown(nextOutage.minutesUntil)} · тривалість {slotDuration(nextOutage.slot)}
            </p>
          </div>
        )}
        {!isOff && !nextOutage && (
          <p className="text-sm text-secondary-c">Більше відключень сьогодні не заплановано</p>
        )}
      </div>
    </div>
  );
}

// ── Emergency Banner ──────────────────────────────────────────
function EmergencyBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fade-in rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-4 pulse-amber">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />
        <div className="flex-1">
          <h3 className="text-base font-bold text-amber-600 dark:text-amber-400">
            Аварійний режим
          </h3>
          <p className="mt-1 text-sm text-amber-700/80 dark:text-amber-200/80">
            Діють позапланові відключення. Звичайний графік може не відповідати дійсності.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 text-amber-500 hover:opacity-70"
          aria-label="Закрити"
        >
          <ChevronLeft className="h-5 w-5 rotate-90" />
        </button>
      </div>
    </div>
  );
}

// ── Hourly Graph with annotations ─────────────────────────────
function HourlyGraph({ slots, now, isToday, updated }: { slots: Slot[]; now: KyivTime; isToday: boolean; updated: string | null }) {
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
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-3.5 rounded bg-emerald-500/60" />
            <span className="text-secondary-c">Є світло</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-3.5 rounded bg-red-500/60" />
            <span className="text-secondary-c">Немає</span>
          </span>
        </div>
        {relUpdate && (
          <span className="flex items-center gap-1 text-xs text-muted-c">
            <Clock className="h-3 w-3" />
            {relUpdate}
          </span>
        )}
      </div>

      <div className="relative rounded-2xl glass p-3 sm:p-4">
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

            if (isPast) bgClass += ' opacity-35';

            return (
              <div key={hour} className="flex flex-col items-center gap-1">
                <div
                  className={`graph-bar relative w-full rounded-lg ${bgClass} ${
                    isCurrent ? 'ring-2 ring-blue-400/80' : ''
                  }`}
                  style={{ height: '48px', animationDelay: `${hour * 0.025}s` }}
                >
                  {isCurrent && (
                    <div className="absolute -top-1.5 left-1/2 now-marker">
                      <div className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50" />
                    </div>
                  )}
                </div>
                <span className={`text-[9px] font-medium sm:text-[10px] ${
                  isCurrent ? 'text-blue-500 dark:text-blue-400 font-bold' : 'text-muted-c'
                }`}>
                  {String(hour).padStart(2, '0')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {relUpdate && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-c">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>Графік оновлено: <span className="font-medium text-secondary-c">{relUpdate}</span>{updated && ` · ${updated}`}</span>
        </div>
      )}
    </div>
  );
}

// ── Event List ────────────────────────────────────────────────
function EventList({ slots, now, isToday }: { slots: Slot[]; now: KyivTime; isToday: boolean }) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const currentMin = isToday ? now.hours * 60 + now.minutes : -1;

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl glass py-8 text-center fade-in-delay-3">
        <Zap className="mx-auto mb-2 h-8 w-8 text-muted-c" />
        <p className="text-base text-secondary-c">Графік поки не доступний</p>
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
                  ? 'border-red-500/40 bg-red-500/10'
                  : 'border-emerald-500/40 bg-emerald-500/10'
                : isPast
                  ? 'border-subtle-c bg-transparent opacity-40'
                  : isOff
                    ? 'border-red-500/15 bg-red-500/[0.03]'
                    : 'border-emerald-500/15 bg-emerald-500/[0.03]'
            }`}
          >
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
              isOff ? 'bg-red-500/15' : 'bg-emerald-500/15'
            }`}>
              {isOff
                ? <ZapOff className="h-6 w-6" style={{ color: 'var(--on-negative)' }} />
                : <Zap className="h-6 w-6" style={{ color: 'var(--on-positive)' }} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-primary-c">
                  {minutesToTime(slot.start)} — {minutesToTime(slot.end)}
                </span>
                {active && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    isOff ? 'bg-red-500/25 text-red-500 dark:text-red-300' : 'bg-emerald-500/25 text-emerald-600 dark:text-emerald-300'
                  }`}>
                    зараз
                  </span>
                )}
              </div>
              <p className={`text-sm ${isOff ? 'text-red-400/80 dark:text-red-300/70' : 'text-emerald-500/80 dark:text-emerald-300/70'}`}>
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
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

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

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Load cities
  useEffect(() => {
    fetchCities()
      .then((data) => { setCities(data); setLoading(false); })
      .catch(() => {
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

  // Fetch schedule
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

  // Clock
  useEffect(() => {
    const interval = setInterval(() => setNow(getKyivTime()), 15000);
    return () => clearInterval(interval);
  }, []);

  // Geolocation auto-detect
  const detectCity = useCallback(() => {
    if (cities.length === 0) return;
    setGeoDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nearest = findNearestCity(pos.coords.latitude, pos.coords.longitude, cities);
        if (nearest) {
          setSelectedCity(nearest);
          setSelectedGroup('');
          setTodaySchedule(null);
          setTomorrowSchedule(null);
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary-c">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin" style={{ color: 'var(--accent)' }} />
          <p className="mt-3 text-base text-secondary-c">Завантаження...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary-c" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Ambient gradient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/5 blur-3xl" />
        <div className="absolute top-1/2 -right-40 h-80 w-80 rounded-full bg-emerald-500/3 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl px-4 py-5 sm:px-6">
        {/* ── Header ── */}
        <header className="mb-5 fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {view === 'settings' && (
                <button
                  onClick={() => { setView('schedule'); hapticImpact('light'); }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl glass"
                >
                  <ChevronLeft className="h-5 w-5 text-primary-c" />
                </button>
              )}
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-lg shadow-blue-500/20">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-primary-c">
                  {view === 'schedule' ? 'Графік світла' : 'Налаштування'}
                </h1>
                {selectedCity && view === 'schedule' ? (
                  <button
                    onClick={() => { setView('settings'); hapticImpact('light'); }}
                    className="flex items-center gap-1 text-sm" style={{ color: 'var(--accent)' }}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {selectedCity.name}
                    {selectedGroup && ` · черга ${selectedGroup}`}
                  </button>
                ) : !selectedCity && view === 'schedule' ? (
                  <p className="text-sm text-secondary-c">Київська область</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); hapticImpact('light'); }}
                className="flex h-11 w-11 items-center justify-center rounded-xl glass transition-all hover:scale-105"
                aria-label="Змінити тему"
              >
                {theme === 'dark'
                  ? <Sun className="h-5 w-5 text-amber-400" />
                  : <Moon className="h-5 w-5 text-slate-600" />
                }
              </button>
              {view === 'schedule' && (
                <button
                  onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="flex h-11 w-11 items-center justify-center rounded-xl glass transition-all hover:scale-105"
                >
                  <Settings className="h-5 w-5" style={{ color: 'var(--accent)' }} />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── SCHEDULE VIEW ── */}
        {view === 'schedule' && (
          <>
            <div className="mb-5 text-center fade-in">
              <span className="font-mono text-3xl font-extrabold tracking-wider text-primary-c">{now.timeString}</span>
              <p className="text-sm text-secondary-c">час у Києві</p>
            </div>

            {saved && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-300 fade-in">
                <CheckCircle2 className="h-4 w-4" /> Збережено
              </div>
            )}

            {apiError && (
              <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300 fade-in">
                {apiError}
              </div>
            )}

            {!selectedCity || !selectedGroup ? (
              <div className="flex flex-col items-center justify-center rounded-3xl glass py-16 text-center fade-in-scale">
                <MapPin className="mb-4 h-14 w-14 text-muted-c" />
                <h2 className="mb-2 text-xl font-bold text-primary-c">Оберіть ваше місто</h2>
                <p className="mb-5 max-w-xs text-base text-secondary-c">
                  Щоб побачити графік відключень, оберіть місто та вашу чергу
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => { setView('settings'); hapticImpact('light'); }}
                    className="rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
                  >
                    Обрати місто
                  </button>
                  <button
                    onClick={detectCity}
                    disabled={geoDetecting}
                    className="flex items-center justify-center gap-2 rounded-2xl glass px-6 py-3 text-base font-medium text-secondary-c transition-all hover:scale-[1.02] disabled:opacity-50"
                  >
                    {geoDetecting
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Визначаю...</>
                      : <><Navigation className="h-4 w-4" /> Знайти за геолокацією</>
                    }
                  </button>
                </div>
              </div>
            ) : scheduleLoading ? (
              <div className="flex flex-col items-center justify-center py-16 fade-in">
                <Loader2 className="h-10 w-10 animate-spin" style={{ color: 'var(--accent)' }} />
                <p className="mt-3 text-base text-secondary-c">Завантаження графіку...</p>
              </div>
            ) : (
              <>
                {/* Emergency banner */}
                {showEmergency && (
                  <div className="mb-4">
                    <EmergencyBanner onDismiss={() => { setShowEmergency(false); hapticImpact('light'); }} />
                  </div>
                )}

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
                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-500 dark:text-blue-300'
                        : 'border-subtle-c glass text-secondary-c'
                    }`}
                  >
                    Сьогодні
                  </button>
                  <button
                    onClick={() => { setDayTab('tomorrow'); hapticImpact('light'); }}
                    className={`flex-1 rounded-2xl border-2 px-4 py-3 text-base font-semibold transition-all ${
                      dayTab === 'tomorrow'
                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-500 dark:text-blue-300'
                        : 'border-subtle-c glass text-secondary-c'
                    }`}
                  >
                    Завтра
                  </button>
                </div>

                {/* Graph */}
                <div className="mb-5">
                  <h3 className="mb-2 text-center text-base font-semibold text-secondary-c fade-in-delay-2">
                    Графік по годинах
                  </h3>
                  <HourlyGraph
                    slots={displaySlots}
                    now={now}
                    isToday={dayTab === 'today'}
                    updated={displaySchedule?.updated ?? null}
                  />
                </div>

                {/* Event list */}
                <div className="mb-5">
                  <h3 className="mb-3 text-center text-base font-semibold text-secondary-c fade-in-delay-3">
                    Розклад на {dayTab === 'today' ? 'сьогодні' : 'завтра'}
                  </h3>
                  <EventList
                    slots={displaySlots}
                    now={now}
                    isToday={dayTab === 'today'}
                  />
                </div>

                <footer className="mt-8 border-t pt-4 text-center" style={{ borderColor: 'var(--border-subtle)' }}>
                  <p className="text-xs text-muted-c">
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
              <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Збережено
              </div>
            )}

            {/* Step 1: City */}
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/15 text-sm font-bold" style={{ color: 'var(--accent)' }}>1</span>
                  <h3 className="text-lg font-bold text-primary-c">Оберіть місто</h3>
                </div>
                <button
                  onClick={detectCity}
                  disabled={geoDetecting}
                  className="flex items-center gap-1.5 rounded-xl glass px-3 py-2 text-sm font-medium text-secondary-c transition-all hover:scale-105 disabled:opacity-50"
                >
                  {geoDetecting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Navigation className="h-4 w-4" />
                  }
                  Авто
                </button>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-c" />
                <input
                  type="text"
                  value={citySearch}
                  onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Знайти місто..."
                  className="w-full rounded-xl glass py-3 pl-11 pr-4 text-base text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-2xl glass p-2">
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
                        ? 'border-blue-500/50 bg-blue-500/10 font-semibold'
                        : 'border-transparent text-secondary-c hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <MapPin className="h-5 w-5 shrink-0" />
                    {city.name}
                  </button>
                ))}
                {filteredCities.length === 0 && (
                  <p className="py-6 text-center text-base text-muted-c">Місто не знайдено</p>
                )}
              </div>
            </div>

            {/* Step 2: Queue */}
            {selectedCity && (
              <div className="mb-6 fade-in">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/15 text-sm font-bold" style={{ color: 'var(--accent)' }}>2</span>
                  <h3 className="text-lg font-bold text-primary-c">Оберіть вашу чергу</h3>
                </div>
                <p className="mb-3 text-sm text-secondary-c">
                  Черга вказана у вашому рахунку за електроенергію або на сайті ДТЕК
                </p>
                {scheduleLoading ? (
                  <div className="flex items-center gap-2 py-4 text-base text-secondary-c">
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
                            ? 'border-blue-500/50 bg-blue-500/10 text-blue-500 dark:text-blue-300'
                            : 'border-subtle-c glass text-secondary-c hover:border-medium-c'
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
              <div className="mb-6 rounded-2xl glass p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {notifyEnabled ? <Bell className="h-5 w-5" style={{ color: 'var(--accent)' }} /> : <BellOff className="h-5 w-5 text-muted-c" />}
                    <h3 className="text-base font-bold text-primary-c">Сповіщення</h3>
                  </div>
                  <button
                    onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                    className={`relative h-7 w-12 rounded-full transition-colors ${notifyEnabled ? 'bg-blue-500' : 'bg-black/10 dark:bg-white/10'}`}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${notifyEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {notifyEnabled && (
                  <div>
                    <p className="mb-2 text-sm text-secondary-c">Попередити за:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[30, 60].map((mins) => (
                        <button
                          key={mins}
                          onClick={() => { setNotifyMinutes(mins); hapticImpact('light'); }}
                          className={`rounded-xl border-2 px-4 py-3 text-center text-base font-semibold transition-all ${
                            notifyMinutes === mins
                              ? 'border-blue-500/50 bg-blue-500/10 text-blue-500 dark:text-blue-300'
                              : 'border-subtle-c glass text-secondary-c hover:border-medium-c'
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
              className="w-full rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 px-4 py-4 text-center text-lg font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
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
