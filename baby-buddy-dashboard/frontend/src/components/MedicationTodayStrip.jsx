import { regimenKey } from "../utils/medicationRegimens";

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

export default function MedicationTodayStrip({ regimens = [], medications = [], now = new Date() }) {
  if (!regimens.length) return null;
  return (
    <div className="medication-today">
      <div className="medication-today-title"><strong>Medicación de hoy</strong><span>Un vistazo a lo administrado y lo que queda pendiente</span></div>
      <div className="medication-today-list">
        {regimens.map((item) => {
          const nameKey = regimenKey(item.entry?.name);
          const todayEntries = medications.filter((entry) => regimenKey(entry.name) === nameKey && sameDay(entry.time, now)).sort((a, b) => new Date(a.time) - new Date(b.time));
          if (item.scheduleType === "daily_slots") {
            const slots = (item.regimen?.slots || []).filter((slot) => slot?.enabled !== false && slot?.time).sort((a, b) => String(a.time).localeCompare(String(b.time)));
            const used = new Set();
            const chips = slots.map((slot) => {
              const scheduled = atToday(slot.time, now);
              let best = null; let bestDiff = Infinity; let bestIndex = -1;
              todayEntries.forEach((entry, index) => { if (used.has(index)) return; const diff = Math.abs(new Date(entry.time) - scheduled); if (diff < bestDiff) { best = entry; bestDiff = diff; bestIndex = index; } });
              const done = best && bestDiff <= 5 * 60 * 60 * 1000;
              if (done) used.add(bestIndex);
              const overdue = !done && now > new Date(scheduled.getTime() + 30 * 60000);
              return <span key={slot.key || slot.time} className={`medication-day-chip ${done ? "done" : overdue ? "overdue" : "pending"}`} title={done ? `Administrado a las ${timeText(best.time)}` : `Previsto a las ${slot.time}`}><b>{slot.label || slot.time}</b>{done ? " ✓" : overdue ? " ⚠" : " ⏳"}<small>{done ? timeText(best.time) : slot.time}</small></span>;
            });
            return <div className="medication-day-row" key={nameKey}><strong>{item.entry.name}</strong><div className="medication-day-chips">{chips}</div></div>;
          }
          if (item.scheduleType === "interval") {
            const showNext = item.nextAt && (sameDay(item.nextAt, now) || item.nextAt <= now);
            return <div className="medication-day-row" key={nameKey}><strong>{item.entry.name}</strong><div className="medication-day-chips">{todayEntries.map((entry) => <span className="medication-day-chip done" key={entry.id}>✓<small>{timeText(entry.time)}</small></span>)}{showNext && <span className={`medication-day-chip ${item.nextAt <= now ? "overdue" : "pending"}`}>{item.nextAt <= now ? "⚠ Pendiente" : "⏳ Próxima"}<small>{timeText(item.nextAt)}</small></span>}{!todayEntries.length && !showNext && <span className="medication-day-chip prn">Sin dosis previstas hoy</span>}</div></div>;
          }
          return <div className="medication-day-row" key={nameKey}><strong>{item.entry.name}</strong><div className="medication-day-chips"><span className="medication-day-chip prn">Según necesidad<small>{todayEntries.length} dosis hoy</small></span></div></div>;
        })}
      </div>
    </div>
  );
}
