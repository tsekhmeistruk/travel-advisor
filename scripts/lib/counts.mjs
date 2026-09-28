// A rolling store of daily counts per place and series (pure), e.g. news reports of protests.
//
//   { first: 'YYYY-MM-DD', last: 'YYYY-MM-DD', gaps: ['YYYY-MM-DD'],
//     series: { placeId: { protest: [n, …], violence: [n, …] } } }
//
// Every array has one number per day from `first` to `last`. A day without data (the source
// had no file for it) is in `gaps`: its zeros are not real zeros, so windows leave it out.

const DAY = 864e5;
export const dayIndex = (first, day) => Math.round((Date.parse(day) - Date.parse(first)) / DAY);
export const addDays = (day, n) => new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);

export function emptyCounts() {
  return { first: null, last: null, gaps: [], series: {} };
}

/**
 * Add one day's counts (the day after `last`, or the first day). Returns new data; days between
 * `last` and `day` that were skipped become gaps. Keeps the last `historyDays` days.
 * @param counts  { placeId: { series: n } }, or null for a day without data
 */
export function addDay(data, day, counts, { historyDays }) {
  const out = { first: data.first ?? day, last: data.last, gaps: [...data.gaps], series: structuredClone(data.series) };
  if (out.last && day <= out.last) throw new Error(`Day ${day} is not after ${out.last}`);
  const from = out.last ? addDays(out.last, 1) : day;
  for (let d = from; d < day; d = addDays(d, 1)) out.gaps.push(d);
  if (!counts) out.gaps.push(day);
  out.last = day;
  const length = dayIndex(out.first, day) + 1;
  const names = new Set(Object.values(out.series).flatMap(s => Object.keys(s)));
  for (const place of Object.keys(counts ?? {})) for (const name of Object.keys(counts[place])) names.add(name);
  for (const place of new Set([...Object.keys(out.series), ...Object.keys(counts ?? {})])) {
    const s = (out.series[place] ??= {});
    for (const name of names) {
      const arr = s[name] ?? [];
      while (arr.length < length - 1) arr.push(0);
      arr.push(counts?.[place]?.[name] ?? 0);
      s[name] = arr;
    }
  }
  return trim(out, historyDays);
}

function trim(data, historyDays) {
  const drop = dayIndex(data.first, data.last) + 1 - historyDays;
  if (drop <= 0) return data;
  const first = addDays(data.first, drop);
  for (const s of Object.values(data.series)) for (const name of Object.keys(s)) s[name] = s[name].slice(drop);
  return { ...data, first, gaps: data.gaps.filter(d => d >= first) };
}

/**
 * The count of a window of days ending at `end`, leaving out gaps.
 * @returns { sum, days }  days: how many days of the window had data
 */
export function windowSum(data, place, name, end, length) {
  const arr = data.series[place]?.[name];
  const gaps = new Set(data.gaps);
  let sum = 0;
  let days = 0;
  for (let i = 0; i < length; i++) {
    const d = addDays(end, -i);
    if (d < data.first || gaps.has(d)) continue;
    days++;
    sum += arr?.[dayIndex(data.first, d)] ?? 0;
  }
  return { sum, days };
}
