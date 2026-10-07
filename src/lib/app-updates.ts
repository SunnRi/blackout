export type AppUpdate = {
  version: string;
  date: string;
  title: string;
  items: string[];
};

const LATEST_VERSION = '0.3.0';
const STORAGE_KEY = 'whatsNewSeen';

export const APP_UPDATES: AppUpdate[] = [
  {
    version: '0.3.0',
    date: '7 жовтня',
    title: 'Оновлення графіка та Київ',
    items: [
      'Нова вкладка «Оновлення графіка»: видно, що саме змінилося у графіку вашого міста — яка черга, на який день і що додали чи прибрали',
      'Графік перевіряється автоматично кожні 30 хвилин, зміни з’являються одразу',
      'Київ знову доступний у списку областей',
      'У виборі міста залишилися лише населені пункти — райони та громади прибрано',
      'Села з однаковими назвами розрізняються громадою: «Андріївка (Димерська громада)»',
    ],
  },
  {
    version: '0.2.0',
    date: '7 жовтня',
    title: 'Вибір міста та сповіщення',
    items: [
      'Вибір області та міста з пошуком, вибір своєї черги',
      'Графік на сьогодні і завтра, три стилі відображення: мінімальний, стандартний і розширений',
      'Сповіщення про найближчі відключення через Telegram-бота',
    ],
  },
  {
    version: '0.1.0',
    date: '6 жовтня',
    title: 'Перший реліз',
    items: [
      'Графік відключень світла по чергах',
      'Київ — з офіційного джерела Yasno, інші області — з bezsvitla',
    ],
  },
];

export function getUnseenUpdate(): AppUpdate | null {
  try {
    const seen = localStorage.getItem(STORAGE_KEY);
    return seen === LATEST_VERSION ? null : APP_UPDATES[0];
  } catch {
    return null;
  }
}

export function markUpdateSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, LATEST_VERSION);
  } catch {
    // ignore
  }
}
