import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { Icons } from "./Icons";
import { api } from "../api";

function fmtStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

function fmtDate(value) {
  if (!value) return "—";
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function DiaperStockModal({ activeSize, onChanged, onClose }) {
  const [payload, setPayload] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [value, setValue] = useState("");
  const [purchaseEditor, setPurchaseEditor] = useState(null);
  const [purchaseSize, setPurchaseSize] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [stock, purchases] = await Promise.all([api.getDiaperStock(), api.getDiaperPurchases(40)]);
      setPayload(stock);
      setHistory(purchases);
    } catch (err) {
      setError(err.message || "No se pudo consultar Grocy");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const items = useMemo(() => payload?.items || [], [payload]);
  const purchases = useMemo(() => history?.items || [], [history]);

  const openEditor = (mode, item) => {
    setError("");
    setPurchaseEditor(null);
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
      const updated = await api.adjustDiaperStock(editor.item.product_id, delta, editor.mode === "add" ? { kind: "purchase" } : { kind: "correction" });
      setPayload(updated);
      setEditor(null);
      setHistory(await api.getDiaperPurchases(40));
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.message || "No se pudo modificar el stock");
    } finally {
      setBusy(false);
    }
  };

  const editPurchase = (purchase) => {
    setEditor(null);
    setError("");
    setPurchaseEditor(purchase);
    setPurchaseSize(String(purchase.product_id));
    setPurchaseAmount(String(Math.round(Number(purchase.amount) || 0)));
  };

  const savePurchaseCorrection = async () => {
    if (!purchaseEditor) return;
    const productId = Number.parseInt(purchaseSize, 10);
    const amount = Number.parseInt(purchaseAmount, 10);
    if (!Number.isFinite(productId) || !Number.isFinite(amount) || amount <= 0) {
      setError("Selecciona una talla y una cantidad válidas.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setHistory(await api.correctDiaperPurchase({ key: purchaseEditor.key, product_id: productId, amount }));
      setPayload(await api.getDiaperStock());
      setPurchaseEditor(null);
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.message || "No se pudo corregir la compra");
    } finally {
      setBusy(false);
    }
  };

  const removePurchase = async (purchase) => {
    if (!window.confirm(`¿Anular la compra de ${fmtStock(purchase.amount)} pañales de ${purchase.size}?\n\nSe descontarán esas unidades del stock actual de Grocy.`)) return;
    setBusy(true);
    setError("");
    try {
      setHistory(await api.deleteDiaperPurchase(purchase.key));
      setPayload(await api.getDiaperStock());
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.message || "No se pudo anular la compra");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Stock de pañales" onClose={onClose} maxWidth={620}>
      <div className="diaper-stock-intro">
        <span className="diaper-stock-intro-icon"><Icons.Diaper /></span>
        <div>
          <strong>Inventario de Grocy</strong>
          <span>Consulta todas las tallas, apunta compras y corrige errores sin salir de la app.</span>
        </div>
        <button className="diaper-stock-refresh" type="button" onClick={load} disabled={loading || busy} title="Actualizar stock"><Icons.Activity /></button>
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
                  <div className="diaper-stock-size-line"><strong>{item.size}</strong>{active && <span className="diaper-stock-active-badge">EN USO</span>}</div>
                  <span className="diaper-stock-product">Producto Grocy #{item.product_id}</span>
                </div>
                <div className="diaper-stock-count"><strong>{fmtStock(item.stock)}</strong><span>uds</span></div>
                <div className="diaper-stock-actions">
                  <button type="button" className="diaper-stock-buy" onClick={() => openEditor("add", item)} disabled={busy || !item.available || !payload.can_add}><Icons.Plus /> <span>Compra</span></button>
                  <button type="button" className="diaper-stock-adjust" onClick={() => openEditor("set", item)} disabled={busy || !item.available || (!payload.can_add && !payload.can_remove)} title="Corregir stock"><Icons.Pencil /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <div className="diaper-stock-editor">
          <div><strong>{editor.mode === "add" ? `Añadir compra · ${editor.item.size}` : `Ajustar total · ${editor.item.size}`}</strong><span>{editor.mode === "add" ? `Ahora hay ${fmtStock(editor.item.stock)}. Introduce cuántos pañales acabáis de comprar.` : "Úsalo para corregir el inventario si el número real no coincide con Grocy."}</span></div>
          <div className="diaper-stock-editor-controls">
            <input type="number" min="0" step="1" inputMode="numeric" value={value} autoFocus disabled={busy} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            <button type="button" onClick={save} disabled={busy}>{busy ? "Guardando…" : editor.mode === "add" ? "Añadir" : "Guardar"}</button>
            <button type="button" className="diaper-stock-cancel" onClick={() => setEditor(null)} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="diaper-purchase-history">
        <div className="diaper-purchase-history-title">
          <div><Icons.History /><div><strong>Últimas compras</strong><span>{history?.source_label || "Historial"}</span></div></div>
          {history?.grocy_configured && !history?.grocy_direct && <span className="diaper-history-warning">Grocy no responde</span>}
        </div>
        {history?.error && <div className="diaper-history-note">No se pudo leer el diario de Grocy; se muestran las compras hechas desde esta app.</div>}
        {!history?.grocy_configured && <div className="diaper-history-note">Para incluir también compras añadidas directamente en Grocy, configura <strong>grocy_url</strong> y <strong>grocy_api_key</strong> en la app.</div>}
        {purchases.length === 0 ? <div className="diaper-stock-empty">Todavía no hay compras registradas.</div> : (
          <div className="diaper-purchase-list">
            {purchases.map((purchase) => (
              <div className="diaper-purchase-row" key={purchase.key}>
                <div className="diaper-purchase-date"><strong>{fmtDate(purchase.timestamp)}</strong><span>{purchase.source_label}{purchase.corrected ? " · corregida" : ""}</span></div>
                <div className="diaper-purchase-desc"><strong>+{fmtStock(purchase.amount)} uds</strong><span>{purchase.size}</span></div>
                <div className="diaper-purchase-actions">
                  <button type="button" onClick={() => editPurchase(purchase)} disabled={busy} title="Corregir talla o cantidad"><Icons.Pencil /></button>
                  <button type="button" className="danger" onClick={() => removePurchase(purchase)} disabled={busy} title="Anular compra"><Icons.Trash /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {purchaseEditor && (
        <div className="diaper-stock-editor diaper-purchase-editor">
          <div><strong>Corregir compra</strong><span>Cambiar la talla o la cantidad ajustará automáticamente el stock actual de Grocy.</span></div>
          <div className="diaper-purchase-editor-grid">
            <select value={purchaseSize} disabled={busy} onChange={(e) => setPurchaseSize(e.target.value)}>{items.map((item) => <option key={item.product_id} value={item.product_id}>{item.size}</option>)}</select>
            <input type="number" min="1" step="1" inputMode="numeric" value={purchaseAmount} disabled={busy} onChange={(e) => setPurchaseAmount(e.target.value)} />
            <button type="button" onClick={savePurchaseCorrection} disabled={busy}>{busy ? "Guardando…" : "Guardar corrección"}</button>
            <button type="button" className="diaper-stock-cancel" onClick={() => setPurchaseEditor(null)} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="diaper-stock-footnote">El inventario siempre se modifica en Grocy. Corregir o anular una compra crea el ajuste necesario para que el stock siga cuadrando.</div>
    </Modal>
  );
}
