import { feedingDurationSeconds, formatFeedingDuration, parseDuration } from "./formatters";

export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function emptySummary(dateKey) {
  return {
    dateKey,
    feedings: 0,
    feedingAmount: 0,
    feedingSeconds: 0,
    feedingMinutes: 0,
    feedingTimes: [],
    feedingDetails: [],
    diapers: 0,
    diaperTimes: [],
    wet: 0,
    solid: 0,
    both: 0,
    sleepHours: 0,
    tummyMinutes: 0,
    medications: 0,
    temperatureMax: null,
    temperatureCount: 0,
  };
}

export function buildDailySummaries({ feedings = [], sleep = [], changes = [], tummy = [], temperatures = [], medications = [] }, days = 30) {
  const result = new Map();
  const now = new Date();

  for (let i = 0; i < days; i += 1) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - i);
    const key = localDateKey(date);
    result.set(key, emptySummary(key));
  }

  for (const entry of feedings) {
    const startValue = entry.start || entry.end;
    const key = localDateKey(startValue);
    const item = result.get(key);
    if (!item) continue;

    item.feedings += 1;
    item.feedingAmount += Number(entry.amount || 0);
    item.feedingSeconds += feedingDurationSeconds(entry);

    const startText = clock(startValue);
    const endText = entry.end ? clock(entry.end) : "en curso";
    if (startText) item.feedingTimes.push(startText);

    item.feedingDetails.push({
      start: startText || "—",
      end: endText,
      duration: formatFeedingDuration(entry),
      sortValue: new Date(startValue).getTime() || 0,
    });
  }

  for (const entry of sleep) {
    const key = localDateKey(entry.start);
    const item = result.get(key);
    if (!item) continue;
    item.sleepHours += parseDuration(entry.duration);
  }

  for (const entry of changes) {
    const key = localDateKey(entry.time);
    const item = result.get(key);
    if (!item) continue;
    item.diapers += 1;
    const time = clock(entry.time);
    if (time) item.diaperTimes.push(time);
    if (entry.wet && entry.solid) item.both += 1;
    else if (entry.wet) item.wet += 1;
    else if (entry.solid) item.solid += 1;
  }

  for (const entry of tummy) {
    const key = localDateKey(entry.start);
    const item = result.get(key);
    if (!item) continue;
    item.tummyMinutes += parseDuration(entry.duration) * 60;
  }

  for (const entry of medications) {
    const key = localDateKey(entry.time);
    const item = result.get(key);
    if (item) item.medications += 1;
  }

  for (const entry of temperatures) {
    const key = localDateKey(entry.time);
    const item = result.get(key);
    if (!item) continue;
    const value = Number(entry.temperature);
    if (!Number.isFinite(value)) continue;
    item.temperatureCount += 1;
    item.temperatureMax = item.temperatureMax === null ? value : Math.max(item.temperatureMax, value);
  }

  return [...result.values()].map((item) => ({
    ...item,
    feedingAmount: Math.round(item.feedingAmount),
    feedingMinutes: Math.round(item.feedingSeconds / 60),
    feedingTimes: [...item.feedingTimes].sort(),
    feedingDetails: [...item.feedingDetails]
      .sort((a, b) => a.sortValue - b.sortValue)
      .map(({ sortValue, ...detail }) => detail),
    diaperTimes: [...item.diaperTimes].sort(),
    sleepHours: Math.round(item.sleepHours * 100) / 100,
    tummyMinutes: Math.round(item.tummyMinutes),
  }));
}

export function hasSummaryData(summary) {
  return Boolean(summary && (summary.feedings || summary.diapers || summary.sleepHours || summary.tummyMinutes || summary.medications || summary.temperatureCount));
}

export function summaryDateLabel(dateKey, long = false) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1, 12, 0, 0);
  return date.toLocaleDateString("es-ES", long
    ? { weekday: "long", day: "numeric", month: "long" }
    : { weekday: "short", day: "numeric", month: "short" });
}
