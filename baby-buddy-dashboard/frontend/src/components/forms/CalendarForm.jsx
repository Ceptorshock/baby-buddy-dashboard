import { useMemo, useState } from "react";
import Modal, { FormButton, FormField, FormInput, FormSelect } from "../Modal";
import { api } from "../../api";

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function serviceDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export default function CalendarForm({ childId, childName, onDone, onClose }) {
  const tomorrow = useMemo(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    return value;
  }, []);
  const [summary, setSummary] = useState("");
  const [date, setDate] = useState(dateInputValue(tomorrow));
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!summary.trim() || !date || !time) {
      setError("Indica qué cita es, la fecha y la hora.");
      return;
    }
    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) {
      setError("La fecha o la hora no son válidas.");
      return;
    }
    const end = new Date(start.getTime() + Number(duration || 30) * 60000);
    setSaving(true);
    try {
      const created = await api.createCalendarEvent(childId, {
        summary: summary.trim(),
        start_date_time: serviceDateTime(start),
        end_date_time: serviceDateTime(end),
        location: location.trim(),
        description: description.trim(),
      });
      onDone(created);
    } catch (err) {
      setError(`No se pudo crear la cita: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Añadir cita · ${childName || "Bebé"}`} onClose={onClose}>
      <form onSubmit={submit}>
        <FormField label="Qué es">
          <FormInput
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Pediatra, vacuna, revisión…"
            autoFocus
          />
        </FormField>
        <div className="calendar-form-grid">
          <FormField label="Fecha">
            <FormInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </FormField>
          <FormField label="Hora">
            <FormInput type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </FormField>
        </div>
        <FormField label="Duración estimada">
          <FormSelect
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            options={[
              { value: "15", label: "15 minutos" },
              { value: "30", label: "30 minutos" },
              { value: "45", label: "45 minutos" },
              { value: "60", label: "1 hora" },
              { value: "90", label: "1 hora y 30 minutos" },
              { value: "120", label: "2 horas" },
            ]}
          />
        </FormField>
        <FormField label="Lugar">
          <FormInput
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Centro de salud, hospital…"
          />
        </FormField>
        <FormField label="Notas (opcional)">
          <textarea
            className="calendar-notes-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Llevar cartilla, documentación…"
            rows={3}
          />
        </FormField>
        {error && <div className="calendar-form-error">{error}</div>}
        <FormButton type="submit" color="#8B5CF6" disabled={saving} style={{ color: "white", opacity: saving ? 0.65 : 1 }}>
          {saving ? "Guardando…" : "Guardar cita"}
        </FormButton>
      </form>
    </Modal>
  );
}
