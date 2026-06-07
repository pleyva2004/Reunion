export interface Interval {
  start: string;
  end: string;
}

export interface DateWindow {
  start: string; // 'YYYY-MM-DD' or ISO datetime
  end: string;
}

// Accepts YYYY-MM-DD (treated as start-of-day UTC) or any ISO 8601 datetime.
function toMs(s: string): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const v = dateOnly ? Date.parse(s + 'T00:00:00.000Z') : Date.parse(s);
  if (Number.isNaN(v)) throw new Error(`invalid date: ${s}`);
  return v;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Normalize a window to half-open [startIso, endIso). Per INTERFACE.md's example,
 * date-only inputs expand to start-of-UTC-day, so end is exclusive at day granularity.
 */
export function normalizeWindow(window: DateWindow): { startIso: string; endIso: string } {
  const s = toMs(window.start);
  const e = toMs(window.end);
  if (s >= e) throw new Error(`window end must be after start (got ${window.start} → ${window.end})`);
  return { startIso: toIso(s), endIso: toIso(e) };
}

/** Returns free intervals = window minus union of busy intervals. */
export function subtractBusy(window: DateWindow, busy: Interval[]): Interval[] {
  const ws = toMs(window.start);
  const we = toMs(window.end);
  if (ws >= we) return [];

  const clipped: Array<[number, number]> = [];
  for (const b of busy) {
    const s = Math.max(toMs(b.start), ws);
    const e = Math.min(toMs(b.end), we);
    if (s < e) clipped.push([s, e]);
  }
  clipped.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [s, e] of clipped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const free: Interval[] = [];
  let cursor = ws;
  for (const [s, e] of merged) {
    if (cursor < s) free.push({ start: toIso(cursor), end: toIso(s) });
    cursor = Math.max(cursor, e);
  }
  if (cursor < we) free.push({ start: toIso(cursor), end: toIso(we) });
  return free;
}

/** Intersect N sorted free-interval arrays into the common free intervals. */
export function intersectFree(arrays: Interval[][]): Interval[] {
  if (arrays.length === 0) return [];
  let acc: Array<[number, number]> = arrays[0].map((i) => [toMs(i.start), toMs(i.end)]);
  for (let i = 1; i < arrays.length; i++) {
    const next: Array<[number, number]> = arrays[i].map((iv) => [toMs(iv.start), toMs(iv.end)]);
    const out: Array<[number, number]> = [];
    let a = 0;
    let b = 0;
    while (a < acc.length && b < next.length) {
      const s = Math.max(acc[a][0], next[b][0]);
      const e = Math.min(acc[a][1], next[b][1]);
      if (s < e) out.push([s, e]);
      if (acc[a][1] < next[b][1]) a++;
      else b++;
    }
    acc = out;
    if (acc.length === 0) break;
  }
  return acc.map(([s, e]) => ({ start: toIso(s), end: toIso(e) }));
}
