import { useEffect, useState } from "react";
import NotesTab from "./NotesTab";
import AuditTab from "./AuditTab";
import ReviewRecords from "../components/ReviewRecords";
import ReportsPanel from "../components/ReportsPanel";
import { Icons } from "../components/Icons";
import { api } from "../api";

function childIdFromEntry(entry) {
  const value =
    entry?.child?.id ??
    entry?.child_id ??
    entry?.child ??
    null;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function MoreTab({
  notes,
  auditEntries,
  currentUser,
  onEditEntry,
}) {
  const [section, setSection] = useState("notes");
  const [childId, setChildId] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const localId =
      (notes || []).map(childIdFromEntry).find(Boolean) ||
      (auditEntries || []).map(childIdFromEntry).find(Boolean);

    if (localId) {
      setChildId(localId);
      return undefined;
    }

    Promise.all([
      api.getConfig().catch(() => null),
      api.getChildren().catch(() => ({ results: [] })),
    ]).then(([config, children]) => {
      if (cancelled) return;

      const configured = Number(config?.default_child_id || 0);
      if (configured > 0) {
        setChildId(configured);
        return;
      }

      const first = (children?.results || [])[0];
      if (first?.id) setChildId(Number(first.id));
    });

    return () => {
      cancelled = true;
    };
  }, [notes, auditEntries]);

  return (
    <div className="more-tab fade-in">
      <div className="section-title-row more-title-row">
        <div>
          <span className="eyebrow">MÁS</span>
          <h2>Información y herramientas</h2>
        </div>
      </div>

      <div
        className="more-segmented"
        role="tablist"
        aria-label="Secciones adicionales"
        style={{ flexWrap: "wrap" }}
      >
        <button
          type="button"
          className={section === "notes" ? "is-active" : ""}
          onClick={() => setSection("notes")}
        >
          <Icons.StickyNote /> Notas
        </button>

        <button
          type="button"
          className={section === "audit" ? "is-active" : ""}
          onClick={() => setSection("audit")}
        >
          <Icons.History /> Registro
        </button>

        <button
          type="button"
          className={section === "review" ? "is-active" : ""}
          onClick={() => setSection("review")}
        >
          🔎 Revisar{reviewCount > 0 ? ` (${reviewCount})` : ""}
        </button>

        <button
          type="button"
          className={section === "reports" ? "is-active" : ""}
          onClick={() => setSection("reports")}
        >
          📄 Informes
        </button>
      </div>

      {section === "notes" && (
        <NotesTab notes={notes} onEditEntry={onEditEntry} />
      )}

      {section === "audit" && (
        <AuditTab entries={auditEntries} currentUser={currentUser} />
      )}

      <div style={{ display: section === "review" ? "block" : "none" }}>
        <ReviewRecords
          childId={childId}
          onEditEntry={onEditEntry}
          onCountChange={setReviewCount}
        />
      </div>

      {section === "reports" && <ReportsPanel childId={childId} />}
    </div>
  );
}
