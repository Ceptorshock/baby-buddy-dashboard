import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { colors } from "../utils/colors";
import { feedingDurationSeconds, formatTime, parseDuration } from "../utils/formatters";

function resultList(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.results) ? payload.results : [];
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateTime(value) {
  const date = dateValue(value);
  if (!date) return "—";
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timerType(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("feeding") || value.includes("toma")) return "feeding";
  if (value.includes("sleep") || value.includes("sueño")) return "sleep";
  if (value.includes("tummy") || value.includes("boca abajo")) return "tummy";
  return "timer";
}

function buildIssues({ feedings, sleep, changes, timers }) {
  const issues = [];
  const now = Date.now();
  const futureLimit = now + 5 * 60 * 1000;

  for (const entry of feedings) {
    const start = dateValue(entry.start);
    const end = dateValue(entry.end);

    if (start && start.getTime() > futureLimit) {
      issues.push({
        key: `feeding-future-${entry.id}`,
        type: "feeding",
        severity: "high",
        title: "Toma con inicio en el futuro",
        detail: `Inicio ${localDateTime(entry.start)}`,
        entry,
      });
    }

    if (start && end && end < start) {
      issues.push({
        key: `feeding-negative-${entry.id}`,
        type: "feeding",
        severity: "high",
        title: "Toma con fin anterior al inicio",
        detail: `${formatTime(entry.start)} → ${formatTime(entry.end)}`,
        entry,
      });
      continue;
    }

    if (start && end) {
      const mins = Math.round(feedingDurationSeconds(entry) / 60);

      if (mins > 180) {
        issues.push({
          key: `feeding-long-${entry.id}`,
          type: "feeding",
          severity: "review",
          title: "Toma muy larga para revisar",
          detail: `${formatTime(entry.start)} → ${formatTime(entry.end)} · ${mins} min`,
          entry,
        });
      } else if (mins < 1) {
        issues.push({
          key: `feeding-short-${entry.id}`,
          type: "feeding",
          severity: "review",
          title: "Toma de menos de 1 minuto",
          detail: `${formatTime(entry.start)} → ${formatTime(entry.end)}`,
          entry,
        });
      }
    }
  }

  const chronological = [...feedings]
    .filter((entry) => entry.start && entry.end)
    .sort(
      (a, b) =>
        new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

  for (let i = 1; i < chronological.length; i += 1) {
    const previous = chronological[i - 1];
    const current = chronological[i];
    const previousEnd = dateValue(previous.end);
    const currentStart = dateValue(current.start);

    if (
      previousEnd &&
      currentStart &&
      currentStart.getTime() < previousEnd.getTime()
    ) {
      issues.push({
        key: `feeding-overlap-${previous.id}-${current.id}`,
        type: "feeding",
        severity: "high",
        title: "Dos tomas se solapan",
        detail: `${formatTime(previous.start)}–${formatTime(previous.end)} / ${formatTime(current.start)}–${formatTime(current.end)}`,
        entry: current,
      });
    }
  }

  for (const entry of sleep) {
    const start = dateValue(entry.start);
    const end = dateValue(entry.end);

    if (start && start.getTime() > futureLimit) {
      issues.push({
        key: `sleep-future-${entry.id}`,
        type: "sleep",
        severity: "high",
        title: "Sueño con inicio en el futuro",
        detail: `Inicio ${localDateTime(entry.start)}`,
        entry,
      });
    }

    if (start && end && end < start) {
      issues.push({
        key: `sleep-negative-${entry.id}`,
        type: "sleep",
        severity: "high",
        title: "Sueño con fin anterior al inicio",
        detail: `${formatTime(entry.start)} → ${formatTime(entry.end)}`,
        entry,
      });
      continue;
    }

    const hours = parseDuration(entry.duration);
    if (hours > 14) {
      issues.push({
        key: `sleep-long-${entry.id}`,
        type: "sleep",
        severity: "review",
        title: "Registro de sueño muy largo",
        detail: `${formatTime(entry.start)} → ${entry.end ? formatTime(entry.end) : "en curso"} · ${hours.toFixed(1)} h`,
        entry,
      });
    }
  }

  for (const entry of changes) {
    const time = dateValue(entry.time);
    if (time && time.getTime() > futureLimit) {
      issues.push({
        key: `diaper-future-${entry.id}`,
        type: "diaper",
        severity: "high",
        title: "Pañal con hora en el futuro",
        detail: localDateTime(entry.time),
        entry,
      });
    }
  }

  for (const timer of timers) {
    const start = dateValue(timer.start);
    if (!start) continue;

    const elapsedMinutes = Math.floor((now - start.getTime()) / 60000);
    const kind = timerType(timer.name);

    const threshold =
      kind === "feeding"
        ? 120
        : kind === "tummy"
          ? 60
          : kind === "sleep"
            ? 720
            : 180;

    if (elapsedMinutes > threshold) {
      issues.push({
        key: `timer-long-${timer.id}`,
        type: "timer",
        severity: "review",
        title: "Temporizador posiblemente olvidado",
        detail: `${timer.name || "Temporizador"} · activo desde ${formatTime(timer.start)} · ${elapsedMinutes} min`,
        entry: timer,
      });
    }
  }

  return issues.sort((a, b) => {
    if (a.severity === b.severity) return a.title.localeCompare(b.title);
    return a.severity === "high" ? -1 : 1;
  });
}

export default function ReviewRecords({
  childId,
  onEditEntry,
  onCountChange,
}) {
  const [data, setData] = useState({
    feedings: [],
    sleep: [],
    changes: [],
    timers: [],
  });
  const [loading, setLoading] = useState(Boolean(childId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!childId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const iso = monthAgo.toISOString();

    Promise.all([
      api.getFeedings({
        child: childId,
        start_min: iso,
        limit: 500,
        ordering: "-start",
      }),
      api.getSleep({
        child: childId,
        start_min: iso,
        limit: 500,
        ordering: "-start",
      }),
      api.getChanges({
        child: childId,
        date_min: iso,
        limit: 500,
        ordering: "-time",
      }),
      api.getTimers(),
    ])
      .then(([feedings, sleep, changes, timers]) => {
        if (cancelled) return;
        setData({
          feedings: resultList(feedings),
          sleep: resultList(sleep),
          changes: resultList(changes),
          timers: resultList(timers).filter((timer) => {
            const timerChildId = Number(timer?.child?.id ?? timer?.child ?? 0);
            return !timerChildId || timerChildId === Number(childId);
          }),
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "No se pudieron revisar los registros.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [childId]);

  const issues = useMemo(() => buildIssues(data), [data]);

  useEffect(() => {
    onCountChange?.(issues.length);
  }, [issues.length, onCountChange]);

  if (!childId) {
    return (
      <div style={{ color: "var(--text-dim)", padding: 20, textAlign: "center" }}>
        No se pudo determinar el bebé activo.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ color: "var(--text-muted)", padding: 20, textAlign: "center" }}>
        Revisando registros…
      </div>
    );
  }

  if (error) {
    return <div style={{ color: "#ef4444", padding: 12 }}>{error}</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          padding: 11,
          borderRadius: 11,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          fontSize: 12,
          color: "var(--text-muted)",
          lineHeight: 1.45,
        }}
      >
        Esto busca posibles <strong>errores de registro</strong> —horas
        imposibles, solapamientos o temporizadores olvidados—. No interpreta si
        una toma, un sueño o un pañal son normales desde el punto de vista
        médico.
      </div>

      {issues.length === 0 ? (
        <div
          style={{
            padding: 26,
            borderRadius: 12,
            background: `${colors.feeding}06`,
            border: "1px solid var(--border)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 5 }}>✓</div>
          <strong>No veo registros sospechosos</strong>
          <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>
            Revisados los últimos 30 días.
          </div>
        </div>
      ) : (
        issues.map((issue) => {
          const editable = issue.type !== "timer";
          return (
            <button
              type="button"
              key={issue.key}
              disabled={!editable}
              onClick={() =>
                editable && onEditEntry?.(issue.type, issue.entry)
              }
              style={{
                width: "100%",
                border:
                  issue.severity === "high"
                    ? "1px solid #ef444455"
                    : "1px solid var(--border)",
                borderRadius: 11,
                background:
                  issue.severity === "high"
                    ? "#ef444408"
                    : "var(--bg)",
                color: "var(--text)",
                padding: "10px 12px",
                display: "grid",
                gridTemplateColumns: "28px minmax(0,1fr) auto",
                gap: 9,
                alignItems: "center",
                textAlign: "left",
                fontFamily: "inherit",
                cursor: editable ? "pointer" : "default",
              }}
            >
              <span style={{ fontSize: 17 }}>
                {issue.severity === "high" ? "⚠️" : "🔎"}
              </span>
              <span>
                <strong style={{ display: "block", fontSize: 12 }}>
                  {issue.title}
                </strong>
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  {issue.detail}
                </span>
              </span>
              <span
                style={{
                  fontSize: editable ? 17 : 10,
                  color: "var(--text-dim)",
                  whiteSpace: "nowrap",
                }}
              >
                {editable ? "✎" : "barra superior"}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
