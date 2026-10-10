import {
  Bell, BellOff, CheckCircle2, ChevronDown, Loader2, MapPin, Plus, Search, Sparkles, X,
} from 'lucide-react';
import { type City, type CitySchedule, type Oblast } from '@/lib/yasno-api';
import { DESIGN_STYLES, type DesignStyle, type ThemeMode } from '@/lib/appearance';
import { ALL_GROUPS } from '@/lib/schedule';
import { type View } from '@/types';
import { hapticImpact, hapticNotification } from '@/lib/telegram';

type SettingsViewProps = {
  saved: boolean;
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  designStyle: DesignStyle;
  setDesignStyle: (s: DesignStyle) => void;
  altOblast: Oblast | null;
  setAltOblast: (o: Oblast | null) => void;
  altCity: City | null;
  setAltCity: (c: City | null) => void;
  altGroup: string;
  setAltGroup: (g: string) => void;
  altLabel: string;
  setAltLabel: (s: string) => void;
  altExpanded: boolean;
  setAltExpanded: (v: boolean) => void;
  setActiveLocation: (l: 'home' | 'work') => void;
  altOblastList: Oblast[];
  altCities: City[];
  altCitiesLoading: boolean;
  altCitySearch: string;
  setAltCitySearch: (s: string) => void;
  filteredAltCities: City[];
  homeExpanded: boolean;
  setHomeExpanded: (v: boolean) => void;
  homeConfigured: boolean;
  setHomeConfigured: (v: boolean) => void;
  homeLabel: string;
  setHomeLabel: (s: string) => void;
  selectedOblast: Oblast | null;
  setSelectedOblast: (o: Oblast | null) => void;
  selectedCity: City | null;
  setSelectedCity: (c: City | null) => void;
  selectedGroup: string;
  setSelectedGroup: (g: string) => void;
  oblasts: Oblast[];
  cities: City[];
  citySearchSettings: string;
  setCitySearchSettings: (s: string) => void;
  filteredSettingsCities: City[];
  setTodaySchedule: (s: CitySchedule | null) => void;
  setTomorrowSchedule: (s: CitySchedule | null) => void;
  notifyEnabled: boolean;
  setNotifyEnabled: (v: boolean) => void;
  notifyMinutes: number;
  setNotifyMinutes: (n: number) => void;
  tgUser: { id: number } | null;
  setView: (v: View) => void;
  onResetAll: () => void;
  citiesLoading: boolean;
  scheduleLoading: boolean;
  availableGroups: string[];
};

export default function SettingsView({
  altCity, altCities, altCitiesLoading, altCitySearch, altExpanded, altGroup,
  altLabel, altOblast, altOblastList, availableGroups, cities, citiesLoading,
  citySearchSettings, designStyle,
  filteredAltCities, filteredSettingsCities, homeConfigured, homeExpanded,
  homeLabel, notifyEnabled, notifyMinutes, oblasts, onResetAll, saved,
  selectedCity, selectedGroup, selectedOblast, setActiveLocation, setAltCity,
  setAltCitySearch, setAltExpanded, setAltGroup, setAltLabel, setAltOblast,
  setCitySearchSettings, setDesignStyle, setHomeConfigured, setHomeExpanded,
  setHomeLabel, setNotifyEnabled, setNotifyMinutes, setSelectedCity,
  setSelectedGroup, setSelectedOblast, setThemeMode, setTodaySchedule,
  setTomorrowSchedule, setView, scheduleLoading, tgUser, themeMode,
}: SettingsViewProps) {
  return (
          <div className="fade-in space-y-3">
            {saved && (
              <div className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/8 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Збережено
              </div>
            )}

            {/* Theme */}
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-secondary-c">Тема</h3>
              <div className="segmented flex w-full">
                {(['light', 'dark'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setThemeMode(m); hapticImpact('light'); }}
                    className={`segmented-item flex-1 px-3 py-1.5 text-xs font-semibold ${themeMode === m ? 'active text-primary-c' : 'text-secondary-c'}`}
                  >
                    {m === 'light' ? 'Світла' : 'Темна'}
                  </button>
                ))}
              </div>
            </div>

            {/* Design style */}
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-secondary-c">Стиль дизайну</h3>
              <div className="grid grid-cols-2 gap-2">
                {DESIGN_STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setDesignStyle(s.id); hapticImpact('light'); }}
                    className={`d-card px-3 py-2.5 text-left transition-all hover:scale-[1.02] ${designStyle === s.id ? 'ring-2 ring-blue-500/40' : ''}`}
                  >
                    <span className={`block text-sm font-bold ${designStyle === s.id ? 'accent-c' : 'text-primary-c'}`}>{s.name}</span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-muted-c">{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Second location (work) */}
            <div data-tour="alt-location">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-secondary-c">Друга локація (робота)</h3>
                {altOblast && altCity && altGroup && !altExpanded && (
                  <button onClick={() => { setAltExpanded(false); setAltOblast(null); setAltCity(null); setAltGroup(''); setAltLabel(''); setActiveLocation('home'); hapticImpact('medium'); }}
                    className="text-[11px] font-semibold text-red-400 hover:underline">Прибрати</button>
                )}
              </div>
              {/* Saved and collapsed: show a one-line summary that expands on tap */}
              {altOblast && altCity && altGroup && !altExpanded ? (
                <button
                  onClick={() => { setAltExpanded(true); hapticImpact('light'); }}
                  className="d-card flex w-full items-center gap-2 px-3.5 py-3 text-left transition-all hover:scale-[1.01]"
                >
                  <MapPin className="h-4 w-4 shrink-0 accent-c" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-primary-c">{altLabel.trim() || 'Робота'} · {altCity.name}</span>
                    <span className="block truncate text-[11px] text-muted-c">{altOblast.name} · черга {altGroup}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-c" />
                </button>
              ) : !altOblast && !altCity && !altGroup && !altExpanded ? (
                <button
                  onClick={() => { setAltExpanded(true); hapticImpact('light'); }}
                  className="d-btn flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-secondary-c transition-all hover:scale-[1.01]"
                >
                  <Plus className="h-4 w-4" /> Додати другу локацію
                </button>
              ) : altExpanded || (altOblast || altCity || altGroup) ? (
                <div className="d-card space-y-3 px-3.5 py-3">
                  <p className="text-[11px] text-muted-c">Показуватимемо графік і для неї. Перемикайте вкладками на головному екрані.</p>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-secondary-c">Назва вкладки</p>
                    <input
                      type="text"
                      value={altLabel}
                      onChange={(e) => setAltLabel(e.target.value)}
                      maxLength={24}
                      placeholder="Напр.: Робота, Офіс, Дача..."
                      className="d-panel w-full rounded-xl px-3 py-2 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-secondary-c">Область</p>
                    <select
                      value={altOblast?.slug ?? ''}
                      onChange={(e) => {
                        const ob = altOblastList.find((o) => o.slug === e.target.value);
                        if (ob) { setAltOblast(ob); setAltCity(null); setAltGroup(''); hapticImpact('light'); }
                      }}
                      className="d-panel w-full appearance-none rounded-xl px-3 py-2 text-sm text-primary-c outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="" disabled>Оберіть область...</option>
                      {altOblastList.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-secondary-c">Місто</p>
                    {altCity ? (
                      <button
                        onClick={() => { setAltCity(null); setAltGroup(''); setAltCitySearch(''); hapticImpact('light'); }}
                        className="d-panel flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm"
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0 accent-c" />
                        <span className="truncate font-semibold text-primary-c">{altCity.name}</span>
                        <X className="ml-auto h-4 w-4 shrink-0 text-muted-c" />
                      </button>
                    ) : (
                      <>
                        <div className="relative mb-1.5">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-c" />
                          <input
                            type="text"
                            value={altCitySearch}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAltCitySearch(val);
                              const q = val.trim().toLowerCase();
                              if (q.length > 0) {
                                const exact = altCities.find((c) => c.name.toLowerCase() === q);
                                if (exact) {
                                  setAltCity(exact);
                                  setAltGroup('');
                                }
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (filteredAltCities.length > 0) {
                                  const top = filteredAltCities[0];
                                  setAltCity(top);
                                  setAltGroup('');
                                  setAltCitySearch('');
                                  hapticImpact('light');
                                }
                              }
                            }}
                            placeholder="Почніть вводити назву міста..."
                            className="d-panel w-full rounded-xl py-2 pl-10 pr-3 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                        {filteredAltCities.length > 0 && altCitySearch.trim() && (
                          <div className="mb-2 flex items-center justify-between rounded-xl accent-soft-bg px-3 py-1.5 text-xs fade-in">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Sparkles className="h-3 w-3 shrink-0 accent-c" />
                              <span className="truncate text-secondary-c">
                                Підстановка: <b className="text-primary-c">{filteredAltCities[0].name}</b>
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const top = filteredAltCities[0];
                                setAltCity(top);
                                setAltGroup('');
                                setAltCitySearch('');
                                hapticImpact('light');
                              }}
                              className="ml-2 shrink-0 rounded-lg accent-bg px-2 py-0.5 text-[11px] font-bold text-white shadow-sm hover:scale-105 active:scale-95 transition-all"
                            >
                              Обрати ↵
                            </button>
                          </div>
                        )}
                        {!altOblast ? (
                          <p className="py-1.5 text-center text-xs text-muted-c">Оберіть область або введіть назву міста</p>
                        ) : altCitiesLoading ? (
                          <div className="flex items-center justify-center gap-2 py-2 text-xs text-secondary-c"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Завантаження...</div>
                        ) : (
                          <div className="d-panel max-h-32 space-y-0.5 overflow-y-auto overscroll-contain rounded-xl p-1.5">
                            {filteredAltCities
                              .slice(0, 30)
                              .map((city) => (
                                <button
                                  key={city.slug}
                                  onClick={() => { setAltCity(city); setAltGroup(''); hapticImpact('light'); }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-secondary-c transition-all active:bg-black/5 dark:active:bg-white/5"
                                >
                                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{city.name}</span>
                                </button>
                              ))}
                            {filteredAltCities.length === 0 && (
                              <p className="py-2 text-center text-xs text-muted-c">Не знайдено</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-secondary-c">Черга</p>
                    <div className="grid grid-cols-6 gap-1">
                      {ALL_GROUPS.map((group) => (
                        <button
                          key={group}
                          onClick={() => { setAltGroup(group); hapticImpact('light'); }}
                          className={`rounded-lg px-1 py-2 text-center text-xs font-bold transition-all ${
                            altGroup === group ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'd-btn text-secondary-c hover:scale-105'
                          }`}
                        >{group}</button>
                      ))}
                    </div>
                  </div>
                  {altOblast && altCity && altGroup && (
                    <button
                      onClick={() => { setAltExpanded(false); setActiveLocation('home'); hapticNotification('success'); }}
                      className="w-full rounded-xl accent-bg px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02]"
                    >Прийняти зміни</button>
                  )}
                </div>
              ) : null}
            </div>

            {/* Home location — same card style as the second location */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-secondary-c">Основна локація</h3>
              </div>
              {/* Saved and collapsed: show a one-line summary that expands on tap */}
              {selectedOblast && selectedCity && selectedGroup && !homeExpanded && homeConfigured ? (
                <button
                  onClick={() => { setHomeExpanded(true); hapticImpact('light'); }}
                  className="d-card flex w-full items-center gap-2 px-3.5 py-3 text-left transition-all hover:scale-[1.01]"
                >
                  <MapPin className="h-4 w-4 shrink-0 accent-c" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-primary-c">{homeLabel.trim() || 'Дім'} · {selectedCity.name}</span>
                    <span className="block truncate text-[11px] text-muted-c">{selectedOblast.name} · черга {selectedGroup}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-c" />
                </button>
              ) : (
              <div className="d-card space-y-3 px-3.5 py-3">
                <p className="text-[11px] text-muted-c">Основна локація. Показується на головному екрані за замовчуванням.</p>
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-secondary-c">Назва вкладки</p>
                  <input
                    type="text"
                    value={homeLabel}
                    onChange={(e) => setHomeLabel(e.target.value)}
                    maxLength={24}
                    placeholder="Напр.: Дім, Квартира..."
                    className="d-panel w-full rounded-xl px-3 py-2 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-secondary-c">Область</p>
                  <select
                    value={selectedOblast?.slug ?? ''}
                    onChange={(e) => {
                      const oblast = oblasts.find((o) => o.slug === e.target.value);
                      if (oblast) { setSelectedOblast(oblast); setSelectedCity(null); setSelectedGroup(''); setTodaySchedule(null); setTomorrowSchedule(null); hapticImpact('light'); }
                    }}
                    className="d-panel w-full appearance-none rounded-xl px-3 py-2 text-sm text-primary-c outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    <option value="" disabled>Оберіть область...</option>
                    {oblasts.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
                  </select>
                </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold text-secondary-c">Місто</p>
                {selectedCity ? (
                  <button
                    onClick={() => { setSelectedCity(null); setSelectedGroup(''); setCitySearchSettings(''); setTodaySchedule(null); setTomorrowSchedule(null); hapticImpact('light'); }}
                    className="d-panel flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm"
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0 accent-c" />
                    <span className="truncate font-semibold text-primary-c">{selectedCity.name}</span>
                    <X className="ml-auto h-4 w-4 shrink-0 text-muted-c" />
                  </button>
                ) : (
                  <>
                    <div className="relative mb-1.5">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-c" />
                      <input
                        type="text"
                        value={citySearchSettings}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCitySearchSettings(val);
                          const q = val.trim().toLowerCase();
                          if (q.length > 0) {
                            const exact = cities.find((c) => c.name.toLowerCase() === q);
                            if (exact) {
                              setSelectedCity(exact);
                              setSelectedGroup('');
                              setTodaySchedule(null);
                              setTomorrowSchedule(null);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (filteredSettingsCities.length > 0) {
                              const top = filteredSettingsCities[0];
                              setSelectedCity(top);
                              setSelectedGroup('');
                              setCitySearchSettings('');
                              setTodaySchedule(null);
                              setTomorrowSchedule(null);
                              hapticImpact('light');
                            }
                          }
                        }}
                        placeholder="Почніть вводити назву міста..."
                        className="d-panel w-full rounded-xl py-2 pl-10 pr-3 text-sm text-primary-c placeholder:text-muted-c outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                    </div>
                    {filteredSettingsCities.length > 0 && citySearchSettings.trim() && (
                      <div className="mb-2 flex items-center justify-between rounded-xl accent-soft-bg px-3 py-1.5 text-xs fade-in">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Sparkles className="h-3 w-3 shrink-0 accent-c" />
                          <span className="truncate text-secondary-c">
                            Підстановка: <b className="text-primary-c">{filteredSettingsCities[0].name}</b>
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const top = filteredSettingsCities[0];
                            setSelectedCity(top);
                            setSelectedGroup('');
                            setCitySearchSettings('');
                            setTodaySchedule(null);
                            setTomorrowSchedule(null);
                            hapticImpact('light');
                          }}
                          className="ml-2 shrink-0 rounded-lg accent-bg px-2 py-0.5 text-[11px] font-bold text-white shadow-sm hover:scale-105 active:scale-95 transition-all"
                        >
                          Обрати ↵
                        </button>
                      </div>
                    )}
                    {!selectedOblast ? (
                      <p className="py-1.5 text-center text-xs text-muted-c">Оберіть область або введіть назву міста</p>
                    ) : citiesLoading ? (
                      <div className="flex items-center justify-center gap-2 py-2 text-xs text-secondary-c"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Завантаження...</div>
                    ) : (
                      <div className="d-panel max-h-32 space-y-0.5 overflow-y-auto overscroll-contain rounded-xl p-1.5">
                        {filteredSettingsCities
                          .slice(0, 30)
                          .map((city) => (
                            <button
                              key={city.slug}
                              onClick={() => { setSelectedCity(city); setSelectedGroup(''); setTodaySchedule(null); setTomorrowSchedule(null); hapticImpact('light'); }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-secondary-c transition-all active:bg-black/5 dark:active:bg-white/5"
                            >
                              <MapPin className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{city.name}</span>
                            </button>
                          ))}
                        {filteredSettingsCities.length === 0 && <p className="py-2 text-center text-xs text-muted-c">Не знайдено</p>}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold text-secondary-c">Черга</p>
                {scheduleLoading ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-secondary-c"><Loader2 className="h-4 w-4 animate-spin" /> Завантаження...</div>
                ) : (
                  <div className="grid grid-cols-6 gap-1">
                    {(availableGroups.length > 0 ? availableGroups : ALL_GROUPS).map((group) => (
                      <button
                        key={group}
                        onClick={() => { setSelectedGroup(group); hapticImpact('light'); }}
                        className={`rounded-lg px-1 py-2 text-center text-xs font-bold transition-all ${
                          selectedGroup === group ? 'accent-soft-bg accent-c ring-1 ring-blue-500/30' : 'd-btn text-secondary-c hover:scale-105'
                        }`}
                      >{group}</button>
                    ))}
                  </div>
                )}
              </div>
              {selectedOblast && selectedCity && selectedGroup && (
                <button
                  onClick={() => { setHomeExpanded(false); setHomeConfigured(true); hapticNotification('success'); }}
                  className="w-full rounded-xl accent-bg px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02]"
                >Прийняти зміни</button>
              )}
              </div>
              )}
            </div>

            {/* Notifications */}
            {tgUser && (
              <div className="d-card px-3.5 py-3">
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

            {/* Replay onboarding — full reset: wipes saved prefs, bot
                message history and the guided tour, then starts over from
                the greeting screen. Server-side wipe is verified, so the
                restore effect can't bring the old settings back. */}
            <button
              onClick={() => {
                if (confirm && confirm('Це видалить усі налаштування, історію змін і повідомлення бота. Продовжити?')) {
                  onResetAll();
                }
              }}
              className="d-btn flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-red-400 transition-all hover:scale-[1.01]"
            >
              <Sparkles className="h-3.5 w-3.5" /> Пройти налаштування знову
            </button>

            <button
              onClick={() => { setView('schedule'); hapticImpact('light'); }}
              className="w-full rounded-xl accent-bg px-4 py-2.5 text-center text-sm font-bold text-white shadow-sm transition-all hover:scale-[1.02]"
            >Готово</button>
          </div>
  );
}
