import SectionCard from "./SectionCard";
import { Icons } from "./Icons";

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function eventDate(event) {
  const value = event?.start;
  if (!value) return null;
  const date = new Date(event.all_day ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventTime(event, date) {
  if (event?.all_day) return "Todo el día";
  if (!date) return "Hora sin definir";
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export default function CalendarCard({ status, onAddEvent }) {
  if (!status?.configured) return null;
  const events = status.events || [];

  return (
    <SectionCard title="Próximas citas" icon={<Icons.Calendar />} color="#8B5CF6">
      <div className="calendar-actions-row">
        <button className="calendar-add-btn" type="button" onClick={onAddEvent}>
          <Icons.Plus />
          <span>Añadir cita</span>
        </button>
      </div>
      {!status.available ? (
        <div className="calendar-empty">No se pudo consultar el calendario.</div>
      ) : events.length === 0 ? (
        <div className="calendar-empty">No hay citas próximas.</div>
      ) : (
        <div className="calendar-events">
          {events.map((event, index) => {
            const date = eventDate(event);
            return (
              <article className="calendar-event" key={`${event.start}-${event.summary}-${index}`}>
                <div className="calendar-date-badge">
                  <span>{date ? date.getDate() : "—"}</span>
                  <small>{date ? MONTHS[date.getMonth()] : ""}</small>
                </div>
                <div className="calendar-event-body">
                  <div className="calendar-event-title">{event.summary || "Cita"}</div>
                  <div className="calendar-event-meta">
                    <span><Icons.Clock /> {eventTime(event, date)}</span>
                    {event.location && <span><Icons.MapPin /> {event.location}</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
