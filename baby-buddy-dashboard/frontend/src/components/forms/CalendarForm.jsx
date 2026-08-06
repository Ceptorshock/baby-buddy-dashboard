import { useMemo, useState } from "react";
import Modal, { FormButton, FormField, FormInput, FormSelect } from "../Modal";
import { api } from "../../api";

function pad(value) { return String(value).padStart(2, "0"); }
function dateInputValue(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function serviceDateTime(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`; }
function parseEventDate(value) {
  if (!value) return null;
  const date = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function CalendarForm({ childId, childName, entry, initialDate, onDone, onClose }) {
  const isEdit = Boolean(entry?.uid);
  const initialStart = useMemo(() => parseEventDate(entry?.start), [entry]);
  const initialEnd = useMemo(() => parseEventDate(entry?.end), [entry]);
  const tomorrow = useMemo(() => { const value = new Date(); value.setDate(value.getDate() + 1); return value; }, []);
  const selectedInitialDate = useMemo(() => parseEventDate(initialDate), [initialDate]);
  const baseStart = initialStart || selectedInitialDate || tomorrow;
  const initialDuration = initialStart && initialEnd ? Math.max(15, Math.round((initialEnd - initialStart) / 60000)) : 30;
  const [summary, setSummary] = useState(entry?.summary || "");
  const [date, setDate] = useState(dateInputValue(baseStart));
  const [time, setTime] = useState(initialStart ? `${pad(initialStart.getHours())}:${pad(initialStart.getMinutes())}` : "10:00");
  const [duration, setDuration] = useState(String([15,30,45,60,90,120].includes(initialDuration) ? initialDuration : 30));
  const [location, setLocation] = useState(entry?.location || "");
  const [description, setDescription] = useState(entry?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault(); setError("");
    if (!summary.trim() || !date || !time) { setError("Indica qué cita es, la fecha y la hora."); return; }
    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) { setError("La fecha o la hora no son válidas."); return; }
    const end = new Date(start.getTime() + Number(duration || 30) * 60000);
    const payload = {
      summary: summary.trim(), start_date_time: serviceDateTime(start), end_date_time: serviceDateTime(end),
      location: location.trim(), description: description.trim(),
    };
    if (isEdit) {
      payload.uid = entry.uid; payload.recurrence_id = entry.recurrence_id || ""; payload.recurrence_range = "";
    }
    setSaving(true);
    try {
      const result = isEdit ? await api.updateCalendarEvent(childId, payload) : await api.createCalendarEvent(childId, payload);
      onDone(result);
    } catch (err) { setError(`No se pudo ${isEdit ? "actualizar" : "crear"} la cita: ${err.message}`); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`${isEdit ? "Editar" : "Añadir"} cita · ${childName || "Bebé"}`} onClose={onClose}>
      <form onSubmit={submit}>
        <FormField label="Qué es"><FormInput value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Pediatra, vacuna, revisión…" autoFocus /></FormField>
        <div className="calendar-form-grid">
          <FormField label="Fecha"><FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
          <FormField label="Hora"><FormInput type="time" value={time} onChange={(e) => setTime(e.target.value)} /></FormField>
        </div>
        <FormField label="Duración estimada"><FormSelect value={duration} onChange={(e) => setDuration(e.target.value)} options={[
          { value:"15",label:"15 minutos" },{ value:"30",label:"30 minutos" },{ value:"45",label:"45 minutos" },
          { value:"60",label:"1 hora" },{ value:"90",label:"1 hora y 30 minutos" },{ value:"120",label:"2 horas" },
        ]} /></FormField>
        <FormField label="Lugar"><FormInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Centro de salud, hospital…" /></FormField>
        <FormField label="Notas (opcional)"><textarea className="calendar-notes-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Llevar cartilla, documentación…" rows={3} /></FormField>
        {error && <div className="calendar-form-error">{error}</div>}
        <FormButton type="submit" color="#8B5CF6" disabled={saving} style={{ color:"white", opacity: saving ? 0.65 : 1 }}>
          {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar cita"}
        </FormButton>
      </form>
    </Modal>
  );
}
