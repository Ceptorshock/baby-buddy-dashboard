import { useMemo } from "react";
import SectionCard from "./SectionCard";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { feedingDurationSeconds, formatTime } from "../utils/formatters";

function methodKey(entry) {
  const method = String(entry?.method || "").toLowerCase();
  if (method === "left breast") return "left";
  if (method === "right breast") return "right";
  if (method === "both breasts") return "both";
  return "";
}

function minutes(entry) {
  return Math.max(0, Math.round(feedingDurationSeconds(entry) / 60));
}

function summarize(entries) {
  const result = {
    left: { count: 0, minutes: 0 },
    right: { count: 0, minutes: 0 },
    both: { count: 0, minutes: 0 },
  };

  for (const entry of entries || []) {
    const key = methodKey(entry);
    if (!key) continue;
    result[key].count += 1;
    result[key].minutes += minutes(entry);
  }

  return result;
}

function sideLabel(key) {
  if (key === "left") return "Izquierdo";
  if (key === "right") return "Derecho";
  if (key === "both") return "Ambos";
  return "—";
}

function statBox(icon, title, data) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 11,
        background: "var(--bg)",
        padding: 11,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>
        {icon} {title}
      </div>
      <strong style={{ display: "block", fontSize: 18 }}>
        {data.minutes} min
      </strong>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {data.count} {data.count === 1 ? "toma" : "tomas"}
      </span>
    </div>
  );
}

export default function BreastfeedingSummary({
  todayFeedings = [],
  weeklyFeedings = [],
}) {
  const today = useMemo(() => summarize(todayFeedings), [todayFeedings]);
  const week = useMemo(() => summarize(weeklyFeedings), [weeklyFeedings]);

  const latest = useMemo(
    () =>
      [...weeklyFeedings]
        .filter((entry) => methodKey(entry) && (entry.start || entry.end))
        .sort(
          (a, b) =>
            new Date(b.start || b.end).getTime() -
            new Date(a.start || a.end).getTime(),
        )[0] || null,
    [weeklyFeedings],
  );

  const latestKey = methodKey(latest);
  const hasData =
    week.left.count + week.right.count + week.both.count > 0;

  return (
    <SectionCard
      title="Lactancia"
      icon={<Icons.Bottle />}
      color={colors.feeding}
    >
      {hasData ? (
        <>
          <div
            style={{
              padding: "10px 12px",
              marginBottom: 12,
              borderRadius: 11,
              background: `${colors.feeding}08`,
              border: `1px solid ${colors.feeding}20`,
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--text-dim)",
                marginBottom: 3,
              }}
            >
              ÚLTIMO PECHO REGISTRADO
            </span>
            <strong style={{ fontSize: 14 }}>
              {sideLabel(latestKey)}
              {latest?.start
                ? ` · ${formatTime(latest.start)}`
                : ""}
            </strong>
          </div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--text-muted)",
              marginBottom: 7,
            }}
          >
            HOY
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 8,
              marginBottom: 14,
            }}
          >
            {statBox("⬅️", "Izquierdo", today.left)}
            {statBox("➡️", "Derecho", today.right)}
            {statBox("↔️", "Ambos", today.both)}
          </div>

          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--text-muted)",
              marginBottom: 7,
            }}
          >
            ÚLTIMOS 7 DÍAS
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 8,
            }}
          >
            {statBox("⬅️", "Izquierdo", week.left)}
            {statBox("➡️", "Derecho", week.right)}
            {statBox("↔️", "Ambos", week.both)}
          </div>

          <div
            style={{
              marginTop: 9,
              fontSize: 10,
              color: "var(--text-dim)",
            }}
          >
            Resume únicamente lo que se ha registrado; no indica qué pecho
            corresponde usar en la siguiente toma.
          </div>
        </>
      ) : (
        <div
          style={{
            color: "var(--text-dim)",
            textAlign: "center",
            padding: 20,
            fontSize: 13,
          }}
        >
          Aún no hay tomas registradas como pecho izquierdo, derecho o ambos.
        </div>
      )}
    </SectionCard>
  );
}
