import { useMemo, useState } from "react";
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

function getActiveRegimens(medications) {
  const latest = new Map();
  for (const entry of medications || []) {
    const key = String(entry?.name || "").trim().toLocaleLowerCase("es-ES");
    if (!key || latest.has(key)) continue;
    latest.set(key, entry);
  }
  return [...latest.values()].map((entry) => {
    const ms = intervalMilliseconds(entry.next_dose_interval);
    const previous = new Date(entry.time);
    const nextAt = ms > 0 && !Number.isNaN(previous.getTime()) ? new Date(previous.getTime() + ms) : null;
    return { entry, nextAt };
  }).filter((item) => item.nextAt).sort((a, b) => a.nextAt - b.nextAt);
}

export default function NightModePanel({ data, timer, onOpenForm, onCreated, onDisable }) {
  const [showDiaper, setShowDiaper] = useState(false);
  const [savingDiaper, setSavingDiaper] = useState(false);
  const [savingMedication, setSavingMedication] = useState(null);
  const [message, setMessage] = useState("");

  const regimens = useMemo(() => getActiveRegimens(data.medications), [data.medications]);
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
      const payload = {
        child: data.child.id,
        name: entry.name,
        time: localTimestamp(nextAt),
        next_dose_interval: entry.next_dose_interval,
      };
      if (entry.dosage !== null && entry.dosage !== undefined && entry.dosage !== "") payload.dosage = entry.dosage;
      if (entry.dosage_unit) payload.dosage_unit = entry.dosage_unit;
      if (entry.notes) payload.notes = entry.notes;
      const created = await api.createMedication(payload);
      onCreated({ type: "medication", id: created.id, label: entry.name, childId: data.child.id });
      setMessage(`${entry.name} registrado a las ${clock(nextAt)}`);
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
      await api.updateMedication(entry.id, { next_dose_interval: null });
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
          {regimens.map(({ entry, nextAt }) => {
            const due = nextAt <= new Date();
            return (
              <div className={`night-medication-row${due ? " is-due" : ""}`} key={`night-med-${entry.id}`}>
                <div className="night-medication-info">
                  <strong>{entry.name}{doseText(entry) ? ` · ${doseText(entry)}` : ""}</strong>
                  <span>{due ? "Pendiente" : "Próxima"} · {clock(nextAt)}</span>
                </div>
                <div className="night-medication-actions">
                  <button disabled={!due || savingMedication === entry.id} onClick={() => quickMedication({ entry, nextAt })}>
                    {savingMedication === entry.id ? "…" : `Registrar ${clock(nextAt)}`}
                  </button>
                  <button title="Modificar antes de registrar" onClick={() => onOpenForm({ type: "medication", prefill: { ...entry, time: nextAt.toISOString() } })}><Icons.Pencil /></button>
                  <button title="Finalizar pauta" onClick={() => endRegimen(entry)}><Icons.X /></button>
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
