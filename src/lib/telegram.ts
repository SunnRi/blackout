declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        themeParams?: Record<string, string>;
        colorScheme?: 'light' | 'dark';
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        BackButton?: {
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
        MainButton?: {
          text: string;
          show: () => void;
          hide: () => void;
          setText: (text: string) => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
          enable: () => void;
          disable: () => void;
          setParams: (params: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export type TGUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

export function setTelegramThemeColors(mode: 'light' | 'dark') {
  const tg = getTelegramWebApp();
  if (!tg) return;
  const color = mode === 'dark' ? '#000000' : '#eef1f6';
  if (tg.setHeaderColor) tg.setHeaderColor(color);
  if (tg.setBackgroundColor) tg.setBackgroundColor(color);
}

export function initTelegramWebApp() {
  const tg = getTelegramWebApp();
  if (tg) {
    tg.ready();
    tg.expand();
    setTelegramThemeColors('dark');
  }
  return tg;
}

export function getTelegramUser(): TGUser | null {
  const tg = getTelegramWebApp();
  return tg?.initDataUnsafe?.user ?? null;
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'light') {
  const tg = getTelegramWebApp();
  tg?.HapticFeedback?.impactOccurred(style);
}

export function hapticNotification(type: 'success' | 'warning' | 'error') {
  const tg = getTelegramWebApp();
  tg?.HapticFeedback?.notificationOccurred(type);
}

export {};
