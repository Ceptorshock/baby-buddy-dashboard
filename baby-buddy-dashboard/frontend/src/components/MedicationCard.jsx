import { useEffect, useMemo, useState } from "react";
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

function regimenKey(name) {
  return String(name || "").trim().toLocaleLowerCase("es-ES");
}

function doseText(entry) {
  if (entry.dosage === null || entry.dosage === undefined || entry.dosage === "") return "";
  return `${entry.dosage} ${entry.dosage_unit || ""}`.trim();
}

function effectiveEntry(entry, regimenMap) {
  const regimen = regimenMap.get(regimenKey(entry?.name));
  if (!regimen) return entry;
  return {
    ...entry,
    dosage: regimen.dosage !== null && regimen.dosage !== undefined && regimen.dosage !== "" ? regimen.dosage : entry.dosage,
    dosage_unit: regimen.dosage_unit || entry.dosage_unit,
    next_dose_interval: regimen.next_dose_interval || entry.next_dose_interval,
  };
}

function activeRegimens(medications, regimenMap) {
  const latestByName = new Map();
  for (const entry of medications || []) {
    const key = regimenKey(entry?.name);
    if (!key || latestByName.has(key)) continue;
    latestByName.set(key, entry);
  }
  return [...latestByName.values()]
    .map((rawEntry) => {
      const entry = effectiveEntry(rawEntry, regimenMap);
      const intervalMs = intervalMilliseconds(entry.next_dose_interval);
      const administeredAt = new Date(rawEntry.time);
      const nextAt = intervalMs > 0 && !Number.isNaN(administeredAt.getTime())
        ? new Date(administeredAt.getTime() + intervalMs)
        : null;
      return { entry, rawEntry, intervalMs, nextAt };
    })
    .filter((item) => item.nextAt)
    .sort((a, b) => a.nextAt - b.nextAt);
}

export default function MedicationCard({ medications = [], childId, onEditEntry, onAdd, onCreateScheduled, onChanged }) {
  const recent = medications.slice(0, 5);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const [regimenMap, setRegimenMap] = useState(() => new Map());
  const [advanceMinutes, setAdvanceMinutes] = useState(20);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!childId) {
      setRegimenMap(new Map());
      return;
    }
    let cancelled = false;
    Promise.all([
      api.getMedicationRegimens(childId).catch(() => ({ regimens: [] })),
      api.getDashboardSettings().catch(() => ({ medication_alerts: { minutes_before: 20 } })),
    ]).then(([regimensResult, settings]) => {
      if (cancelled) return;
      const map = new Map();
      for (const item of regimensResult.regimens || []) {
        if (item?.name) map.set(regimenKey(item.name), item);
      }
      setRegimenMap(map);
      const minutes = Number(settings?.medication_alerts?.minutes_before ?? 20);
      setAdvanceMinutes(Number.isFinite(minutes) ? Math.max(0, minutes) : 20);
    });
    return () => { cancelled = true; };
  }, [childId, medications]);

  const regimens = useMemo(() => activeRegimens(medications, regimenMap), [medications, regimenMap]);

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
      await api.setMedicationRegimen(childId, {
        name: entry.name,
        dosage: entry.dosage ?? null,
        dosage_unit: entry.dosage_unit || "",
        next_dose_interval: entry.next_dose_interval || "",
        active: true,
      }).catch(() => null);
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
      await Promise.all([
        api.updateMedication(entry.id, { next_dose_interval: null }),
        api.deleteMedicationRegimen(childId, entry.name).catch(() => null),
      ]);
      setMessage(`Pauta de ${entry.name} finalizada.`);
      await onChanged?.();
    } catch (error) {
      setMessage(`No se pudo finalizar la pauta: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const stateFor = (nextAt) => {
    const deltaMinutes = (nextAt.getTime() - clock.getTime()) / 60000;
    if (deltaMinutes <= 0) return { cls: "is-due", text: `Pendiente desde hace ${Math.max(0, Math.floor(-deltaMinutes))} min` };
    if (deltaMinutes <= advanceMinutes) return { cls: "is-soon", text: `Toca en ${Math.max(1, Math.ceil(deltaMinutes))} min` };
    return { cls: "is-early", text: `Próxima dosis · ${formatTime(nextAt)}` };
  };

  return (
    <div className="fade-in fade-in-2">
      <SectionCard title="Medicamentos" icon={<Icons.Pill />} color={colors.medication}>
        {regimens.length > 0 && (
          <div className="medication-regimens">
            <div className="medication-regimens-title">Pautas activas</div>
            {regimens.map(({ entry, rawEntry, nextAt }) => {
              const state = stateFor(nextAt);
              return (
                <div key={`regimen-${rawEntry.id}`} className={`medication-regimen-row ${state.cls}`}>
                  <div className="medication-regimen-info">
                    <strong>{entry.name}{doseText(entry) ? ` · ${doseText(entry)}` : ""}</strong>
                    <span>{state.text}{state.cls === "is-due" ? ` · prevista ${formatTime(nextAt)}` : ""}</span>
                  </div>
                  <div className="medication-regimen-actions">
                    <button
                      type="button"
                      className={`medication-quick-dose ${state.cls}`}
                      disabled={busyId === `dose:${rawEntry.id}`}
                      title={`Registrar la dosis con la hora real. Hora prevista: ${formatTime(nextAt)}`}
                      onClick={() => registerScheduledDose({ entry: { ...entry, id: rawEntry.id }, nextAt })}
                    >
                      <Icons.Pill />
                      {busyId === `dose:${rawEntry.id}` ? "Guardando…" : `Dar ahora · ${formatTime(clock)}`}
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
                      title="Editar dosis futura e intervalo de la pauta, sin registrar una dosis"
                      onClick={() => onEditEntry?.("medication", rawEntry, { ...entry }, { regimenOnly: true })}
                    >
                      <Icons.Settings />
                    </button>
                    <button
                      type="button"
                      className="medication-icon-btn medication-end-btn"
                      disabled={busyId === `end:${rawEntry.id}`}
                      title="Finalizar pauta"
                      onClick={() => endRegimen(rawEntry)}
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
