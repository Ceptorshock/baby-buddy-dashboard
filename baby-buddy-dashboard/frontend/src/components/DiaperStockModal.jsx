import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { Icons } from "./Icons";
import { api } from "../api";

function fmtStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

export default function DiaperStockModal({ activeSize, onChanged, onClose }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [value, setValue] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setPayload(await api.getDiaperStock());
    } catch (err) {
      setError(err.message || "No se pudo consultar Grocy");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const items = useMemo(() => payload?.items || [], [payload]);

  const openEditor = (mode, item) => {
    setError("");
    setEditor({ mode, item });
    setValue(mode === "add" ? "24" : String(Math.round(Number(item.stock) || 0)));
  };

  const save = async () => {
    if (!editor) return;
    const amount = Number.parseInt(value, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Introduce un número válido de pañales.");
      return;
    }
    const current = Math.round(Number(editor.item.stock) || 0);
    const delta = editor.mode === "add" ? amount : amount - current;
    if (editor.mode === "add" && amount === 0) return;
    if (delta === 0) { setEditor(null); return; }

    setBusy(true);
    setError("");
    try {
      const updated = await api.adjustDiaperStock(editor.item.product_id, delta);
      setPayload(updated);
      setEditor(null);
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.message || "No se pudo modificar el stock");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Stock de pañales" onClose={onClose} maxWidth={520}>
      <div className="diaper-stock-intro">
        <span className="diaper-stock-intro-icon"><Icons.Diaper /></span>
        <div>
          <strong>Inventario de Grocy</strong>
          <span>Consulta todas las tallas y apunta una compra sin salir de la app.</span>
        </div>
        <button className="diaper-stock-refresh" type="button" onClick={load} disabled={loading || busy} title="Actualizar stock">
          <Icons.Activity />
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="diaper-stock-empty">Consultando existencias…</div>}
      {!loading && payload && !payload.available && (
        <div className="form-warning">No se pudo leer <strong>{payload.source || "el sensor de stock de Grocy"}</strong>{payload.error ? `: ${payload.error}` : "."}</div>
      )}

      {!loading && items.length > 0 && (
        <div className="diaper-stock-list">
          {items.map((item) => {
            const active = String(item.size) === String(activeSize || "");
            return (
              <div className={`diaper-stock-row${active ? " diaper-stock-row-active" : ""}`} key={item.product_id}>
                <div className="diaper-stock-main">
                  <div className="diaper-stock-size-line">
                    <strong>{item.size}</strong>
                    {active && <span className="diaper-stock-active-badge">EN USO</span>}
                  </div>
                  <span className="diaper-stock-product">Producto Grocy #{item.product_id}</span>
                </div>
                <div className="diaper-stock-count">
                  <strong>{fmtStock(item.stock)}</strong>
                  <span>uds</span>
                </div>
                <div className="diaper-stock-actions">
                  <button type="button" className="diaper-stock-buy" onClick={() => openEditor("add", item)} disabled={busy || !item.available || !payload.can_add}>
                    <Icons.Plus /> <span>Compra</span>
                  </button>
                  <button type="button" className="diaper-stock-adjust" onClick={() => openEditor("set", item)} disabled={busy || !item.available || (!payload.can_add && !payload.can_remove)} title="Corregir stock">
                    <Icons.Pencil />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <div className="diaper-stock-editor">
          <div>
            <strong>{editor.mode === "add" ? `Añadir compra · ${editor.item.size}` : `Ajustar total · ${editor.item.size}`}</strong>
            <span>
              {editor.mode === "add"
                ? `Ahora hay ${fmtStock(editor.item.stock)}. Introduce cuántos pañales acabáis de comprar.`
                : "Úsalo para corregir el inventario si el número real no coincide con Grocy."}
            </span>
          </div>
          <div className="diaper-stock-editor-controls">
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={value}
              autoFocus
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
            <button type="button" onClick={save} disabled={busy}>
              {busy ? "Guardando…" : editor.mode === "add" ? "Añadir" : "Guardar"}
            </button>
            <button type="button" className="diaper-stock-cancel" onClick={() => setEditor(null)} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="diaper-stock-footnote">
        Los cambios se aplican directamente a Grocy. <strong>Compra</strong> suma unidades; el lápiz fija el total real.
      </div>
    </Modal>
  );
}
