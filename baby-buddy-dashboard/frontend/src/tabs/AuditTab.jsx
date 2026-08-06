import SectionCard from "../components/SectionCard";
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";

const RESOURCE_LABELS = {
  feedings: "Toma",
  sleep: "Sueño",
  changes: "Pañal",
  "tummy-times": "Tiempo boca abajo",
  temperature: "Temperatura",
  weight: "Peso",
  height: "Altura",
  notes: "Nota",
  timers: "Temporizador",
  medication: "Medicamento",
  pumping: "Extracción",
};
const ACTION_LABELS = { create: "creó", update: "editó", delete: "eliminó", undo: "deshizo" };
const HIDDEN_FIELDS = new Set(["id", "child", "_audit", "tags"]);

function valueText(value) {
  if (value === null || value === undefined || value === "") return "vacío";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function changesFor(entry) {
  if (entry.action !== "update" || !entry.before || !entry.after) return [];
  const keys = new Set([...Object.keys(entry.before), ...Object.keys(entry.after)]);
  return [...keys]
    .filter((key) => !HIDDEN_FIELDS.has(key))
    .filter((key) => JSON.stringify(entry.before[key]) !== JSON.stringify(entry.after[key]))
    .slice(0, 5)
    .map((key) => `${key}: ${valueText(entry.before[key])} → ${valueText(entry.after[key])}`);
}

export default function AuditTab({ entries = [], currentUser }) {
  return (
    <div className="fade-in fade-in-1">
      <SectionCard title="Registro de cambios" icon={<Icons.History />} color={colors.audit}>
        <div className="audit-current-user"><Icons.User /> Sesión actual: <strong>{currentUser?.display_name || "Acceso directo"}</strong></div>
        {entries.length ? (
          <div className="audit-list">
            {entries.map((entry) => {
              const diffs = changesFor(entry);
              return (
                <div className="audit-entry" key={entry.id}>
                  <div className="audit-dot" style={{ background: colors.audit }} />
                  <div className="audit-body">
                    <div className="audit-title">
                      <strong>{entry.user_display_name || "Autor no registrado"}</strong>{" "}
                      {ACTION_LABELS[entry.action] || entry.action} {RESOURCE_LABELS[entry.resource] || entry.resource}
                      {entry.entry_id ? ` #${entry.entry_id}` : ""}
                    </div>
                    <div className="audit-time">{new Date(entry.timestamp).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</div>
                    {diffs.length > 0 && <div className="audit-diffs">{diffs.map((diff) => <div key={diff}>{diff}</div>)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="empty-state-small">Los cambios realizados antes de ES18 no tienen autor registrado.</div>}
      </SectionCard>
    </div>
  );
}
