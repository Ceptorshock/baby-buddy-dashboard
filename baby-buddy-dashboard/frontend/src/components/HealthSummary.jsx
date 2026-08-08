import SectionCard from "./SectionCard";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { timeAgo } from "../utils/formatters";
import { useUnits } from "../utils/units";

export default function HealthSummary({ temperatures = [], onAddTemperature }) {
  const units = useUnits();
  const latest = temperatures?.[0] || null;
  const value = latest?.temperature ?? null;

  return (
    <SectionCard title="Temperatura corporal" icon={<Icons.Temp />} color={colors.temp}>
      <div className="health-temp-summary">
        <div className="health-temp-value">
          <span className="health-temp-icon"><Icons.Temp /></span>
          <div>
            <strong>{value !== null && value !== undefined ? `${value} ${units.temp}` : "Sin datos"}</strong>
            <span>{latest?.time ? timeAgo(latest.time) : "Todavía no hay registros"}</span>
          </div>
        </div>
        <button type="button" className="section-action-btn" onClick={onAddTemperature}>
          <Icons.Plus /> Registrar
        </button>
      </div>
    </SectionCard>
  );
}
