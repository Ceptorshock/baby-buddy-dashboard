import { useMemo, useState } from "react";
import SectionCard from "./SectionCard";
import { Icons } from "./Icons";
import { buildDailySummaries, hasSummaryData, summaryDateLabel } from "../utils/dailySummary";
import { useUnits } from "../utils/units";
import { colors } from "../utils/colors";

function SummaryDetail({ item, units }) {
  if (!item) return null;
  return (
    <div className="daily-summary-detail">
      <div><span>🍼 Tomas</span><strong>{item.feedings}{item.feedingAmount > 0 ? ` · ${item.feedingAmount} ${units.volume}` : ""}</strong></div>
      <div><span>🧷 Pañales</span><strong>{item.diapers} · {item.wet} pis · {item.solid} caca · {item.both} ambos</strong></div>
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
                    {hasSummaryData(item) ? <span>🍼 {item.feedings} · 🧷 {item.diapers} · 😴 {item.sleepHours.toFixed(1)}h · 💊 {item.medications}{item.temperatureMax !== null ? ` · 🌡️ ${item.temperatureMax.toFixed(1)}°` : ""}</span> : <span>Sin registros</span>}
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
