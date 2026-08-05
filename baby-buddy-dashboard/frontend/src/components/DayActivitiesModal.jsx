import { t as translate } from "../locales";

import Modal from "./Modal";
import TimelineItem from "./TimelineItem";
import { colors } from "../utils/colors";
import {
  toFeedingTimeline,
  toSleepBlocks,
  parseDuration,
} from "../utils/formatters";
import { useUnits } from "../utils/units";

export default function DayActivitiesModal({
  day,
  type,
  data,
  onEditEntry,
  onClose,
}) {
  const units = useUnits();

  const formatTime = (date) =>
    new Date(date).toLocaleTimeString(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const getTitle = () => {
    const titles = {
      feeding: "dayModal.feedings",
      sleep: "dayModal.sleepSessions",
      tummy: "dayModal.tummyTime",
    };

    const titleKey = titles[type] || "dayModal.activities";

    return `${translate(titleKey)} - ${day}`;
  };

  const renderContent = () => {
    if (!data || data.length === 0) {
      return (
        <div
          style={{
            color: "var(--text-dim)",
            fontSize: 13,
            textAlign: "center",
            padding: 40,
          }}
        >
          {translate("dayModal.noActivities")}
        </div>
      );
    }

    if (type === "feeding") {
      const timeline = toFeedingTimeline(data, units.volume);

      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {timeline.map((feeding, index, entries) => (
            <div
              key={feeding.entry?.id ?? index}
              className="entry-clickable"
              onClick={() => {
                onEditEntry?.("feeding", feeding.entry);
                onClose();
              }}
            >
              <TimelineItem
                time={feeding.time}
                label={feeding.label}
                detail={feeding.detail}
                color={colors.feeding}
                isLast={index === entries.length - 1}
              />
            </div>
          ))}
        </div>
      );
    }

    if (type === "sleep") {
      const blocks = toSleepBlocks(data);

      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {blocks.map((sleep, index, entries) => (
            <div
              key={sleep.entry?.id ?? index}
              className="entry-clickable"
              onClick={() => {
                onEditEntry?.("sleep", sleep.entry);
                onClose();
              }}
            >
              <TimelineItem
                time={`${sleep.start}–${sleep.end}`}
                label={`${sleep.duration.toFixed(1)} h${
                  sleep.nap
                    ? ` · ${translate("overview.nap")}`
                    : ""
                }`}
                detail={`${sleep.start} ${translate("common.to")} ${sleep.end}`}
                color={colors.sleep}
                isLast={index === entries.length - 1}
              />
            </div>
          ))}
        </div>
      );
    }

    if (type === "tummy") {
      return (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {data.map((entry, index, entries) => {
            const startTime = formatTime(entry.start);
            const endTime = formatTime(entry.end);
            const durationMinutes = Math.round(
              parseDuration(entry.duration) * 60,
            );

            return (
              <div
                key={entry.id ?? index}
                className="entry-clickable"
                onClick={() => {
                  onEditEntry?.("tummy", entry);
                  onClose();
                }}
              >
                <TimelineItem
                  time={startTime}
                  label={`${durationMinutes} min${
                    entry.milestone
                      ? ` · ${entry.milestone}`
                      : ""
                  }`}
                  detail={`${startTime} ${translate("common.to")} ${endTime}`}
                  color={colors.tummy}
                  isLast={index === entries.length - 1}
                />
              </div>
            );
          })}
        </div>
      );
    }

    return null;
  };

  return (
    <Modal title={getTitle()} onClose={onClose}>
      <div style={{ padding: "0 4px" }}>{renderContent()}</div>
    </Modal>
  );
}
