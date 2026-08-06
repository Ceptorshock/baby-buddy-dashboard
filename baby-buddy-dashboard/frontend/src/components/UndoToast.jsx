import { Icons } from "./Icons";

export default function UndoToast({ item, busy, message, onUndo, onDismiss }) {
  if (!item && !message) return null;
  return (
    <div className={`undo-toast${message ? " undo-toast-warning" : ""}`}>
      <div>
        <strong>{message || item?.successMessage || `${item.label} registrado`}</strong>
        {!message && <span>Puedes deshacerlo durante unos segundos.</span>}
      </div>
      {!message && (
        <button onClick={onUndo} disabled={busy}><Icons.Undo /> {busy ? "Deshaciendo..." : "Deshacer"}</button>
      )}
      <button className="undo-close" onClick={onDismiss}>×</button>
    </div>
  );
}
