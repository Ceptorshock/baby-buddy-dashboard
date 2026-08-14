import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormSelect, FormInput, FormButton } from "../Modal";
import { colors } from "../../utils/colors";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const COLORS = [
  { value: "", label: "Sin especificar" },
  { value: "black", label: "Negro" },
  { value: "brown", label: "Marrón" },
  { value: "green", label: "Verde" },
  { value: "yellow", label: "Amarillo" },
];

export default function DiaperForm({ childId, entry, diaperSize, onDone, onClose, preset }) {
  const isEdit = !!entry;
  const [time, setTime] = useState(entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date()));
  const [wet, setWet] = useState(entry ? entry.wet : (preset === "wet" || preset === "both"));
  const [solid, setSolid] = useState(entry ? entry.solid : (preset === "solid" || preset === "both"));
  const [color, setColor] = useState(entry?.color || "");
  const [notes, setNotes] = useState(entry?.notes || "");
  const [saving, setSaving] = useState(false);
  const [selectedSize, setSelectedSize] = useState(diaperSize?.state || "");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { wet, solid, time: `${time}:00` };
      if (color) data.color = color;
      if (notes.trim()) data.notes = notes.trim();

      if (isEdit) {
        await api.updateChange(entry.id, data);
      } else {
        data.child = childId;
        if (selectedSize) data._dashboard_diaper_size = selectedSize;
        const created = await api.createChange(data);
        const grocy = created?._grocy;
        onDone({
          type: "diaper",
          id: created.id,
          label: "Pañal",
          childId,
          diaper_size: selectedSize || diaperSize?.state || "",
          successMessage: grocy?.consumed
            ? `Pañal registrado · Grocy descontado (${grocy.size})`
            : "Pañal registrado · descuento de Grocy pendiente",
        });
      }

      if (isEdit) onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Editar cambio de pañal" : "Registrar cambio de pañal"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {isEdit && (
          <div style={{
            marginBottom: 14,
            padding: 10,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text-muted)",
            fontSize: 12,
          }}>
            Corrige aquí la hora y si fue <strong>pis</strong>, <strong>caca</strong> o ambos. Editar el tipo no descuenta otro pañal de Grocy.
          </div>
        )}

        <FormField label="Hora">
          <FormInput type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} required />
        </FormField>

        {!isEdit && diaperSize?.configured && diaperSize.available && (
          <FormField label="Talla para este cambio">
            <FormSelect
              options={(diaperSize.options || []).map((option) => ({ value: option, label: option }))}
              value={selectedSize}
              onChange={(e) => setSelectedSize(e.target.value)}
            />
            <div className="form-help" style={{ marginTop: 6 }}>
              Solo afecta a este pañal y al descuento de Grocy. <strong>No cambia la talla habitual</strong>.
            </div>
          </FormField>
        )}

        {!isEdit && (!diaperSize?.configured || !diaperSize.available) && (
          <div className="form-warning">
            No hay una talla de pañal disponible para este bebé en Home Assistant.
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {[
            { key: "wet", label: "Pis", active: wet, toggle: () => setWet(!wet) },
            { key: "solid", label: "Caca", active: solid, toggle: () => setSolid(!solid) },
          ].map((btn) => (
            <button
              key={btn.key}
              type="button"
              onClick={btn.toggle}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 10,
                border: btn.active ? `2px solid ${colors.diaper}` : "1px solid var(--border)",
                background: btn.active ? `${colors.diaper}15` : "var(--bg)",
                color: btn.active ? colors.diaper : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {solid && (
          <FormField label="Color">
            <FormSelect options={COLORS} value={color} onChange={(e) => setColor(e.target.value)} />
          </FormField>
        )}

        <FormField label="Notas">
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </FormField>

        <FormButton color={colors.diaper} disabled={saving || (!wet && !solid)}>
          {saving ? "Guardando..." : isEdit ? "Actualizar cambio" : "Guardar cambio"}
        </FormButton>
      </form>
    </Modal>
  );
}
