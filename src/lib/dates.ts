// All dates are local-calendar "YYYY-MM-DD" strings, so a session stays on the
// day it was logged regardless of timezone or daylight saving changes.

export function toKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function fromKey(key: string): Date {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function startOfWeek(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
