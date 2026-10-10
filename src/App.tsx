import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getKyivTime, type KyivTime } from '@/lib/time';
import {
  getTelegramStartScreen, getTelegramUser, getTelegramWebApp, hapticImpact,
  hapticNotification, initTelegramWebApp, setTelegramThemeColors,
} from '@/lib/telegram';
import {
  fetchCities, fetchOblasts, fetchTodaySchedule, fetchTomorrowSchedule,
  type City, type CitySchedule, type Oblast, type Slot,
} from '@/lib/yasno-api';
import { ALL_GROUPS } from '@/lib/schedule';
import { filterCities } from '@/lib/search';
import {
  getInitialDensity, getInitialDesignStyle, getInitialThemeMode,
  type Density, type DesignStyle, type ThemeMode,
} from '@/lib/appearance';
import type { DayTab, View } from '@/types';
import AdminView from '@/components/AdminView';
import AppHeader from '@/components/AppHeader';
import Aurora from '@/components/Aurora';
import ChangeHistory from '@/components/ChangeHistory';
import GuidedTour from '@/components/GuidedTour';
import Onboarding from '@/components/Onboarding';
import ScheduleView from '@/components/ScheduleView';
import SettingsView from '@/components/SettingsView';

function App() {
  const [view, setView] = useState<View>('schedule');
  const [dayTab, setDayTab] = useState<DayTab>(() => {
    if (typeof window !== 'undefined') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab === 'tomorrow') return 'tomorrow';
    }
    return 'today';
  });
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<KyivTime>(getKyivTime());
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [density, setDensity] = useState<Density>(getInitialDensity);
  const [designStyle, setDesignStyle] = useState<DesignStyle>(getInitialDesignStyle);
  const [onboarded, setOnboarded] = useState<boolean>(() => localStorage.getItem('onboarded') === '1');
  const [tourDone, setTourDone] = useState<boolean>(() => localStorage.getItem('tourDone') === '1');
  const [tourOpen, setTourOpen] = useState(false);
  const [prefsChecked, setPrefsChecked] = useState(() => !getTelegramUser());
  const [obStep, setObStep] = useState(0);

  const [oblasts, setOblasts] = useState<Oblast[]>([]);
  const [selectedOblast, setSelectedOblast] = useState<Oblast | null>(() => {
    try {
      const s = localStorage.getItem('selectedOblast');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [cities, setCities] = useState<City[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<City | null>(() => {
    try {
      const s = localStorage.getItem('selectedCity');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [selectedGroup, setSelectedGroup] = useState<string>(() => {
    return localStorage.getItem('selectedGroup') ?? '';
  });
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [todaySchedule, setTodaySchedule] = useState<CitySchedule | null>(null);
  const [tomorrowSchedule, setTomorrowSchedule] = useState<CitySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [citySearchSettings, setCitySearchSettings] = useState('');

  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() => {
    const s = localStorage.getItem('notifyEnabled');
    return s !== null ? s === '1' : true;
  });
  const [notifyMinutes, setNotifyMinutes] = useState<number>(() => {
    const s = localStorage.getItem('notifyMinutes');
    return s ? Number(s) || 60 : 60;
  });
  const [saved, setSaved] = useState(false);

  // Second location ("work") — optional, configured in settings only.
  const [altOblast, setAltOblast] = useState<Oblast | null>(() => {
    try {
      const s = localStorage.getItem('altOblast');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [altCity, setAltCity] = useState<City | null>(() => {
    try {
      const s = localStorage.getItem('altCity');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [altGroup, setAltGroup] = useState(() => localStorage.getItem('altGroup') ?? '');
  const [altLabel, setAltLabel] = useState(() => localStorage.getItem('altLabel') ?? '');
  const [homeLabel, setHomeLabel] = useState(() => localStorage.getItem('homeLabel') ?? '');
  const [activeLocation, setActiveLocation] = useState<'home' | 'work'>(() => {
    const s = localStorage.getItem('activeLocation');
    return s === 'work' ? 'work' : 'home';
  });
  const [altExpanded, setAltExpanded] = useState(false);
  const [homeExpanded, setHomeExpanded] = useState(false);
  const [homeConfigured, setHomeConfigured] = useState(() => {
    return Boolean(localStorage.getItem('selectedCity') && localStorage.getItem('selectedGroup'));
  });
  const [altOblastList, setAltOblastList] = useState<Oblast[]>(oblasts);
  const [altCities, setAltCities] = useState<City[]>([]);
  const [altCitiesLoading, setAltCitiesLoading] = useState(false);
  const [altCitySearch, setAltCitySearch] = useState('');

  const tgUser = useMemo(() => getTelegramUser(), []);
  const isAdmin = tgUser?.id === 87003816;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedCityKeyRef = useRef<string>('');
  const homeBackupRef = useRef<{ oblast: Oblast | null; city: City | null; group: string } | null>(null);
  // True once the user picks anything themselves; the saved-settings restore
  // must never overwrite a choice the user just made.
  const hasSelectionRef = useRef(false);
  hasSelectionRef.current = Boolean(selectedOblast || selectedCity || selectedGroup);

  // Immediate localStorage persistence: guarantees 0ms restore on reopen
  useEffect(() => {
    if (selectedOblast) localStorage.setItem('selectedOblast', JSON.stringify(selectedOblast));
    else localStorage.removeItem('selectedOblast');
  }, [selectedOblast]);

  useEffect(() => {
    if (selectedCity) localStorage.setItem('selectedCity', JSON.stringify(selectedCity));
    else localStorage.removeItem('selectedCity');
  }, [selectedCity]);

  useEffect(() => {
    if (selectedGroup) localStorage.setItem('selectedGroup', selectedGroup);
    else localStorage.removeItem('selectedGroup');
  }, [selectedGroup]);

  useEffect(() => {
    if (altOblast) localStorage.setItem('altOblast', JSON.stringify(altOblast));
    else localStorage.removeItem('altOblast');
  }, [altOblast]);

  useEffect(() => {
    if (altCity) localStorage.setItem('altCity', JSON.stringify(altCity));
    else localStorage.removeItem('altCity');
  }, [altCity]);

  useEffect(() => {
    if (altGroup) localStorage.setItem('altGroup', altGroup);
    else localStorage.removeItem('altGroup');
  }, [altGroup]);

  useEffect(() => {
    if (altLabel) localStorage.setItem('altLabel', altLabel);
    else localStorage.removeItem('altLabel');
  }, [altLabel]);

  useEffect(() => {
    if (homeLabel) localStorage.setItem('homeLabel', homeLabel);
    else localStorage.removeItem('homeLabel');
  }, [homeLabel]);

  useEffect(() => {
    localStorage.setItem('activeLocation', activeLocation);
  }, [activeLocation]);

  useEffect(() => {
    localStorage.setItem('notifyEnabled', notifyEnabled ? '1' : '0');
  }, [notifyEnabled]);

  useEffect(() => {
    localStorage.setItem('notifyMinutes', String(notifyMinutes));
  }, [notifyMinutes]);

  // Red dot on the history button: set when the latest change for this city is
  // newer than the last time the user opened the changes tab.
  const [unseenChanges, setUnseenChanges] = useState(false);
  const lastSeenChangeRef = useRef<string>('');

  // Deep link from the bot's "schedule updated" notification: the button opens
  // the mini app with ?screen=changes, landing the user straight on the change
  // history once their city is restored.
  const [pendingView, setPendingView] = useState<View | null>(() => {
    const screen = getTelegramStartScreen();
    return screen === 'changes' ? 'changes' : null;
  });

  useEffect(() => {
    if (!selectedOblast || !selectedCity) return;
    let cancelled = false;
    const fetchState = () => {
      supabase
        .from('schedule_check_state')
        .select('last_change_at')
        .eq('oblast_slug', selectedOblast.slug)
        .eq('city_slug', selectedCity.slug)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          const latest = (data as { last_change_at: string | null } | null)?.last_change_at ?? '';
          setUnseenChanges(Boolean(latest) && latest > (lastSeenChangeRef.current ?? ''));
        });
    };
    fetchState();
    const interval = setInterval(fetchState, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedOblast, selectedCity]);

  // Opening the changes tab marks everything as seen — server-side so it
  // travels with the user's Telegram account across devices/sessions.
  useEffect(() => {
    if (view !== 'changes') return;
    const ts = new Date().toISOString();
    lastSeenChangeRef.current = ts;
    setUnseenChanges(false);
    const tg = getTelegramWebApp();
    if (tg?.initData) {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          initData: tg.initData,
          markChangesSeen: true,
          patch: {
            oblast_slug: selectedOblast?.slug ?? '',
            city_slug: selectedCity?.slug ?? '',
          },
        }),
      }).catch(() => { /* best-effort */ });
    }
  }, [view, selectedOblast, selectedCity]);

  // Show the guided tour once, right after onboarding lands on the main screen.
  useEffect(() => {
    if (onboarded && !tourDone) {
      const t = setTimeout(() => setTourOpen(true), 700);
      return () => clearTimeout(t);
    }
  }, [onboarded, tourDone]);

  const finishTour = () => {
    setTourOpen(false);
    setTourDone(true);
    localStorage.setItem('tourDone', '1');
  };

  // Apply the deep-linked screen once onboarding state is resolved and the
  // city is restored — the changes view needs oblast + city to render.
  useEffect(() => {
    if (!pendingView || !onboarded || !prefsChecked || !selectedOblast || !selectedCity) return;
    setView(pendingView);
    setPendingView(null);
  }, [pendingView, onboarded, prefsChecked, selectedOblast, selectedCity]);

  useEffect(() => { initTelegramWebApp(); }, []);

  // Theme is always one of light/dark; default is light.
  const resolvedTheme: 'light' | 'dark' = themeMode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    setTelegramThemeColors(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => { localStorage.setItem('themeMode', themeMode); }, [themeMode]);
  useEffect(() => { localStorage.setItem('density', density); }, [density]);
  useEffect(() => { localStorage.setItem('designStyle', designStyle); }, [designStyle]);

  // Notification settings are shared with the Telegram bot: refresh them
  // whenever the user opens the settings screen so bot-side edits show up.
  // Goes through the user-prefs edge function, which verifies the Telegram
  // initData signature server-side before returning anything.
  useEffect(() => {
    if (view !== 'settings' || !tgUser) return;
    const tg = getTelegramWebApp();
    if (!tg?.initData) return;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json() as { prefs?: { notify_enabled: boolean; notify_minutes_before: number } | null };
        if (json.prefs) {
          setNotifyEnabled(json.prefs.notify_enabled);
          setNotifyMinutes(json.prefs.notify_minutes_before);
        }
      })
      .catch(() => { /* settings stay local */ });
  }, [view, tgUser]);

  // Sync alt oblast list once the catalog loads.
  useEffect(() => { if (oblasts.length > 0) setAltOblastList(oblasts); }, [oblasts]);

  // Load cities for the alt location when its oblast changes.
  useEffect(() => {
    if (!altOblast) { setAltCities([]); return; }
    setAltCitiesLoading(true);
    fetchCities(altOblast.slug)
      .then((data) => setAltCities(data))
      .catch(() => setAltCities([]))
      .finally(() => setAltCitiesLoading(false));
  }, [altOblast]);

  // Save the alt location + active location whenever they change (debounced).
  useEffect(() => {
    if (!tgUser) return;
    const tg = getTelegramWebApp();
    if (!tg?.initData) return;
    const timer = setTimeout(async () => {
      const patch: Record<string, unknown> = { active_location: activeLocation, home_label: homeLabel.trim() || null };
      if (altOblast && altCity && altGroup) {
        patch.alt_oblast_slug = altOblast.slug;
        patch.alt_city_slug = altCity.slug;
        patch.alt_city_name = altCity.name;
        patch.alt_queue_group = altGroup;
        patch.alt_label = altLabel.trim() || null;
      }
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ initData: tg.initData, patch }),
        });
      } catch { /* best-effort */ }
    }, 1200);
    return () => clearTimeout(timer);
  }, [tgUser, altOblast, altCity, altGroup, altLabel, homeLabel, activeLocation]);

  // Switching location swaps the displayed city/queue from the stored pairs.
  const switchLocation = (target: 'home' | 'work') => {
    if (target === activeLocation) return;
    if (target === 'work' && !(altOblast && altCity && altGroup)) return;
    hapticImpact('medium');
    if (target === 'work') {
      homeBackupRef.current = { oblast: selectedOblast, city: selectedCity, group: selectedGroup };
      setSelectedOblast(altOblast); setSelectedCity(altCity); setSelectedGroup(altGroup);
    } else {
      const home = homeBackupRef.current;
      if (home?.oblast && home?.city) {
        setSelectedOblast(home.oblast); setSelectedCity(home.city); setSelectedGroup(home.group);
      } else {
        // Fall back to stored home prefs.
        setSelectedOblast(null); setSelectedCity(null); setSelectedGroup('');
      }
    }
    setActiveLocation(target);
  };

  useEffect(() => {
    fetchOblasts()
      .then((data) => { setOblasts(data); setLoading(false); })
      .catch(() => { setApiError('Не вдалося завантажити список областей'); setLoading(false); });
  }, []);

  // Load cities when oblast changes
  useEffect(() => {
    if (!selectedOblast) { setCities([]); return; }
    setCitiesLoading(true);
    fetchCities(selectedOblast.slug)
      .then((data) => setCities(data))
      .catch(() => setCities([]))
      .finally(() => setCitiesLoading(false));
  }, [selectedOblast]);

  // Load saved settings right away: if the user already picked a city and queue,
  // restore them and skip onboarding even when the local flag was lost.
  // The restore itself still needs the city catalog to map slugs -> names.
  useEffect(() => {
    if (!tgUser || oblasts.length === 0) return;
    const tg = getTelegramWebApp();
    if (!tg?.initData) { setPrefsChecked(true); return; }
    let cancelled = false;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then(async (r) => {
        if (!r.ok) { setPrefsChecked(true); return; }
        const json = await r.json() as {
          prefs?: {
            notify_enabled: boolean; notify_minutes_before: number;
            oblast_slug: string | null; city_slug: string | null; city_name: string | null; queue_group: string | null;
            last_seen_changes_at: string | null;
            alt_oblast_slug: string | null; alt_city_slug: string | null; alt_city_name: string | null; alt_queue_group: string | null;
            active_location: 'home' | 'work' | null;
            alt_label?: string | null;
            home_label?: string | null;
          } | null;
          city_seen_at?: string | null;
        };
        if (cancelled) return;
        const prefs = json.prefs;
        if (prefs) {
          setNotifyEnabled(prefs.notify_enabled);
          setNotifyMinutes(prefs.notify_minutes_before);
          // Use per-city seen timestamp if available, fall back to legacy.
          const seenAt = json.city_seen_at ?? prefs.last_seen_changes_at;
          if (seenAt) lastSeenChangeRef.current = seenAt;

          // If local selection was empty (e.g. fresh device or cleared storage), restore home location from server:
          if (!selectedCity || !selectedGroup) {
            if (prefs.oblast_slug) {
              const oblast = oblasts.find((o) => o.slug === prefs.oblast_slug) ?? { slug: prefs.oblast_slug, name: prefs.oblast_slug, available: true };
              setSelectedOblast(oblast);
            }
            if (prefs.city_slug && prefs.queue_group) {
              if (prefs.city_name) setSelectedCity({ slug: prefs.city_slug, name: prefs.city_name });
              setSelectedGroup(prefs.queue_group);
              setOnboarded(true);
              setHomeConfigured(true);
              localStorage.setItem('onboarded', '1');
            }
          }

          // Restore the second location if configured on server and missing locally:
          if (prefs.alt_oblast_slug && prefs.alt_city_slug && prefs.alt_queue_group && (!altCity || !altGroup)) {
            const altOb = oblasts.find((o) => o.slug === prefs.alt_oblast_slug) ?? { slug: prefs.alt_oblast_slug, name: prefs.alt_oblast_slug, available: true };
            setAltOblast(altOb);
            if (prefs.alt_city_name) setAltCity({ slug: prefs.alt_city_slug, name: prefs.alt_city_name });
            setAltGroup(prefs.alt_queue_group);
            setAltLabel((prefs as { alt_label?: string | null }).alt_label ?? '');
            setHomeLabel((prefs as { home_label?: string | null }).home_label ?? '');
          }
          if (prefs.active_location === 'work' && !localStorage.getItem('activeLocation')) {
            setActiveLocation('work');
          }
        }
        setPrefsChecked(true);
      })
      .catch(() => { if (!cancelled) setPrefsChecked(true); });
    return () => { cancelled = true; };
  }, [tgUser, oblasts]);

  useEffect(() => {
    if (!tgUser || !selectedOblast || !selectedCity || !selectedGroup) return;
    // While the "work" location is active, the displayed city/queue belong to
    // the alt_* columns — never overwrite the home prefs with them.
    if (activeLocation !== 'home') return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const tgW = getTelegramWebApp();
      if (!tgW?.initData) return;
      const prefKey = `${selectedOblast.slug}|${selectedCity.slug}|${selectedGroup}`;
      try {
        // Check stored prefs via the authenticated edge function to compare
        // against current selection before saving.
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ initData: tgW.initData }),
        });
        if (!r.ok) return;
        const json = await r.json() as {
          prefs?: { oblast_slug: string | null; city_slug: string | null; queue_group: string | null } | null;
        };
        const stored = json.prefs;
        const storedKey = stored
          ? `${stored.oblast_slug ?? ''}|${stored.city_slug ?? ''}|${stored.queue_group ?? ''}`
          : '';
        const changed = storedKey !== prefKey;
        if (changed) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({
              initData: tgW.initData,
              patch: {
                oblast_slug: selectedOblast.slug,
                city_slug: selectedCity.slug,
                city_name: selectedCity.name,
                queue_group: selectedGroup,
                notify_enabled: notifyEnabled,
                notify_minutes_before: notifyMinutes,
              },
            }),
          });
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-bot`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              action: 'prefs_saved',
              initData: tgW.initData,
              city: selectedCity.name,
              queue: selectedGroup,
            }),
          });
          setSaved(true); hapticNotification('success');
          setTimeout(() => setSaved(false), 2000);
        }
      } catch { /* best-effort */ }
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [tgUser, selectedOblast, selectedCity, selectedGroup, notifyEnabled, notifyMinutes]);

  useEffect(() => {
    if (!selectedOblast || !selectedCity) return;
    const key = `${selectedOblast.slug}/${selectedCity.slug}`;
    const isFirstLoad = loadedCityKeyRef.current !== key;
    loadedCityKeyRef.current = key;
    if (isFirstLoad) setScheduleLoading(true);
    setApiError(null);
    Promise.all([
      fetchTodaySchedule(selectedOblast.slug, selectedCity.slug),
      fetchTomorrowSchedule(selectedOblast.slug, selectedCity.slug),
    ])
      .then(([today, tomorrow]) => {
        setTodaySchedule(today); setTomorrowSchedule(tomorrow);
        const groups = today.schedules.map((s) => s.queue).sort();
        setAvailableGroups(groups.length > 0 ? groups : ALL_GROUPS);
      })
      .catch(() => { if (isFirstLoad) setApiError('Не вдалося завантажити графік. Спробуйте пізніше.'); })
      .finally(() => { if (isFirstLoad) setScheduleLoading(false); });
  }, [selectedOblast, selectedCity, refreshTick]);

  // Auto-refresh schedules every 30 minutes (silent, without loader)
  useEffect(() => {
    const interval = setInterval(() => setRefreshTick((t) => t + 1), 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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

  const tomorrowSlots = useMemo<Slot[]>(() => {
    if (!tomorrowSchedule || !selectedGroup) return [];
    return tomorrowSchedule.schedules.find((s) => s.queue === selectedGroup)?.slots ?? [];
  }, [tomorrowSchedule, selectedGroup]);
  const filteredSettingsCities = useMemo(() => filterCities(cities, citySearchSettings), [cities, citySearchSettings]);

  const filteredAltCities = useMemo(() => filterCities(altCities, altCitySearch), [altCities, altCitySearch]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-primary-c">
      <div className="text-center">
        <Loader2 className="mx-auto h-9 w-9 animate-spin accent-c" />
        <p className="mt-2 text-sm text-secondary-c">Завантаження...</p>
      </div>
    </div>
  );

  if (!prefsChecked) return (
    <div className="flex min-h-screen items-center justify-center bg-primary-c">
      <div className="text-center">
        <Loader2 className="mx-auto h-9 w-9 animate-spin accent-c" />
        <p className="mt-2 text-sm text-secondary-c">Завантаження...</p>
      </div>
    </div>
  );

  if (!onboarded) {
    return (
      <div className={`design-${designStyle}`}>
        <Onboarding
          step={obStep} setStep={setObStep}
          oblasts={oblasts}
          selectedOblast={selectedOblast} setSelectedOblast={setSelectedOblast}
          cities={cities}
          selectedCity={selectedCity} setSelectedCity={setSelectedCity}
          selectedGroup={selectedGroup} setSelectedGroup={setSelectedGroup}
          scheduleLoading={scheduleLoading} citiesLoading={citiesLoading} availableGroups={availableGroups}
          tgUser={tgUser}
          notifyEnabled={notifyEnabled} setNotifyEnabled={setNotifyEnabled}
          notifyMinutes={notifyMinutes} setNotifyMinutes={setNotifyMinutes}
          onFinish={() => {
            if (selectedOblast) localStorage.setItem('selectedOblast', JSON.stringify(selectedOblast));
            if (selectedCity) localStorage.setItem('selectedCity', JSON.stringify(selectedCity));
            if (selectedGroup) localStorage.setItem('selectedGroup', selectedGroup);
            localStorage.setItem('onboarded', '1');
            setOnboarded(true);
            setHomeConfigured(true);
            setView('schedule');
          }}
        />
      </div>
    );
  }
  const handleResetAll = () => {
    const tg = getTelegramWebApp();
    if (tg?.initData) {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-prefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ initData: tg.initData, resetAll: true }),
      }).catch(() => { /* best-effort */ });
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'reset_all', initData: tg.initData }),
      }).catch(() => { /* best-effort */ });
    }
    localStorage.removeItem('onboarded');
    localStorage.removeItem('tourDone');
    localStorage.removeItem('selectedOblast');
    localStorage.removeItem('selectedCity');
    localStorage.removeItem('selectedGroup');
    localStorage.removeItem('altOblast');
    localStorage.removeItem('altCity');
    localStorage.removeItem('altGroup');
    localStorage.removeItem('altLabel');
    localStorage.removeItem('homeLabel');
    localStorage.removeItem('activeLocation');
    loadedCityKeyRef.current = '';
    homeBackupRef.current = null;
    hasSelectionRef.current = false;
    setHomeExpanded(false);
    setHomeConfigured(false);
    setAltExpanded(false);
    setAltOblast(null); setAltCity(null); setAltGroup(''); setAltLabel(''); setHomeLabel('');
    setActiveLocation('home');
    setSelectedOblast(null); setSelectedCity(null); setSelectedGroup('');
    setTodaySchedule(null); setTomorrowSchedule(null);
    setCities([]); setCitySearchSettings('');
    setTourDone(false);
    setObStep(0); setOnboarded(false);
    hapticNotification('warning');
  };

return (
  <div className={`design-${designStyle} min-h-screen bg-primary-c`} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
    <Aurora />
    <div className="relative z-10 mx-auto max-w-lg px-4 py-4 sm:px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>

      <AppHeader
        view={view}
        onBackToSchedule={() => setView('schedule')}
        onOpenCitySettings={() => setView('settings')}
        selectedCity={selectedCity}
        selectedGroup={selectedGroup}
        themeMode={themeMode}
        onToggleTheme={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
        density={density}
        onDensityChange={(d) => setDensity(d)}
        unseenChanges={unseenChanges}
        isAdmin={isAdmin}
        onOpenChanges={() => setView('changes')}
        onOpenAdmin={() => setView('admin')}
        onOpenSettings={() => setView('settings')}
      />

      {view === 'schedule' && (
        <ScheduleView
          now={now}
          dayTab={dayTab}
          setDayTab={setDayTab}
          saved={saved}
          apiError={apiError}
          selectedCity={selectedCity}
          selectedGroup={selectedGroup}
          setView={setView}
          scheduleLoading={scheduleLoading}
          density={density}
          todaySlots={todaySlots}
          tomorrowSlots={tomorrowSlots}
          displaySlots={displaySlots}
          displaySchedule={displaySchedule}
          altOblast={altOblast}
          altCity={altCity}
          altGroup={altGroup}
          switchLocation={switchLocation}
          activeLocation={activeLocation}
          homeLabel={homeLabel}
          altLabel={altLabel}
        />
      )}

      {view === 'changes' && selectedOblast && selectedCity && (
        <div className="fade-in">
          <p className="mb-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-c">
            <RefreshCw className="h-3 w-3" />
            <span>Стежимо за графіком · {selectedCity.name}</span>
          </p>
          <ChangeHistory oblastSlug={selectedOblast.slug} citySlug={selectedCity.slug} />
          <button
            onClick={() => { setView('schedule'); hapticImpact('light'); }}
            className="d-btn mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-secondary-c transition-all hover:scale-[1.01]"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> До графіка
          </button>
        </div>
      )}

      {view === 'admin' && isAdmin && (
        <AdminView initData={getTelegramWebApp()?.initData ?? ''} onBack={() => setView('schedule')} />
      )}

      {view === 'settings' && (
        <SettingsView
          saved={saved}
          themeMode={themeMode} setThemeMode={setThemeMode}
          designStyle={designStyle} setDesignStyle={setDesignStyle}
          altOblast={altOblast} setAltOblast={setAltOblast}
          altCity={altCity} setAltCity={setAltCity}
          altGroup={altGroup} setAltGroup={setAltGroup}
          altLabel={altLabel} setAltLabel={setAltLabel}
          altExpanded={altExpanded} setAltExpanded={setAltExpanded}
          setActiveLocation={setActiveLocation}
          altOblastList={altOblastList}
          altCities={altCities} altCitiesLoading={altCitiesLoading}
          altCitySearch={altCitySearch} setAltCitySearch={setAltCitySearch}
          filteredAltCities={filteredAltCities}
          homeExpanded={homeExpanded} setHomeExpanded={setHomeExpanded}
          homeConfigured={homeConfigured} setHomeConfigured={setHomeConfigured}
          homeLabel={homeLabel} setHomeLabel={setHomeLabel}
          selectedOblast={selectedOblast} setSelectedOblast={setSelectedOblast}
          selectedCity={selectedCity} setSelectedCity={setSelectedCity}
          selectedGroup={selectedGroup} setSelectedGroup={setSelectedGroup}
          oblasts={oblasts} cities={cities}
          citySearchSettings={citySearchSettings} setCitySearchSettings={setCitySearchSettings}
          filteredSettingsCities={filteredSettingsCities}
          setTodaySchedule={setTodaySchedule} setTomorrowSchedule={setTomorrowSchedule}
          notifyEnabled={notifyEnabled} setNotifyEnabled={setNotifyEnabled}
          notifyMinutes={notifyMinutes} setNotifyMinutes={setNotifyMinutes}
          tgUser={tgUser}
          setView={setView}
          onResetAll={handleResetAll}
          citiesLoading={citiesLoading}
          scheduleLoading={scheduleLoading}
          availableGroups={availableGroups}
        />
      )}

      {tourOpen && <GuidedTour onDone={finishTour} onSkip={finishTour} goToView={(v) => { setView(v); hapticImpact('light'); }} />}
    </div>
  </div>
);
}

export default App;
