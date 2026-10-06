import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Zap,
  ZapOff,
  AlertTriangle,
  MapPin,
  Clock,
  Search,
  CalendarDays,
  Loader2,
  CheckCircle2,
  XCircle,
  Sun,
  Moon,
  Bell,
  BellOff,
  ChevronLeft,
  Radio,
  Home,
  Building2,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { supabase, type UserPreferences } from '@/lib/supabase';
import { getKyivTime, type KyivTime } from '@/lib/time';
import {
  initTelegramWebApp,
  getTelegramUser,
  hapticImpact,
  hapticNotification,
} from '@/lib/telegram';
import {
  fetchRegions,
  fetchPlannedOutages,
  fetchProbableOutages,
  fetchStreets,
  fetchHouses,
  fetchGroupByAddress,
  minutesToTime,
  type YasnoRegion,
  type YasnoSlot,
  type YasnoPlannedOutages,
  type YasnoProbableOutages,
} from '@/lib/yasno-api';

const DAY_LABELS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

function slotToHM(slot: YasnoSlot): { start: string; end: string } {
  return {
    start: minutesToTime(slot.start),
    end: minutesToTime(slot.end),
  };
}

function isSlotActive(slot: YasnoSlot, now: KyivTime): boolean {
  const currentMin = now.hours * 60 + now.minutes;
  return currentMin >= slot.start && currentMin < slot.end;
}

function getNextSlot(slots: YasnoSlot[], now: KyivTime): YasnoSlot | null {
  const currentMin = now.hours * 60 + now.minutes;
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  return sorted.find((s) => s.start > currentMin) ?? null;
}

function getCurrentSlot(slots: YasnoSlot[], now: KyivTime): YasnoSlot | null {
  return slots.find((s) => isSlotActive(s, now)) ?? null;
}

// ─── Status Card ──────────────────────────────────────────────
function StatusCard({ slots, now, status }: { slots: YasnoSlot[]; now: KyivTime; status: string | null }) {
  const current = getCurrentSlot(slots, now);
  const next = getNextSlot(slots, now);

  // Check system status (NoOutages, ScheduleApplies, WaitingForSchedule, EmergencyShutdowns)
  if (status === "NoOutages") {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 p-5 sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20">
            <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">Без відключень</p>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">Світло є</h2>
            <p className="mt-0.5 text-sm text-gray-400">Графік не застосовується</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "EmergencyShutdowns") {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-500/20 to-red-600/5 p-5 sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-500/20">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-red-400">Аварійні відключення</p>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">Непередбачувано</h2>
            <p className="mt-0.5 text-sm text-gray-400">Графік може не враховуватися</p>
          </div>
        </div>
      </div>
    );
  }

  if (current && current.type === "Definite") {
    const hm = slotToHM(current);
    return (
      <div className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-500/20 to-red-600/5 p-5 sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-500/20">
            <ZapOff className="h-7 w-7 text-red-400" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-red-400">Світла немає</p>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">Відключення</h2>
            <p className="mt-0.5 text-sm text-gray-400">{hm.start} — {hm.end}</p>
          </div>
        </div>
        {next && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-gray-300">
            <Clock className="h-4 w-4 text-gray-400" />
            Наступне вмикання о <span className="font-semibold text-white">{minutesToTime(next.start)}</span>
          </div>
        )}
      </div>
    );
  }

  if (current && current.type === "NotPlanned") {
    const hm = slotToHM(current);
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 p-5 sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20">
            <Zap className="h-7 w-7 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">Живлення є</p>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">Має бути світло</h2>
            <p className="mt-0.5 text-sm text-gray-400">{hm.start} — {hm.end}</p>
          </div>
        </div>
        {next && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-gray-300">
            <Clock className="h-4 w-4 text-gray-400" />
            Наступне відключення о <span className="font-semibold text-white">{minutesToTime(next.start)}</span>
          </div>
        )}
      </div>
    );
  }

  // No current slot — light should be on
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 p-5 sm:p-7">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20">
          <Zap className="h-7 w-7 text-emerald-400" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">Живлення є</p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Світло вімкнене</h2>
          <p className="mt-0.5 text-sm text-gray-400">Поза графіком відключень</p>
        </div>
      </div>
      {next && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-gray-300">
          <Clock className="h-4 w-4 text-gray-400" />
          Наступне відключення о <span className="font-semibold text-white">{minutesToTime(next.start)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Day Schedule Card ────────────────────────────────────────
function DaySchedule({
  slots,
  dayLabel,
  isToday,
  now,
}: {
  slots: YasnoSlot[];
  dayLabel: string;
  isToday: boolean;
  now: KyivTime;
}) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`font-semibold ${isToday ? 'text-white' : 'text-gray-400'}`}>
          {dayLabel}
          {isToday && (
            <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300">
              Сьогодні
            </span>
          )}
        </h3>
      </div>
      {sorted.length === 0 ? (
        <p className="py-3 text-center text-sm text-gray-500">Відключень не заплановано</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((slot, i) => {
            const hm = slotToHM(slot);
            const isActive = isToday && isSlotActive(slot, now);
            const isDefinite = slot.type === 'Definite';
            const colorClass = isDefinite
              ? 'bg-red-500/15 border-red-500/30 text-red-300'
              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
            const dotClass = isDefinite ? 'bg-red-500' : 'bg-emerald-500';
            return (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all ${colorClass} ${
                  isActive ? 'ring-2 ring-white/20' : ''
                }`}
              >
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass} ${isActive ? 'animate-pulse' : ''}`} />
                <div className="flex flex-1 items-center justify-between">
                  <span className="text-sm font-medium text-white">{hm.start} — {hm.end}</span>
                  <span className={`text-xs font-medium ${isDefinite ? 'text-red-300' : 'text-emerald-300'}`}>
                    {isDefinite ? 'Відключення' : 'Світло'}
                  </span>
                </div>
                {isActive && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white">зараз</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
type View = 'schedule' | 'settings';

function App() {
  const [view, setView] = useState<View>('schedule');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<KyivTime>(getKyivTime());

  // Yasno data
  const [regions, setRegions] = useState<YasnoRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<YasnoRegion | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<{ id: number; name: string } | null>(null);
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [plannedData, setPlannedData] = useState<YasnoPlannedOutages | null>(null);
  const [probableData, setProbableData] = useState<YasnoProbableOutages | null>(null);
  const [plannedLoading, setPlannedLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Address lookup
  const [streetQuery, setStreetQuery] = useState('');
  const [streets, setStreets] = useState<{ id: number; name: string }[]>([]);
  const [selectedStreet, setSelectedStreet] = useState<{ id: number; name: string } | null>(null);
  const [houseQuery, setHouseQuery] = useState('');
  const [houses, setHouses] = useState<{ id: number; name: string }[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<{ id: number; name: string } | null>(null);
  const [searchingStreet, setSearchingStreet] = useState(false);
  const [searchingHouse, setSearchingHouse] = useState(false);

  // Notifications
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyMinutes, setNotifyMinutes] = useState(60);
  const [saved, setSaved] = useState(false);

  const tgUser = useMemo(() => getTelegramUser(), []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initTelegramWebApp();
  }, []);

  // Load regions from Yasno API
  useEffect(() => {
    fetchRegions()
      .then((data) => {
        setRegions(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load regions:', err);
        setApiError('Не вдалося завантажити регіони');
        setLoading(false);
      });
  }, []);

  // Load saved preferences
  useEffect(() => {
    if (!tgUser) return;
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
          if (prefs.yasno_region_id != null && prefs.yasno_dso_id != null) {
            const region = regions.find((r) => r.id === prefs.yasno_region_id);
            if (region) {
              setSelectedRegion(region);
              const provider = region.dsos.find((d) => d.id === prefs.yasno_dso_id);
              if (provider) setSelectedProvider({ id: provider.id, name: provider.name });
              if (prefs.yasno_group) setSelectedGroup(prefs.yasno_group);
            }
          }
        }
      });
  }, [tgUser, regions]);

  // Auto-save preferences
  useEffect(() => {
    if (!tgUser || !selectedRegion || !selectedProvider) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await supabase.from('user_preferences').upsert(
        {
          tg_user_id: tgUser.id,
          tg_username: tgUser.username ?? null,
          yasno_region_id: selectedRegion.id,
          yasno_dso_id: selectedProvider.id,
          yasno_group: selectedGroup || null,
          notify_enabled: notifyEnabled,
          notify_minutes_before: notifyMinutes,
          street_name: selectedStreet?.name ?? null,
          house_name: selectedHouse?.name ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tg_user_id' },
      );
      setSaved(true);
      hapticNotification('success');
      setTimeout(() => setSaved(false), 2000);
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [tgUser, selectedRegion, selectedProvider, selectedGroup, notifyEnabled, notifyMinutes, selectedStreet, selectedHouse]);

  // Fetch outage data when region/provider/group changes
  useEffect(() => {
    if (!selectedRegion || !selectedProvider || !selectedGroup) return;
    setPlannedLoading(true);
    setApiError(null);
    Promise.all([
      fetchPlannedOutages(selectedRegion.id, selectedProvider.id),
      fetchProbableOutages(selectedRegion.id, selectedProvider.id),
    ])
      .then(([planned, probable]) => {
        setPlannedData(planned);
        setProbableData(probable);
        // Extract available groups from planned data
        const groups = Object.keys(planned);
        setAvailableGroups(groups.sort());
      })
      .catch((err) => {
        console.error('Failed to load outages:', err);
        setApiError('Не вдалося завантажити графік. Спробуйте пізніше.');
      })
      .finally(() => setPlannedLoading(false));
  }, [selectedRegion, selectedProvider, selectedGroup]);

  // Update clock
  useEffect(() => {
    const interval = setInterval(() => setNow(getKyivTime()), 30000);
    return () => clearInterval(interval);
  });

  // Street search
  useEffect(() => {
    if (!selectedRegion || !selectedProvider || streetQuery.length < 3) {
      setStreets([]);
      return;
    }
    setSearchingStreet(true);
    const timer = setTimeout(() => {
      fetchStreets(selectedRegion.id, selectedProvider.id, streetQuery)
        .then((data) => setStreets(data))
        .catch(() => setStreets([]))
        .finally(() => setSearchingStreet(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [streetQuery, selectedRegion, selectedProvider]);

  // House search
  useEffect(() => {
    if (!selectedStreet || houseQuery.length < 1) {
      setHouses([]);
      return;
    }
    setSearchingHouse(true);
    const timer = setTimeout(() => {
      if (!selectedRegion || !selectedProvider) return;
      fetchHouses(selectedRegion.id, selectedProvider.id, selectedStreet.id, houseQuery)
        .then((data) => setHouses(data))
        .catch(() => setHouses([]))
        .finally(() => setSearchingHouse(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [houseQuery, selectedStreet, selectedRegion, selectedProvider]);

  // Auto-detect group from address
  const detectGroup = useCallback(async () => {
    if (!selectedRegion || !selectedProvider || !selectedStreet || !selectedHouse) return;
    try {
      const result = await fetchGroupByAddress(
        selectedRegion.id,
        selectedProvider.id,
        selectedStreet.id,
        selectedHouse.id,
      );
      const groupStr = `${result.group}.${result.subgroup}`;
      setSelectedGroup(groupStr);
      hapticNotification('success');
    } catch (err) {
      console.error('Failed to detect group:', err);
      hapticNotification('error');
    }
  }, [selectedRegion, selectedProvider, selectedStreet, selectedHouse]);

  // Compute today's slots from planned data
  const todaySlots = useMemo<YasnoSlot[]>(() => {
    if (!plannedData || !selectedGroup) return [];
    const groupData = plannedData[selectedGroup];
    if (!groupData?.today?.slots) return [];
    return groupData.today.slots;
  }, [plannedData, selectedGroup]);

  const todayStatus = useMemo(() => {
    if (!plannedData || !selectedGroup) return null;
    return plannedData[selectedGroup]?.today?.status ?? null;
  }, [plannedData, selectedGroup]);

  const tomorrowSlots = useMemo<YasnoSlot[]>(() => {
    if (!plannedData || !selectedGroup) return [];
    return plannedData[selectedGroup]?.tomorrow?.slots ?? [];
  }, [plannedData, selectedGroup]);

  // Compute weekly probable schedule (7 days)
  const weeklySchedule = useMemo<YasnoSlot[][]>(() => {
    if (!probableData || !selectedRegion || !selectedProvider || !selectedGroup) {
      return [[], [], [], [], [], [], []];
    }
    const result: YasnoSlot[][] = [[], [], [], [], [], [], []];
    try {
      const regionData = probableData[String(selectedRegion.id)];
      if (!regionData) return result;
      const dsoData = regionData.dsos?.[String(selectedProvider.id)];
      if (!dsoData) return result;
      const groupData = dsoData.groups?.[selectedGroup];
      if (!groupData) return result;
      const slotsByDay = groupData.slots;
      // API uses weekday 0=Monday..6=Sunday
      // We need 0=Sunday..6=Saturday
      for (const [weekdayStr, slots] of Object.entries(slotsByDay)) {
        const apiWeekday = parseInt(weekdayStr); // 0=Mon..6=Sun
        const ourWeekday = apiWeekday === 6 ? 0 : apiWeekday + 1; // convert to 0=Sun
        result[ourWeekday] = slots;
      }
    } catch (e) {
      console.error('Failed to parse weekly schedule:', e);
    }
    return result;
  }, [probableData, selectedRegion, selectedProvider, selectedGroup]);

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
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="absolute bottom-0 -left-40 h-80 w-80 rounded-full bg-amber-500/5 blur-3xl" />
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
                  {view === 'schedule' ? 'Графік відключень' : 'Налаштування'}
                </h1>
                <p className="text-xs text-gray-400">
                  {selectedRegion?.value ?? 'Оберіть регіон'}
                  {selectedProvider ? ` · ${selectedProvider.name}` : ''}
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
            {/* Live clock */}
            <div className="mb-5 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] py-3">
              {now.hours >= 6 && now.hours < 20 ? (
                <Sun className="h-5 w-5 text-amber-400" />
              ) : (
                <Moon className="h-5 w-5 text-blue-300" />
              )}
              <span className="font-mono text-lg font-semibold tracking-wide text-white">{now.timeString}</span>
              <span className="text-sm text-gray-400">{DAY_LABELS[now.dayOfWeek].toLowerCase()}, Київ</span>
            </div>

            {/* Save indicator */}
            {saved && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Налаштування збережено
              </div>
            )}

            {/* API Error */}
            {apiError && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {apiError}
              </div>
            )}

            {/* Not configured yet */}
            {!selectedRegion || !selectedProvider || !selectedGroup ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] py-12 text-center">
                <MapPin className="mb-3 h-10 w-10 text-gray-500" />
                <p className="mb-2 text-gray-400">Оберіть регіон та групу</p>
                <button
                  onClick={() => { setView('settings'); hapticImpact('light'); }}
                  className="mt-2 rounded-xl bg-blue-500/20 px-6 py-2.5 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/30"
                >
                  Налаштувати
                </button>
              </div>
            ) : plannedLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
              </div>
            ) : (
              <>
                {/* Status card */}
                <div className="mb-5">
                  <StatusCard slots={todaySlots} now={now} status={todayStatus} />
                </div>

                {/* System status banner */}
                {todayStatus && todayStatus !== "ScheduleApplies" && (
                  <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Radio className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-300">
                        {todayStatus === "NoOutages" && "Графік відключень не застосовується — світло є за розписом"}
                        {todayStatus === "WaitingForSchedule" && "Графік на сьогодні ще не опублікований"}
                        {todayStatus === "EmergencyShutdowns" && "Аварійні відключення — графік може не дотримуватися"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Today + Tomorrow from planned data */}
                <div className="mb-5">
                  <div className="mb-3 flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-gray-400" />
                    <h2 className="text-base font-semibold text-white">Сьогодні та завтра</h2>
                  </div>
                  <div className="space-y-3">
                    <DaySchedule slots={todaySlots} dayLabel="Сьогодні" isToday={true} now={now} />
                    <DaySchedule slots={tomorrowSlots} dayLabel="Завтра" isToday={false} now={now} />
                  </div>
                </div>

                {/* Weekly probable schedule */}
                <div className="mb-5">
                  <div className="mb-3 flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-gray-400" />
                    <h2 className="text-base font-semibold text-white">Тижневий графік</h2>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-3">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500" /> Відключення
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Світло
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                      <DaySchedule
                        key={day}
                        slots={weeklySchedule[day]}
                        dayLabel={DAY_LABELS[day]}
                        isToday={day === now.dayOfWeek}
                        now={now}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Footer */}
            <footer className="mt-10 border-t border-white/5 pt-5 text-center">
              <p className="text-xs text-gray-500">
                Дані надаються API Yasno/DTEK. Графік є попереджувальним.
              </p>
              <p className="mt-2 text-xs text-gray-600">Час за київським поясом (Europe/Kyiv)</p>
            </footer>
          </>
        )}

        {/* ─── SETTINGS VIEW ─── */}
        {view === 'settings' && (
          <>
            {/* Save indicator */}
            {saved && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Налаштування збережено
              </div>
            )}

            {/* Region selection */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-medium text-gray-400">Регіон</label>
              <div className="space-y-2">
                {regions.map((region) => (
                  <button
                    key={region.id}
                    onClick={() => {
                      setSelectedRegion(region);
                      setSelectedProvider(null);
                      setSelectedGroup('');
                      setPlannedData(null);
                      setProbableData(null);
                      hapticImpact('light');
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                      selectedRegion?.id === region.id
                        ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                        : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {region.value}
                    </span>
                    <ChevronRight className={`h-4 w-4 transition-transform ${selectedRegion?.id === region.id ? 'rotate-90' : ''}`} />
                  </button>
                ))}
              </div>
            </div>

            {/* Provider selection */}
            {selectedRegion && (
              <div className="mb-5">
                <label className="mb-2 block text-sm font-medium text-gray-400">Енергопостачальник</label>
                <div className="space-y-2">
                  {selectedRegion.dsos.map((dso) => (
                    <button
                      key={dso.id}
                      onClick={() => {
                        setSelectedProvider({ id: dso.id, name: dso.name });
                        setSelectedGroup('');
                        hapticImpact('light');
                      }}
                      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                        selectedProvider?.id === dso.id
                          ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                          : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {dso.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Group selection */}
            {selectedProvider && (
              <div className="mb-5">
                <label className="mb-2 block text-sm font-medium text-gray-400">
                  Група відключення
                  {availableGroups.length === 0 && !plannedLoading && (
                    <span className="ml-2 text-xs text-gray-500">(завантажте графік, щоб побачити групи)</span>
                  )}
                </label>
                {plannedLoading ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Завантаження груп...
                  </div>
                ) : availableGroups.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {availableGroups.map((group) => (
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
                ) : (
                  <p className="py-3 text-sm text-gray-500">Групи будуть доступні після завантаження графіка</p>
                )}
              </div>
            )}

            {/* Address lookup — auto-detect group */}
            {selectedProvider && (
              <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Home className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-semibold text-white">Знайти групу за адресою</h3>
                </div>
                <p className="mb-3 text-xs text-gray-500">Введіть вулицю та номер будинку, щоб автоматично визначити групу</p>

                {/* Street search */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={streetQuery}
                    onChange={(e) => setStreetQuery(e.target.value)}
                    placeholder="Вулиця (мінімум 3 символи)..."
                    className="w-full rounded-lg bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  {searchingStreet && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
                  )}
                </div>
                {streets.length > 0 && !selectedStreet && (
                  <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-[#121829]">
                    {streets.map((street) => (
                      <button
                        key={street.id}
                        onClick={() => {
                          setSelectedStreet(street);
                          setStreets([]);
                          setStreetQuery(street.name);
                          hapticImpact('light');
                        }}
                        className="block w-full px-4 py-2.5 text-left text-sm text-gray-300 transition-colors hover:bg-white/5"
                      >
                        {street.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* House search */}
                {selectedStreet && (
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={houseQuery}
                      onChange={(e) => setHouseQuery(e.target.value)}
                      placeholder="Номер будинку..."
                      autoFocus
                      className="w-full rounded-lg bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    {searchingHouse && (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
                    )}
                  </div>
                )}
                {houses.length > 0 && !selectedHouse && (
                  <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-[#121829]">
                    {houses.map((house) => (
                      <button
                        key={house.id}
                        onClick={() => {
                          setSelectedHouse(house);
                          setHouses([]);
                          setHouseQuery(house.name);
                          hapticImpact('light');
                        }}
                        className="block w-full px-4 py-2.5 text-left text-sm text-gray-300 transition-colors hover:bg-white/5"
                      >
                        {house.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Detect button */}
                {selectedStreet && selectedHouse && (
                  <button
                    onClick={detectGroup}
                    className="w-full rounded-xl bg-blue-500/20 px-4 py-2.5 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/30"
                  >
                    Визначити групу
                  </button>
                )}
                {selectedStreet && (
                  <button
                    onClick={() => {
                      setSelectedStreet(null);
                      setSelectedHouse(null);
                      setStreetQuery('');
                      setHouseQuery('');
                      setStreets([]);
                      setHouses([]);
                    }}
                    className="mt-2 w-full text-center text-xs text-gray-500"
                  >
                    Скинути адресу
                  </button>
                )}
              </div>
            )}

            {/* Notification settings */}
            {tgUser && (
              <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {notifyEnabled ? (
                      <Bell className="h-4 w-4 text-blue-400" />
                    ) : (
                      <BellOff className="h-4 w-4 text-gray-500" />
                    )}
                    <h3 className="text-sm font-semibold text-white">Сповіщення про відключення</h3>
                  </div>
                  <button
                    onClick={() => {
                      setNotifyEnabled(!notifyEnabled);
                      hapticImpact('medium');
                    }}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      notifyEnabled ? 'bg-blue-500' : 'bg-white/10'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        notifyEnabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
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

            {/* Done button */}
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
