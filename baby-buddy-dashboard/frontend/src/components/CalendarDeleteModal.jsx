import { useState } from "react";
import Modal from "./Modal";
import { api } from "../api";
export default function CalendarDeleteModal({ childId, event, onDone, onClose }){
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const remove=async()=>{setBusy(true);setError("");try{await api.deleteCalendarEvent(childId,{uid:event.uid,recurrence_id:event.recurrence_id||"",recurrence_range:""});onDone();}catch(err){setError(`No se pudo eliminar: ${err.message}`);}finally{setBusy(false);}};
  return <Modal title="Eliminar cita" onClose={onClose}><div className="calendar-delete-confirm"><div className="calendar-delete-symbol">×</div><strong>¿Eliminar «{event.summary||"Cita"}»?</strong><p>Se borrará también del calendario de Google. Esta acción no se puede deshacer.</p>{error&&<div className="calendar-form-error">{error}</div>}<div className="calendar-delete-buttons"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="calendar-delete-confirm-btn" onClick={remove} disabled={busy}>{busy?"Eliminando…":"Sí, eliminar"}</button></div></div></Modal>;
}
