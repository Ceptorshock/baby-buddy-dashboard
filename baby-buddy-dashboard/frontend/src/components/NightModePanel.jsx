import { useEffect, useMemo, useState } from "react";
import { Icons } from "./Icons";
import { api } from "../api";
import { formatElapsed } from "../utils/formatters";

function timerKind(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("sleep") || value.includes("sueño")) return "sleep";
  if (value.includes("tummy") || value.includes("boca")) return "tummy";
  return "feeding";
}

function intervalMilliseconds(value) {
  const parts = String(value || "").split(":").map(Number);
  return ((parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)) * 1000;
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

function regimenKey(name) {
  return String(name || "").trim().toLocaleLowerCase("es-ES");
}

function getActiveRegimens(medications, regimenMap) {
  const latest = new Map();
  for (const entry of medications || []) {
    const key = regimenKey(entry?.name);
    if (!key || latest.has(key)) continue;
    latest.set(key, entry);
  }
  return [...latest.values()].map((rawEntry) => {
    const template = regimenMap.get(regimenKey(rawEntry.name));
    const entry = template ? {
      ...rawEntry,
      dosage: template.dosage !== null && template.dosage !== undefined && template.dosage !== "" ? template.dosage : rawEntry.dosage,
      dosage_unit: template.dosage_unit || rawEntry.dosage_unit,
      next_dose_interval: template.next_dose_interval || rawEntry.next_dose_interval,
    } : rawEntry;
    const ms = intervalMilliseconds(entry.next_dose_interval);
    const previous = new Date(rawEntry.time);
    const nextAt = ms > 0 && !Number.isNaN(previous.getTime()) ? new Date(previous.getTime() + ms) : null;
    return { entry, rawEntry, nextAt };
  }).filter((item) => item.nextAt).sort((a, b) => a.nextAt - b.nextAt);
}

export default function NightModePanel({ data, timer, onOpenForm, onCreated, onDisable }) {
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

  const regimens = useMemo(() => getActiveRegimens(data.medications, regimenMap), [data.medications, regimenMap]);
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

  const quickMedication = async ({ entry, nextAt }) => {
    if (!entry || !nextAt || !data.child?.id) return;
    setSavingMedication(entry.id);
    vibrate();
    try {
      const administeredNow = new Date();
      const payload = {
        child: data.child.id,
        name: entry.name,
        time: localTimestamp(administeredNow),
        next_dose_interval: entry.next_dose_interval,
      };
      if (entry.dosage !== null && entry.dosage !== undefined && entry.dosage !== "") payload.dosage = entry.dosage;
      if (entry.dosage_unit) payload.dosage_unit = entry.dosage_unit;
      if (entry.notes) payload.notes = entry.notes;
      const created = await api.createMedication(payload);
      await api.setMedicationRegimen(data.child.id, {
        name: entry.name, dosage: entry.dosage ?? null, dosage_unit: entry.dosage_unit || "",
        next_dose_interval: entry.next_dose_interval || "", active: true,
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

  const endRegimen = async (entry) => {
    if (!window.confirm(`¿Finalizar la pauta de ${entry.name}?`)) return;
    setSavingMedication(entry.id);
    try {
      await Promise.all([
        api.updateMedication(entry.id, { next_dose_interval: null }),
        api.deleteMedicationRegimen(data.child.id, entry.name).catch(() => null),
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
          {regimens.map(({ entry, rawEntry, nextAt }) => {
            const deltaMinutes = (nextAt.getTime() - now.getTime()) / 60000;
            const due = deltaMinutes <= 0;
            const soon = !due && deltaMinutes <= advanceMinutes;
            return (
              <div className={`night-medication-row${due ? " is-due" : soon ? " is-soon" : ""}`} key={`night-med-${rawEntry.id}`}>
                <div className="night-medication-info">
                  <strong>{entry.name}{doseText(entry) ? ` · ${doseText(entry)}` : ""}</strong>
                  <span>{due ? "Pendiente" : soon ? `Toca en ${Math.max(1, Math.ceil(deltaMinutes))} min` : "Próxima"} · {clock(nextAt)}</span>
                </div>
                <div className="night-medication-actions">
                  <button className={due ? "is-due" : soon ? "is-soon" : "is-early"} disabled={savingMedication === rawEntry.id} onClick={() => quickMedication({ entry: { ...entry, id: rawEntry.id }, nextAt })}>
                    {savingMedication === rawEntry.id ? "…" : `Dar ahora · ${clock(now)}`}
                  </button>
                  <button title="Dar con cambios" onClick={() => onOpenForm({ type: "medication", prefill: { ...entry, time: new Date().toISOString() } })}><Icons.Pencil /></button>
                  <button title="Editar dosis futura e intervalo" onClick={() => onOpenForm({ type: "medication", entry: rawEntry, prefill: entry, regimenOnly: true })}><Icons.Settings /></button>
                  <button title="Finalizar pauta" onClick={() => endRegimen(rawEntry)}><Icons.X /></button>
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
