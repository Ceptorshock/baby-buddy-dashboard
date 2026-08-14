import { useMemo, useState } from "react";
import SectionCard from "./SectionCard";
import { Icons } from "./Icons";
import {
  feedingDurationSeconds,
  formatTime,
  parseDuration,
} from "../utils/formatters";
import { colors } from "../utils/colors";

const FILTERS = [
  { id: "all", label: "Todo" },
  { id: "feeding", label: "🍼" },
  { id: "sleep", label: "😴" },
  { id: "diaper", label: "🧷" },
  { id: "medication", label: "💊" },
  { id: "tummy", label: "🤸" },
];

function localDayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (localDayKey(date) === localDayKey(today)) return "Hoy";
  if (localDayKey(date) === localDayKey(yesterday)) return "Ayer";

  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function humanMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function feedingMethod(entry) {
  const method = String(entry?.method || "").toLowerCase();
  if (method === "left breast") return "Pecho izquierdo";
  if (method === "right breast") return "Pecho derecho";
  if (method === "both breasts") return "Ambos pechos";
  if (method === "bottle") return "Biberón";
  if (method === "parent fed") return "Dado por un adulto";
  if (method === "self fed") return "Comió solo/a";
  return entry?.method || "";
}

function diaperText(entry) {
  if (entry?.wet && entry?.solid) return "Pis y caca";
  if (entry?.wet) return "Pis";
  if (entry?.solid) return "Caca";
  return "Cambio";
}

function buildItems({
  feedings = [],
  sleep = [],
  changes = [],
  medications = [],
  tummy = [],
}) {
  const items = [];

  for (const entry of feedings) {
    const when = entry?.start || entry?.end;
    if (!when) continue;
    const minutes = Math.round(feedingDurationSeconds(entry) / 60);
    items.push({
      id: `feeding-${entry.id || when}`,
      type: "feeding",
      icon: "🍼",
      color: colors.feeding,
      when,
      time: `${formatTime(when)} – ${entry.end ? formatTime(entry.end) : "en curso"}`,
      title: "Toma",
      detail: `${minutes} min${feedingMethod(entry) ? ` · ${feedingMethod(entry)}` : ""}`,
      entry,
    });
  }

  for (const entry of sleep) {
    if (!entry?.start) continue;
    const minutes = Math.round(parseDuration(entry.duration) * 60);
    items.push({
      id: `sleep-${entry.id || entry.start}`,
      type: "sleep",
      icon: "😴",
      color: colors.sleep,
      when: entry.start,
      time: `${formatTime(entry.start)} – ${entry.end ? formatTime(entry.end) : "en curso"}`,
      title: "Sueño",
      detail: humanMinutes(minutes),
      entry,
    });
  }

  for (const entry of changes) {
    if (!entry?.time) continue;
    items.push({
      id: `diaper-${entry.id || entry.time}`,
      type: "diaper",
      icon: "🧷",
      color: colors.diaper,
      when: entry.time,
      time: formatTime(entry.time),
      title: "Pañal",
      detail: diaperText(entry),
      entry,
    });
  }

  for (const entry of medications) {
    if (!entry?.time) continue;
    const dose =
      entry?.dosage !== null &&
      entry?.dosage !== undefined &&
      entry?.dosage !== ""
        ? ` · ${entry.dosage}${entry.dosage_unit ? ` ${entry.dosage_unit}` : ""}`
        : "";

    items.push({
      id: `medication-${entry.id || entry.time}-${entry.name || ""}`,
      type: "medication",
      icon: "💊",
      color: colors.medication,
      when: entry.time,
      time: formatTime(entry.time),
      title: entry.name || "Medicamento",
      detail: `Medicación${dose}`,
      entry,
    });
  }

  for (const entry of tummy) {
    if (!entry?.start) continue;
    const minutes = Math.round(parseDuration(entry.duration) * 60);
    items.push({
      id: `tummy-${entry.id || entry.start}`,
      type: "tummy",
      icon: "🤸",
      color: colors.tummy,
      when: entry.start,
      time: `${formatTime(entry.start)} – ${entry.end ? formatTime(entry.end) : "en curso"}`,
      title: "Boca abajo",
      detail: `${minutes} min`,
      entry,
    });
  }

  return items.sort(
    (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
  );
}

function buttonStyle(active) {
  return {
    border: active
      ? "1px solid var(--text-muted)"
      : "1px solid var(--border)",
    borderRadius: 999,
    background: active ? "var(--surface)" : "var(--bg)",
    color: active ? "var(--text)" : "var(--text-muted)",
    padding: "7px 11px",
    minWidth: 42,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: active ? 800 : 650,
    cursor: "pointer",
  };
}

export default function ActivityTimeline({
  feedings = [],
  sleep = [],
  changes = [],
  medications = [],
  tummy = [],
  onEditEntry,
}) {
  const [filter, setFilter] = useState("all");
  const [showAll, setShowAll] = useState(false);

  const items = useMemo(
    () =>
      buildItems({
        feedings,
        sleep,
        changes,
        medications,
        tummy,
      }),
    [feedings, sleep, changes, medications, tummy],
  );

  const filtered =
    filter === "all"
      ? items
      : items.filter((item) => item.type === filter);

  const visible = showAll ? filtered : filtered.slice(0, 30);

  const grouped = [];
  for (const item of visible) {
    const key = localDayKey(item.when);
    let group = grouped.find((entry) => entry.key === key);
    if (!group) {
      group = {
        key,
        label: dayLabel(item.when),
        items: [],
      };
      grouped.push(group);
    }
    group.items.push(item);
  }

  return (
    <SectionCard
      title="Cronología"
      icon={<Icons.History />}
      color={colors.feeding}
    >
      <div
        style={{
          display: "flex",
          gap: 7,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        {FILTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            style={buttonStyle(filter === item.id)}
            onClick={() => {
              setFilter(item.id);
              setShowAll(false);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {grouped.length ? (
        <div style={{ display: "grid", gap: 16 }}>
          {grouped.map((group) => (
            <div key={group.key}>
              <div
                style={{
                  marginBottom: 7,
                  color: "var(--text-dim)",
                  fontSize: 11,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                }}
              >
                {group.label}
              </div>

              <div style={{ display: "grid" }}>
                {group.items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onEditEntry?.(item.type, item.entry)}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns: "28px minmax(0, 1fr) auto",
                      gap: 10,
                      alignItems: "center",
                      border: 0,
                      borderBottom: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text)",
                      padding: "9px 2px",
                      fontFamily: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    title="Pulsa para editar"
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9,
                        display: "grid",
                        placeItems: "center",
                        background: `${item.color}14`,
                        fontSize: 15,
                      }}
                    >
                      {item.icon}
                    </span>

                    <span style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          display: "block",
                          fontSize: 13,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.title}
                      </strong>
                      <span
                        style={{
                          display: "block",
                          marginTop: 2,
                          color: "var(--text-muted)",
                          fontSize: 11,
                        }}
                      >
                        {item.detail}
                      </span>
                    </span>

                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      <span>{item.time}</span>
                      <span
                        aria-hidden="true"
                        style={{
                          marginLeft: 5,
                          fontSize: 17,
                          lineHeight: 1,
                          opacity: 0.85,
                        }}
                      >
                        ✎
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            color: "var(--text-dim)",
            textAlign: "center",
            padding: 24,
            fontSize: 13,
          }}
        >
          No hay registros para este filtro.
        </div>
      )}

      {filtered.length > 30 && (
        <button
          className="expand-toggle"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? "Mostrar solo los 30 más recientes"
            : `Ver toda la cronología (${filtered.length})`}
        </button>
      )}
    </SectionCard>
  );
}
