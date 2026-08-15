import { useMemo, useState } from "react";
import ActivityTimeline from "../components/ActivityTimeline";
import { feedingDurationSeconds, parseDuration } from "../utils/formatters";

const RANGES = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
];

function startOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function filterEntries(entries, field, range, selectedDate) {
  const now = new Date();
  let min = null;
  let max = null;

  if (selectedDate) {
    min = new Date(`${selectedDate}T00:00:00`);
    max = new Date(`${selectedDate}T23:59:59.999`);
  } else if (range === "today") {
    min = startOfDay(now);
    max = now;
  } else if (range === "yesterday") {
    min = startOfDay(now);
    min.setDate(min.getDate() - 1);
    max = new Date(min);
    max.setHours(23, 59, 59, 999);
  } else {
    const days = range === "7d" ? 7 : 30;
    min = new Date(now.getTime() - days * 86400000);
    max = now;
  }

  return (entries || []).filter((entry) => {
    const value = entry?.[field];
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date >= min && date <= max;
  });
}

function rangeButton(active) {
  return {
    border: active ? "1px solid var(--text-muted)" : "1px solid var(--border)",
    borderRadius: 999,
    background: active ? "var(--surface)" : "var(--bg)",
    color: active ? "var(--text)" : "var(--text-muted)",
    padding: "7px 11px",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: active ? 800 : 650,
    cursor: "pointer",
  };
}

export default function HistoryTab({
  feedings = [],
  sleep = [],
  changes = [],
  medications = [],
  tummy = [],
  onEditEntry,
}) {
  const [range, setRange] = useState("today");
  const [selectedDate, setSelectedDate] = useState("");

  const filtered = useMemo(
    () => ({
      feedings: filterEntries(feedings, "start", range, selectedDate),
      sleep: filterEntries(sleep, "start", range, selectedDate),
      changes: filterEntries(changes, "time", range, selectedDate),
      medications: filterEntries(medications, "time", range, selectedDate),
      tummy: filterEntries(tummy, "start", range, selectedDate),
    }),
    [feedings, sleep, changes, medications, tummy, range, selectedDate],
  );

  const feedingMinutes = Math.round(
    filtered.feedings.reduce((sum, entry) => sum + feedingDurationSeconds(entry), 0) / 60,
  );
  const sleepMinutes = Math.round(
    filtered.sleep.reduce((sum, entry) => sum + parseDuration(entry.duration) * 60, 0),
  );

  return (
    <div className="fade-in">
      <div className="section-title-row" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">HISTORIAL</span>
          <h2>Consulta y corrige cualquier registro</h2>
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {RANGES.map((item) => (
          <button
            key={item.id}
            type="button"
            style={rangeButton(!selectedDate && range === item.id)}
            onClick={() => {
              setSelectedDate("");
              setRange(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
        <input
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          style={{ border: selectedDate ? "1px solid var(--text-muted)" : "1px solid var(--border)", borderRadius: 10, padding: "7px 9px", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit", fontSize: 12 }}
          title="Elegir un día concreto"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 14 }}>
        {[
          ["🍼 Tomas", filtered.feedings.length, `${feedingMinutes} min efectivos`],
          ["🧷 Pañales", filtered.changes.length, "cambios"],
          ["😴 Sueño", filtered.sleep.length, `${Math.floor(sleepMinutes / 60)} h ${sleepMinutes % 60} min`],
          ["💊 Medicación", filtered.medications.length, "dosis"],
        ].map(([label, value, detail]) => (
          <div key={label} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--card-bg)", padding: 11 }}>
            <span style={{ display: "block", color: "var(--text-muted)", fontSize: 11 }}>{label}</span>
            <strong style={{ display: "block", marginTop: 2, color: "var(--text)", fontSize: 18 }}>{value}</strong>
            <small style={{ color: "var(--text-dim)" }}>{detail}</small>
          </div>
        ))}
      </div>

      <ActivityTimeline
        feedings={filtered.feedings}
        sleep={filtered.sleep}
        changes={filtered.changes}
        medications={filtered.medications}
        tummy={filtered.tummy}
        onEditEntry={onEditEntry}
      />
    </div>
  );
}
