import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bell, BellOff, Check, CheckCircle2, Keyboard,
  Loader2, MapPin, Search, Sparkles, X, Zap,
} from 'lucide-react';
import { type City, type Oblast } from '@/lib/yasno-api';
import { getKyivTime } from '@/lib/time';
import { timeGreeting } from '@/lib/format';
import { filterCities } from '@/lib/search';
import { ALL_GROUPS } from '@/lib/schedule';
import { hapticImpact, hapticNotification } from '@/lib/telegram';
import Aurora from './Aurora';
// ── Onboarding ────────────────────────────────────────────────
function Onboarding({
  step, setStep, oblasts, selectedOblast, setSelectedOblast,
  cities, selectedCity, setSelectedCity, selectedGroup, setSelectedGroup,
  onFinish, scheduleLoading, citiesLoading, availableGroups,
  tgUser, notifyEnabled, setNotifyEnabled, notifyMinutes, setNotifyMinutes,
}: {
  step: number;
  setStep: (n: number) => void;
  oblasts: Oblast[];
  selectedOblast: Oblast | null;
  setSelectedOblast: (o: Oblast | null) => void;
  cities: City[];
  selectedCity: City | null;
  setSelectedCity: (c: City | null) => void;
  selectedGroup: string;
  setSelectedGroup: (g: string) => void;
  onFinish: () => void;
  scheduleLoading: boolean;
  citiesLoading: boolean;
  availableGroups: string[];
  tgUser: { id: number; username?: string } | null;
  notifyEnabled: boolean;
  setNotifyEnabled: (v: boolean) => void;
  notifyMinutes: number;
  setNotifyMinutes: (v: number) => void;
}) {
  const [citySearch, setCitySearch] = useState(() => selectedCity?.name ?? '');

  // Keep search input synced if selectedCity changes
  useEffect(() => {
    if (selectedCity?.name && !citySearch) {
      setCitySearch(selectedCity.name);
    }
  }, [selectedCity]);

  const filtered = useMemo(() => filterCities(cities, citySearch), [cities, citySearch]);

  const totalSteps = 5;

  return (
    <div className="relative min-h-screen bg-primary-c" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <Aurora />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-8">
        <div className="mb-6 flex justify-center gap-1.5">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 accent-bg' : i < step ? 'w-1.5 accent-bg opacity-50' : 'w-1.5 bg-black/10 dark:bg-white/15'
              }`}
            />
          ))}
        </div>

        <div className="flex flex-1 flex-col" key={step}>
          {step === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center text-center fade-in-right">
              <div className="logo-bounce mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-xl shadow-blue-500/30">
                <Zap className="h-12 w-12 text-white" />
              </div>
              <p className="mb-1 text-base text-secondary-c">{timeGreeting(getKyivTime().hours)}!</p>
              <h1 className="text-3xl font-extrabold text-primary-c">Графік світла</h1>
              <p className="mt-3 max-w-xs text-base text-secondary-c">
                Дізнавайтесь, коли буде світло у вашій черзі — швидко і просто
              </p>
              <div className="d-btn mt-6 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs text-secondary-c">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Налаштування займе менше хвилини
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-1 flex-col fade-in-right">
              <h2 className="text-2xl font-extrabold text-primary-c">Ваша область</h2>
              <p className="mb-3 mt-1 text-sm text-secondary-c">Оберіть область або місто Київ</p>
              <div className="d-panel scroll-touch space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl p-1.5" style={{ height: 'min(320px, 42vh)', WebkitOverflowScrolling: 'touch' }}>
                {oblasts.map((oblast) => (
                  <button
                    key={oblast.slug}
                    onClick={() => { setSelectedOblast(oblast); hapticImpact('light'); setStep(Math.max(step, 2)); }}
                    className={`flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                      selectedOblast?.slug === oblast.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c active:bg-black/5 dark:active:bg-white/5'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{oblast.name}</span>
                    {selectedOblast?.slug === oblast.slug && <Check className="ml-auto h-4 w-4 shrink-0" />}
                  </button>
                ))}
                {oblasts.length === 0 && <p className="py-6 text-center text-sm text-muted-c">Не вдалося завантажити</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-1 flex-col fade-in-right">
              <h2 className="text-2xl font-extrabold text-primary-c">Ваше місто</h2>
              <p className="mb-3 mt-1 text-sm text-secondary-c">Оберіть місто, щоб ми показали правильний графік</p>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-c" />
                <input
                  type="text"
                  value={citySearch}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCitySearch(val);
                    const q = val.trim().toLowerCase();
                    if (q) {
                      const exact = cities.find((c) => c.name.toLowerCase() === q);
                      if (exact && selectedCity?.slug !== exact.slug) {
                        setSelectedCity(exact);
                        setSelectedGroup('');
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filtered.length > 0) {
                        const topCity = filtered[0];
                        setSelectedCity(topCity);
                        setCitySearch(topCity.name);
                        setSelectedGroup('');
                        hapticImpact('light');
                        setStep(3);
                      }
                    }
                  }}
                  placeholder="Пошук міста..."
                  className="d-panel w-full rounded-xl py-2.5 pl-10 pr-10 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                {citySearch && (
                  <button
                    type="button"
                    onClick={() => { setCitySearch(''); setSelectedCity(null); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-c hover:text-primary-c"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Quick suggestion / автопідстановка banner */}
              {filtered.length > 0 && citySearch.trim() && (
                <div className="mb-2.5 flex items-center justify-between rounded-xl accent-soft-bg px-3 py-2 text-xs fade-in">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 accent-c" />
                    <span className="truncate text-secondary-c">
                      Підстановка: <b className="text-primary-c">{filtered[0].name}</b>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const topCity = filtered[0];
                      setSelectedCity(topCity);
                      setCitySearch(topCity.name);
                      setSelectedGroup('');
                      hapticImpact('light');
                      setStep(3);
                    }}
                    className="ml-2 shrink-0 rounded-lg accent-bg px-2.5 py-1 text-[11px] font-bold text-white shadow-sm hover:scale-105 active:scale-95 transition-all"
                  >
                    Обрати ↵
                  </button>
                </div>
              )}

              <div className="mb-3 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(10,132,255,0.08)' }}>
                <Keyboard className="mt-0.5 h-4 w-4 shrink-0 accent-c" />
                <p className="text-xs leading-relaxed text-secondary-c">
                  <b className="text-primary-c">Введіть перші букви</b> — місто підставиться автоматично. Натисніть <b>Enter</b> або оберіть зі списку.
                </p>
              </div>
              <div className="d-panel scroll-touch space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl p-1.5" style={{ height: 'min(320px, 42vh)', WebkitOverflowScrolling: 'touch' }}>
                {citiesLoading ? (
                  <div className="flex items-center justify-center py-8 text-secondary-c">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження міст...
                  </div>
                ) : (
                  <>
                    {filtered.map((city) => (
                      <button
                        key={city.slug}
                        onClick={() => {
                          setSelectedCity(city);
                          setCitySearch(city.name);
                          setSelectedGroup('');
                          hapticImpact('light');
                        }}
                        className={`flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                          selectedCity?.slug === city.slug ? 'accent-soft-bg font-semibold accent-c' : 'text-secondary-c active:bg-black/5 dark:active:bg-white/5'
                        }`}
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{city.name}</span>
                        {selectedCity?.slug === city.slug && <Check className="ml-auto h-4 w-4 shrink-0" />}
                      </button>
                    ))}
                    {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted-c">Не знайдено</p>}
                  </>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-1 flex-col fade-in-right">
              <h2 className="text-2xl font-extrabold text-primary-c">Ваша черга</h2>
              <p className="mb-4 mt-1 text-sm text-secondary-c">Черга вказана у вашому рахунку за електроенергію</p>
              {scheduleLoading ? (
                <div className="flex flex-1 items-center justify-center text-secondary-c">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Завантаження черг...
                </div>
              ) : (
                <div className="grid flex-1 grid-cols-4 content-start gap-2">
                  {(availableGroups.length > 0 ? availableGroups : ALL_GROUPS).map((group) => (
                    <button
                      key={group}
                      onClick={() => { setSelectedGroup(group); hapticImpact('light'); }}
                      className={`rounded-2xl px-2 py-4 text-center text-base font-bold transition-all ${
                        selectedGroup === group ? 'accent-soft-bg accent-c ring-2 ring-blue-500/40' : 'd-btn text-secondary-c hover:scale-105'
                      }`}
                    >{group}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-1 flex-col items-center justify-center text-center fade-in-right">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl accent-soft-bg">
                <Bell className="h-12 w-12 accent-c" />
              </div>
              <h2 className="text-2xl font-extrabold text-primary-c">Сповіщення</h2>
              <p className="mt-2 max-w-xs text-sm text-secondary-c">
                Хочете отримувати повідомлення про відключення світла і за скільки хвилин попереджати?
              </p>
              {tgUser && (
                <div className="d-card mt-5 w-full px-3.5 py-3 text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {notifyEnabled ? <Bell className="h-3.5 w-3.5 accent-c" /> : <BellOff className="h-3.5 w-3.5 text-muted-c" />}
                      <h3 className="text-xs font-bold text-primary-c">Сповіщення</h3>
                    </div>
                    <button
                      onClick={() => { setNotifyEnabled(!notifyEnabled); hapticImpact('medium'); }}
                      style={{ width: 38, height: 20, padding: 0, border: 'none', flexShrink: 0 }}
                      className={`relative inline-block rounded-full transition-colors ${notifyEnabled ? 'accent-bg' : 'bg-black/10 dark:bg-white/10'}`}
                      aria-label="Сповіщення"
                    >
                      <span
                        style={{
                          position: 'absolute', left: 2, top: 2, width: 16, height: 16,
                          transform: notifyEnabled ? 'translateX(18px)' : 'translateX(0px)',
                        }}
                        className="block rounded-full bg-white shadow-sm transition-transform duration-200"
                      />
                    </button>
                  </div>
                  {notifyEnabled && (
                    <div className="mt-2.5">
                      <p className="mb-1.5 text-[11px] text-secondary-c">Попередити за:</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[15, 30, 60].map((mins) => (
                          <button
                            key={mins}
                            onClick={() => { setNotifyMinutes(mins); hapticImpact('light'); }}
                            className={`rounded-lg px-3 py-1.5 text-center text-xs font-semibold transition-all ${
                              notifyMinutes === mins ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'd-btn text-secondary-c'
                            }`}
                          >{mins} хв</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-2.5 flex items-center gap-1 text-[10px] text-muted-c">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    Налаштування спільні з Telegram-ботом — змініть у будь-якому місці
                  </p>
                </div>
              )}
              <p className="mt-4 max-w-xs text-xs text-muted-c">
                Цей крок можна пропустити — налаштувати сповіщення можна пізніше в налаштуваннях або в боті.
              </p>
            </div>
          )}

        </div>

        <div className="mx-auto mt-6 flex w-full gap-2">
          {step > 0 && (
            <button
              onClick={() => { setStep(step - 1); hapticImpact('light'); }}
              className="d-btn flex h-14 w-14 items-center justify-center rounded-2xl text-primary-c"
              aria-label="Назад"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => {
              if (step === 2 && !selectedCity && filtered.length > 0) {
                const topCity = filtered[0];
                setSelectedCity(topCity);
                setCitySearch(topCity.name);
                setSelectedGroup('');
                hapticImpact('light');
                setStep(3);
                return;
              }
              if (step === 4) { onFinish(); hapticNotification('success'); }
              else { setStep(step + 1); hapticImpact('light'); }
            }}
            disabled={
              (step === 1 && !selectedOblast) ||
              (step === 2 && !selectedCity && filtered.length === 0) ||
              (step === 3 && !selectedGroup)
            }
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl accent-bg py-4 text-base font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] disabled:opacity-40"
          >
            {step === 0 && <>Почнемо <ArrowRight className="h-5 w-5" /></>}
            {(step === 1 || step === 2) && <>Далі <ArrowRight className="h-5 w-5" /></>}
            {step === 3 && <>Далі <ArrowRight className="h-5 w-5" /></>}
            {step === 4 && <><CheckCircle2 className="h-5 w-5" /> Готово</>}
          </button>
        </div>
      </div>
    </div>
  );
}
export default Onboarding;