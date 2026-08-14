import { useEffect, useState } from "react";
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

function timerList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
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
  const [error, setError] = useState("");
  const [timerLoading, setTimerLoading] = useState(Boolean(timerId));
  const [timerResolved, setTimerResolved] = useState(!timerId);

  useEffect(() => {
    if (!timerId || entry) return;
    let cancelled = false;

    api.getTimers()
      .then((payload) => {
        if (cancelled) return;
        const timer = timerList(payload).find((item) => String(item.id) === String(timerId));
        if (timer?.start) {
          setStart(toLocalDatetime(new Date(timer.start)));
          setEnd(toLocalDatetime(new Date()));
          setTimerResolved(true);
        }
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setTimerLoading(false);
      });

    return () => { cancelled = true; };
  }, [timerId, entry]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
      setError("La hora de fin debe ser igual o posterior a la hora de inicio.");
      return;
    }

    setSaving(true);

    try {
      const data = { type, method };
      if (amount) data.amount = parseFloat(amount);
      if (notes.trim()) data.notes = notes.trim();

      if (isEdit) {
        data.start = `${start}:00`;
        data.end = `${end}:00`;
        await api.updateFeeding(entry.id, data);
        onDone();
        return;
      }

      data.child = childId;

      if (timerId && !timerResolved) {
        data.timer = timerId;
      } else {
        data.start = `${start}:00`;
        data.end = `${end}:00`;
      }

      const created = await api.createFeeding(data);

      // Si hemos convertido el temporizador en horas manuales, ya no hace falta.
      if (timerId && timerResolved) {
        await api.deleteTimer(timerId).catch(() => null);
      }

      onDone({ type: "feeding", id: created.id, label: "Toma", childId });
    } catch (err) {
      setError(err?.message || "No se pudo guardar la toma.");
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Editar toma" : "Registrar toma"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {(isEdit || timerId) && (
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
            {isEdit ? (
              <>
                <strong style={{ color: "var(--text)" }}>Corrige la toma sin crear otra</strong>
                <div style={{ marginTop: 4 }}>
                  Puedes cambiar inicio y fin o alargar esta misma toma. La alarma de la siguiente toma seguirá contando desde el <strong>inicio</strong>.
                </div>
              </>
            ) : timerLoading ? (
              <strong>Cargando las horas del temporizador…</strong>
            ) : timerResolved ? (
              <>
                <strong style={{ color: "var(--text)" }}>Temporizador recuperado</strong>
                <div style={{ marginTop: 4 }}>
                  Antes de guardar puedes corregir la hora de <strong>inicio</strong> y de <strong>fin</strong>. Útil si empezaste el temporizador tarde.
                </div>
              </>
            ) : (
              <div>No se pudo recuperar el inicio del temporizador; se usará el temporizador original de Baby Buddy.</div>
            )}
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

        {(!timerId || timerResolved || isEdit) && (
          <>
            <FormField label="Inicio">
              <FormInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </FormField>

            <FormField label="Fin">
              <FormInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </FormField>

            {(isEdit || timerId) && (
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
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </FormField>

        {error && (
          <div style={{ marginBottom: 12, color: "#ef4444", fontSize: 12 }}>{error}</div>
        )}

        <FormButton color={colors.feeding} disabled={saving || timerLoading}>
          {saving ? "Guardando..." : isEdit ? "Actualizar toma" : "Guardar toma"}
        </FormButton>
      </form>
    </Modal>
  );
}
