import { useMemo } from "react";
import { buildDailySummaries } from "../utils/dailySummary";
import { useUnits } from "../utils/units";

export default function DailySummaryCard({ data, onOpenHistory }) {
  const units = useUnits();
  const today = useMemo(() => buildDailySummaries(data, 1)[0], [data]);
  if (!today) return null;
  return (
    <section className="daily-summary-card fade-in">
      <div className="daily-summary-head">
        <div><span className="eyebrow">HOY</span><strong>Resumen del día</strong></div>
        <button type="button" onClick={onOpenHistory}>Ver historial</button>
      </div>
      <div className="daily-summary-grid">
        <div><span>🍼</span><strong>{today.feedings}</strong><small>{today.feedingAmount > 0 ? `${today.feedingAmount} ${units.volume}` : "tomas"}</small></div>
        <div><span>🧷</span><strong>{today.diapers}</strong><small>{today.both ? `${today.both} ambos` : "pañales"}</small></div>
        <div><span>😴</span><strong>{today.sleepHours.toFixed(1)} h</strong><small>sueño</small></div>
        <div><span>💊</span><strong>{today.medications}</strong><small>dosis</small></div>
        <div><span>🌡️</span><strong>{today.temperatureMax === null ? "—" : `${today.temperatureMax.toFixed(1)}°`}</strong><small>máxima</small></div>
      </div>
    </section>
  );
}
