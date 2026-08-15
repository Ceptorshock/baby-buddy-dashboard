import { useEffect, useMemo, useState } from "react";
import { Icons } from "./Icons";
import { api } from "../api";
import {
  feedingDurationSeconds,
  feedingMethodLabel,
  feedingSegments,
  formatElapsed,
  formatTime,
  isAlexaFeeding,
  isPausedFeeding,
} from "../utils/formatters";
import {
  describeRegimen,
  effectiveMedicationEntry,
  intervalMilliseconds,
  nextDailySlot,
  normalizeScheduleType,
  regimenKey,
} from "../utils/medicationRegimens";

function timerKind(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("sleep") || value.includes("sueño")) return "sleep";
  if (value.includes("tummy") || value.includes("boca")) return "tummy";
  return "feeding";
}

function localTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function clock(date) {
  return new Date(date).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function doseText(entry) {
  if (entry?.dosage === null || entry?.dosage === undefined || entry?.dosage === "") return "";
  return `${entry.dosage} ${entry.dosage_unit || ""}`.trim();
}

function latestBy(entries, field) {
  return [...(entries || [])]
    .filter((item) => item?.[field])
    .sort((a, b) => new Date(b[field]).getTime() - new Date(a[field]).getTime())[0] || null;
}

function durationText(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function relativeTo(target, now) {
  if (!target) return "Sin referencia";
  const minutes = Math.round((target.getTime() - now.getTime()) / 60000);
  const text = durationText(Math.abs(minutes));
  return minutes >= 0 ? `faltan ${text}` : `hace ${text}`;
}

function diaperText(entry) {
  if (!entry) return "Sin pañales registrados";
  if (entry.wet && entry.solid) return "Pis y caca";
  if (entry.wet) return "Pis";
  if (entry.solid) return "Caca";
  return "Cambio";
}

function getActiveRegimens(medications, regimenMap, now, advanceMinutes) {
  const latest = new Map();
  for (const entry of medications || []) {
    const key = regimenKey(entry?.name);
    if (!key || latest.has(key)) continue;
    latest.set(key, entry);
  }

  const sourceRegimens = new Map(regimenMap);
  for (const [key, rawEntry] of latest.entries()) {
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

  const result = [];
  for (const [key, regimen] of sourceRegimens.entries()) {
    if (!regimen?.active) continue;
    const rawEntry = latest.get(key);
    if (!rawEntry) continue;
    const entry = effectiveMedicationEntry(rawEntry, regimen);
    const scheduleType = normalizeScheduleType(regimen, rawEntry);
    let nextAt = null;
    let slot = null;

    if (scheduleType === "interval") {
      const ms = intervalMilliseconds(regimen.next_dose_interval || rawEntry.next_dose_interval);
      const previous = new Date(rawEntry.time);
      if (ms > 0 && !Number.isNaN(previous.getTime())) nextAt = new Date(previous.getTime() + ms);
    } else if (scheduleType === "daily_slots") {
      const next = nextDailySlot(regimen, rawEntry.time, now, advanceMinutes);
      nextAt = next?.nextAt || null;
      slot = next?.slot || null;
    }

    if (scheduleType === "prn" || nextAt) result.push({ entry, rawEntry, regimen, scheduleType, nextAt, slot });
  }

  return result.sort((a, b) => {
    if (!a.nextAt && !b.nextAt) return a.entry.name.localeCompare(b.entry.name, "es");
    if (!a.nextAt) return 1;
    if (!b.nextAt) return -1;
    return a.nextAt - b.nextAt;
  });
}

export default function NightModePanel({ data, timer, onOpenForm, onCreated, onContinueFeeding, onDisable }) {
  const [showDiaper, setShowDiaper] = useState(false);
  const [savingDiaper, setSavingDiaper] = useState(false);
  const [savingMedication, setSavingMedication] = useState(null);
  const [message, setMessage] = useState("");
  const [regimenMap, setRegimenMap] = useState(() => new Map());
  const [advanceMinutes, setAdvanceMinutes] = useState(20);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timerId = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!data.child?.id) return;
    let cancelled = false;
    Promise.all([
      api.getMedicationRegimens(data.child.id).catch(() => ({ regimens: [] })),
      api.getDashboardSettings().catch(() => ({ medication_alerts: { minutes_before: 20 } })),
    ]).then(([result, settings]) => {
      if (cancelled) return;
      const next = new Map();
      for (const item of result.regimens || []) if (item?.name) next.set(regimenKey(item.name), item);
      setRegimenMap(next);
      const minutes = Number(settings?.medication_alerts?.minutes_before ?? 20);
      setAdvanceMinutes(Number.isFinite(minutes) ? Math.max(0, minutes) : 20);
    });
    return () => { cancelled = true; };
  }, [data.child?.id, data.medications]);

  const regimens = useMemo(
    () => getActiveRegimens(data.medications, regimenMap, now, advanceMinutes),
    [data.medications, regimenMap, now, advanceMinutes],
  );
  const vibrate = () => { try { navigator.vibrate?.(35); } catch {} };
  const activeByType = (type) => timer.activeTimers.find((item) => timerKind(item.name) === type);

  const toggleTimer = async (type) => {
    const active = activeByType(type);
    vibrate();
    if (active) {
      const stopped = await timer.stopTimer(active.id);
      if (stopped) onOpenForm({ type, timerId: stopped.id });
    } else {
      await timer.startTimer(type);
      setMessage(type === "feeding" ? "Toma iniciada" : "Sueño iniciado");
      setTimeout(() => setMessage(""), 2500);
      await data.refetch();
    }
  };

  const quickDiaper = async (kind) => {
    setSavingDiaper(true);
    vibrate();
    try {
      const created = await api.createChange({
        child: data.child?.id,
        wet: kind === "wet" || kind === "both",
        solid: kind === "solid" || kind === "both",
        time: new Date().toISOString(),
      });
      onCreated({
        type: "diaper",
        id: created.id,
        label: "Pañal",
        childId: data.child?.id,
        diaper_size: data.diaperSize?.state || "",
        successMessage: created?._grocy?.consumed ? "Pañal registrado y descontado en Grocy" : "Pañal registrado",
      });
      setShowDiaper(false);
      setMessage("Pañal registrado");
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setSavingDiaper(false);
    }
  };

  const quickMedication = async ({ entry, regimen, scheduleType, nextAt }) => {
    if (!entry || !data.child?.id) return;
    setSavingMedication(entry.id);
    vibrate();
    try {
      const administeredNow = new Date();
      const payload = {
        child: data.child.id,
        name: entry.name,
        time: localTimestamp(administeredNow),
      };
      if (scheduleType === "interval" && regimen.next_dose_interval) payload.next_dose_interval = regimen.next_dose_interval;
      if (entry.dosage !== null && entry.dosage !== undefined && entry.dosage !== "") payload.dosage = entry.dosage;
      if (entry.dosage_unit) payload.dosage_unit = entry.dosage_unit;
      if (entry.notes) payload.notes = entry.notes;
      const created = await api.createMedication(payload);
      await api.setMedicationRegimen(data.child.id, {
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
      onCreated({ type: "medication", id: created.id, label: entry.name, childId: data.child.id });
      setMessage(`${entry.name} registrado ahora · ${clock(administeredNow)}`);
      await data.refetch();
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setSavingMedication(null);
    }
  };

  const endRegimen = async (entry, regimen) => {
    if (!window.confirm(`¿Finalizar la pauta de ${entry.name}?`)) return;
    setSavingMedication(entry.id);
    try {
      await Promise.all([
        entry.next_dose_interval ? api.updateMedication(entry.id, { next_dose_interval: null }) : Promise.resolve(),
        api.deleteMedicationRegimen(data.child.id, regimen?.name || entry.name).catch(() => null),
      ]);
      setMessage(`Pauta de ${entry.name} finalizada`);
      await data.refetch();
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setSavingMedication(null);
    }
  };

  const feeding = activeByType("feeding");
  const sleep = activeByType("sleep");
  const latestFeeding = useMemo(
    () => latestBy(data.weeklyFeedings, "start"),
    [data.weeklyFeedings],
  );
  const latestDiaper = useMemo(
    () => latestBy(data.recentChanges, "time"),
    [data.recentChanges],
  );
  const feedingAlertMinutes = Number(data.alertsConfig?.feeding_minutes || 180);
  const referenceStart = feeding?.start || (latestFeeding?.start ? new Date(latestFeeding.start) : null);
  const nextFeedingAt = referenceStart
    ? new Date(referenceStart.getTime() + feedingAlertMinutes * 60000)
    : null;
  const latestFeedingMinutes = latestFeeding
    ? Math.max(0, Math.round(feedingDurationSeconds(latestFeeding) / 60))
    : 0;
  const latestSegments = latestFeeding ? feedingSegments(latestFeeding) : 0;
  const latestPaused = latestFeeding ? isPausedFeeding(latestFeeding) : false;
  const sinceLatestEnd = latestFeeding?.end
    ? (now.getTime() - new Date(latestFeeding.end).getTime()) / 60000
    : Infinity;
  const canContinueLatest = Boolean(
    latestFeeding &&
      !feeding &&
      timer.activeTimers.length === 0 &&
      (latestPaused || (sinceLatestEnd >= 0 && sinceLatestEnd <= 90)),
  );

  const continueLatest = async () => {
    if (!canContinueLatest || !onContinueFeeding) return;
    vibrate();
    const started = await onContinueFeeding(latestFeeding);
    if (started) {
      setMessage("Continuando la última toma");
      setTimeout(() => setMessage(""), 2500);
    }
  };

  return (
    <div className="night-mode-screen">
      <header className="night-header">
        <div>
          <div className="night-kicker">MODO NOCHE</div>
          <h1>{data.child?.first_name || "Bebé"}</h1>
          <div className="night-user"><Icons.User /> {data.currentUser?.display_name || "Acceso directo"}</div>
        </div>
        <button className="night-exit" onClick={onDisable}>Usar modo normal ahora</button>
      </header>

      {(feeding || sleep) && (
        <div className="night-active-card">
          {feeding && <div><Icons.Bottle /> Toma · <strong>{formatElapsed(timer.elapsedMap[feeding.id] || 0)}</strong></div>}
          {sleep && <div><Icons.Moon /> Sueño · <strong>{formatElapsed(timer.elapsedMap[sleep.id] || 0)}</strong></div>}
        </div>
      )}

      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "var(--card-bg)",
          padding: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <div>
            <div className="night-kicker">REFERENCIA RÁPIDA</div>
            <strong style={{ color: "var(--text)", fontSize: 15 }}>Lo importante sin salir del modo noche</strong>
          </div>
          {latestPaused && !feeding && (
            <span style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800 }}>⏸️ Toma pausada</span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8 }}>
          <div style={{ padding: 11, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <span style={{ display: "block", fontSize: 10, color: "var(--text-dim)", fontWeight: 800 }}>ÚLTIMA TOMA</span>
            {latestFeeding ? (
              <>
                <strong style={{ display: "block", marginTop: 4, color: "var(--text)", fontSize: 14 }}>
                  {formatTime(latestFeeding.start)}–{formatTime(latestFeeding.end)}
                </strong>
                <small style={{ display: "block", marginTop: 3, color: "var(--text-muted)", lineHeight: 1.35 }}>
                  {latestFeedingMinutes} min{latestFeeding?._session ? " efectivos" : ""}
                  {latestSegments > 1 ? ` · ${latestSegments} tramos` : ""}
                  {latestFeeding.method ? ` · ${feedingMethodLabel(latestFeeding.method)}` : ""}
                  {isAlexaFeeding(latestFeeding) ? " · 🎙️ Alexa" : ""}
                </small>
              </>
            ) : (
              <strong style={{ display: "block", marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>Sin tomas registradas</strong>
            )}
          </div>

          <div style={{ padding: 11, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <span style={{ display: "block", fontSize: 10, color: "var(--text-dim)", fontWeight: 800 }}>PRÓXIMA TOMA ORIENTATIVA</span>
            <strong style={{ display: "block", marginTop: 4, color: "var(--text)", fontSize: 14 }}>
              {nextFeedingAt ? clock(nextFeedingAt) : "—"}
            </strong>
            <small style={{ display: "block", marginTop: 3, color: "var(--text-muted)", lineHeight: 1.35 }}>
              {nextFeedingAt ? `${feeding ? "Desde el inicio de la toma actual" : "Desde el inicio de la última toma"} · ${relativeTo(nextFeedingAt, now)}` : "Sin referencia todavía"}
            </small>
          </div>

          <div style={{ padding: 11, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <span style={{ display: "block", fontSize: 10, color: "var(--text-dim)", fontWeight: 800 }}>ÚLTIMO PAÑAL</span>
            <strong style={{ display: "block", marginTop: 4, color: "var(--text)", fontSize: 14 }}>
              {latestDiaper ? `${clock(latestDiaper.time)} · ${diaperText(latestDiaper)}` : "—"}
            </strong>
            <small style={{ display: "block", marginTop: 3, color: "var(--text-muted)" }}>
              {latestDiaper ? relativeTo(new Date(latestDiaper.time), now).replace("hace ", "Hace ") : "Sin registro"}
            </small>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {latestFeeding && (
            <button
              type="button"
              onClick={() => onOpenForm({ type: "feeding", entry: latestFeeding })}
              style={{ flex: "1 1 140px", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 12px", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit", fontWeight: 800 }}
            >
              ✎ Corregir última toma
            </button>
          )}
          {canContinueLatest && (
            <button
              type="button"
              onClick={continueLatest}
              style={{ flex: "1 1 150px", border: 0, borderRadius: 11, padding: "10px 12px", background: "#F59E0B", color: "#000", fontFamily: "inherit", fontWeight: 900 }}
            >
              ▶️ Continuar última toma
            </button>
          )}
          {latestDiaper && (
            <button
              type="button"
              onClick={() => onOpenForm({ type: "diaper", entry: latestDiaper })}
              style={{ flex: "1 1 120px", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 12px", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit", fontWeight: 800 }}
            >
              ✎ Corregir pañal
            </button>
          )}
        </div>
      </section>

      <div className="night-action-grid">
        <button className={`night-action ${feeding ? "is-active" : ""}`} onClick={() => toggleTimer("feeding")}>
          <Icons.Bottle /><span>{feeding ? "Finalizar toma" : "Iniciar toma"}</span>
        </button>
        <button className={`night-action ${sleep ? "is-active" : ""}`} onClick={() => toggleTimer("sleep")}>
          <Icons.Moon /><span>{sleep ? "Despertar" : "Dormir"}</span>
        </button>
        <button className="night-action" onClick={() => setShowDiaper(!showDiaper)}>
          <Icons.Droplet /><span>Pañal</span>
        </button>
        <button className="night-action medication" onClick={() => onOpenForm({ type: "medication" })}>
          <Icons.Pill /><span>Nuevo medicamento</span>
        </button>
      </div>

      {showDiaper && (
        <div className="night-diaper-picker">
          <button disabled={savingDiaper} onClick={() => quickDiaper("wet")}>Pis</button>
          <button disabled={savingDiaper} onClick={() => quickDiaper("solid")}>Caca</button>
          <button disabled={savingDiaper} onClick={() => quickDiaper("both")}>Ambos</button>
        </div>
      )}

      {regimens.length > 0 && (
        <div className="night-medication-regimens">
          <div className="night-medication-title">Pautas activas</div>
          {regimens.map(({ entry, rawEntry, regimen, scheduleType, nextAt, slot }) => {
            const deltaMinutes = nextAt ? (nextAt.getTime() - now.getTime()) / 60000 : null;
            const due = deltaMinutes !== null && deltaMinutes <= 0;
            const soon = deltaMinutes !== null && !due && deltaMinutes <= advanceMinutes;
            const scheduleLabel = scheduleType === "prn"
              ? "Según necesidad · sin avisos"
              : `${slot?.label ? `${slot.label} · ` : ""}${due ? "Pendiente" : soon ? `Toca en ${Math.max(1, Math.ceil(deltaMinutes))} min` : "Próxima"} · ${clock(nextAt)}`;
            return (
              <div className={`night-medication-row${due ? " is-due" : soon ? " is-soon" : ""}`} key={`night-med-${rawEntry.id}`}>
                <div className="night-medication-info">
                  <strong>{entry.name}{doseText(entry) ? ` · ${doseText(entry)}` : ""}</strong>
                  <span>{scheduleLabel}</span>
                  <small>{describeRegimen(regimen)}</small>
                </div>
                <div className="night-medication-actions">
                  <button className={due ? "is-due" : soon ? "is-soon" : "is-early"} disabled={savingMedication === rawEntry.id} onClick={() => quickMedication({ entry: { ...entry, id: rawEntry.id }, regimen, scheduleType, nextAt })}>
                    {savingMedication === rawEntry.id ? "…" : `Dar ahora · ${clock(now)}`}
                  </button>
                  <button title="Dar con cambios" onClick={() => onOpenForm({ type: "medication", prefill: { ...entry, ...regimen, time: new Date().toISOString(), _scheduled_for: scheduleType === "daily_slots" && nextAt ? nextAt.toISOString() : null } })}><Icons.Pencil /></button>
                  <button title="Editar dosis y pauta futura" onClick={() => onOpenForm({ type: "medication", entry: rawEntry, prefill: { ...entry, ...regimen }, regimenOnly: true })}><Icons.Settings /></button>
                  <button title="Finalizar pauta" onClick={() => endRegimen(rawEntry, regimen)}><Icons.X /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {message && <div className="night-message">{message}</div>}
    </div>
  );
}
