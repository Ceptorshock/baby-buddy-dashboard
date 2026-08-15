import { t as translate } from "../locales";

const FEEDING_TYPES = {
  "breast milk": "Leche materna",
  formula: "Leche de fórmula",
  "fortified breast milk": "Leche materna fortificada",
  "solid food": "Alimentos sólidos",
  "fortified milk": "Leche fortificada",
};

const FEEDING_METHODS = {
  bottle: "Biberón",
  "left breast": "Pecho izquierdo",
  "right breast": "Pecho derecho",
  "both breasts": "Ambos pechos",
  "parent fed": "Dado por un adulto",
  "self fed": "Comió solo/a",
};

function localizeFeedingValue(value, dictionary) {
  if (!value) return "";
  return dictionary[String(value).toLowerCase()] || value;
}

const ALEXA_NOTE_MARKERS = [
  "registrado mediante alexa",
  "registrado por alexa",
  "controlado por alexa",
];

function feedingTagName(tag) {
  if (typeof tag === "string") return tag;
  return tag?.name || tag?.label || tag?.value || "";
}

export function isAlexaFeeding(feeding) {
  if (!feeding) return false;

  const tagged = (Array.isArray(feeding.tags) ? feeding.tags : []).some(
    (tag) => feedingTagName(tag).trim().toLowerCase() === "alexa",
  );
  if (tagged) return true;

  const notes = String(feeding.notes || "").toLowerCase();
  return ALEXA_NOTE_MARKERS.some((marker) => notes.includes(marker));
}

export function getAge(birthDate) {
  const birth = new Date(birthDate);
  const now = new Date();
  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  const days = now.getDate() - birth.getDate();
  if (days < 0) months--;
  const adjustedDays = days < 0 ? 30 + days : days;

  if (months < 1) {
    const count = Math.max(0, Math.floor((now - birth) / 86400000));
    return translate("time.babyAgeDays", { count });
  }
  if (months < 12) {
    return translate("time.babyAgeMonthsDays", {
      months,
      days: adjustedDays,
    });
  }
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) {
    return translate("time.babyAgeYears", { years });
  }
  return translate("time.babyAgeYearsMonths", {
    years,
    months: remainingMonths,
  });
}

export function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return translate("time.justNow");
  if (mins < 60) return translate("time.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `Hace ${hours} h ${rest} min` : translate("time.hoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return translate("time.daysAgo", { count: days });
}

export function formatTime(dateStr) {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const parts = String(durationStr).split(":").map(Number);
  if (parts.length === 3) return parts[0] + parts[1] / 60 + parts[2] / 3600;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return parts[0] || 0;
}

export function formatDuration(durationStr) {
  if (!durationStr) return "—";
  const hours = parseDuration(durationStr);
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}

export function feedingDurationSeconds(feeding) {
  if (!feeding) return 0;

  if (feeding.start && feeding.end) {
    const start = new Date(feeding.start);
    const end = new Date(feeding.end);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
    }
  }

  if (feeding.duration) {
    return Math.max(0, Math.round(parseDuration(feeding.duration) * 3600));
  }

  if (feeding.start && !feeding.end) {
    const start = new Date(feeding.start);
    if (!Number.isNaN(start.getTime())) {
      return Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
    }
  }

  return 0;
}

export function formatExactSeconds(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours} h ${minutes} min ${seconds} s`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

export function formatFeedingDuration(feeding) {
  return formatExactSeconds(feedingDurationSeconds(feeding));
}

export function toFeedingTimeline(feedings, volumeUnit = "mL") {
  return feedings.map((f) => {
    const amount = f.amount ? `${f.amount} ${volumeUnit}` : "";
    const method = localizeFeedingValue(f.method, FEEDING_METHODS);
    const type = localizeFeedingValue(f.type, FEEDING_TYPES);
    const description = method || type || translate("action.feeding");
    const startValue = f.start || f.end;
    const startText = formatTime(startValue);
    const endText = f.end ? formatTime(f.end) : "en curso";
    const durationText = formatFeedingDuration(f);
    const alexa = isAlexaFeeding(f);

    return {
      time: `${startText}–${f.end ? endText : "…"}`,
      label: [alexa ? "🎙️ Alexa ·" : "", amount, description]
        .filter(Boolean)
        .join(" "),
      detail: `Inicio ${startText} · Fin ${endText} · Duración ${durationText}${startValue ? ` · ${timeAgo(startValue)}` : ""}`,
      amount: f.amount || 0,
      type: f.type,
      method: f.method,
      entry: f,
    };
  });
}

export function toDiaperTimeline(changes) {
  return changes.map((c) => ({
    time: formatTime(c.time),
    type: c.solid && c.wet ? "both" : c.solid ? "solid" : "wet",
    ago: timeAgo(c.time),
    color: c.color,
    entry: c,
  }));
}

export function toSleepBlocks(sleepEntries) {
  return sleepEntries.map((s) => ({
    start: formatTime(s.start),
    end: s.end ? formatTime(s.end) : translate("time.ongoing"),
    duration: parseDuration(s.duration),
    nap: s.nap,
    entry: s,
  }));
}

export function toNoteTimeline(notes) {
  return notes.map((n) => ({
    time: formatTime(n.time),
    text: n.note,
    ago: timeAgo(n.time),
    entry: n,
  }));
}

export function toGrowthSeries(entries, valueKey) {
  return entries
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((e) => ({
      timestamp: new Date(e.date).getTime(),
      date: new Date(e.date).toLocaleDateString("es-ES", {
        month: "short",
        day: "numeric",
      }),
      [valueKey]: parseFloat(e[valueKey]),
      entry: e,
    }));
}

export function formatGrowthTick(timestamp) {
  return new Date(timestamp).toLocaleDateString("es-ES", {
    month: "short",
    day: "numeric",
  });
}

function getLast7Days() {
  const result = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);

    result.push({
      label: d
        .toLocaleDateString("es-ES", { weekday: "short" })
        .replace(".", ""),
      dateStr: `${d.getFullYear()}-${String(
        d.getMonth() + 1,
      ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    });
  }

  return result;
}

function entryDateStr(dateVal) {
  const d = new Date(dateVal);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function aggregateByDayOfWeek(entries, valueKey, dateKey = "start") {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e[dateKey] || e.time || e.date);
    if (key in sums) sums[key] += parseFloat(e[valueKey] || 0);
  });
  return days.map((d) => ({ day: d.label, amount: Math.round(sums[d.dateStr]) }));
}

export function aggregateSleepByDay(entries) {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start);
    if (key in sums) sums[key] += parseDuration(e.duration);
  });
  return days.map((d) => ({ day: d.label, hours: Math.round(sums[d.dateStr] * 10) / 10 }));
}

export function aggregateTummyByDay(entries) {
  const days = getLast7Days();
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start);
    if (key in sums) sums[key] += parseDuration(e.duration) * 60;
  });
  return days.map((d) => ({ day: d.label, minutes: Math.round(sums[d.dateStr]) }));
}

function getLastNDays(n) {
  const result = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const month = d.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
    result.push({
      label: month,
      dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    });
  }
  return result;
}

export function dailyFeedingTotals(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start || e.time || e.date);
    if (key in sums) sums[key] += parseFloat(e.amount || 0);
  });
  const result = days.map((d) => ({ date: d.label, amount: Math.round(sums[d.dateStr]) }));
  const firstNonZero = result.findIndex((d) => d.amount > 0);
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}

export function getEntriesForDay(entries, dayLabel, dateKey = "start") {
  const days = getLast7Days();
  const targetDay = days.find((d) => d.label === dayLabel);
  if (!targetDay) return [];

  return entries.filter((e) => {
    const key = entryDateStr(e[dateKey] || e.time || e.date);
    return key === targetDay.dateStr;
  });
}

export function getEntriesForDate(entries, dateLabel, dateKey = "start") {
  const targetDate = dateLabel;
  return entries.filter((e) => {
    const entryDate = new Date(e[dateKey] || e.time || e.date);
    const formattedDate = entryDate.toLocaleDateString("es-ES", {
      month: "short",
      day: "numeric",
    });
    return formattedDate === targetDate;
  });
}

export function dailySleepTotals(entries, numDays = 30) {
  const days = getLastNDays(numDays);
  const sums = {};
  days.forEach((d) => (sums[d.dateStr] = 0));
  entries.forEach((e) => {
    const key = entryDateStr(e.start);
    if (key in sums) sums[key] += parseDuration(e.duration);
  });
  const result = days.map((d) => ({ date: d.label, hours: Math.round(sums[d.dateStr] * 10) / 10 }));
  const firstNonZero = result.findIndex((d) => d.hours > 0);
  return firstNonZero > 0 ? result.slice(firstNonZero) : result;
}
