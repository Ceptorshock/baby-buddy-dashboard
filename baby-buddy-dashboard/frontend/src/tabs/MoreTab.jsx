import { useState } from "react";
import NotesTab from "./NotesTab";
import AuditTab from "./AuditTab";
import { Icons } from "../components/Icons";

export default function MoreTab({ notes, auditEntries, currentUser, onEditEntry, onOpenSettings }) {
  const [section, setSection] = useState("notes");

  return (
    <div className="more-tab fade-in">
      <div className="section-title-row more-title-row">
        <div>
          <span className="eyebrow">MÁS</span>
          <h2>Información y herramientas</h2>
        </div>
        <button type="button" className="section-action-btn more-settings-btn" onClick={onOpenSettings}>
          <Icons.Settings /> Ajustes
        </button>
      </div>

      <div className="more-segmented" role="tablist" aria-label="Secciones adicionales">
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
      </div>

      {section === "notes" && (
        <NotesTab
          notes={notes}
          onEditEntry={onEditEntry}
        />
      )}
      {section === "audit" && (
        <AuditTab entries={auditEntries} currentUser={currentUser} />
      )}
    </div>
  );
}
