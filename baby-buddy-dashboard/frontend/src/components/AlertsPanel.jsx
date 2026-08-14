import { Icons } from "./Icons";

function newestDate(entries, fields) {
  let newest = null;
  for (const entry of entries || []) {
    for (const field of fields) {
      if (!entry?.[field]) continue;
      const date = new Date(entry[field]);
      if (!Number.isNaN(date.getTime()) && (!newest || date > newest)) newest = date;
      break;
    }
  }
  return newest;
}

export default function AlertsPanel({ config, weeklyFeedings, activeTimers, elapsedMap, roomStatus }) {
  if (!config?.enabled) return null;
  const alerts = [];

  // Siempre INICIO -> INICIO. "end" solo sirve como respaldo para datos antiguos.
  const lastFeeding = newestDate(weeklyFeedings, ["start", "end"]);
  if (lastFeeding) {
    const mins = Math.floor((Date.now() - lastFeeding.getTime()) / 60000);
    if (mins >= config.feeding_minutes) {
      alerts.push(`Han pasado ${Math.floor(mins / 60)} h ${mins % 60} min desde el inicio de la última toma.`);
    }
  }

  const temperature = Number(roomStatus?.temperature);
  if (Number.isFinite(temperature)) {
    if (temperature < config.room_temp_min) alerts.push(`La habitación está fría: ${temperature.toFixed(1)} °C.`);
    if (temperature > config.room_temp_max) alerts.push(`La habitación está caliente: ${temperature.toFixed(1)} °C.`);
  }

  const stock = Number(roomStatus?.diaper_stock);
  const diaperSize = roomStatus?.diaper_size || "la talla activa";
  if (roomStatus?.diaper_stock_available && Number.isFinite(stock) && stock <= config.diaper_stock_low_threshold) {
    alerts.push(`Quedan ${stock} pañales de ${diaperSize}.`);
  }

  if (!alerts.length) return null;
  return (
    <div className="alerts-panel fade-in">
      <span className="alerts-icon"><Icons.Alert /></span>
      <div>
        <strong>Avisos</strong>
        {alerts.map((message) => <div className="alert-line" key={message}>{message}</div>)}
      </div>
    </div>
  );
}
