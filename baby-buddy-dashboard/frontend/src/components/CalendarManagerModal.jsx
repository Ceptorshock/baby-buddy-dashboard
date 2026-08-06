import { useMemo, useState } from "react";
import Modal from "./Modal";
import { Icons } from "./Icons";

const WEEKDAYS=["L","M","X","J","V","S","D"];
function parseDate(event){const v=event?.start;if(!v)return null;const d=new Date(event.all_day?`${v}T00:00:00`:v);return Number.isNaN(d.getTime())?null:d;}
function keyDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function monthLabel(d){return d.toLocaleDateString("es-ES",{month:"long",year:"numeric"});}
function timeLabel(e,d){return e.all_day?"Todo el día":d.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});}

export default function CalendarManagerModal({ childName, status, onAdd, onEdit, onDelete, onClose }){
  const events=status?.all_events||[];
  const first=events.map(parseDate).find(Boolean)||new Date();
  const [month,setMonth]=useState(new Date(first.getFullYear(),first.getMonth(),1));
  const eventMap=useMemo(()=>{const map={};events.forEach(e=>{const d=parseDate(e);if(!d)return;const k=keyDate(d);(map[k]||(map[k]=[])).push(e);});return map;},[events]);
  const days=useMemo(()=>{const y=month.getFullYear(),m=month.getMonth();const firstDay=new Date(y,m,1);const offset=(firstDay.getDay()+6)%7;const count=new Date(y,m+1,0).getDate();return [...Array(offset).fill(null),...Array.from({length:count},(_,i)=>new Date(y,m,i+1))];},[month]);
  const monthEvents=events.filter(e=>{const d=parseDate(e);return d&&d.getFullYear()===month.getFullYear()&&d.getMonth()===month.getMonth();});
  return <Modal title={`Calendario · ${childName||"Bebé"}`} onClose={onClose} maxWidth={820}>
    <div className="full-calendar-toolbar"><div className="full-calendar-nav"><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><Icons.ChevronLeft/></button><strong>{monthLabel(month)}</strong><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><Icons.ChevronRight/></button></div><button className="calendar-add-btn" onClick={onAdd} disabled={!status?.can_create}><Icons.Plus/> Añadir cita</button></div>
    <div className="full-calendar-weekdays">{WEEKDAYS.map(d=><span key={d}>{d}</span>)}</div>
    <div className="full-calendar-grid">{days.map((date,index)=>{if(!date)return <div className="full-calendar-day full-calendar-day-empty" key={`e-${index}`}/>;const list=eventMap[keyDate(date)]||[];return <div className={`full-calendar-day${keyDate(date)===keyDate(new Date())?" full-calendar-today":""}`} key={keyDate(date)} onClick={()=>onAdd(date)} role="button" tabIndex={0} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onAdd(date);}}} title="Añadir cita este día"><span className="full-calendar-day-number">{date.getDate()}</span>{list.slice(0,2).map((e,i)=><button className="full-calendar-chip" key={`${e.uid||e.start}-${i}`} onClick={(event)=>{event.stopPropagation();onEdit(e);}} title={e.summary}>{e.summary}</button>)}{list.length>2&&<small>+{list.length-2}</small>}</div>})}</div>
    <div className="calendar-month-agenda"><h3>Citas de {monthLabel(month)}</h3>{monthEvents.length===0?<div className="calendar-empty">No hay citas este mes.</div>:monthEvents.map((e,i)=>{const d=parseDate(e);return <article className="calendar-agenda-row" key={`${e.uid||e.start}-${i}`}><div><strong>{e.summary}</strong><span>{d?.toLocaleDateString("es-ES",{weekday:"short",day:"2-digit",month:"short"})} · {timeLabel(e,d)}{e.location?` · ${e.location}`:""}</span></div><div className="calendar-event-actions"><button className="calendar-icon-btn" onClick={()=>onEdit(e)} disabled={!status?.can_update||!e.uid}><Icons.Pencil/></button><button className="calendar-icon-btn calendar-delete-btn" onClick={()=>onDelete(e)} disabled={!status?.can_delete||!e.uid}><Icons.X/></button></div></article>})}</div>
  </Modal>;
}
