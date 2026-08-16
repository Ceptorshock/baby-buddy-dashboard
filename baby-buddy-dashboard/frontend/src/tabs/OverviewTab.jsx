import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import TimelineItem from "../components/TimelineItem";
import DiaperBadge from "../components/DiaperBadge";
import CustomTooltip from "../components/CustomTooltip";
import ChartDetailBar from "../components/ChartDetailBar";
import DayActivitiesModal from "../components/DayActivitiesModal";
import DailySummaryHistory from "../components/DailySummaryHistory";
import ActivityTimeline from "../components/ActivityTimeline";
import HistoryTab from "./HistoryTab";
import BreastfeedingSummary from "../components/BreastfeedingSummary";
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";
import {
  toFeedingTimeline,
  toDiaperTimeline,
  toSleepBlocks,
  aggregateByDayOfWeek,
  aggregateSleepByDay,
  aggregateTummyByDay,
  getEntriesForDay,
  parseDuration,
  feedingDurationSeconds,
  formatTime,
} from "../utils/formatters";
import { useUnits } from "../utils/units";

const INITIAL_FEEDINGS = 5;
const INITIAL_OTHER = 4;

function byDateDesc(entries, field) {
  return [...(entries || [])].sort(
    (a, b) =>
      new Date(b?.[field] || 0).getTime() -
      new Date(a?.[field] || 0).getTime(),
  );
}

function clock(value) {
  return formatTime(value);
}

function roundedMinutes(seconds) {
  return Math.max(0, Math.round((Number(seconds) || 0) / 60));
}

function humanMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function nightStart(now = new Date()) {
  const start = new Date(now);
  start.setSeconds(0, 0);

  if (now.getHours() >= 20) {
    start.setHours(20, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 1);
    start.setHours(20, 0, 0, 0);
  }

  return start;
}

function inWindow(value, start, end) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function sleepOverlapMinutes(entry, windowStart, windowEnd) {
  if (!entry?.start) return 0;

  const start = new Date(entry.start);
  const end = entry.end ? new Date(entry.end) : windowEnd;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  const overlapStart = Math.max(start.getTime(), windowStart.getTime());
  const overlapEnd = Math.min(end.getTime(), windowEnd.getTime());

  if (overlapEnd <= overlapStart) return 0;
  return Math.round((overlapEnd - overlapStart) / 60000);
}

function tabButton(active) {
  return {
    border: active
      ? "1px solid var(--text-muted)"
      : "1px solid var(--border)",
    borderRadius: 10,
    background: active ? "var(--surface)" : "var(--bg)",
    color: active ? "var(--text)" : "var(--text-muted)",
    padding: "9px 14px",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: active ? 800 : 650,
    cursor: "pointer",
    flex: "1 1 0",
    minWidth: 96,
  };
}

export default function OverviewTab({
  feedings,
  weeklyFeedings: weeklyFeedingsRaw,
  sleepEntries,
  weeklySleep,
  changes,
  tummyTimes,
  weeklyTummyTimes,
  monthlyFeedings = [],
  monthlySleep = [],
  monthlyChanges = [],
  monthlyTummyTimes = [],
  monthlyTemperatures = [],
  monthlyMedications = [],
  onEditEntry,
}) {
  const units = useUnits();
  const [activitySection, setActivitySection] = useState("history");
  const [expanded, setExpanded] = useState({});
  const [dayModal, setDayModal] = useState(null);
  const [selectedBar, setSelectedBar] = useState(null);

  const toggle = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // "Hoy": se mantiene tal y como estaba para las cuatro tarjetas superiores.
  const totalFeeding = feedings.reduce((s, f) => s + (f.amount || 0), 0);
  const totalFeedingMinutes = Math.round(
    feedings.reduce((s, f) => s + feedingDurationSeconds(f), 0) / 60,
  );

  const totalSleep = sleepEntries.reduce(
    (s, e) => s + parseDuration(e.duration),
    0,
  );

  const avgSleepMinutes =
    sleepEntries.length > 0
      ? Math.round((totalSleep * 60) / sleepEntries.length)
      : 0;

  const totalDiapers = changes.length;
  const wetCount = changes.filter((c) => c.wet && !c.solid).length;
  const solidCount = changes.filter((c) => c.solid && !c.wet).length;
  const bothCount = changes.filter((c) => c.wet && c.solid).length;

  const avgTummy =
    tummyTimes.length > 0
      ? tummyTimes.reduce(
          (s, t) => s + parseDuration(t.duration) * 60,
          0,
        ) / tummyTimes.length
      : 0;

  // Registros recientes: ya NO se limitan al cambio de día a las 00:00.
  const recentFeedingEntries = useMemo(
    () => byDateDesc(weeklyFeedingsRaw, "start"),
    [weeklyFeedingsRaw],
  );
  const recentSleepEntries = useMemo(
    () => byDateDesc(weeklySleep, "start"),
    [weeklySleep],
  );
  const recentDiaperEntries = useMemo(
    () => byDateDesc(monthlyChanges, "time"),
    [monthlyChanges],
  );
  const recentTummyEntries = useMemo(
    () => byDateDesc(weeklyTummyTimes, "start"),
    [weeklyTummyTimes],
  );

  const feedingTimeline = toFeedingTimeline(
    recentFeedingEntries,
    units.volume,
  );
  const sleepBlocks = toSleepBlocks(recentSleepEntries);
  const diaperTimeline = toDiaperTimeline(recentDiaperEntries);

  // Ventana "Noche": desde las 20:00 hasta ahora.
  const night = useMemo(() => {
    const end = new Date();
    const start = nightStart(end);

    const nightFeedings = byDateDesc(
      monthlyFeedings.filter((entry) =>
        inWindow(entry.start || entry.end, start, end),
      ),
      "start",
    );

    const nightDiapers = byDateDesc(
      monthlyChanges.filter((entry) =>
        inWindow(entry.time, start, end),
      ),
      "time",
    );

    const overlappingSleep = monthlySleep
      .map((entry) => ({
        entry,
        minutes: sleepOverlapMinutes(entry, start, end),
      }))
      .filter((item) => item.minutes > 0)
      .sort(
        (a, b) =>
          new Date(b.entry.start).getTime() -
          new Date(a.entry.start).getTime(),
      );

    const feedingMinutes = Math.round(
      nightFeedings.reduce(
        (sum, entry) => sum + feedingDurationSeconds(entry),
        0,
      ) / 60,
    );

    const sleepMinutes = overlappingSleep.reduce(
      (sum, item) => sum + item.minutes,
      0,
    );

    const chronologicalFeedings = nightFeedings
      .slice()
      .sort(
        (a, b) =>
          new Date(a.start || a.end).getTime() -
          new Date(b.start || b.end).getTime(),
      );

    const feedingIntervals = [];
    for (let index = 1; index < chronologicalFeedings.length; index += 1) {
      const previous = new Date(
        chronologicalFeedings[index - 1].start ||
          chronologicalFeedings[index - 1].end,
      ).getTime();
      const current = new Date(
        chronologicalFeedings[index].start ||
          chronologicalFeedings[index].end,
      ).getTime();

      if (Number.isFinite(previous) && Number.isFinite(current) && current >= previous) {
        feedingIntervals.push(Math.round((current - previous) / 60000));
      }
    }

    const averageFeedingInterval = feedingIntervals.length
      ? Math.round(
          feedingIntervals.reduce((sum, value) => sum + value, 0) /
            feedingIntervals.length,
        )
      : 0;

    const longestFeedingInterval = feedingIntervals.length
      ? Math.max(...feedingIntervals)
      : 0;

    const longestSleep = overlappingSleep.length
      ? Math.max(...overlappingSleep.map((item) => item.minutes))
      : 0;

    const wet = nightDiapers.filter(
      (entry) => entry.wet && !entry.solid,
    ).length;
    const solid = nightDiapers.filter(
      (entry) => entry.solid && !entry.wet,
    ).length;
    const both = nightDiapers.filter(
      (entry) => entry.wet && entry.solid,
    ).length;

    return {
      start,
      end,
      feedings: nightFeedings,
      feedingMinutes,
      averageFeedingInterval,
      longestFeedingInterval,
      diapers: nightDiapers,
      wet,
      solid,
      both,
      sleep: overlappingSleep,
      sleepMinutes,
      longestSleep,
    };
  }, [monthlyFeedings, monthlySleep, monthlyChanges]);

  // Tendencias de siete días se quedan, pero dentro de "Resúmenes".
  const weeklyFeedings = aggregateByDayOfWeek(
    weeklyFeedingsRaw,
    "amount",
  );
  const sleepByDay = aggregateSleepByDay(weeklySleep);
  const tummyByDay = aggregateTummyByDay(weeklyTummyTimes);

  const handleChartClick = (data, type) => {
    if (!data || !data.activeLabel) return;
    const label = data.activeLabel;
    const value = data.activePayload?.[0]?.value;
    setSelectedBar({ type, label, value });
  };

  const openDayModal = (day, type) => {
    let dayData = [];

    if (type === "feeding") {
      dayData = getEntriesForDay(weeklyFeedingsRaw, day, "start");
    } else if (type === "sleep") {
      dayData = getEntriesForDay(weeklySleep, day, "start");
    } else if (type === "tummy") {
      dayData = getEntriesForDay(weeklyTummyTimes, day, "start");
    }

    setSelectedBar(null);
    setDayModal({ day, type, data: dayData });
  };

  const recordsContent = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16,
      }}
    >
      {/* TOMAS */}
      <SectionCard
        title="Tomas recientes"
        icon={<Icons.Bottle />}
        color={colors.feeding}
      >
        {feedingTimeline.length > 0 ? (
          <>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(expanded.feedings
                ? feedingTimeline
                : feedingTimeline.slice(0, INITIAL_FEEDINGS)
              ).map((item, index, shown) => (
                <div
                  key={item.entry?.id ?? index}
                  className="entry-clickable"
                  onClick={() =>
                    onEditEntry?.("feeding", item.entry)
                  }
                >
                  <TimelineItem
                    time={item.time}
                    label={item.label}
                    detail={item.detail}
                    color={colors.feeding}
                    audit={item.entry?._audit}
                    isLast={index === shown.length - 1}
                  />
                </div>
              ))}
            </div>

            {feedingTimeline.length > INITIAL_FEEDINGS && (
              <button
                className="expand-toggle"
                onClick={() => toggle("feedings")}
              >
                {expanded.feedings
                  ? "Mostrar solo las últimas 5"
                  : `Ver más tomas (${feedingTimeline.length})`}
              </button>
            )}
          </>
        ) : (
          <div
            style={{
              color: "var(--text-dim)",
              fontSize: 13,
              textAlign: "center",
              padding: 20,
            }}
          >
            No hay tomas recientes
          </div>
        )}
      </SectionCard>

      {/* SUEÑO */}
      <SectionCard
        title="Sueños recientes"
        icon={<Icons.Moon />}
        color={colors.sleep}
      >
        {sleepBlocks.length > 0 ? (
          <>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(expanded.sleep
                ? sleepBlocks
                : sleepBlocks.slice(0, INITIAL_OTHER)
              ).map((item, index, shown) => (
                <div
                  key={item.entry?.id ?? index}
                  className="entry-clickable"
                  onClick={() =>
                    onEditEntry?.("sleep", item.entry)
                  }
                >
                  <TimelineItem
                    time={`${item.start}–${item.end}`}
                    label={`${item.duration.toFixed(1)} h${
                      item.nap ? " · Siesta" : ""
                    }`}
                    detail={`${item.start} a ${item.end}`}
                    color={colors.sleep}
                    audit={item.entry?._audit}
                    isLast={index === shown.length - 1}
                  />
                </div>
              ))}
            </div>

            {sleepBlocks.length > INITIAL_OTHER && (
              <button
                className="expand-toggle"
                onClick={() => toggle("sleep")}
              >
                {expanded.sleep
                  ? "Mostrar menos"
                  : `Ver más sueños (${sleepBlocks.length})`}
              </button>
            )}
          </>
        ) : (
          <div
            style={{
              color: "var(--text-dim)",
              fontSize: 13,
              textAlign: "center",
              padding: 20,
            }}
          >
            No hay sueño reciente
          </div>
        )}
      </SectionCard>

      {/* PAÑALES */}
      <SectionCard
        title="Pañales recientes"
        icon={<Icons.Droplet />}
        color={colors.diaper}
      >
        {diaperTimeline.length > 0 ? (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {(expanded.diapers
                ? diaperTimeline
                : diaperTimeline.slice(0, INITIAL_OTHER)
              ).map((item, index) => (
                <div
                  key={item.entry?.id ?? index}
                  className="entry-clickable"
                  onClick={() =>
                    onEditEntry?.("diaper", item.entry)
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 10,
                    background:
                      index === 0
                        ? `${colors.diaper}08`
                        : "transparent",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <DiaperBadge type={item.type} />
                    <div>
                      <strong style={{ fontSize: 13 }}>
                        {item.time}{" "}
                        <span style={{ opacity: 0.65 }}>✎</span>
                      </strong>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-dim)",
                        }}
                      >
                        {item.ago}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {diaperTimeline.length > INITIAL_OTHER && (
              <button
                className="expand-toggle"
                onClick={() => toggle("diapers")}
              >
                {expanded.diapers
                  ? "Mostrar menos"
                  : `Ver más pañales (${diaperTimeline.length})`}
              </button>
            )}
          </>
        ) : (
          <div
            style={{
              color: "var(--text-dim)",
              fontSize: 13,
              textAlign: "center",
              padding: 20,
            }}
          >
            No hay pañales recientes
          </div>
        )}
      </SectionCard>

      {/* BOCA ABAJO */}
      <SectionCard
        title="Boca abajo reciente"
        icon={<Icons.Sun />}
        color={colors.tummy}
      >
        {recentTummyEntries.length > 0 ? (
          <>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(expanded.tummy
                ? recentTummyEntries
                : recentTummyEntries.slice(0, INITIAL_OTHER)
              ).map((entry, index, shown) => {
                const minutes = Math.round(
                  parseDuration(entry.duration) * 60,
                );
                return (
                  <div
                    key={entry.id ?? index}
                    className="entry-clickable"
                    onClick={() =>
                      onEditEntry?.("tummy", entry)
                    }
                  >
                    <TimelineItem
                      time={clock(entry.start)}
                      label={`${minutes} min`}
                      detail={`${clock(entry.start)} a ${
                        entry.end ? clock(entry.end) : "en curso"
                      }`}
                      color={colors.tummy}
                      audit={entry?._audit}
                      isLast={index === shown.length - 1}
                    />
                  </div>
                );
              })}
            </div>

            {recentTummyEntries.length > INITIAL_OTHER && (
              <button
                className="expand-toggle"
                onClick={() => toggle("tummy")}
              >
                {expanded.tummy
                  ? "Mostrar menos"
                  : `Ver más (${recentTummyEntries.length})`}
              </button>
            )}
          </>
        ) : (
          <div
            style={{
              color: "var(--text-dim)",
              fontSize: 13,
              textAlign: "center",
              padding: 20,
            }}
          >
            No hay registros recientes
          </div>
        )}
      </SectionCard>
    </div>
  );

  const historyContent = (
    <HistoryTab
      feedings={monthlyFeedings}
      sleep={monthlySleep}
      changes={monthlyChanges}
      medications={monthlyMedications}
      temperatures={monthlyTemperatures}
      tummy={monthlyTummyTimes}
      onEditEntry={onEditEntry}
      showSummary
      showHeader={false}
    />
  );

  const timelineContent = (
    <ActivityTimeline
      feedings={monthlyFeedings}
      sleep={monthlySleep}
      changes={monthlyChanges}
      medications={monthlyMedications}
      tummy={monthlyTummyTimes}
      onEditEntry={onEditEntry}
    />
  );

  const nightContent = (
    <div style={{ display: "grid", gap: 16 }}>
      <SectionCard
        title="La noche"
        icon={<Icons.Moon />}
        color={colors.sleep}
      >
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 12,
            marginBottom: 14,
          }}
        >
          Desde {night.start.toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "2-digit",
          })} a las {clock(night.start)} hasta ahora
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              🍼 TOMAS
            </div>
            <strong
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 20,
              }}
            >
              {night.feedings.length}
            </strong>
            <span
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {night.feedingMinutes} min totales
            </span>
            {night.averageFeedingInterval > 0 && (
              <span
                style={{
                  display: "block",
                  marginTop: 3,
                  fontSize: 11,
                  color: "var(--text-dim)",
                  lineHeight: 1.35,
                }}
              >
                Intervalo medio {humanMinutes(night.averageFeedingInterval)}
                {night.longestFeedingInterval > 0
                  ? ` · mayor ${humanMinutes(night.longestFeedingInterval)}`
                  : ""}
              </span>
            )}
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              😴 SUEÑO
            </div>
            <strong
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 20,
              }}
            >
              {humanMinutes(night.sleepMinutes)}
            </strong>
            <span
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {night.sleep.length}{" "}
              {night.sleep.length === 1 ? "tramo" : "tramos"}
            </span>
            {night.longestSleep > 0 && (
              <span
                style={{
                  display: "block",
                  marginTop: 3,
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                Tramo más largo {humanMinutes(night.longestSleep)}
              </span>
            )}
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              🧷 PAÑALES
            </div>
            <strong
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 20,
              }}
            >
              {night.diapers.length}
            </strong>
            <span
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              desde las 20:00
            </span>
            <span
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              {night.wet} pis · {night.solid} caca · {night.both} ambos
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Tomas de esta noche"
        icon={<Icons.Bottle />}
        color={colors.feeding}
      >
        {night.feedings.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(210px, 280px))",
              gap: 7,
              justifyContent: "start",
            }}
          >
            {night.feedings
              .slice()
              .sort(
                (a, b) =>
                  new Date(a.start || a.end).getTime() -
                  new Date(b.start || b.end).getTime(),
              )
              .map((entry) => {
                const start = entry.start || entry.end;
                const minutes = roundedMinutes(
                  feedingDurationSeconds(entry),
                );

                return (
                  <button
                    key={entry.id || start}
                    type="button"
                    onClick={() =>
                      onEditEntry?.("feeding", entry)
                    }
                    title="Editar toma"
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 9,
                      background: "var(--bg)",
                      color: "var(--text)",
                      padding: "7px 9px",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      fontFamily: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <strong
                      style={{
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {clock(start)} –{" "}
                      {entry.end ? clock(entry.end) : "en curso"}
                    </strong>

                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        color: "var(--text-muted)",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {minutes} min
                      <span
                        aria-hidden="true"
                        style={{
                          fontSize: 17,
                          lineHeight: 1,
                          opacity: 0.85,
                        }}
                      >
                        ✎
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        ) : (
          <div
            style={{
              color: "var(--text-dim)",
              fontSize: 13,
              textAlign: "center",
              padding: 16,
            }}
          >
            No hay tomas desde las 20:00
          </div>
        )}
      </SectionCard>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <SectionCard
          title="Sueño de esta noche"
          icon={<Icons.Moon />}
          color={colors.sleep}
        >
          {night.sleep.length ? (
            <div style={{ display: "grid", gap: 5 }}>
              {night.sleep.map(({ entry, minutes }) => (
                <button
                  key={entry.id || entry.start}
                  type="button"
                  onClick={() =>
                    onEditEntry?.("sleep", entry)
                  }
                  style={{
                    border: 0,
                    background: "transparent",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                    padding: "8px 4px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <strong style={{ fontSize: 13 }}>
                    {clock(entry.start)} –{" "}
                    {entry.end ? clock(entry.end) : "en curso"}
                  </strong>
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 12,
                    }}
                  >
                    {humanMinutes(minutes)} · ✎
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div
              style={{
                color: "var(--text-dim)",
                fontSize: 13,
                textAlign: "center",
                padding: 20,
              }}
            >
              Sin sueño registrado en esta ventana
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Pañales de esta noche"
          icon={<Icons.Droplet />}
          color={colors.diaper}
        >
          {night.diapers.length ? (
            <div style={{ display: "grid", gap: 5 }}>
              {night.diapers
                .slice()
                .sort(
                  (a, b) =>
                    new Date(a.time).getTime() -
                    new Date(b.time).getTime(),
                )
                .map((entry) => {
                  const label =
                    entry.wet && entry.solid
                      ? "Pis y caca"
                      : entry.wet
                        ? "Pis"
                        : entry.solid
                          ? "Caca"
                          : "Cambio";

                  return (
                    <button
                      key={entry.id || entry.time}
                      type="button"
                      onClick={() =>
                        onEditEntry?.("diaper", entry)
                      }
                      style={{
                        border: 0,
                        background: "transparent",
                        borderBottom:
                          "1px solid var(--border)",
                        color: "var(--text)",
                        padding: "8px 4px",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <strong style={{ fontSize: 13 }}>
                        {clock(entry.time)}
                      </strong>
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontSize: 12,
                        }}
                      >
                        {label} · ✎
                      </span>
                    </button>
                  );
                })}
            </div>
          ) : (
            <div
              style={{
                color: "var(--text-dim)",
                fontSize: 13,
                textAlign: "center",
                padding: 20,
              }}
            >
              Sin pañales desde las 20:00
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );

  const summariesContent = (
    <div style={{ display: "grid", gap: 16 }}>
      <BreastfeedingSummary
        todayFeedings={feedings}
        weeklyFeedings={weeklyFeedingsRaw}
      />

      <DailySummaryHistory
        data={{
          feedings: monthlyFeedings,
          sleep: monthlySleep,
          changes: monthlyChanges,
          tummy: monthlyTummyTimes,
          temperatures: monthlyTemperatures,
          medications: monthlyMedications,
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        <SectionCard
          title="Tomas · 7 días"
          icon={<Icons.Bottle />}
          color={colors.feeding}
        >
          {weeklyFeedings.some((d) => d.amount > 0) ? (
            <>
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={weeklyFeedings}
                    barSize={20}
                    onClick={(data) =>
                      handleChartClick(data, "feeding")
                    }
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#252836"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: "#5A6178" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="amount"
                      fill={colors.feeding}
                      radius={[6, 6, 0, 0]}
                      opacity={0.85}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {selectedBar?.type === "feeding" && (
                <ChartDetailBar
                  label={selectedBar.label}
                  value={selectedBar.value}
                  unit={units.volume}
                  color={colors.feeding}
                  onViewEntries={() =>
                    openDayModal(
                      selectedBar.label,
                      "feeding",
                    )
                  }
                  onDismiss={() => setSelectedBar(null)}
                />
              )}
            </>
          ) : (
            <div
              style={{
                color: "var(--text-dim)",
                fontSize: 13,
                textAlign: "center",
                padding: 20,
              }}
            >
              Sin datos suficientes
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Sueño · 7 días"
          icon={<Icons.Moon />}
          color={colors.sleep}
        >
          {sleepByDay.some((d) => d.hours > 0) ? (
            <>
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sleepByDay}
                    barSize={20}
                    onClick={(data) =>
                      handleChartClick(data, "sleep")
                    }
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#252836"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: "#5A6178" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="hours"
                      fill={colors.sleep}
                      radius={[6, 6, 0, 0]}
                      opacity={0.85}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {selectedBar?.type === "sleep" && (
                <ChartDetailBar
                  label={selectedBar.label}
                  value={selectedBar.value}
                  unit="h"
                  color={colors.sleep}
                  onViewEntries={() =>
                    openDayModal(selectedBar.label, "sleep")
                  }
                  onDismiss={() => setSelectedBar(null)}
                />
              )}
            </>
          ) : (
            <div
              style={{
                color: "var(--text-dim)",
                fontSize: 13,
                textAlign: "center",
                padding: 20,
              }}
            >
              Sin datos suficientes
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Boca abajo · 7 días"
          icon={<Icons.Sun />}
          color={colors.tummy}
        >
          {tummyByDay.some((d) => d.minutes > 0) ? (
            <>
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={tummyByDay}
                    barSize={20}
                    onClick={(data) =>
                      handleChartClick(data, "tummy")
                    }
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#252836"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: "#5A6178" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="minutes"
                      fill={colors.tummy}
                      radius={[6, 6, 0, 0]}
                      opacity={0.85}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {selectedBar?.type === "tummy" && (
                <ChartDetailBar
                  label={selectedBar.label}
                  value={selectedBar.value}
                  unit="min"
                  color={colors.tummy}
                  onViewEntries={() =>
                    openDayModal(selectedBar.label, "tummy")
                  }
                  onDismiss={() => setSelectedBar(null)}
                />
              )}
            </>
          ) : (
            <div
              style={{
                color: "var(--text-dim)",
                fontSize: 13,
                textAlign: "center",
                padding: 20,
              }}
            >
              Sin datos suficientes
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );

  return (
    <>
      <div className="section-title-row">
        <div>
          <span className="eyebrow">ACTIVIDAD</span>
          <h2>Actividad</h2>
        </div>
      </div>

      {/* Primero: la fotografía rápida de HOY */}
      <div style={{ marginBottom: 7 }}>
        <span className="eyebrow">HOY</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div className="fade-in fade-in-1">
          <StatCard
            icon={<Icons.Bottle />}
            label="Tomas"
            value={`${feedings.length}`}
            sub={`${totalFeedingMinutes} min totales${
              totalFeeding > 0
                ? ` · ${Math.round(totalFeeding)} ${units.volume}`
                : ""
            }`}
            color={colors.feeding}
          />
        </div>

        <div className="fade-in fade-in-2">
          <StatCard
            icon={<Icons.Moon />}
            label="Sueño"
            value={`${totalSleep.toFixed(1)}h`}
            sub={
              sleepEntries.length
                ? `${sleepEntries.length} ${
                    sleepEntries.length === 1
                      ? "sesión"
                      : "sesiones"
                  } · media ${avgSleepMinutes} min`
                : "Sin sesiones hoy"
            }
            color={colors.sleep}
          />
        </div>

        <div className="fade-in fade-in-3">
          <StatCard
            icon={<Icons.Droplet />}
            label="Pañales"
            value={totalDiapers}
            sub={`${wetCount} pis · ${solidCount} caca · ${bothCount} ambos`}
            color={colors.diaper}
          />
        </div>

        <div className="fade-in fade-in-4">
          <StatCard
            icon={<Icons.Sun />}
            label="Boca abajo"
            value={`${Math.round(avgTummy)} min`}
            sub={`${tummyTimes.length} ${
              tummyTimes.length === 1 ? "sesión" : "sesiones"
            } hoy`}
            color={colors.tummy}
          />
        </div>
      </div>

      {/* Segundo: navegación interna para no apilarlo todo */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <button
          type="button"
          style={tabButton(activitySection === "history")}
          onClick={() => setActivitySection("history")}
        >
          Historial
        </button>

        <button
          type="button"
          style={tabButton(activitySection === "records")}
          onClick={() => setActivitySection("records")}
        >
          Recientes
        </button>

        <button
          type="button"
          style={tabButton(activitySection === "night")}
          onClick={() => setActivitySection("night")}
        >
          Noche
        </button>

        <button
          type="button"
          style={tabButton(activitySection === "summaries")}
          onClick={() => setActivitySection("summaries")}
        >
          Resúmenes
        </button>
      </div>

      {activitySection === "history" && historyContent}
      {activitySection === "records" && recordsContent}
      {activitySection === "night" && nightContent}
      {activitySection === "summaries" && summariesContent}

      {dayModal && (
        <DayActivitiesModal
          day={dayModal.day}
          type={dayModal.type}
          data={dayModal.data}
          onEditEntry={onEditEntry}
          onClose={() => setDayModal(null)}
        />
      )}
    </>
  );
}
