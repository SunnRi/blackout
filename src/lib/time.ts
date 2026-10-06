export type KyivTime = {
  hours: number;
  minutes: number;
  dayOfWeek: number;
  timeString: string;
};

export function getKyivTime(): KyivTime {
  const now = new Date();
  const kyivString = now.toLocaleString('en-US', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const timeMatch = kyivString.match(/(\d{2}):(\d{2})/);
  const hours = timeMatch ? parseInt(timeMatch[1], 10) : 0;
  const minutes = timeMatch ? parseInt(timeMatch[2], 10) : 0;

  const weekdayStr = kyivString.split(',')[0].trim();
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = weekdayMap[weekdayStr] ?? new Date().getDay();

  const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return { hours, minutes, dayOfWeek, timeString };
}
