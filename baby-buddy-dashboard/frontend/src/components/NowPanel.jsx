import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { parseDuration } from "../utils/formatters";
import { useUnits } from "../utils/units";

function timestampOf(entry, fields) {
  for (const field of fields) {
    if (entry?.[field]) return new Date(entry[field]);
  }
  return null;
}

function ago(date) {
  if (!date || Number.isNaN(date.getTime())) return "Sin datos";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
  const days = Math.floor(hours / 24);
  return `Hace ${days} ${days === 1 ? "día" : "días"}`;
}

function latest(entries, fields) {
  return [...(entries || [])].sort((a, b) => {
    const da = timestampOf(a, fields)?.getTime() || 0;
    const db = timestampOf(b, fields)?.getTime() || 0;
    return db - da;
  })[0];
}

function diaperLabel(entry) {
  if (!entry) return "Sin datos";
  if (entry.wet && entry.solid) return "Pis y caca";
  if (entry.wet) return "Pis";
  if (entry.solid) return "Caca";
  return "Cambio";
}

function activeLabel(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("sleep") || value.includes("sueño")) return "Durmiendo";
  if (value.includes("tummy") || value.includes("boca abajo")) return "Boca abajo";
  if (value.includes("feeding") || value.includes("toma")) return "Toma";
  return name || "Actividad";
}

export default function NowPanel({ weeklyFeedings, weeklySleep, recentChanges, activeTimers, elapsedMap }) {
  const units = useUnits();
  const feeding = latest(weeklyFeedings, ["end", "start"]);
  const sleep = latest(weeklySleep, ["end", "start"]);
  const diaper = latest(recentChanges, ["time"]);
  const active = activeTimers?.[0];
  const feedingDate = timestampOf(feeding, ["end", "start"]);
  const sleepDate = timestampOf(sleep, ["end", "start"]);
  const diaperDate = timestampOf(diaper, ["time"]);
  const sleepHours = sleep ? parseDuration(sleep.duration) : 0;

  const cards = [
    {
      icon: <Icons.Bottle />,
      color: colors.feeding,
      label: "Última toma",
      value: feeding ? `${feeding.amount ? `${Math.round(Number(feeding.amount))} ${units.volume} · ` : ""}${ago(feedingDate)}` : "Sin datos",
    },
    {
      icon: <Icons.Droplet />,
      color: colors.diaper,
      label: "Último pañal",
      value: diaper ? `${diaperLabel(diaper)} · ${ago(diaperDate)}` : "Sin datos",
    },
    {
      icon: <Icons.Moon />,
      color: colors.sleep,
      label: "Último sueño",
      value: sleep ? `${sleepHours.toFixed(1)} h · ${ago(sleepDate)}` : "Sin datos",
    },
    {
      icon: <Icons.Timer />,
      color: active ? "#F59E0B" : "#22C55E",
      label: "Estado actual",
      value: active ? `${activeLabel(active.name)} · ${Math.floor((elapsedMap?.[active.id] || 0) / 60)} min` : "Sin actividad en curso",
    },
  ];

  return (
    <section className="now-panel fade-in">
      <div className="now-panel-heading">
        <div>
          <span className="eyebrow">AHORA</span>
          <h2>Situación de un vistazo</h2>
        </div>
        <span className={`now-status-dot${active ? " now-status-dot-active" : ""}`}>
          {active ? "Actividad en curso" : "Todo tranquilo"}
        </span>
      </div>
      <div className="now-grid">
        {cards.map((item) => (
          <div className="now-item" key={item.label}>
            <span className="now-icon" style={{ color: item.color, background: `${item.color}16` }}>{item.icon}</span>
            <div>
              <div className="now-label">{item.label}</div>
              <div className="now-value">{item.value}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
