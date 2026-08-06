import { useState } from "react";
import { Icons } from "./Icons";
import { api } from "../api";
import { colors } from "../utils/colors";
import { formatElapsed } from "../utils/formatters";

function timerKind(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("sleep") || value.includes("sueño")) return "sleep";
  if (value.includes("tummy") || value.includes("boca")) return "tummy";
  return "feeding";
}

export default function NightModePanel({ data, timer, onOpenForm, onCreated, onDisable }) {
  const [showDiaper, setShowDiaper] = useState(false);
  const [savingDiaper, setSavingDiaper] = useState(false);
  const [message, setMessage] = useState("");

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

  const feeding = activeByType("feeding");
  const sleep = activeByType("sleep");
  const latestMedication = data.medications?.[0];

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
          <Icons.Pill /><span>Medicamento</span>
        </button>
      </div>

      {showDiaper && (
        <div className="night-diaper-picker">
          <button disabled={savingDiaper} onClick={() => quickDiaper("wet")}>Pis</button>
          <button disabled={savingDiaper} onClick={() => quickDiaper("solid")}>Caca</button>
          <button disabled={savingDiaper} onClick={() => quickDiaper("both")}>Ambos</button>
        </div>
      )}

      {latestMedication && (
        <div className="night-last-medication">
          <span>Último medicamento</span>
          <strong>{latestMedication.name}{latestMedication.dosage ? ` · ${latestMedication.dosage} ${latestMedication.dosage_unit || ""}` : ""}</strong>
          <span>{new Date(latestMedication.time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      )}
      {message && <div className="night-message">{message}</div>}
    </div>
  );
}
