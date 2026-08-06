import SectionCard from "./SectionCard";
import TimelineItem from "./TimelineItem";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { formatTime, timeAgo } from "../utils/formatters";

function intervalMilliseconds(value) {
  const parts = String(value || "").split(":").map(Number);
  if (!parts.length) return 0;
  return ((parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)) * 1000;
}

function doseText(entry) {
  if (entry.dosage === null || entry.dosage === undefined || entry.dosage === "") return "";
  return `${entry.dosage} ${entry.dosage_unit || ""}`.trim();
}

export default function MedicationCard({ medications = [], onEditEntry, onAdd }) {
  const recent = medications.slice(0, 5);
  const latest = recent[0];
  const nextAt = latest?.next_dose_interval
    ? new Date(new Date(latest.time).getTime() + intervalMilliseconds(latest.next_dose_interval))
    : null;

  return (
    <div className="fade-in fade-in-2">
      <SectionCard title="Medicamentos" icon={<Icons.Pill />} color={colors.medication}>
        {latest && (
          <div className="medication-next-dose">
            <div>
              <span className="medication-next-label">Última administración</span>
              <strong>{latest.name}{doseText(latest) ? ` · ${doseText(latest)}` : ""}</strong>
            </div>
            <div className="medication-next-time">
              {nextAt ? (
                <>
                  <span>Próxima según pauta</span>
                  <strong className={nextAt <= new Date() ? "dose-due" : ""}>{formatTime(nextAt)}</strong>
                </>
              ) : <span>Sin próxima dosis configurada</span>}
            </div>
          </div>
        )}
        {recent.length ? (
          <div className="medication-list">
            {recent.map((entry, index) => (
              <div key={entry.id} className="entry-clickable" onClick={() => onEditEntry?.("medication", entry)}>
                <TimelineItem
                  time={formatTime(entry.time)}
                  label={`${entry.name}${doseText(entry) ? ` · ${doseText(entry)}` : ""}`}
                  detail={entry.notes || timeAgo(entry.time)}
                  color={colors.medication}
                  audit={entry._audit}
                  isLast={index === recent.length - 1}
                />
              </div>
            ))}
          </div>
        ) : <div className="empty-state-small">Todavía no hay medicamentos registrados</div>}
        <button className="section-action-btn" onClick={onAdd}><Icons.Plus /> Registrar medicamento</button>
      </SectionCard>
    </div>
  );
}
