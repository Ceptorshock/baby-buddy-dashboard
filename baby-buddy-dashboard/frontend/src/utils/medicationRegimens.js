export const DAILY_SLOT_PRESETS = [
  { key: "breakfast", label: "Desayuno", time: "08:30", enabled: true },
  { key: "midmorning", label: "Media mañana", time: "11:30", enabled: false },
  { key: "lunch", label: "Comida", time: "14:30", enabled: true },
  { key: "snack", label: "Merienda", time: "18:00", enabled: false },
  { key: "dinner", label: "Cena", time: "21:30", enabled: true },
  { key: "bedtime", label: "Antes de dormir", time: "23:30", enabled: false },
];

export function intervalMilliseconds(value) {
  const parts = String(value || "").split(":").map(Number);
  if (!parts.length) return 0;
  return ((parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)) * 1000;
}

export function regimenKey(name) {
  return String(name || "").trim().toLocaleLowerCase("es-ES");
}

export function normalizeScheduleType(regimen, fallbackEntry = {}) {
  const explicit = String(regimen?.schedule_type || "").trim();
  if (["interval", "daily_slots", "prn"].includes(explicit)) return explicit;
  if (regimen?.slots?.some?.((slot) => slot?.enabled !== false && slot?.time)) return "daily_slots";
  if (regimen?.next_dose_interval || fallbackEntry?.next_dose_interval) return "interval";
  return regimen ? "prn" : "none";
}

export function normalizeDailySlots(slots) {
  const incoming = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    const key = String(slot?.key || "").trim();
    if (key) incoming.set(key, slot);
  }
  const presets = DAILY_SLOT_PRESETS.map((preset) => {
    const stored = incoming.get(preset.key);
    return {
      key: preset.key,
      label: String(stored?.label || preset.label),
      time: /^\d{2}:\d{2}$/.test(String(stored?.time || "")) ? stored.time : preset.time,
      enabled: stored ? stored.enabled !== false : preset.enabled,
    };
  });
  for (const slot of Array.isArray(slots) ? slots : []) {
    const key = String(slot?.key || "").trim();
    if (!key || presets.some((item) => item.key === key)) continue;
    const time = String(slot?.time || "");
    if (!/^\d{2}:\d{2}$/.test(time)) continue;
    presets.push({ key, label: String(slot?.label || key), time, enabled: slot?.enabled !== false });
  }
  return presets;
}

export function enabledDailySlots(slots) {
  return normalizeDailySlots(slots)
    .filter((slot) => slot.enabled && /^\d{2}:\d{2}$/.test(slot.time))
    .sort((a, b) => a.time.localeCompare(b.time));
}

function dateAtTime(baseDate, hhmm) {
  const [hours, minutes] = String(hhmm || "00:00").split(":").map(Number);
  const result = new Date(baseDate);
  result.setHours(hours || 0, minutes || 0, 0, 0);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function nextDailySlot(regimen, latestAdministration, now = new Date(), earlyGraceMinutes = 20) {
  const slots = enabledDailySlots(regimen?.slots);
  if (!slots.length) return null;

  const latest = latestAdministration ? new Date(latestAdministration) : null;
  let reference = latest && !Number.isNaN(latest.getTime())
    ? new Date(latest.getTime() + Math.max(0, Number(earlyGraceMinutes || 0)) * 60000)
    : new Date(now.getTime() - 24 * 3600 * 1000);

  const marker = regimen?.last_scheduled_for ? new Date(regimen.last_scheduled_for) : null;
  if (marker && !Number.isNaN(marker.getTime()) && marker > reference) reference = marker;

  const candidates = [];
  const start = addDays(reference, -1);
  for (let day = 0; day < 4; day += 1) {
    const base = addDays(start, day);
    for (const slot of slots) {
      const at = dateAtTime(base, slot.time);
      if (at > reference) candidates.push({ slot, nextAt: at });
    }
  }
  candidates.sort((a, b) => a.nextAt - b.nextAt);
  if (!candidates.length) return null;

  const due = candidates.filter((item) => item.nextAt <= now);
  return due.length ? due[due.length - 1] : candidates[0];
}

export function describeRegimen(regimen) {
  const type = normalizeScheduleType(regimen);
  if (type === "daily_slots") {
    const labels = enabledDailySlots(regimen?.slots).map((slot) => slot.label);
    return labels.length ? labels.join(" · ") : "Horarios del día";
  }
  if (type === "prn") return "Según necesidad · sin avisos";
  return "Cada X tiempo";
}

export function effectiveMedicationEntry(entry, regimen) {
  if (!regimen) return entry;
  return {
    ...entry,
    dosage: regimen.dosage !== null && regimen.dosage !== undefined && regimen.dosage !== "" ? regimen.dosage : entry?.dosage,
    dosage_unit: regimen.dosage_unit || entry?.dosage_unit,
    next_dose_interval: regimen.next_dose_interval || entry?.next_dose_interval,
    schedule_type: normalizeScheduleType(regimen, entry),
    slots: normalizeDailySlots(regimen.slots),
    last_scheduled_for: regimen.last_scheduled_for || null,
  };
}
