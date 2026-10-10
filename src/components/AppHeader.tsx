import { useState } from 'react';
import {
  BarChart3, Check, ChevronLeft, Gauge, History, Layers, LayoutGrid,
  MapPin, Moon, Settings, Sun, Zap,
} from 'lucide-react';
import { type City } from '@/lib/yasno-api';
import { type Density, DENSITY_OPTIONS, type ThemeMode } from '@/lib/appearance';
import { type View } from '@/types';
import { hapticImpact } from '@/lib/telegram';

type AppHeaderProps = {
  view: View;
  onBackToSchedule: () => void;
  onOpenCitySettings: () => void;
  selectedCity: City | null;
  selectedGroup: string;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  unseenChanges: boolean;
  isAdmin: boolean;
  onOpenChanges: () => void;
  onOpenAdmin: () => void;
  onOpenSettings: () => void;
};

export default function AppHeader({
  view, onBackToSchedule, onOpenCitySettings, selectedCity, selectedGroup,
  themeMode, onToggleTheme, density, onDensityChange, unseenChanges, isAdmin,
  onOpenChanges, onOpenAdmin, onOpenSettings,
}: AppHeaderProps) {
  const [densityMenuOpen, setDensityMenuOpen] = useState(false);

  const title = view === 'schedule'
    ? 'Графік світла'
    : view === 'changes' ? 'Оновлення графіка'
    : view === 'admin' ? 'Адмінка'
    : 'Налаштування';

  return (
    <header className="relative z-50 mb-4 fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {view === 'settings' && (
            <button onClick={() => { onBackToSchedule(); hapticImpact('light'); }}
              className="d-btn flex h-9 w-9 items-center justify-center rounded-full">
              <ChevronLeft className="h-5 w-5 text-primary-c" />
            </button>
          )}
          <div className="logo-glow flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 shadow-sm shadow-indigo-500/40">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-primary-c">{title}</h1>
            {selectedCity && view !== 'settings' ? (
              <button onClick={() => { onOpenCitySettings(); hapticImpact('light'); }}
                className="flex items-center gap-1 text-xs accent-c">
                <MapPin className="h-3 w-3" />
                {selectedCity.name}{selectedGroup && ` · ${selectedGroup}`}
              </button>
            ) : !selectedCity && view !== 'settings' ? (
              <p className="text-xs text-secondary-c">Україна</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { onToggleTheme(); hapticImpact('light'); }}
            className="d-btn flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Тема"
            title={themeMode === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему'}
          >
            {themeMode === 'light'
              ? <Moon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              : <Sun className="h-4 w-4 text-amber-400" />}
          </button>
{view === 'schedule' && (
            <div className="relative">
              <button
                onClick={() => { setDensityMenuOpen((o) => !o); hapticImpact('light'); }}
                className={`d-btn flex h-9 w-9 items-center justify-center rounded-full ${densityMenuOpen ? 'ring-2 ring-blue-500/40' : ''}`}
                aria-label="Стиль відображення"
                title="Стиль відображення"
              >
                {density === 'minimal' && <Gauge className="h-4 w-4 accent-c" />}
                {density === 'standard' && <LayoutGrid className="h-4 w-4 accent-c" />}
                {density === 'extended' && <Layers className="h-4 w-4 accent-c" />}
              </button>
              {densityMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setDensityMenuOpen(false)} />
                  <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl d-panel menu-solid fade-in-menu">
                    {DENSITY_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => { onDensityChange(o.id); setDensityMenuOpen(false); hapticImpact('light'); }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                          density === o.id ? 'accent-soft-bg' : 'hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <o.icon className={`h-4 w-4 shrink-0 ${density === o.id ? 'accent-c' : 'text-muted-c'}`} />
                        <span className="min-w-0">
                          <span className={`block text-xs font-semibold ${density === o.id ? 'accent-c' : 'text-primary-c'}`}>{o.name}</span>
                          <span className="block truncate text-[10px] text-muted-c">{o.desc}</span>
                        </span>
                        {density === o.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0 accent-c" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {view === 'schedule' && selectedCity && (
            <button onClick={() => { onOpenChanges(); hapticImpact('light'); }}
              className="relative d-btn flex h-9 w-9 items-center justify-center rounded-full"
              aria-label="Оновлення графіка" title="Оновлення графіка" data-tour="history">
              <History className="h-4 w-4 accent-c" />
              {unseenChanges && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
                </span>
              )}
            </button>
          )}
          {view === 'schedule' && isAdmin && (
            <button onClick={() => { onOpenAdmin(); hapticImpact('light'); }}
              className="d-btn flex h-9 w-9 items-center justify-center rounded-full" aria-label="Адмінка" title="Адмінка">
              <BarChart3 className="h-4 w-4 accent-c" />
            </button>
          )}
          {view === 'schedule' && (
            <button onClick={() => { onOpenSettings(); hapticImpact('light'); }}
              className="d-btn flex h-9 w-9 items-center justify-center rounded-full" data-tour="settings">
              <Settings className="h-4 w-4 accent-c" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}