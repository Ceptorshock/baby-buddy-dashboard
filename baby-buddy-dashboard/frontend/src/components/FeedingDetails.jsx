import { useMemo, useState } from "react";
import {
  feedingDurationSeconds,
  feedingLastBreast,
  feedingMethodLabel,
  feedingNextBreast,
  feedingSegmentDetails,
  feedingSegments,
  formatTime,
} from "../utils/formatters";

function durationText(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function secondsBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 1000));
}

function normalizedDetails(feeding) {
  return feedingSegmentDetails(feeding)
    .map((item) => ({ ...item }))
    .sort((a, b) => new Date(a.start || 0).getTime() - new Date(b.start || 0).getTime());
}

export function feedingBreakdown(feeding) {
  const details = normalizedDetails(feeding);
  const breaks = [];
  let restSeconds = 0;

  for (let index = 0; index < details.length - 1; index += 1) {
    const current = details[index];
    const next = details[index + 1];
    const gap = current?.end && next?.start ? secondsBetween(current.end, next.start) : 0;
    breaks.push(gap);
    restSeconds += gap;
  }

  const start = feeding?.start || details[0]?.start || null;
  const end = feeding?.end || details[details.length - 1]?.end || null;
  const wallSeconds = start && end ? secondsBetween(start, end) : 0;

  return {
    details,
    breaks,
    restSeconds,
    wallSeconds,
    activeSeconds: feedingDurationSeconds(feeding),
    segments: feedingSegments(feeding),
  };
}

export default function FeedingDetails({ feeding, defaultOpen = false, label = "Detalles" }) {
  const [open, setOpen] = useState(defaultOpen);
  const breakdown = useMemo(() => feedingBreakdown(feeding), [feeding]);
  const lastBreast = feedingLastBreast(feeding);
  const nextBreast = feedingNextBreast(feeding);

  if (!feeding || breakdown.segments <= 1) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 9,
          background: "var(--bg)",
          color: "var(--text-muted)",
          padding: "6px 9px",
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        {open ? "▴ Ocultar detalles" : `▾ ${label}`}
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 11,
            border: "1px solid var(--border)",
            background: "var(--bg)",
          }}
        >
          {breakdown.details.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {breakdown.details.map((item, index) => (
                <div key={`${item.start || "segment"}-${index}`}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: 8,
                      padding: "8px 9px",
                      borderRadius: 9,
                      background: "var(--card-bg)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", fontSize: 12, color: "var(--text)" }}>
                        Tramo {index + 1} · {feedingMethodLabel(item.method) || "Método sin indicar"}
                      </strong>
                      <span style={{ display: "block", marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>
                        Inicio {formatTime(item.start)} · Fin {formatTime(item.end)}
                      </span>
                    </div>
                    <strong style={{ color: "var(--text)", fontSize: 12, whiteSpace: "nowrap" }}>
                      {durationText(item.active_seconds)}
                    </strong>
                  </div>

                  {index < breakdown.details.length - 1 && (
                    <div
                      style={{
                        margin: "5px 0 0 12px",
                        paddingLeft: 9,
                        borderLeft: "2px dashed var(--border)",
                        color: "var(--text-dim)",
                        fontSize: 10,
                        fontWeight: 750,
                      }}
                    >
                      ⏸ Descanso: {breakdown.breaks[index] > 0 ? durationText(breakdown.breaks[index]) : "sin descanso"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>
              Esta toma tiene {breakdown.segments} tramos, pero fue creada antes de que el panel guardara el detalle de cada tramo. No se pueden reconstruir automáticamente sus horas.
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))",
              gap: 7,
              marginTop: 10,
            }}
          >
            <div style={{ padding: 8, borderRadius: 9, border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <span style={{ display: "block", color: "var(--text-dim)", fontSize: 9, fontWeight: 800 }}>INTERVALO TOTAL</span>
              <strong style={{ display: "block", marginTop: 3, fontSize: 12 }}>{durationText(breakdown.wallSeconds)}</strong>
            </div>
            <div style={{ padding: 8, borderRadius: 9, border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <span style={{ display: "block", color: "var(--text-dim)", fontSize: 9, fontWeight: 800 }}>TIEMPO EFECTIVO</span>
              <strong style={{ display: "block", marginTop: 3, fontSize: 12 }}>{durationText(breakdown.activeSeconds)}</strong>
            </div>
            <div style={{ padding: 8, borderRadius: 9, border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <span style={{ display: "block", color: "var(--text-dim)", fontSize: 9, fontWeight: 800 }}>DESCANSOS</span>
              <strong style={{ display: "block", marginTop: 3, fontSize: 12 }}>{durationText(breakdown.restSeconds)}</strong>
            </div>
            <div style={{ padding: 8, borderRadius: 9, border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <span style={{ display: "block", color: "var(--text-dim)", fontSize: 9, fontWeight: 800 }}>TRAMOS</span>
              <strong style={{ display: "block", marginTop: 3, fontSize: 12 }}>{breakdown.segments}</strong>
            </div>
          </div>

          {(lastBreast || nextBreast) && (
            <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 10 }}>
              {lastBreast ? `Último pecho: ${feedingMethodLabel(lastBreast).replace("Pecho ", "")}` : ""}
              {lastBreast && nextBreast ? " · " : ""}
              {nextBreast ? `Siguiente orientativo: ${feedingMethodLabel(nextBreast).replace("Pecho ", "")}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
