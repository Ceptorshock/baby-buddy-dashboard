import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormSelect, FormButton } from "../Modal";
import { colors } from "../../utils/colors";
import { DAILY_SLOT_PRESETS, normalizeDailySlots, normalizeScheduleType } from "../../utils/medicationRegimens";

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

const SCHEDULE_TYPES = [
  { value: "interval", label: "Cada X tiempo" },
  { value: "daily_slots", label: "Horarios del día" },
  { value: "prn", label: "Según necesidad (sin avisos)" },
  { value: "none", label: "Dosis única / sin pauta" },
];

export default function MedicationForm({ childId, entry, prefill, regimenOnly = false, onDone, onClose }) {
  const isEdit = !!entry && !regimenOnly;
  const source = regimenOnly ? (prefill || entry || {}) : (entry || prefill || {});
  const initialInterval = parseInterval(source?.next_dose_interval);
  const inferredType = normalizeScheduleType(source, source);
  const [name, setName] = useState(source?.name || "");
  const [dosage, setDosage] = useState(source?.dosage ?? "");
  const [dosageUnit, setDosageUnit] = useState(source?.dosage_unit || "ml");
  const [time, setTime] = useState(source?.time ? toLocalDatetime(new Date(source.time)) : toLocalDatetime(new Date()));
  const [scheduleType, setScheduleType] = useState(regimenOnly ? (inferredType === "none" ? "interval" : inferredType) : inferredType);
  const [intervalHours, setIntervalHours] = useState(initialInterval.hours || "");
  const [intervalMinutes, setIntervalMinutes] = useState(initialInterval.minutes || "");
  const [slots, setSlots] = useState(() => normalizeDailySlots(source?.slots || DAILY_SLOT_PRESETS));
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

  const updateSlot = (key, patch) => {
    setSlots((current) => current.map((slot) => slot.key === key ? { ...slot, ...patch } : slot));
  };

  const regimenPayload = () => {
    const interval = scheduleType === "interval" ? intervalValue() : "";
    return {
      name: name.trim(),
      dosage: dosage === "" ? null : Number(dosage),
      dosage_unit: dosage === "" ? "" : dosageUnit,
      schedule_type: scheduleType,
      next_dose_interval: interval,
      slots: scheduleType === "daily_slots" ? slots : [],
      active: scheduleType !== "none",
      last_scheduled_for: source?._scheduled_for || source?.last_scheduled_for || null,
    };
  };

  const validateSchedule = () => {
    if (scheduleType === "interval" && !intervalValue()) return "Indica el intervalo de la pauta.";
    if (scheduleType === "daily_slots" && !slots.some((slot) => slot.enabled)) return "Activa al menos un horario del día.";
    return "";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    const scheduleError = regimenOnly || scheduleType !== "none" ? validateSchedule() : "";
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const regimen = regimenPayload();

      if (regimenOnly) {
        await api.setMedicationRegimen(childId, regimen);
        if (entry?.id) {
          await api.updateMedication(entry.id, {
            next_dose_interval: scheduleType === "interval" ? (regimen.next_dose_interval || null) : null,
          });
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
      if (scheduleType === "interval" && regimen.next_dose_interval) {
        data.next_dose_interval = regimen.next_dose_interval;
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
        if (scheduleType !== "none") {
          await api.setMedicationRegimen(childId, regimen).catch(() => null);
        }
        onDone({ type: "medication", id: created.id, label: name.trim(), childId });
      }
    } catch (err) {
      setError(err.message || "No se pudo guardar el medicamento.");
      setSaving(false);
    }
  };

  const scheduleOptions = regimenOnly ? SCHEDULE_TYPES.filter((item) => item.value !== "none") : SCHEDULE_TYPES;

  return (
    <Modal title={regimenOnly ? `Editar pauta · ${name || "Medicamento"}` : isEdit ? "Editar medicamento" : prefill ? "Registrar dosis" : "Registrar medicamento"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {!regimenOnly && (
          <FormField label="Medicamento">
            <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Paracetamol" autoFocus required />
          </FormField>
        )}

        {regimenOnly && (
          <div className="form-help" style={{ marginBottom: 12 }}>
            Estos cambios se aplican a las próximas dosis. No modifican las dosis ya registradas.
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

        <FormField label="Tipo de pauta">
          <FormSelect options={scheduleOptions} value={scheduleType} onChange={(e) => setScheduleType(e.target.value)} />
        </FormField>

        {scheduleType === "interval" && (
          <FormField label="Intervalo hasta la próxima dosis">
            <div className="form-two-columns">
              <FormInput type="number" min="0" max="168" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} placeholder="Horas" />
              <FormInput type="number" min="0" max="59" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} placeholder="Minutos" />
            </div>
            <div className="form-help">La siguiente toma se calcula desde la hora real de administración.</div>
          </FormField>
        )}

        {scheduleType === "daily_slots" && (
          <FormField label="Momentos del día">
            <div className="medication-slot-editor">
              {slots.map((slot) => (
                <div className={`medication-slot-row${slot.enabled ? " is-enabled" : ""}`} key={slot.key}>
                  <label className="medication-slot-check">
                    <input type="checkbox" checked={slot.enabled} onChange={(e) => updateSlot(slot.key, { enabled: e.target.checked })} />
                    <span>{slot.label}</span>
                  </label>
                  <FormInput
                    className="medication-slot-time"
                    type="time"
                    value={slot.time}
                    disabled={!slot.enabled}
                    style={{ padding: "8px 9px" }}
                    onChange={(e) => updateSlot(slot.key, { time: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="form-help">Activa solo las franjas prescritas. Las horas son editables.</div>
          </FormField>
        )}

        {scheduleType === "prn" && (
          <div className="form-help medication-prn-help">
            Quedará como acceso rápido «Dar ahora», pero no se calculará una próxima hora ni se enviarán avisos automáticos.
          </div>
        )}

        {scheduleType === "none" && (
          <div className="form-help medication-prn-help">
            Se registrará esta administración sin crear una pauta activa.
          </div>
        )}

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
