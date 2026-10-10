import { Gauge, LayoutGrid, Layers } from 'lucide-react';

export type ThemeMode = 'light' | 'dark';
export type Density = 'minimal' | 'standard' | 'extended';
export type DesignStyle = 'glass' | 'fluent';

export const DESIGN_STYLES: { id: DesignStyle; name: string; desc: string }[] = [
  { id: 'glass', name: 'Liquid Glass', desc: 'Напівпрозорі скляні поверхні з розмиттям' },
  { id: 'fluent', name: 'Fluent', desc: 'Чисті Mica-поверхні, легкі тіні, стиль Microsoft' },
];

export const DENSITY_OPTIONS: { id: Density; name: string; desc: string; icon: typeof Gauge }[] = [
  { id: 'minimal', name: 'Мінімальний', desc: 'Тільки статус і найближчі події', icon: Gauge },
  { id: 'standard', name: 'Стандартний', desc: 'Статус, графік дня і список подій', icon: LayoutGrid },
  { id: 'extended', name: 'Розширений', desc: 'Все + статистика дня і обидва дні одразу', icon: Layers },
];

export function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('themeMode');
  return saved === 'light' ? 'light' : 'dark';
}

export function getInitialDensity(): Density {
  if (typeof window === 'undefined') return 'extended';
  const saved = localStorage.getItem('density');
  return saved === 'minimal' || saved === 'standard' ? saved : 'extended';
}

export function getInitialDesignStyle(): DesignStyle {
  if (typeof window === 'undefined') return 'glass';
  const saved = localStorage.getItem('designStyle');
  return saved === 'fluent' ? 'fluent' : 'glass';
}