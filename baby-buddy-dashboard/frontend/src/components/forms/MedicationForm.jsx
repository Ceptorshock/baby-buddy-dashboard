import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormSelect, FormButton } from "../Modal";
import { colors } from "../../utils/colors";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseInterval(value) {
  const parts = String(value || "").split(":").map((part) => Number(part || 0));
  return { hours: parts[0] || 0, minutes: parts[1] || 0 };
}

const UNITS = [
  { value: "mg", label: "mg" },
  { value: "ml", label: "ml" },
  { value: "drops", label: "gotas" },
  { value: "tablets", label: "comprimidos" },
];

export default function MedicationForm({ childId, entry, onDone, onClose }) {
  const isEdit = !!entry;
  const initialInterval = parseInterval(entry?.next_dose_interval);
  const [name, setName] = useState(entry?.name || "");
  const [dosage, setDosage] = useState(entry?.dosage ?? "");
  const [dosageUnit, setDosageUnit] = useState(entry?.dosage_unit || "ml");
  const [time, setTime] = useState(entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date()));
  const [intervalHours, setIntervalHours] = useState(initialInterval.hours || "");
  const [intervalMinutes, setIntervalMinutes] = useState(initialInterval.minutes || "");
  const [notes, setNotes] = useState(entry?.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const data = { name: name.trim(), time: `${time}:00` };
      if (dosage !== "") {
        data.dosage = Number(dosage);
        if (dosageUnit) data.dosage_unit = dosageUnit;
      } else if (isEdit && entry?.dosage !== null && entry?.dosage !== undefined) {
        data.dosage = null;
      }
      const hours = Math.max(0, Number(intervalHours || 0));
      const minutes = Math.max(0, Math.min(59, Number(intervalMinutes || 0)));
      if (hours || minutes) {
        data.next_dose_interval = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
      } else if (isEdit && entry?.next_dose_interval) {
        data.next_dose_interval = null;
      }
      if (notes.trim()) data.notes = notes.trim();
      else if (isEdit && entry?.notes) data.notes = "";

      if (isEdit) {
        await api.updateMedication(entry.id, data);
        onDone();
      } else {
        data.child = childId;
        const created = await api.createMedication(data);
        onDone({ type: "medication", id: created.id, label: name.trim(), childId });
      }
    } catch (err) {
      setError(err.message || "No se pudo guardar el medicamento.");
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Editar medicamento" : "Registrar medicamento"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label="Medicamento">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Paracetamol" autoFocus required />
        </FormField>
        <div className="form-two-columns">
          <FormField label="Dosis">
            <FormInput type="number" min="0" step="0.01" value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="Opcional" />
          </FormField>
          <FormField label="Unidad">
            <FormSelect options={UNITS} value={dosageUnit} onChange={(e) => setDosageUnit(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Hora administrada">
          <FormInput type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} required />
        </FormField>
        <FormField label="Intervalo hasta la próxima dosis (opcional)">
          <div className="form-two-columns">
            <FormInput type="number" min="0" max="168" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} placeholder="Horas" />
            <FormInput type="number" min="0" max="59" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} placeholder="Minutos" />
          </div>
          <div className="form-help">Es solo un recordatorio de la pauta que introduzcáis; la app no calcula una dosis médica.</div>
        </FormField>
        <FormField label="Notas">
          <textarea className="form-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </FormField>
        {error && <div className="form-error">{error}</div>}
        <FormButton color={colors.medication} disabled={saving || !name.trim()}>
          {saving ? "Guardando..." : isEdit ? "Actualizar medicamento" : "Guardar medicamento"}
        </FormButton>
      </form>
    </Modal>
  );
}
