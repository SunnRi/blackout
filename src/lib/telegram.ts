declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          start_param?: string;
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
        openLink?: (url: string) => void;
        openTelegramLink?: (url: string) => void;
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
  const color = mode === 'dark' ? '#05060f' : '#eef1f6';
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

// Telegram opens a mini app either via a ?screen=... URL query (web_app button)
// or a start_param (direct link). Returns the requested screen name, if any.
export function getTelegramStartScreen(): string | null {
  const tg = getTelegramWebApp();
  const param = tg?.initDataUnsafe?.start_param
    ?? new URLSearchParams(window.location.search).get('screen');
  if (!param) return null;
  return /^[a-z_]{1,32}$/.test(param) ? param : null;
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
