import { useMemo, useState } from "react";
import SectionCard from "./SectionCard";
import TimelineItem from "./TimelineItem";
import { Icons } from "./Icons";
import { api } from "../api";
import { colors } from "../utils/colors";
import { formatTime, timeAgo } from "../utils/formatters";

function intervalMilliseconds(value) {
  const parts = String(value || "").split(":").map(Number);
  if (!parts.length) return 0;
  return ((parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)) * 1000;
}

function localTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function doseText(entry) {
  if (entry.dosage === null || entry.dosage === undefined || entry.dosage === "") return "";
  return `${entry.dosage} ${entry.dosage_unit || ""}`.trim();
}

function activeRegimens(medications) {
  const latestByName = new Map();
  for (const entry of medications || []) {
    const key = String(entry?.name || "").trim().toLocaleLowerCase("es-ES");
    if (!key || latestByName.has(key)) continue;
    latestByName.set(key, entry);
  }
  return [...latestByName.values()]
    .map((entry) => {
      const intervalMs = intervalMilliseconds(entry.next_dose_interval);
      const administeredAt = new Date(entry.time);
      const nextAt = intervalMs > 0 && !Number.isNaN(administeredAt.getTime())
        ? new Date(administeredAt.getTime() + intervalMs)
        : null;
      return { entry, intervalMs, nextAt };
    })
    .filter((item) => item.nextAt)
    .sort((a, b) => a.nextAt - b.nextAt);
}

export default function MedicationCard({ medications = [], childId, onEditEntry, onAdd, onCreateScheduled, onChanged }) {
  const recent = medications.slice(0, 5);
  const regimens = useMemo(() => activeRegimens(medications), [medications]);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");

  const registerScheduledDose = async ({ entry, nextAt }) => {
    if (!childId || !entry || !nextAt) return;
    setBusyId(`dose:${entry.id}`);
    setMessage("");
    try {
      const administeredNow = new Date();
      const data = {
        child: childId,
        name: entry.name,
        time: localTimestamp(administeredNow),
        next_dose_interval: entry.next_dose_interval,
      };
      if (entry.dosage !== null && entry.dosage !== undefined && entry.dosage !== "") data.dosage = entry.dosage;
      if (entry.dosage_unit) data.dosage_unit = entry.dosage_unit;
      if (entry.notes) data.notes = entry.notes;
      const created = await api.createMedication(data);
      setMessage(`${entry.name} registrado ahora (${formatTime(administeredNow)}). Próxima dosis calculada desde la hora real.`);
      onCreateScheduled?.({ type: "medication", id: created.id, label: entry.name, childId });
      await onChanged?.();
    } catch (error) {
      setMessage(`No se pudo registrar la dosis: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const endRegimen = async (entry) => {
    if (!entry?.id) return;
    const confirmed = window.confirm(`¿Finalizar la pauta de ${entry.name}?\n\nNo se borrará ninguna dosis ya registrada y dejarán de generarse próximas dosis y avisos.`);
    if (!confirmed) return;
    setBusyId(`end:${entry.id}`);
    setMessage("");
    try {
      await api.updateMedication(entry.id, { next_dose_interval: null });
      setMessage(`Pauta de ${entry.name} finalizada.`);
      await onChanged?.();
    } catch (error) {
      setMessage(`No se pudo finalizar la pauta: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade-in fade-in-2">
      <SectionCard title="Medicamentos" icon={<Icons.Pill />} color={colors.medication}>
        {regimens.length > 0 && (
          <div className="medication-regimens">
            <div className="medication-regimens-title">Pautas activas</div>
            {regimens.map(({ entry, nextAt }) => {
              const due = nextAt <= new Date();
              return (
                <div key={`regimen-${entry.id}`} className={`medication-regimen-row${due ? " is-due" : ""}`}>
                  <div className="medication-regimen-info">
                    <strong>{entry.name}{doseText(entry) ? ` · ${doseText(entry)}` : ""}</strong>
                    <span>{due ? "Dosis pendiente" : "Próxima dosis"} · {formatTime(nextAt)}</span>
                  </div>
                  <div className="medication-regimen-actions">
                    <button
                      type="button"
                      className="medication-quick-dose"
                      disabled={busyId === `dose:${entry.id}`}
                      title={`Registrar ahora. Hora prevista: ${formatTime(nextAt)}`}
                      onClick={() => registerScheduledDose({ entry, nextAt })}
                    >
                      <Icons.Pill />
                      {busyId === `dose:${entry.id}` ? "Guardando…" : `Dar ahora · ${formatTime(new Date())}`}
                    </button>
                    <button
                      type="button"
                      className="medication-icon-btn"
                      title="Dar ahora modificando dosis, hora o intervalo"
                      onClick={() => onEditEntry?.("medication", null, { ...entry, time: new Date().toISOString() })}
                    >
                      <Icons.Pencil />
                    </button>
                    <button
                      type="button"
                      className="medication-icon-btn"
                      title="Editar solo la pauta, sin registrar una dosis"
                      onClick={() => onEditEntry?.("medication", entry, null, { regimenOnly: true })}
                    >
                      <Icons.Settings />
                    </button>
                    <button
                      type="button"
                      className="medication-icon-btn medication-end-btn"
                      disabled={busyId === `end:${entry.id}`}
                      title="Finalizar pauta"
                      onClick={() => endRegimen(entry)}
                    >
                      <Icons.X />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {message && <div className="medication-message">{message}</div>}

        {recent.length ? (
          <div className="medication-list">
            {recent.map((entry, index) => (
              <div key={entry.id} className="entry-clickable" onClick={() => onEditEntry?.("medication", entry)}>
                <TimelineItem
                  time={formatTime(entry.time)}
                  label={`${entry.name}${doseText(entry) ? ` · ${doseText(entry)}` : ""}`}
                  detail={entry.notes || timeAgo(entry.time)}
                  color={colors.medication}
                  audit={entry._audit}
                  isLast={index === recent.length - 1}
                />
              </div>
            ))}
          </div>
        ) : <div className="empty-state-small">Todavía no hay medicamentos registrados</div>}
        <button className="section-action-btn" onClick={onAdd}><Icons.Plus /> Registrar medicamento / iniciar pauta</button>
      </SectionCard>
    </div>
  );
}
