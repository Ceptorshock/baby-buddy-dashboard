import SectionCard from "./SectionCard";
import { Icons } from "./Icons";

const MONTHS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function eventDate(event) { const value=event?.start; if(!value)return null; const d=new Date(event.all_day?`${value}T00:00:00`:value); return Number.isNaN(d.getTime())?null:d; }
function eventTime(event,date) { if(event?.all_day)return "Todo el día"; if(!date)return "Hora sin definir"; return date.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}); }

export default function CalendarCard({ status, onAddEvent, onOpenCalendar, onEditEvent, onDeleteEvent }) {
  if (!status?.configured) return null;
  const events=status.events||[]; const writable=status.can_create!==false;
  const headerAction=(<div className="calendar-header-actions">
    <button className="calendar-add-btn calendar-add-btn-header calendar-view-btn" type="button" onClick={onOpenCalendar} title="Abrir calendario completo"><Icons.Calendar/><span>Calendario</span></button>
    <button className="calendar-add-btn calendar-add-btn-header" type="button" onClick={onAddEvent} disabled={!writable} title={writable?"Añadir cita":status.write_error}><Icons.Plus/><span>Añadir</span></button>
  </div>);
  return <SectionCard title="Próximas citas" icon={<Icons.Calendar/>} color="#8B5CF6" headerAction={headerAction}>
    {!status.available ? <div className="calendar-empty">No se pudo consultar el calendario.</div>
    : events.length===0 ? <div className="calendar-empty">No hay citas próximas.</div>
    : <div className="calendar-events">{events.map((event,index)=>{const date=eventDate(event); return <article className="calendar-event" key={`${event.uid||event.start}-${index}`}>
        <div className="calendar-date-badge"><span>{date?date.getDate():"—"}</span><small>{date?MONTHS[date.getMonth()]:""}</small></div>
        <div className="calendar-event-body"><div className="calendar-event-title">{event.summary||"Cita"}</div><div className="calendar-event-meta"><span><Icons.Clock/> {eventTime(event,date)}</span>{event.location&&<span><Icons.MapPin/> {event.location}</span>}</div></div>
        <div className="calendar-event-actions">
          <button type="button" className="calendar-icon-btn" onClick={()=>onEditEvent(event)} disabled={!status.can_update||!event.uid} title="Editar cita"><Icons.Pencil/></button>
          <button type="button" className="calendar-icon-btn calendar-delete-btn" onClick={()=>onDeleteEvent(event)} disabled={!status.can_delete||!event.uid} title="Eliminar cita"><Icons.X/></button>
        </div>
      </article>})}</div>}
  </SectionCard>;
}
