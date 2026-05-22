export function fmtMinor(minor: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(minor / 100);
}

export function fmtAge(ms: number): string {
  if (ms < 1000) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s.toString().padStart(2, "0") + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h";
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// fmtSmartTime produces a human-natural timestamp that scales with age:
//   "now"             — within 5 seconds
//   "12 sec ago"      — within 60 seconds
//   "8 min ago"       — within 60 minutes
//   "today 14:23"     — same calendar day
//   "Tue 15:47"       — within the previous 6 days
//   "May 17"          — older than that, same year
//   "May 17 2025"     — older than that, prior year
// Pass `now` (defaults to new Date()) so tests can pin the clock.
export function fmtSmartTime(d: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 5_000) return "now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)} sec ago`;
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)} min ago`;

  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `today ${hh}:${mm}`;

  const diffDays = Math.floor(diffMs / (24 * 60 * 60_000));
  if (diffDays < 7) return `${WEEKDAY[d.getDay()]} ${hh}:${mm}`;

  const monthDay = `${MONTH[d.getMonth()]} ${d.getDate()}`;
  if (d.getFullYear() === now.getFullYear()) return monthDay;
  return `${monthDay} ${d.getFullYear()}`;
}
