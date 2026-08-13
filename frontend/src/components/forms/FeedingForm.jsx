import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormSelect, FormInput, FormButton } from "../Modal";
import { colors } from "../../utils/colors";
import { useUnits } from "../../utils/units";

const TYPES = [
  { value: "breast milk", label: "Leche materna" },
  { value: "formula", label: "Leche de fórmula" },
  { value: "fortified breast milk", label: "Leche materna fortificada" },
  { value: "solid food", label: "Alimentos sólidos" },
];

const METHODS = [
  { value: "bottle", label: "Biberón" },
  { value: "left breast", label: "Pecho izquierdo" },
  { value: "right breast", label: "Pecho derecho" },
  { value: "both breasts", label: "Ambos pechos" },
  { value: "parent fed", label: "Dado por un adulto" },
  { value: "self fed", label: "Comió solo/a" },
];

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutes(value, minutes) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return toLocalDatetime(new Date(parsed.getTime() + minutes * 60000));
}

const quickButtonStyle = {
  flex: 1,
  minWidth: 72,
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--bg)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

export default function FeedingForm({ childId, timerId, entry, onDone, onClose }) {
  const units = useUnits();
  const isEdit = !!entry;
  const now = new Date();
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const [type, setType] = useState(entry?.type || "breast milk");
  const [method, setMethod] = useState(entry?.method || "bottle");
  const [amount, setAmount] = useState(entry?.amount != null ? String(entry.amount) : "");
  const [start, setStart] = useState(entry?.start ? toLocalDatetime(new Date(entry.start)) : toLocalDatetime(fifteenMinsAgo));
  const [end, setEnd] = useState(entry?.end ? toLocalDatetime(new Date(entry.end)) : toLocalDatetime(now));
  const [notes, setNotes] = useState(entry?.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { type, method };
      if (amount) data.amount = parseFloat(amount);
      if (notes.trim()) data.notes = notes.trim();
      if (isEdit) {
        data.start = `${start}:00`;
        data.end = `${end}:00`;
        await api.updateFeeding(entry.id, data);
      } else {
        data.child = childId;
        if (timerId) {
          data.timer = timerId;
        } else {
          data.start = `${start}:00`;
          data.end = `${end}:00`;
        }
        const created = await api.createFeeding(data);
        onDone({ type: "feeding", id: created.id, label: "Toma", childId });
      }
      if (isEdit) onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Editar toma" : "Registrar toma"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {isEdit && (
          <div style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.45,
          }}>
            <strong style={{ color: "var(--text)" }}>¿Ha vuelto a mamar después de una pausa?</strong>
            <div style={{ marginTop: 4 }}>
              Puedes alargar esta misma toma en vez de crear otra. La alerta de la siguiente toma seguirá contando desde la hora de <strong>inicio</strong>.
            </div>
          </div>
        )}

        <FormField label="Tipo">
          <FormSelect options={TYPES} value={type} onChange={(e) => setType(e.target.value)} />
        </FormField>
        <FormField label="Método">
          <FormSelect options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        </FormField>
        <FormField label={`Cantidad (${units.volume})`}>
          <FormInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Opcional" min="0" step="5" />
        </FormField>

        {(isEdit || !timerId) && (
          <>
            <FormField label="Inicio">
              <FormInput
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Fin">
              <FormInput
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </FormField>

            {isEdit && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: -4, marginBottom: 14 }}>
                <button type="button" style={quickButtonStyle} onClick={() => setEnd(addMinutes(end, 5))}>Fin +5 min</button>
                <button type="button" style={quickButtonStyle} onClick={() => setEnd(addMinutes(end, 10))}>Fin +10 min</button>
                <button type="button" style={quickButtonStyle} onClick={() => setEnd(addMinutes(end, 15))}>Fin +15 min</button>
                <button type="button" style={quickButtonStyle} onClick={() => setEnd(toLocalDatetime(new Date()))}>Fin = ahora</button>
              </div>
            )}
          </>
        )}

        <FormField label="Notas">
          <FormInput
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional"
          />
        </FormField>
        <FormButton color={colors.feeding} disabled={saving}>
          {saving ? "Guardando..." : isEdit ? "Actualizar toma" : "Guardar toma"}
        </FormButton>
      </form>
    </Modal>
  );
}
