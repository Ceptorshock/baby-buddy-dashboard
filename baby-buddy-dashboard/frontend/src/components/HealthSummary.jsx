import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import SectionCard from "./SectionCard";
import Modal from "./Modal";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { formatTime, timeAgo } from "../utils/formatters";
import { useUnits } from "../utils/units";

function dateKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(key, long = false) {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-ES", long
    ? { weekday: "long", day: "numeric", month: "long" }
    : { day: "2-digit", month: "2-digit" });
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function TemperatureTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="temperature-tooltip">
      <strong>{dayLabel(point.key, true)}</strong>
      <span>Máxima: {point.max.toFixed(1)} {unit}</span>
      <small>{point.count} medición{point.count === 1 ? "" : "es"} · media {point.avg.toFixed(1)} {unit}</small>
    </div>
  );
}

export default function HealthSummary({ temperatures = [], onAddTemperature }) {
  const units = useUnits();
  const [selectedDay, setSelectedDay] = useState(null);

  const valid = useMemo(() => (temperatures || [])
    .filter((entry) => entry?.time && Number.isFinite(Number(entry?.temperature)))
    .map((entry) => ({ ...entry, numericTemperature: Number(entry.temperature) }))
    .sort((a, b) => new Date(b.time) - new Date(a.time)), [temperatures]);

  const latest = valid[0] || null;

  const daily = useMemo(() => {
    const groups = new Map();
    for (const entry of valid) {
      const key = dateKey(entry.time);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    return [...groups.entries()]
      .map(([key, entries]) => {
        const values = entries.map((e) => e.numericTemperature);
        const max = Math.max(...values);
        const min = Math.min(...values);
        const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
        return {
          key,
          date: dayLabel(key),
          max: round1(max),
          min: round1(min),
          avg: round1(avg),
          count: entries.length,
          entries: [...entries].sort((a, b) => new Date(a.time) - new Date(b.time)),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [valid]);

  const chartData = daily.slice(-14);
  const today = daily.find((day) => day.key === dateKey(new Date())) || null;

  const openChartDay = (state) => {
    const point = state?.activePayload?.[0]?.payload;
    if (point?.key) setSelectedDay(point);
  };

  const headerAction = (
    <button type="button" className="section-header-action-btn" onClick={onAddTemperature}>
      <Icons.Plus /> Registrar
    </button>
  );

  return (
    <>
      <SectionCard
        title="Temperatura corporal"
        icon={<Icons.Temp />}
        color={colors.temp}
        headerAction={headerAction}
      >
        {!latest ? (
          <div className="temperature-empty">
            <span>Todavía no hay registros.</span>
            <small>Registra una temperatura para empezar a ver la evolución.</small>
          </div>
        ) : (
          <>
            <div className="temperature-stat-grid">
              <div className="temperature-stat">
                <span>Última</span>
                <strong>{latest.numericTemperature.toFixed(1)} {units.temp}</strong>
                <small>{timeAgo(latest.time)}</small>
              </div>
              <div className="temperature-stat temperature-stat-primary">
                <span>Máxima hoy</span>
                <strong>{today ? `${today.max.toFixed(1)} ${units.temp}` : "—"}</strong>
                <small>{today ? `${today.count} medición${today.count === 1 ? "" : "es"}` : "Sin mediciones hoy"}</small>
              </div>
              <div className="temperature-stat">
                <span>Media hoy</span>
                <strong>{today ? `${today.avg.toFixed(1)} ${units.temp}` : "—"}</strong>
                <small>{today ? `mín. ${today.min.toFixed(1)} ${units.temp}` : "—"}</small>
              </div>
            </div>

            <div className="temperature-chart-heading">
              <div>
                <strong>Máxima diaria</strong>
                <span>Últimos 14 días con mediciones</span>
              </div>
              <small>Toca un día para ver el detalle</small>
            </div>

            <div className="temperature-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} onClick={openChartDay} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis domain={["dataMin - 0.4", "dataMax + 0.4"]} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip content={<TemperatureTooltip unit={units.temp} />} />
                  <Line
                    type="monotone"
                    dataKey="max"
                    stroke={colors.temp}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: colors.temp, strokeWidth: 0 }}
                    activeDot={{ r: 6, cursor: "pointer" }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </SectionCard>

      {selectedDay && (
        <Modal title={`Temperatura · ${dayLabel(selectedDay.key, true)}`} onClose={() => setSelectedDay(null)}>
          <div className="temperature-day-summary">
            <div><span>Máxima</span><strong>{selectedDay.max.toFixed(1)} {units.temp}</strong></div>
            <div><span>Media</span><strong>{selectedDay.avg.toFixed(1)} {units.temp}</strong></div>
            <div><span>Mínima</span><strong>{selectedDay.min.toFixed(1)} {units.temp}</strong></div>
          </div>
          <div className="temperature-day-list">
            {selectedDay.entries.map((entry, index) => (
              <div className="temperature-day-entry" key={entry.id ?? `${entry.time}-${index}`}>
                <span>{formatTime(entry.time)}</span>
                <strong>{entry.numericTemperature.toFixed(1)} {units.temp}</strong>
              </div>
            ))}
          </div>
          <div className="temperature-day-note">
            {selectedDay.count} medición{selectedDay.count === 1 ? "" : "es"} registradas ese día.
          </div>
        </Modal>
      )}
    </>
  );
}
