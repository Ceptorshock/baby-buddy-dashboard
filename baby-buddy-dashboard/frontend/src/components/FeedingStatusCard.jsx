import { useMemo } from "react";
import { colors } from "../utils/colors";
import {
  feedingDurationSeconds,
  feedingMethodLabel,
  feedingSegments,
  formatTime,
  isPausedFeeding,
} from "../utils/formatters";

function latestByStart(feedings = []) {
  return [...feedings]
    .filter((item) => item?.start || item?.end)
    .sort(
      (a, b) =>
        new Date(b.start || b.end).getTime() -
        new Date(a.start || a.end).getTime(),
    )[0] || null;
}

function remainingText(target) {
  if (!target) return "—";
  const minutes = Math.round((target.getTime() - Date.now()) / 60000);
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const duration = hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${rest} min`;
  return minutes >= 0 ? `faltan ${duration}` : `hace ${duration}`;
}

function breastLabel(value) {
  const method = String(value || "").toLowerCase();
  if (method === "left breast") return "Izquierdo";
  if (method === "right breast") return "Derecho";
  if (method === "both breasts") return "Ambos";
  return "—";
}

const tileStyle = {
  minWidth: 0,
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--bg)",
};

export default function FeedingStatusCard({
  feedings = [],
  activeTimers = [],
  feedingAlertMinutes = 180,
  onContinue,
  onEdit,
}) {
  const latest = useMemo(() => latestByStart(feedings), [feedings]);
  const lastBreast = useMemo(
    () =>
      [...feedings]
        .filter((item) =>
          ["left breast", "right breast", "both breasts"].includes(
            String(item?.method || "").toLowerCase(),
          ),
        )
        .sort(
          (a, b) =>
            new Date(b.start || b.end).getTime() -
            new Date(a.start || a.end).getTime(),
        )[0] || null,
    [feedings],
  );

  if (!latest) return null;

  const reference = latest.start
    ? new Date(new Date(latest.start).getTime() + Number(feedingAlertMinutes || 180) * 60000)
    : null;
  const paused = isPausedFeeding(latest);
  const segments = feedingSegments(latest);
  const duration = Math.max(0, Math.round(feedingDurationSeconds(latest) / 60));
  const sinceEndMinutes = latest.end
    ? (Date.now() - new Date(latest.end).getTime()) / 60000
    : Infinity;
  const canContinue = paused || (sinceEndMinutes >= 0 && sinceEndMinutes <= 90);
  const busy = activeTimers.length > 0;

  return (
    <section
      className="fade-in"
      style={{
        border: `1px solid ${colors.feeding}35`,
        borderRadius: 16,
        background: "var(--card-bg)",
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 11 }}>
        <div>
          <span className="eyebrow">TOMAS</span>
          <strong style={{ display: "block", marginTop: 2, color: "var(--text)", fontSize: 15 }}>
            Referencia rápida
          </strong>
        </div>
        {paused && (
          <span style={{ border: `1px solid ${colors.feeding}55`, borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800, color: colors.feeding }}>
            ⏸️ Pausada
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
        <div style={tileStyle}>
          <span style={{ display: "block", color: "var(--text-dim)", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>Última toma</span>
          <strong style={{ display: "block", marginTop: 4, color: "var(--text)", fontSize: 14 }}>
            {formatTime(latest.start)}–{formatTime(latest.end)}
          </strong>
          <small style={{ display: "block", marginTop: 3, color: "var(--text-muted)" }}>
            {duration} min{latest?._session ? " efectivos" : ""}{segments > 1 ? ` · ${segments} tramos` : ""}
          </small>
        </div>

        <div style={tileStyle}>
          <span style={{ display: "block", color: "var(--text-dim)", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>Próxima referencia</span>
          <strong style={{ display: "block", marginTop: 4, color: "var(--text)", fontSize: 14 }}>
            {reference ? formatTime(reference) : "—"}
          </strong>
          <small style={{ display: "block", marginTop: 3, color: "var(--text-muted)" }}>
            Desde el inicio · {remainingText(reference)}
          </small>
        </div>

        <div style={tileStyle}>
          <span style={{ display: "block", color: "var(--text-dim)", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>Último pecho</span>
          <strong style={{ display: "block", marginTop: 4, color: "var(--text)", fontSize: 14 }}>
            {breastLabel(lastBreast?.method)}
          </strong>
          <small style={{ display: "block", marginTop: 3, color: "var(--text-muted)" }}>
            {lastBreast ? `${formatTime(lastBreast.start)} · ${feedingMethodLabel(lastBreast.method)}` : "Sin registro"}
          </small>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {canContinue && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onContinue?.(latest)}
            style={{ flex: "1 1 150px", border: 0, borderRadius: 11, padding: "10px 12px", background: colors.feeding, color: "#000", fontFamily: "inherit", fontWeight: 800, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}
          >
            ▶️ Continuar última toma
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit?.(latest)}
          style={{ flex: "1 1 110px", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 12px", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit", fontWeight: 750, cursor: "pointer" }}
        >
          ✎ Corregir
        </button>
      </div>
      {busy && canContinue && (
        <div style={{ marginTop: 7, color: "var(--text-dim)", fontSize: 11 }}>
          Finaliza o descarta la actividad en curso antes de continuar esta toma.
        </div>
      )}
    </section>
  );
}
