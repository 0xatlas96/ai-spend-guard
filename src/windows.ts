export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function isSameUtcDay(iso: string, date: Date): boolean {
  return iso.slice(0, 10) === utcDayKey(date);
}

export function isSameUtcMonth(iso: string, date: Date): boolean {
  return iso.slice(0, 7) === utcMonthKey(date);
}
