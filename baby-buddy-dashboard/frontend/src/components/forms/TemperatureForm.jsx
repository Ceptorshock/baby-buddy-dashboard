import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton } from "../Modal";
import { colors } from "../../utils/colors";
import { useUnits } from "../../utils/units";

export default function TemperatureForm({ childId, onDone, onClose }) {
  const units = useUnits();
  const [temp, setTemp] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!temp) return;
    setSaving(true);
    try {
      const created = await api.createTemperature({
        child: childId,
        temperature: parseFloat(temp),
      });
      onDone({ type: "temp", id: created.id, label: "Temperatura", childId });
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title="Registrar temperatura" onClose={onClose}>
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
          />
        </FormField>
        <FormButton color={colors.temp} disabled={saving || !temp}>
          {saving ? "Guardando..." : "Guardar temperatura"}
        </FormButton>
      </form>
    </Modal>
  );
}
