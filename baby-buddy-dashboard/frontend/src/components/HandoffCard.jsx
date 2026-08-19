import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icons } from "./Icons";
import { useUnits } from "../utils/units";
import {
  feedingDurationSeconds,
  feedingLastBreast,
  feedingMethodLabel,
  formatTime,
  parseDuration,
} from "../utils/formatters";

function sinceText(value) {
  if (!value) return "";
  const date = new Date(value);
  const mins = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 60000),
  );
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
}

function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activityLabel(timer) {
  const value = String(timer?.name || "").toLowerCase();
  if (value.includes("sleep") || value.includes("sueño"))
    return "😴 Durmiendo";
  if (value.includes("tummy") || value.includes("boca abajo"))
    return "🤸 Boca abajo";
  if (value.includes("feeding") || value.includes("toma"))
    return "🍼 Tomando";
  return `⏱️ ${timer?.name || "Actividad"}`;
}

function elapsedText(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${
    minutes % 60 ? ` ${minutes % 60} min` : ""
  }`;
}

function resultList(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.results) ? payload.results : [];
}

function diaperLabel(entry) {
  if (!entry) return "";
  if (entry.wet && entry.solid) return "pis y caca";
  if (entry.wet) return "pis";
  if (entry.solid) return "caca";
  return "cambio";
}

function humanMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

export default function HandoffCard({
  childId,
  childName,
  currentUser,
  activeTimers = [],
  elapsedMap = {},
  feedings = [],
  feedingAlertMinutes = 180,
}) {
  const units = useUnits();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [recent, setRecent] = useState({
    feedings: [],
    sleep: [],
    changes: [],
  });

  const load = async () => {
    if (!childId) return;
    try {
      setState(await api.getHandoff(childId));
      setError("");
    } catch (err) {
      setError(err.message || "No se pudo cargar el relevo");
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [childId]);

  useEffect(() => {
    setNote(state?.current?.note || "");
  }, [state?.current?.id]);

  useEffect(() => {
    const current = state?.current;
    if (!childId || !current?.timestamp) {
      setRecent({ feedings: [], sleep: [], changes: [] });
      return;
    }

    let cancelled = false;
    const start = current.timestamp;

    Promise.all([
      api.getFeedings({
        child: childId,
        start_min: start,
        limit: 100,
        ordering: "-start",
      }),
      api.getSleep({
        child: childId,
        start_min: start,
        limit: 100,
        ordering: "-start",
      }),
      api.getChanges({
        child: childId,
        date_min: start,
        limit: 100,
        ordering: "-time",
      }),
    ])
      .then(([feedings, sleep, changes]) => {
        if (cancelled) return;
        setRecent({
          feedings: resultList(feedings),
          sleep: resultList(sleep),
          changes: resultList(changes),
        });
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [childId, state?.current?.id, state?.current?.timestamp]);

  const toggle = async () => {
    if (!childId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.setHandoffEnabled(childId, !state?.enabled);
      await load();
    } catch (err) {
      setError(err.message || "No se pudo cambiar el modo relevo");
    } finally {
      setBusy(false);
    }
  };

  const takeOver = async () => {
    if (!childId || busy) return;
    setBusy(true);
    setError("");
    try {
      setState(await api.takeOverHandoff(childId));
    } catch (err) {
      setError(err.message || "No se pudo registrar el relevo");
    } finally {
      setBusy(false);
    }
  };

  const current = state?.current;

  const saveNote = async () => {
    if (!childId || !current || noteBusy) return;
    setNoteBusy(true);
    setError("");
    try {
      await api.updateHandoffNote(childId, note);
      await load();
    } catch (err) {
      setError(err.message || "No se pudo guardar la nota");
    } finally {
      setNoteBusy(false);
    }
  };

  const recentSummary = useMemo(() => {
    const feedingMinutes = Math.round(
      recent.feedings.reduce(
        (sum, entry) => sum + feedingDurationSeconds(entry),
        0,
      ) / 60,
    );

    const latestFeeding = recent.feedings[0] || null;
    const latestDiaper = recent.changes[0] || null;
    const latestSleep = recent.sleep[0] || null;

    return {
      feedingMinutes,
      latestFeeding,
      latestDiaper,
      latestSleep,
    };
  }, [recent]);

  if (!state) return null;

  const summary = state.summary || {};
  const currentActivity = activeTimers[0] || null;
  const nextMedication = state.next_medication || null;
  const sortedFeedings = [...(feedings || [])]
    .filter((entry) => entry?.start || entry?.end)
    .sort((a, b) => new Date(b.start || b.end).getTime() - new Date(a.start || a.end).getTime());
  const latestOverallFeeding = sortedFeedings[0] || null;
  const latestBreast = sortedFeedings.find((entry) => feedingLastBreast(entry)) || null;
  const latestBreastMethod = feedingLastBreast(latestBreast);
  const nextBreastMethod = latestBreastMethod === "left breast" ? "right breast" : latestBreastMethod === "right breast" ? "left breast" : null;
  const nextFeedingReference = latestOverallFeeding?.start
    ? new Date(new Date(latestOverallFeeding.start).getTime() + Number(feedingAlertMinutes || 180) * 60000)
    : null;
  const referenceDeltaMinutes = nextFeedingReference
    ? Math.round((nextFeedingReference.getTime() - Date.now()) / 60000)
    : null;
  const referenceText = referenceDeltaMinutes == null
    ? "Sin referencia"
    : referenceDeltaMinutes >= 0
      ? `faltan ${humanMinutes(referenceDeltaMinutes)}`
      : `hace ${humanMinutes(Math.abs(referenceDeltaMinutes))}`;

  return (
    <section
      className={`handoff-card fade-in${
        state.enabled ? " enabled" : " disabled"
      }`}
    >
      <div className="handoff-head">
        <div className="handoff-title">
          <span className="handoff-icon">🤝</span>
          <div>
            <span className="eyebrow">RELEVO</span>
            <strong>
              {state.enabled
                ? "Modo relevo activo"
                : "Modo relevo desactivado"}
            </strong>
          </div>
        </div>

        <label
          className="handoff-switch"
          title="Activar o desactivar el modo relevo"
        >
          <input
            type="checkbox"
            checked={Boolean(state.enabled)}
            disabled={busy}
            onChange={toggle}
          />
          <span />
        </label>
      </div>

      {!state.enabled ? (
        <p className="handoff-disabled-text">
          Para los días que estéis juntos no hace falta usarlo. Actívalo
          cuando os vayáis alternando con {childName || "el bebé"}.
        </p>
      ) : !current ? (
        <div className="handoff-empty">
          <span>No hay un relevo iniciado todavía.</span>
          <button onClick={takeOver} disabled={busy}>
            🤝 Me hago cargo
          </button>
        </div>
      ) : (
        <>
          <div className="handoff-current">
            <div>
              <span>Ahora a cargo</span>
              <strong>{current.to_user_name}</strong>
              <small>
                Desde {when(current.timestamp)} ·{" "}
                {sinceText(current.timestamp)}
              </small>
            </div>

            <button
              onClick={takeOver}
              disabled={
                busy ||
                (currentUser?.display_name &&
                  current.to_user_name === currentUser.display_name)
              }
            >
              {busy
                ? "Guardando…"
                : currentUser?.display_name === current.to_user_name
                  ? "Ya estás a cargo"
                  : "🤝 Me hago cargo"}
            </button>
          </div>

          <div className="handoff-summary">
            <div>
              <span>🍼</span>
              <strong>{summary.feedings || 0}</strong>
              <small>
                {recentSummary.feedingMinutes > 0
                  ? `${recentSummary.feedingMinutes} min`
                  : summary.feeding_amount
                    ? `${Math.round(summary.feeding_amount)} ${units.volume}`
                    : "tomas"}
              </small>
            </div>

            <div>
              <span>🧷</span>
              <strong>{summary.diapers || 0}</strong>
              <small>
                {summary.both ? `${summary.both} ambos` : "pañales"}
              </small>
            </div>

            <div>
              <span>😴</span>
              <strong>
                {Number(summary.sleep_hours || 0).toFixed(1)} h
              </strong>
              <small>sueño</small>
            </div>

            <div>
              <span>💊</span>
              <strong>{summary.medications || 0}</strong>
              <small>dosis</small>
            </div>

            <div>
              <span>🌡️</span>
              <strong>
                {summary.temperature_max == null
                  ? "—"
                  : `${Number(summary.temperature_max).toFixed(1)}°`}
              </strong>
              <small>máxima</small>
            </div>
          </div>

          <div className="handoff-status-lines">
            <div>
              <span>Última toma</span>
              <strong>
                {recentSummary.latestFeeding
                  ? `${formatTime(
                      recentSummary.latestFeeding.start ||
                        recentSummary.latestFeeding.end,
                    )}–${
                      recentSummary.latestFeeding.end
                        ? formatTime(recentSummary.latestFeeding.end)
                        : "en curso"
                    } · ${humanMinutes(
                      feedingDurationSeconds(
                        recentSummary.latestFeeding,
                      ) / 60,
                    )}`
                  : "Ninguna desde el relevo"}
              </strong>
            </div>

            <div>
              <span>Último pañal</span>
              <strong>
                {recentSummary.latestDiaper
                  ? `${formatTime(recentSummary.latestDiaper.time)} · ${diaperLabel(
                      recentSummary.latestDiaper,
                    )}`
                  : "Ninguno desde el relevo"}
              </strong>
            </div>

            <div>
              <span>Último sueño</span>
              <strong>
                {recentSummary.latestSleep
                  ? `${formatTime(
                      recentSummary.latestSleep.start,
                    )}–${
                      recentSummary.latestSleep.end
                        ? formatTime(recentSummary.latestSleep.end)
                        : "en curso"
                    } · ${humanMinutes(
                      parseDuration(
                        recentSummary.latestSleep.duration,
                      ) * 60,
                    )}`
                  : "Ninguno desde el relevo"}
              </strong>
            </div>
          </div>

          <div className="handoff-status-lines">
            <div>
              <span>Ahora mismo</span>
              <strong>
                {currentActivity
                  ? `${activityLabel(currentActivity)} · ${elapsedText(
                      elapsedMap?.[currentActivity.id],
                    )}`
                  : "Sin actividad en curso"}
              </strong>
            </div>

            <div>
              <span>Próxima medicación</span>
              <strong>
                {nextMedication
                  ? `${
                      nextMedication.due ? "⚠️ " : "💊 "
                    }${nextMedication.name}${
                      nextMedication.slot
                        ? ` · ${nextMedication.slot}`
                        : ""
                    } · ${new Date(
                      nextMedication.time,
                    ).toLocaleTimeString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "Sin medicación programada"}
              </strong>
            </div>

            <div>
              <span>Próxima toma orientativa</span>
              <strong>
                {nextFeedingReference
                  ? `${formatTime(nextFeedingReference)} · ${referenceText}`
                  : "Sin toma anterior"}
              </strong>
            </div>

            <div>
              <span>Último pecho usado</span>
              <strong>
                {latestBreast
                  ? `${feedingMethodLabel(latestBreastMethod)} · siguiente ${feedingMethodLabel(nextBreastMethod)}`
                  : "Sin registro"}
              </strong>
            </div>
          </div>

          <div className="handoff-note">
            <label htmlFor={`handoff-note-${childId}`}>
              Nota para el siguiente relevo <span>(opcional)</span>
            </label>

            <div>
              <input
                id={`handoff-note-${childId}`}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ej.: ha estado inquieta después de comer"
              />
              <button
                type="button"
                onClick={saveNote}
                disabled={
                  noteBusy || note === (current.note || "")
                }
              >
                {noteBusy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>

          {(state.history || []).length > 1 && (
            <button
              type="button"
              className="handoff-history-toggle"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory
                ? "Ocultar relevos anteriores"
                : "Ver relevos anteriores"}
            </button>
          )}

          {showHistory && (
            <div className="handoff-history">
              {state.history.slice(1, 8).map((item) => (
                <div key={item.id}>
                  <span>{when(item.timestamp)}</span>
                  <div>
                    <strong>
                      {item.from_user_name
                        ? `${item.from_user_name} → `
                        : ""}
                      {item.to_user_name}
                    </strong>
                    {item.note && <small>{item.note}</small>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {error && <div className="handoff-error">{error}</div>}
    </section>
  );
}
