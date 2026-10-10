import type { City } from './yasno-api';

// Folds Ukrainian/Hungarian vowels and strips signs/apostrophes so the search
// is robust to typos: "і"≈"и", "є"≈"е", apostrophes and hyphens are ignored.
export function normalizeSearch(str: string): string {
  return str
    .toLowerCase()
    .replace(/[іïиы]/g, 'и')
    .replace(/[еєэё]/g, 'е')
    .replace(/[’'`ʼ\s-]/g, '');
}

// Case-insensitive city filtering with smart ranking: exact/substring matches
// first, then normalized matches; results are sorted with Ukrainian collation.
// When the query is empty the original array is returned unchanged.
export function filterCities(cities: City[], query: string): City[] {
  if (!query.trim()) return cities;
  const raw = query.trim().toLowerCase();
  const norm = normalizeSearch(raw);
  const matches = cities.filter((c) => {
    const nameLower = c.name.toLowerCase();
    const slugLower = c.slug.toLowerCase();
    if (nameLower.includes(raw) || slugLower.includes(raw)) return true;
    if (normalizeSearch(nameLower).includes(norm) || normalizeSearch(slugLower).includes(norm)) return true;
    return false;
  });
  matches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(raw) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(raw) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.name.localeCompare(b.name, 'uk');
  });
  return matches;
}