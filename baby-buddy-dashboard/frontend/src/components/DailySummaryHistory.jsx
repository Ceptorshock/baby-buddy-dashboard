import { useMemo, useState } from "react";
import SectionCard from "./SectionCard";
import { Icons } from "./Icons";
import { buildDailySummaries, hasSummaryData, summaryDateLabel } from "../utils/dailySummary";
import { formatFeedingDuration } from "../utils/formatters";
import { useUnits } from "../utils/units";
import { colors } from "../utils/colors";

function timeOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function dayShort(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (key(date) === key(today)) return "Hoy";
  if (key(date) === key(yesterday)) return "Ayer";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

function RecentTimes({ data }) {
  const feedings = useMemo(
    () => [...(data.feedings || [])]
      .filter((x) => x?.start || x?.end)
      .sort((a, b) => new Date(b.start || b.end) - new Date(a.start || a.end))
      .slice(0, 5),
    [data.feedings]
  );

  const diapers = useMemo(
    () => [...(data.changes || [])]
      .filter((x) => x?.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 5),
    [data.changes]
  );

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
      gap: 10,
      marginBottom: 14,
    }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--bg)" }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>🍼 Últimas 5 tomas</div>
        {feedings.length ? feedings.map((entry, index) => {
          const startValue = entry.start || entry.end;
          return (
            <div
              key={entry.id || `${startValue}-${index}`}
              style={{
                padding: "8px 0",
                borderBottom: index === feedings.length - 1 ? "none" : "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 3 }}>
                <strong>{dayShort(startValue)}</strong>
                <strong style={{ color: colors.feeding }}>{formatFeedingDuration(entry)}</strong>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>
                <span><strong>Inicio:</strong> {timeOf(startValue)}</span>
                <span style={{ margin: "0 7px", opacity: 0.55 }}>·</span>
                <span><strong>Fin:</strong> {entry.end ? timeOf(entry.end) : "en curso"}</span>
              </div>
            </div>
          );
        }) : <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Sin tomas registradas</div>}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--bg)" }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>🧷 Últimos 5 pañales</div>
        {diapers.length ? diapers.map((entry) => (
          <div key={entry.id || entry.time} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 13 }}>
            <span>{dayShort(entry.time)} · {entry.wet && entry.solid ? "pis+caca" : entry.wet ? "pis" : entry.solid ? "caca" : "cambio"}</span>
            <strong>{timeOf(entry.time)}</strong>
          </div>
        )) : <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Sin cambios registrados</div>}
      </div>
    </div>
  );
}

function FeedingRows({ details }) {
  if (!details?.length) return null;
  return (
    <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
      {details.map((feeding, index) => (
        <div key={`${feeding.start}-${feeding.end}-${index}`} style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45 }}>
          <strong style={{ color: "var(--text)" }}>{feeding.start}</strong>
          {" → "}
          <strong style={{ color: "var(--text)" }}>{feeding.end}</strong>
          {" · "}
          {feeding.duration}
        </div>
      ))}
    </div>
  );
}

function TimesLine({ title, times }) {
  if (!times?.length) return null;
  return (
    <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45 }}>
      <span style={{ fontWeight: 700 }}>{title}:</span> {times.join(" · ")}
    </div>
  );
}

function SummaryDetail({ item, units }) {
  if (!item) return null;
  return (
    <div className="daily-summary-detail">
      <div>
        <span>🍼 Tomas</span>
        <strong>
          {item.feedings} · {item.feedingMinutes || 0} min totales
          {item.feedingAmount > 0 ? ` · ${item.feedingAmount} ${units.volume}` : ""}
        </strong>
        <FeedingRows details={item.feedingDetails} />
      </div>

      <div>
        <span>🧷 Pañales</span>
        <strong>{item.diapers} · {item.wet} pis · {item.solid} caca · {item.both} ambos</strong>
        <TimesLine title="Horas" times={item.diaperTimes} />
      </div>

      <div><span>😴 Sueño</span><strong>{item.sleepHours.toFixed(1)} h</strong></div>
      <div><span>🤸 Boca abajo</span><strong>{item.tummyMinutes} min</strong></div>
      <div><span>💊 Medicación</span><strong>{item.medications} dosis</strong></div>
      <div><span>🌡️ Temperatura</span><strong>{item.temperatureMax === null ? "Sin mediciones" : `Máx. ${item.temperatureMax.toFixed(1)} °C · ${item.temperatureCount} medición${item.temperatureCount === 1 ? "" : "es"}`}</strong></div>
    </div>
  );
}

export default function DailySummaryHistory({ data }) {
  const units = useUnits();
  const summaries = useMemo(() => buildDailySummaries(data, 30), [data]);
  const [section, setSection] = useState("today");
  const [selected, setSelected] = useState(null);
  const today = summaries[0];
  const yesterday = summaries[1];

  return (
    <div className="daily-summary-history-wrap fade-in">
      <SectionCard title="Resúmenes diarios" icon={<Icons.History />} color={colors.feeding}>
        <RecentTimes data={data} />

        <div style={{
          padding: "9px 11px",
          marginBottom: 12,
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text-muted)",
          fontSize: 12,
        }}>
          ✎ Para corregir una toma, un sueño o un pañal, baja a sus historiales de esta misma pestaña y pulsa directamente sobre el registro. «Mostrar más» enseña todos los de hoy.
        </div>

        <div className="daily-summary-tabs">
          <button className={section === "today" ? "active" : ""} onClick={() => setSection("today")}>Hoy</button>
          <button className={section === "yesterday" ? "active" : ""} onClick={() => setSection("yesterday")}>Ayer</button>
          <button className={section === "history" ? "active" : ""} onClick={() => setSection("history")}>Historial</button>
        </div>

        {section === "today" && <><h4 className="daily-summary-date">{summaryDateLabel(today.dateKey, true)}</h4><SummaryDetail item={today} units={units} /></>}
        {section === "yesterday" && <><h4 className="daily-summary-date">{summaryDateLabel(yesterday.dateKey, true)}</h4><SummaryDetail item={yesterday} units={units} /></>}

        {section === "history" && (
          <div className="daily-summary-history-list">
            {summaries.map((item) => {
              const isSelected = selected === item.dateKey;
              return (
                <div className={`daily-summary-history-entry${isSelected ? " selected" : ""}`} key={item.dateKey}>
                  <button
                    type="button"
                    className={`daily-summary-history-row${isSelected ? " selected" : ""}`}
                    onClick={() => setSelected(isSelected ? null : item.dateKey)}
                  >
                    <strong>{summaryDateLabel(item.dateKey)}</strong>
                    {hasSummaryData(item)
                      ? <span>🍼 {item.feedings}/{item.feedingMinutes || 0} min · 🧷 {item.diapers} · 😴 {item.sleepHours.toFixed(1)}h · 💊 {item.medications}{item.temperatureMax !== null ? ` · 🌡️ ${item.temperatureMax.toFixed(1)}°` : ""}</span>
                      : <span>Sin registros</span>}
                  </button>
                  {isSelected && (
                    <div className="daily-summary-selected-inline">
                      <h4>{summaryDateLabel(item.dateKey, true)}</h4>
                      <SummaryDetail item={item} units={units} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
