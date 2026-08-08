import { useEffect, useState } from "react";
import { api } from "../api";
import { Icons } from "./Icons";
import { useUnits } from "../utils/units";

function sinceText(value) {
  if (!value) return "";
  const date = new Date(value);
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
}

function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function activityLabel(timer) {
  const value = String(timer?.name || "").toLowerCase();
  if (value.includes("sleep") || value.includes("sueño")) return "😴 Durmiendo";
  if (value.includes("tummy") || value.includes("boca abajo")) return "🤸 Boca abajo";
  if (value.includes("feeding") || value.includes("toma")) return "🍼 Tomando";
  return `⏱️ ${timer?.name || "Actividad"}`;
}

function elapsedText(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

export default function HandoffCard({ childId, childName, currentUser, activeTimers = [], elapsedMap = {} }) {
  const units = useUnits();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const load = async () => {
    if (!childId) return;
    try { setState(await api.getHandoff(childId)); setError(""); }
    catch (err) { setError(err.message || "No se pudo cargar el relevo"); }
  };
  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [childId]);
  useEffect(() => { setNote(state?.current?.note || ""); }, [state?.current?.id]);

  const toggle = async () => {
    if (!childId || busy) return;
    setBusy(true); setError("");
    try { await api.setHandoffEnabled(childId, !state?.enabled); await load(); }
    catch (err) { setError(err.message || "No se pudo cambiar el modo relevo"); }
    finally { setBusy(false); }
  };

  const takeOver = async () => {
    if (!childId || busy) return;
    setBusy(true); setError("");
    try { setState(await api.takeOverHandoff(childId)); }
    catch (err) { setError(err.message || "No se pudo registrar el relevo"); }
    finally { setBusy(false); }
  };

  const saveNote = async () => {
    if (!childId || !current || noteBusy) return;
    setNoteBusy(true); setError("");
    try { await api.updateHandoffNote(childId, note); await load(); }
    catch (err) { setError(err.message || "No se pudo guardar la nota"); }
    finally { setNoteBusy(false); }
  };

  if (!state) return null;
  const current = state.current;
  const summary = state.summary || {};
  const currentActivity = activeTimers[0] || null;
  const nextMedication = state.next_medication || null;
  return (
    <section className={`handoff-card fade-in${state.enabled ? " enabled" : " disabled"}`}>
      <div className="handoff-head">
        <div className="handoff-title"><span className="handoff-icon">🤝</span><div><span className="eyebrow">RELEVO</span><strong>{state.enabled ? "Modo relevo activo" : "Modo relevo desactivado"}</strong></div></div>
        <label className="handoff-switch" title="Activar o desactivar el modo relevo"><input type="checkbox" checked={Boolean(state.enabled)} disabled={busy} onChange={toggle} /><span /></label>
      </div>
      {!state.enabled ? (
        <p className="handoff-disabled-text">Para los días que estéis juntos no hace falta usarlo. Actívalo cuando os vayáis alternando con {childName || "el bebé"}.</p>
      ) : !current ? (
        <div className="handoff-empty"><span>No hay un relevo iniciado todavía.</span><button onClick={takeOver} disabled={busy}>🤝 Me hago cargo</button></div>
      ) : (
        <>
          <div className="handoff-current">
            <div><span>Ahora a cargo</span><strong>{current.to_user_name}</strong><small>Desde {when(current.timestamp)} · {sinceText(current.timestamp)}</small></div>
            <button onClick={takeOver} disabled={busy || (currentUser?.display_name && current.to_user_name === currentUser.display_name)}>{busy ? "Guardando…" : currentUser?.display_name === current.to_user_name ? "Ya estás a cargo" : "🤝 Me hago cargo"}</button>
          </div>
          <div className="handoff-summary">
            <div><span>🍼</span><strong>{summary.feedings || 0}</strong><small>{summary.feeding_amount ? `${Math.round(summary.feeding_amount)} ${units.volume}` : "tomas"}</small></div>
            <div><span>🧷</span><strong>{summary.diapers || 0}</strong><small>{summary.both ? `${summary.both} ambos` : "pañales"}</small></div>
            <div><span>😴</span><strong>{Number(summary.sleep_hours || 0).toFixed(1)} h</strong><small>sueño</small></div>
            <div><span>💊</span><strong>{summary.medications || 0}</strong><small>dosis</small></div>
            <div><span>🌡️</span><strong>{summary.temperature_max == null ? "—" : `${Number(summary.temperature_max).toFixed(1)}°`}</strong><small>máxima</small></div>
          </div>
          <div className="handoff-status-lines">
            <div><span>Ahora mismo</span><strong>{currentActivity ? `${activityLabel(currentActivity)} · ${elapsedText(elapsedMap?.[currentActivity.id])}` : "Sin actividad en curso"}</strong></div>
            <div><span>Próximo</span><strong>{nextMedication ? `${nextMedication.due ? "⚠️ " : "💊 "}${nextMedication.name}${nextMedication.slot ? ` · ${nextMedication.slot}` : ""} · ${new Date(nextMedication.time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Sin medicación programada"}</strong></div>
          </div>
          <div className="handoff-note">
            <label htmlFor={`handoff-note-${childId}`}>Nota para el siguiente relevo <span>(opcional)</span></label>
            <div><input id={`handoff-note-${childId}`} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Ej.: ha estado inquieta después de comer" /><button type="button" onClick={saveNote} disabled={noteBusy || note === (current.note || "")}>{noteBusy ? "Guardando…" : "Guardar"}</button></div>
          </div>
          {(state.history || []).length > 1 && <button type="button" className="handoff-history-toggle" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Ocultar relevos anteriores" : "Ver relevos anteriores"}</button>}
          {showHistory && <div className="handoff-history">{state.history.slice(1, 8).map((item) => <div key={item.id}><span>{when(item.timestamp)}</span><div><strong>{item.from_user_name ? `${item.from_user_name} → ` : ""}{item.to_user_name}</strong>{item.note && <small>{item.note}</small>}</div></div>)}</div>}
        </>
      )}
      {error && <div className="handoff-error">{error}</div>}
    </section>
  );
}
