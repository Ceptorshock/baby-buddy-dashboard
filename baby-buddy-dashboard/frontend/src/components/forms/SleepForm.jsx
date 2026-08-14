import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton } from "../Modal";
import { colors } from "../../utils/colors";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function timerList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

export default function SleepForm({ childId, timerId, entry, onDone, onClose }) {
  const isEdit = !!entry;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [start, setStart] = useState(entry?.start ? toLocalDatetime(new Date(entry.start)) : toLocalDatetime(oneHourAgo));
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
      if (isEdit) {
        const data = {
          start: `${start}:00`,
          end: `${end}:00`,
        };
        if (notes.trim()) data.notes = notes.trim();
        await api.updateSleep(entry.id, data);
        onDone();
        return;
      }

      const data = { child: childId };
      if (notes.trim()) data.notes = notes.trim();

      if (timerId && !timerResolved) {
        data.timer = timerId;
      } else {
        data.start = `${start}:00`;
        data.end = `${end}:00`;
      }

      const created = await api.createSleep(data);

      if (timerId && timerResolved) {
        await api.deleteTimer(timerId).catch(() => null);
      }

      onDone({ type: "sleep", id: created.id, label: "Sueño", childId });
    } catch (err) {
      setError(err?.message || "No se pudo guardar el sueño.");
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Editar sueño" : "Registrar sueño"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {timerId && !isEdit && (
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
            {timerLoading
              ? "Cargando las horas del temporizador…"
              : timerResolved
                ? "Puedes corregir el inicio y el fin antes de guardar el sueño."
                : "No se pudo recuperar el inicio; se usará el temporizador original."}
          </div>
        )}

        {(!timerId || timerResolved || isEdit) && (
          <>
            <FormField label="Inicio">
              <FormInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </FormField>
            <FormField label="Fin">
              <FormInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </FormField>
          </>
        )}

        <FormField label="Notas">
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </FormField>

        {error && <div style={{ marginBottom: 12, color: "#ef4444", fontSize: 12 }}>{error}</div>}

        <FormButton color={colors.sleep} disabled={saving || timerLoading}>
          {saving ? "Guardando..." : isEdit ? "Actualizar sueño" : "Guardar sueño"}
        </FormButton>
      </form>
    </Modal>
  );
}
