import { useEffect, useMemo, useState } from "react";
import { enabledDailySlots, regimenKey } from "../utils/medicationRegimens";

function sameDay(value, now) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function atToday(time, now) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const date = new Date(now);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function timeText(value) {
  return new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function slotTimesText(entries) {
  const times = [...new Set(entries.map((row) => row.slot.time).filter(Boolean))].sort();
  if (!times.length) return "—";
  if (times.length === 1) return times[0];
  return `${times[0]}–${times[times.length - 1]}`;
}

function assignEntriesToSlots(item, todayEntries, now) {
  const slots = enabledDailySlots(item.regimen?.slots || []);
  const assigned = new Map();
  const usedEntries = new Set();

  // La última franja registrada por la app es la referencia más fiable cuando
  // una dosis se dio bastante antes o después de su hora prevista.
  const marker = item.regimen?.last_scheduled_for ? new Date(item.regimen.last_scheduled_for) : null;
  if (marker && !Number.isNaN(marker.getTime()) && sameDay(marker, now) && todayEntries.length) {
    const markerSlot = slots.reduce((best, slot) => {
      const diff = Math.abs(atToday(slot.time, now) - marker);
      return !best || diff < best.diff ? { slot, diff } : best;
    }, null);
    if (markerSlot?.slot) {
      const latestIndex = todayEntries.reduce((bestIndex, entry, index) => {
        if (bestIndex < 0) return index;
        return new Date(entry.time) > new Date(todayEntries[bestIndex].time) ? index : bestIndex;
      }, -1);
      if (latestIndex >= 0) {
        assigned.set(markerSlot.slot.key, todayEntries[latestIndex]);
        usedEntries.add(latestIndex);
      }
    }
  }

  const candidates = [];
  slots.forEach((slot) => {
    if (assigned.has(slot.key)) return;
    const scheduled = atToday(slot.time, now);
    todayEntries.forEach((entry, entryIndex) => {
      if (usedEntries.has(entryIndex)) return;
      const diff = Math.abs(new Date(entry.time) - scheduled);
      if (diff <= 5 * 60 * 60 * 1000) candidates.push({ slot, entry, entryIndex, diff });
    });
  });
  candidates.sort((a, b) => a.diff - b.diff);
  const usedSlots = new Set(assigned.keys());
  for (const candidate of candidates) {
    if (usedSlots.has(candidate.slot.key) || usedEntries.has(candidate.entryIndex)) continue;
    assigned.set(candidate.slot.key, candidate.entry);
    usedSlots.add(candidate.slot.key);
    usedEntries.add(candidate.entryIndex);
  }
  return assigned;
}

function DailySlotGroup({ group, busy, onRegisterSlot }) {
  const pending = group.entries.filter((row) => !row.doneEntry);
  const pendingKeys = pending.map((row) => row.key);
  const [selected, setSelected] = useState(() => new Set(pendingKeys));

  useEffect(() => {
    setSelected(new Set(pendingKeys));
  }, [pendingKeys.join("|")]);

  const selectedRows = pending.filter((row) => selected.has(row.key));
  const allSelected = pending.length > 0 && selectedRows.length === pending.length;
  const overdue = pending.some((row) => row.scheduled < group.now);

  const toggle = (key) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className={`medication-slot-group${pending.length === 0 ? " is-complete" : overdue ? " is-overdue" : ""}`}>
      <div className="medication-slot-group-head">
        <div>
          <strong>{group.label}</strong>
          <span>{slotTimesText(group.entries)}</span>
        </div>
        <small>{pending.length === 0 ? "Todo dado ✓" : `${pending.length} pendiente${pending.length === 1 ? "" : "s"}`}</small>
      </div>

      <div className="medication-slot-med-list">
        {group.entries.map((row) => {
          const done = Boolean(row.doneEntry);
          const checked = done || selected.has(row.key);
          const dose = row.item.entry?.dosage !== null && row.item.entry?.dosage !== undefined && row.item.entry?.dosage !== ""
            ? `${row.item.entry.dosage} ${row.item.entry.dosage_unit || ""}`.trim()
            : "Dosis sin especificar";
          return (
            <label key={row.key} className={`medication-slot-med${done ? " is-done" : ""}`}>
              <input type="checkbox" checked={checked} disabled={done || busy} onChange={() => toggle(row.key)} />
              <span className="medication-slot-med-check">{done ? "✓" : ""}</span>
              <span className="medication-slot-med-name"><strong>{row.item.entry.name}</strong><small>{dose}</small></span>
              <span className="medication-slot-med-status">{done ? `Dado ${timeText(row.doneEntry.time)}` : row.slot.time}</span>
            </label>
          );
        })}
      </div>

      {pending.length > 0 && (
        <button
          type="button"
          className="medication-slot-give-btn"
          disabled={busy || selectedRows.length === 0}
          onClick={() => onRegisterSlot?.({ group, items: selectedRows })}
        >
          {busy ? "Registrando…" : allSelected ? `Dar todas (${selectedRows.length})` : `Dar seleccionadas (${selectedRows.length})`}
        </button>
      )}
    </div>
  );
}

export default function MedicationTodayStrip({ regimens = [], medications = [], now = new Date(), busyId = null, onRegisterSlot }) {
  if (!regimens.length) return null;

  const { groups, others } = useMemo(() => {
    const grouped = new Map();
    const nonDaily = [];

    for (const item of regimens) {
      const nameKey = regimenKey(item.entry?.name);
      const todayEntries = medications
        .filter((entry) => regimenKey(entry.name) === nameKey && sameDay(entry.time, now))
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      if (item.scheduleType !== "daily_slots") {
        nonDaily.push({ item, todayEntries });
        continue;
      }

      const assigned = assignEntriesToSlots(item, todayEntries, now);
      for (const slot of enabledDailySlots(item.regimen?.slots || [])) {
        const key = slot.key || slot.label || slot.time;
        if (!grouped.has(key)) grouped.set(key, { key, label: slot.label || key, entries: [], now });
        grouped.get(key).entries.push({
          key: `${nameKey}:${key}`,
          item,
          slot,
          scheduled: atToday(slot.time, now),
          doneEntry: assigned.get(slot.key) || null,
        });
      }
    }

    const slotGroups = [...grouped.values()].sort((a, b) => {
      const aTime = Math.min(...a.entries.map((row) => row.scheduled.getTime()));
      const bTime = Math.min(...b.entries.map((row) => row.scheduled.getTime()));
      return aTime - bTime;
    });
    return { groups: slotGroups, others: nonDaily };
  }, [regimens, medications, now]);

  return (
    <div className="medication-today">
      <div className="medication-today-title">
        <strong>Medicación de hoy</strong>
        <span>Los medicamentos se agrupan por momento del día. Marca solo los que realmente has dado.</span>
      </div>

      {groups.length > 0 && (
        <div className="medication-slot-groups">
          {groups.map((group) => (
            <DailySlotGroup
              key={group.key}
              group={group}
              busy={busyId === `slot:${group.key}`}
              onRegisterSlot={onRegisterSlot}
            />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="medication-other-today">
          <strong>Otras pautas</strong>
          {others.map(({ item, todayEntries }) => {
            const nameKey = regimenKey(item.entry?.name);
            if (item.scheduleType === "interval") {
              const showNext = item.nextAt && (sameDay(item.nextAt, now) || item.nextAt <= now);
              return (
                <div className="medication-day-row" key={nameKey}>
                  <strong>{item.entry.name}</strong>
                  <div className="medication-day-chips">
                    {todayEntries.map((entry) => <span className="medication-day-chip done" key={entry.id}>✓<small>{timeText(entry.time)}</small></span>)}
                    {showNext && <span className={`medication-day-chip ${item.nextAt <= now ? "overdue" : "pending"}`}>{item.nextAt <= now ? "⚠ Pendiente" : "⏳ Próxima"}<small>{timeText(item.nextAt)}</small></span>}
                    {!todayEntries.length && !showNext && <span className="medication-day-chip prn">Sin dosis previstas hoy</span>}
                  </div>
                </div>
              );
            }
            return <div className="medication-day-row" key={nameKey}><strong>{item.entry.name}</strong><div className="medication-day-chips"><span className="medication-day-chip prn">Según necesidad<small>{todayEntries.length} dosis hoy</small></span></div></div>;
          })}
        </div>
      )}
    </div>
  );
}
