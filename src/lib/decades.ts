export type Decade = 'all' | '2020s' | '2010s' | '2000s' | '1990s' | '1980s' | 'classic';

export const DECADES: { id: Decade; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: '2020s', label: '2020s' },
  { id: '2010s', label: '2010s' },
  { id: '2000s', label: '2000s' },
  { id: '1990s', label: '1990s' },
  { id: '1980s', label: '1980s' },
  { id: 'classic', label: 'Before 1980' },
];

export function inDecade(year: number | null | undefined, decade: Decade): boolean {
  if (decade === 'all') return true;
  if (!year) return false;
  if (decade === 'classic') return year < 1980;
  const start = parseInt(decade, 10);
  return year >= start && year < start + 10;
}
