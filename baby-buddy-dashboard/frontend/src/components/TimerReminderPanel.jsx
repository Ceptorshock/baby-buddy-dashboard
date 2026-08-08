import { useMemo, useState } from "react";
import { Icons } from "./Icons";

function timerKind(timer) {
  const value = String(timer?.name || "").toLowerCase();
  if (value.includes("tummy") || value.includes("boca abajo")) return "tummy";
  if (value.includes("sleep") || value.includes("sueño")) return "sleep";
  return "feeding";
}

function label(timer) {
  const kind = timerKind(timer);
  if (kind === "tummy") return "boca abajo";
  if (kind === "feeding") return "la toma";
  return "el sueño";
}

export default function TimerReminderPanel({ timers = [], elapsedMap = {}, config, onContinue, onFinish, onCorrect }) {
  const [snoozedUntil, setSnoozedUntil] = useState({});
  const reminders = useMemo(() => {
    if (config?.enabled === false) return [];
    const now = Date.now();
    return timers.filter((timer) => {
      const kind = timerKind(timer);
      if (kind === "sleep") return false;
      if ((snoozedUntil[timer.id] || 0) > now) return false;
      const minutes = Math.floor(Number(elapsedMap?.[timer.id] || 0) / 60);
      const threshold = kind === "tummy" ? Number(config?.tummy_minutes || 30) : Number(config?.feeding_minutes || 90);
      return minutes >= threshold;
    });
  }, [timers, elapsedMap, config, snoozedUntil]);

  if (!reminders.length) return null;
  const snoozeMinutes = Number(config?.snooze_minutes || 30);
  return <div className="timer-reminder-stack fade-in">{reminders.map((timer) => {
    const minutes = Math.floor(Number(elapsedMap?.[timer.id] || 0) / 60);
    return <div className="timer-reminder" key={timer.id}>
      <span className="timer-reminder-icon"><Icons.Alert /></span>
      <div className="timer-reminder-copy"><strong>¿Te has olvidado de parar {label(timer)}?</strong><span>Lleva activa {minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`}.</span></div>
      <div className="timer-reminder-actions">
        <button type="button" onClick={() => { setSnoozedUntil((old) => ({ ...old, [timer.id]: Date.now() + snoozeMinutes * 60000 })); onContinue?.(timer); }}>Sí, sigue</button>
        <button type="button" className="primary" onClick={() => onFinish?.(timer)}>Finalizar ahora</button>
        <button type="button" onClick={() => onCorrect?.(timer)}>Corregir hora</button>
      </div>
    </div>;
  })}</div>;
}
