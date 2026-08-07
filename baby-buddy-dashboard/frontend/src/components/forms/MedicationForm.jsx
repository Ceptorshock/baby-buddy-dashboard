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

export default function MedicationForm({ childId, entry, prefill, regimenOnly = false, onDone, onClose }) {
  const isEdit = !!entry;
  // En edición de pauta, prefill contiene la plantilla efectiva (incluidos cambios
  // de dosis futuros que no deben reescribir una administración ya registrada).
  const source = regimenOnly ? (prefill || entry || {}) : (entry || prefill || {});
  const initialInterval = parseInterval(source?.next_dose_interval);
  const [name, setName] = useState(source?.name || "");
  const [dosage, setDosage] = useState(source?.dosage ?? "");
  const [dosageUnit, setDosageUnit] = useState(source?.dosage_unit || "ml");
  const [time, setTime] = useState(source?.time ? toLocalDatetime(new Date(source.time)) : toLocalDatetime(new Date()));
  const [intervalHours, setIntervalHours] = useState(initialInterval.hours || "");
  const [intervalMinutes, setIntervalMinutes] = useState(initialInterval.minutes || "");
  const [notes, setNotes] = useState(source?.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const intervalValue = () => {
    const hours = Math.max(0, Number(intervalHours || 0));
    const minutes = Math.max(0, Math.min(59, Number(intervalMinutes || 0)));
    return hours || minutes
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
      : "";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const interval = intervalValue();

      if (regimenOnly) {
        // Guardamos la DOSIS FUTURA en la configuración de la pauta. No tocamos
        // la dosis de la última administración histórica en Baby Buddy.
        await api.setMedicationRegimen(childId, {
          name: name.trim(),
          dosage: dosage === "" ? null : Number(dosage),
          dosage_unit: dosage === "" ? "" : dosageUnit,
          next_dose_interval: interval,
          active: Boolean(interval),
        });
        // next_dose_interval sí es metadata de la pauta de la última dosis y es
        // lo único que actualizamos en Baby Buddy para mantener compatibilidad.
        if (entry?.id) {
          await api.updateMedication(entry.id, { next_dose_interval: interval || null });
        }
        onDone();
        return;
      }

      const data = { name: name.trim(), time: `${time}:00` };
      if (dosage !== "") {
        data.dosage = Number(dosage);
        if (dosageUnit) data.dosage_unit = dosageUnit;
      } else if (isEdit && entry?.dosage !== null && entry?.dosage !== undefined) {
        data.dosage = null;
      }
      if (interval) {
        data.next_dose_interval = interval;
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
        // Una dosis nueva con intervalo define/actualiza la plantilla de futuras
        // dosis; así el engranaje y los avisos comparten la misma pauta.
        if (interval) {
          await api.setMedicationRegimen(childId, {
            name: name.trim(),
            dosage: dosage === "" ? null : Number(dosage),
            dosage_unit: dosage === "" ? "" : dosageUnit,
            next_dose_interval: interval,
            active: true,
          }).catch(() => null);
        }
        onDone({ type: "medication", id: created.id, label: name.trim(), childId });
      }
    } catch (err) {
      setError(err.message || "No se pudo guardar el medicamento.");
      setSaving(false);
    }
  };

  return (
    <Modal title={regimenOnly ? `Editar pauta · ${name || "Medicamento"}` : isEdit ? "Editar medicamento" : prefill ? "Registrar dosis" : "Registrar medicamento"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {!regimenOnly && <>
          <FormField label="Medicamento">
            <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Paracetamol" autoFocus required />
          </FormField>
        </>}

        {regimenOnly && (
          <div className="form-help" style={{ marginBottom: 12 }}>
            Estos cambios se aplican a las próximas dosis. No modifican cuántos comprimidos/ml se registraron en dosis anteriores.
          </div>
        )}

        <div className="form-two-columns">
          <FormField label={regimenOnly ? "Dosis para próximas tomas" : "Dosis"}>
            <FormInput type="number" min="0" step="0.01" value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="Opcional" />
          </FormField>
          <FormField label="Unidad">
            <FormSelect options={UNITS} value={dosageUnit} onChange={(e) => setDosageUnit(e.target.value)} />
          </FormField>
        </div>

        {!regimenOnly && (
          <FormField label="Hora administrada">
            <FormInput type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} required />
          </FormField>
        )}

        <FormField label="Intervalo hasta la próxima dosis (opcional)">
          <div className="form-two-columns">
            <FormInput type="number" min="0" max="168" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} placeholder="Horas" />
            <FormInput type="number" min="0" max="59" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} placeholder="Minutos" />
          </div>
          <div className="form-help">Es un recordatorio de la pauta que introduzcáis; la app no determina la pauta médica.</div>
        </FormField>

        {!regimenOnly && (
          <FormField label="Notas">
            <textarea className="form-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </FormField>
        )}

        {error && <div className="form-error">{error}</div>}
        <FormButton color={colors.medication} disabled={saving || !name.trim()}>
          {saving ? "Guardando..." : regimenOnly ? "Guardar pauta" : isEdit ? "Actualizar medicamento" : prefill ? "Registrar esta dosis" : "Guardar medicamento"}
        </FormButton>
      </form>
    </Modal>
  );
}
