import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton } from "../Modal";
import { colors } from "../../utils/colors";
import { useUnits } from "../../utils/units";

function toLocalDatetime(value) {
  const date = value ? new Date(value) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TemperatureForm({ childId, entry, onDone, onClose }) {
  const units = useUnits();
  const isEdit = Boolean(entry?.id);
  const [temp, setTemp] = useState(
    entry?.temperature != null ? String(entry.temperature) : "",
  );
  const [time, setTime] = useState(toLocalDatetime(entry?.time));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!temp) return;
    setSaving(true);
    setError("");
    try {
      const data = {
        temperature: parseFloat(temp),
        time: `${time}:00`,
      };
      if (isEdit) {
        await api.updateTemperature(entry.id, data);
        onDone();
      } else {
        data.child = childId;
        const created = await api.createTemperature(data);
        onDone({ type: "temp", id: created.id, label: "Temperatura", childId });
      }
    } catch (err) {
      setError(err?.message || "No se pudo guardar la temperatura.");
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Editar temperatura" : "Registrar temperatura"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={`Temperatura (${units.temp})`}>
          <FormInput
            type="number"
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            placeholder="36.6"
            min="30"
            max="45"
            step="0.1"
            autoFocus
            required
          />
        </FormField>
        <FormField label="Hora">
          <FormInput
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </FormField>
        {error && (
          <div style={{ marginBottom: 12, color: "#EF4444", fontSize: 12 }}>
            {error}
          </div>
        )}
        <FormButton color={colors.temp} disabled={saving || !temp}>
          {saving ? "Guardando..." : isEdit ? "Actualizar temperatura" : "Guardar temperatura"}
        </FormButton>
      </form>
    </Modal>
  );
}
