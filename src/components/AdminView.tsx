import { useEffect, useState } from 'react';
import {
  AlertTriangle, BarChart3, Bell, ChevronDown, ChevronLeft, Loader2,
  MapIcon, Users, X,
} from 'lucide-react';
import { getTelegramWebApp, hapticImpact } from '@/lib/telegram';
type AdminUser = {
  tgUserId: number;
  username: string | null;
  cityName: string | null;
  queueGroup: string | null;
  notifyEnabled: boolean;
  notifyMinutesBefore: number;
  activeLocation: string | null;
  altCityName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
type AdminRegion = { name: string; userCount: number; users: AdminUser[] };
type AdminCityCheck = {
  oblastSlug: string; citySlug: string;
  lastCheckedAt: string; lastChangeAt: string | null; isStale: boolean;
};
type AdminStats = {
  generatedAt: string;
  users: { total: number; activeLast7Days: number; notificationsEnabled: number };
  regions: AdminRegion[];
  cities: { name: string; users: number }[];
  schedules: {
    trackedCities: number; fresh: number; stale: number;
    lastCheckedAt: string | null; lastChangeAt: string | null;
    cityChecks: AdminCityCheck[];
  };
};

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'щойно';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'щойно';
  if (mins < 60) return `${mins} хв тому`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} год тому`;
  const days = Math.floor(hours / 24);
  return `${days} дн тому`;
}

function AdminUserDetail({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm fade-in" onClick={onClose}>
      <div className="d-panel menu-solid w-full max-w-md rounded-t-2xl p-5 fade-in-scale max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full accent-bg text-sm font-bold text-white">
              {user.username ? user.username[0].toUpperCase() : '?'}
            </div>
            <div>
              <p className="text-sm font-bold text-primary-c">{user.username ? `@${user.username}` : `ID: ${user.tgUserId}`}</p>
              <p className="text-[11px] text-muted-c">ID: {user.tgUserId}</p>
            </div>
          </div>
          <button onClick={onClose} className="d-btn flex h-8 w-8 items-center justify-center rounded-full"><X className="h-4 w-4 text-secondary-c" /></button>
        </div>
        <div className="space-y-2.5">
          {[
            { label: 'Місто', value: user.cityName ?? 'Не вказано' },
            { label: 'Черга', value: user.queueGroup ?? 'Не вказано' },
            { label: 'Друга локація', value: user.altCityName ?? 'Немає' },
            { label: 'Активна локація', value: user.activeLocation === 'work' ? 'Робота' : 'Дім' },
            { label: 'Сповіщення', value: user.notifyEnabled ? `Увімкнено (${user.notifyMinutesBefore} хв до)` : 'Вимкнено' },
            { label: 'Останній візит', value: formatRelative(user.updatedAt) },
            { label: 'Реєстрація', value: formatRelative(user.createdAt) },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between rounded-lg bg-black/4 px-3 py-2 dark:bg-white/6">
              <span className="text-xs text-secondary-c">{label}</span>
              <span className="text-xs font-semibold text-primary-c">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminView({ initData, onBack }: { initData: string; onBack: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [showCityChecks, setShowCityChecks] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    setErrorMsg(null);
    try {
      const tgInitData = getTelegramWebApp()?.initData || initData;
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ initData: tgInitData }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(errJson?.error || `Помилка ${response.status}`);
      }
      const data = await response.json() as AdminStats;
      if (!data.users || !Array.isArray(data.regions) || !data.schedules) throw new Error('Некоректний формат даних');
      setStats(data);
    } catch (err) {
      setError(true);
      setErrorMsg(err instanceof Error ? err.message : 'Помилка запиту');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [initData]);

  if (loading) {
    return <div className="flex flex-col items-center justify-center py-20 text-secondary-c"><Loader2 className="h-8 w-8 animate-spin accent-c" /><p className="mt-3 text-sm">Завантаження статистики...</p></div>;
  }
  if (error || !stats) {
    return (
      <div className="d-card p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <p className="mt-3 text-sm font-semibold text-primary-c">Не вдалося завантажити статистику</p>
        {errorMsg && <p className="mt-1 text-xs text-secondary-c">{errorMsg}</p>}
        <button onClick={() => void load()} className="mt-4 rounded-xl accent-bg px-4 py-2 text-sm font-bold text-white">
          Повторити
        </button>
      </div>
    );
  }

  return (
    <div className="fade-in space-y-3">
      {selectedUser && <AdminUserDetail user={selectedUser} onClose={() => setSelectedUser(null)} />}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Користувачів', value: stats.users.total, icon: Users },
          { label: 'Активні за 7 днів', value: stats.users.activeLast7Days, icon: BarChart3 },
          { label: 'Зі сповіщеннями', value: stats.users.notificationsEnabled, icon: Bell },
          { label: 'Міст перевіряється', value: stats.schedules.trackedCities, icon: MapIcon },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="d-card p-3.5"><Icon className="h-4 w-4 accent-c" /><p className="mt-2 text-2xl font-bold text-primary-c">{value}</p><p className="text-[11px] text-secondary-c">{label}</p></div>
        ))}
      </div>
      <div className="d-card p-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-primary-c">Актуальність графіків</h2><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${stats.schedules.stale ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600'}`}>{stats.schedules.stale ? `${stats.schedules.stale} застаріли` : 'Усе свіже'}</span></div>
        <div className="mt-3 flex gap-2 text-xs"><span className="flex-1 rounded-lg bg-emerald-500/12 px-3 py-2 text-emerald-600">Свіжі: <b>{stats.schedules.fresh}</b></span><span className="flex-1 rounded-lg bg-amber-500/12 px-3 py-2 text-amber-600">Проблемні: <b>{stats.schedules.stale}</b></span></div>
        <div className="mt-3 space-y-1.5 rounded-lg bg-black/4 px-3 py-2.5 dark:bg-white/6">
          <div className="flex items-center justify-between text-xs"><span className="text-secondary-c">Остання перевірка</span><b className="text-primary-c">{formatRelative(stats.schedules.lastCheckedAt)}</b></div>
          <div className="flex items-center justify-between text-xs"><span className="text-secondary-c">Останнє оновлення графіка</span><b className="text-primary-c">{formatRelative(stats.schedules.lastChangeAt)}</b></div>
        </div>
        <button onClick={() => setShowCityChecks((v) => !v)} className="mt-2 flex w-full items-center justify-center gap-1 text-[11px] accent-c">
          {showCityChecks ? 'Сховати' : 'Показати'} по містах <ChevronDown className={`h-3 w-3 transition-transform ${showCityChecks ? 'rotate-180' : ''}`} />
        </button>
        {showCityChecks && (
          <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto fade-in">
            {stats.schedules.cityChecks.map((c) => (
              <div key={`${c.oblastSlug}/${c.citySlug}`} className="flex items-center justify-between rounded-lg bg-black/4 px-3 py-2 text-xs dark:bg-white/6">
                <div className="min-w-0 flex-1"><p className="truncate font-semibold text-primary-c">{c.citySlug}</p><p className="truncate text-[10px] text-muted-c">{c.oblastSlug}</p></div>
                <div className="ml-2 shrink-0 text-right">
                  <p className="text-secondary-c">Перевірка: {formatRelative(c.lastCheckedAt)}</p>
                  <p className="text-muted-c">Оновлення: {formatRelative(c.lastChangeAt)}</p>
                </div>
                <span className={`ml-2 h-2 w-2 shrink-0 rounded-full ${c.isStale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="d-card p-4">
        <h2 className="mb-3 text-sm font-bold text-primary-c">Користувачі за областями</h2>
        {stats.regions.length === 0 ? <p className="text-sm text-secondary-c">Даних ще немає</p> : (
          <div className="space-y-1.5">
            {stats.regions.map((region) => (
              <div key={region.name} className="rounded-lg bg-black/4 dark:bg-white/6">
                <button
                  onClick={() => setExpandedRegion(expandedRegion === region.name ? null : region.name)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-sm"
                >
                  <span className="truncate text-secondary-c">{region.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <b className="text-primary-c">{region.userCount}</b>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-c transition-transform ${expandedRegion === region.name ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {expandedRegion === region.name && (
                  <div className="space-y-1 border-t border-subtle-c px-2 py-2 fade-in">
                    {region.users.map((u) => (
                      <button
                        key={u.tgUserId}
                        onClick={() => { setSelectedUser(u); hapticImpact('light'); }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full accent-bg text-[11px] font-bold text-white">
                          {u.username ? u.username[0].toUpperCase() : '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-primary-c">{u.username ? `@${u.username}` : `ID: ${u.tgUserId}`}</p>
                          <p className="truncate text-[10px] text-muted-c">{u.cityName ?? '—'}{u.queueGroup ? ` · ${u.queueGroup}` : ''}</p>
                        </div>
                        {u.notifyEnabled && <Bell className="h-3 w-3 shrink-0 accent-c" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="d-card p-4"><h2 className="mb-3 text-sm font-bold text-primary-c">Найпопулярніші міста</h2>{stats.cities.length === 0 ? <p className="text-sm text-secondary-c">Даних ще немає</p> : <div className="space-y-2">{stats.cities.slice(0, 10).map((item) => <div key={item.name} className="flex items-center justify-between text-sm"><span className="truncate text-secondary-c">{item.name}</span><b className="text-primary-c">{item.users}</b></div>)}</div>}</div>
      <button onClick={onBack} className="d-btn flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-secondary-c"><ChevronLeft className="h-4 w-4" /> До графіка</button>
    </div>
  );
}
export default AdminView;