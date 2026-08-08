import { useEffect, useMemo, useState } from "react";
import SectionCard from "./SectionCard";
import TimelineItem from "./TimelineItem";
import { Icons } from "./Icons";
import { api } from "../api";
import { colors } from "../utils/colors";
import { formatTime, timeAgo } from "../utils/formatters";
import {
  describeRegimen,
  effectiveMedicationEntry,
  intervalMilliseconds,
  nextDailySlot,
  normalizeScheduleType,
  regimenKey,
} from "../utils/medicationRegimens";

function localTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function doseText(entry) {
  if (entry.dosage === null || entry.dosage === undefined || entry.dosage === "") return "";
  return `${entry.dosage} ${entry.dosage_unit || ""}`.trim();
}

function activeRegimens(medications, regimenMap, now, advanceMinutes) {
  const latestByName = new Map();
  for (const entry of medications || []) {
    const key = regimenKey(entry?.name);
    if (!key || latestByName.has(key)) continue;
    latestByName.set(key, entry);
  }

  const sourceRegimens = new Map(regimenMap);
  for (const [key, rawEntry] of latestByName.entries()) {
    if (!sourceRegimens.has(key) && rawEntry?.next_dose_interval) {
      sourceRegimens.set(key, {
        child_id: rawEntry.child,
        name: rawEntry.name,
        dosage: rawEntry.dosage,
        dosage_unit: rawEntry.dosage_unit || "",
        schedule_type: "interval",
        next_dose_interval: rawEntry.next_dose_interval,
        slots: [],
        active: true,
      });
    }
  }

  const items = [];
  for (const [key, regimen] of sourceRegimens.entries()) {
    if (!regimen?.active) continue;
    const rawEntry = latestByName.get(key);
    if (!rawEntry) continue;
    const entry = effectiveMedicationEntry(rawEntry, regimen);
    const scheduleType = normalizeScheduleType(regimen, rawEntry);
    let nextAt = null;
    let slot = null;

    if (scheduleType === "interval") {
      const intervalMs = intervalMilliseconds(regimen.next_dose_interval || rawEntry.next_dose_interval);
      const administeredAt = new Date(rawEntry.time);
      if (intervalMs > 0 && !Number.isNaN(administeredAt.getTime())) nextAt = new Date(administeredAt.getTime() + intervalMs);
    } else if (scheduleType === "daily_slots") {
      const next = nextDailySlot(regimen, rawEntry.time, now, advanceMinutes);
      nextAt = next?.nextAt || null;
      slot = next?.slot || null;
    }

    if (scheduleType === "prn" || nextAt) items.push({ entry, rawEntry, regimen, scheduleType, nextAt, slot });
  }

  return items.sort((a, b) => {
    if (!a.nextAt && !b.nextAt) return a.entry.name.localeCompare(b.entry.name, "es");
    if (!a.nextAt) return 1;
    if (!b.nextAt) return -1;
    return a.nextAt - b.nextAt;
  });
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

  const regimens = useMemo(
    () => activeRegimens(medications, regimenMap, clock, advanceMinutes),
    [medications, regimenMap, clock, advanceMinutes],
  );

  const registerScheduledDose = async ({ entry, regimen, scheduleType, nextAt }) => {
    if (!childId || !entry) return;
    setBusyId(`dose:${entry.id}`);
    setMessage("");
    try {
      const administeredNow = new Date();
      const data = {
        child: childId,
        name: entry.name,
        time: localTimestamp(administeredNow),
      };
      if (scheduleType === "interval" && regimen.next_dose_interval) data.next_dose_interval = regimen.next_dose_interval;
      if (entry.dosage !== null && entry.dosage !== undefined && entry.dosage !== "") data.dosage = entry.dosage;
      if (entry.dosage_unit) data.dosage_unit = entry.dosage_unit;
      if (entry.notes) data.notes = entry.notes;

      const created = await api.createMedication(data);
      await api.setMedicationRegimen(childId, {
        ...regimen,
        name: entry.name,
        dosage: entry.dosage ?? null,
        dosage_unit: entry.dosage_unit || "",
        schedule_type: scheduleType,
        next_dose_interval: scheduleType === "interval" ? (regimen.next_dose_interval || "") : "",
        slots: scheduleType === "daily_slots" ? (regimen.slots || []) : [],
        last_scheduled_for: scheduleType === "daily_slots" && nextAt ? nextAt.toISOString() : (regimen.last_scheduled_for || null),
        active: true,
      }).catch(() => null);

      const suffix = scheduleType === "daily_slots" && nextAt
        ? ` Se ha marcado como realizada la franja prevista de las ${formatTime(nextAt)}.`
        : scheduleType === "interval"
          ? " La siguiente se calculará desde la hora real."
          : "";
      setMessage(`${entry.name} registrado ahora (${formatTime(administeredNow)}).${suffix}`);
      onCreateScheduled?.({ type: "medication", id: created.id, label: entry.name, childId });
      await onChanged?.();
    } catch (error) {
      setMessage(`No se pudo registrar la dosis: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const endRegimen = async (entry, regimen) => {
    if (!entry?.id) return;
    const confirmed = window.confirm(`¿Finalizar la pauta de ${entry.name}?\n\nNo se borrará ninguna dosis ya registrada y dejarán de generarse próximas dosis y avisos.`);
    if (!confirmed) return;
    setBusyId(`end:${entry.id}`);
    setMessage("");
    try {
      await Promise.all([
        entry.next_dose_interval ? api.updateMedication(entry.id, { next_dose_interval: null }) : Promise.resolve(),
        api.deleteMedicationRegimen(childId, regimen?.name || entry.name).catch(() => null),
      ]);
      setMessage(`Pauta de ${entry.name} finalizada.`);
      await onChanged?.();
    } catch (error) {
      setMessage(`No se pudo finalizar la pauta: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const stateFor = (nextAt, scheduleType, slot) => {
    if (scheduleType === "prn") return { cls: "is-early", text: "Según necesidad · sin avisos" };
    const deltaMinutes = (nextAt.getTime() - clock.getTime()) / 60000;
    const prefix = scheduleType === "daily_slots" && slot ? `${slot.label} · ` : "";
    if (deltaMinutes <= 0) return { cls: "is-due", text: `${prefix}Pendiente desde hace ${Math.max(0, Math.floor(-deltaMinutes))} min` };
    if (deltaMinutes <= advanceMinutes) return { cls: "is-soon", text: `${prefix}Toca en ${Math.max(1, Math.ceil(deltaMinutes))} min` };
    return { cls: "is-early", text: `${prefix}Próxima · ${formatTime(nextAt)}` };
  };

  return (
    <div className="fade-in fade-in-2">
      <SectionCard title="Medicamentos" icon={<Icons.Pill />} color={colors.medication}>
        {regimens.length > 0 && (
          <div className="medication-regimens">
            <div className="medication-regimens-title">Pautas activas</div>
            {regimens.map(({ entry, rawEntry, regimen, scheduleType, nextAt, slot }) => {
              const state = stateFor(nextAt, scheduleType, slot);
              const title = scheduleType === "daily_slots" && nextAt
                ? `Registrar ahora la dosis prevista para ${slot?.label || "esta franja"} (${formatTime(nextAt)})`
                : scheduleType === "interval" && nextAt
                  ? `Registrar la dosis con la hora real. Hora prevista: ${formatTime(nextAt)}`
                  : "Registrar ahora esta medicación según necesidad";
              return (
                <div key={`regimen-${rawEntry.id}`} className={`medication-regimen-row ${state.cls}`}>
                  <div className="medication-regimen-info">
                    <strong>{entry.name}{doseText(entry) ? ` · ${doseText(entry)}` : ""}</strong>
                    <span>{state.text}{state.cls === "is-due" && nextAt ? ` · prevista ${formatTime(nextAt)}` : ""}</span>
                    <small className="medication-regimen-kind">{describeRegimen(regimen)}</small>
                  </div>
                  <div className="medication-regimen-actions">
                    <button
                      type="button"
                      className={`medication-quick-dose ${state.cls}`}
                      disabled={busyId === `dose:${rawEntry.id}`}
                      title={title}
                      onClick={() => registerScheduledDose({ entry: { ...entry, id: rawEntry.id }, regimen, scheduleType, nextAt })}
                    >
                      <Icons.Pill />
                      {busyId === `dose:${rawEntry.id}` ? "Guardando…" : `Dar ahora · ${formatTime(clock)}`}
                    </button>
                    <button
                      type="button"
                      className="medication-icon-btn"
                      title="Dar ahora modificando dosis, hora o pauta"
                      onClick={() => onEditEntry?.("medication", null, {
                        ...entry,
                        ...regimen,
                        time: new Date().toISOString(),
                        _scheduled_for: scheduleType === "daily_slots" && nextAt ? nextAt.toISOString() : null,
                      })}
                    >
                      <Icons.Pencil />
                    </button>
                    <button
                      type="button"
                      className="medication-icon-btn"
                      title="Editar dosis y pauta futura sin registrar una dosis"
                      onClick={() => onEditEntry?.("medication", rawEntry, { ...entry, ...regimen }, { regimenOnly: true })}
                    >
                      <Icons.Settings />
                    </button>
                    <button
                      type="button"
                      className="medication-icon-btn medication-end-btn"
                      disabled={busyId === `end:${rawEntry.id}`}
                      title="Finalizar pauta"
                      onClick={() => endRegimen(rawEntry, regimen)}
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
