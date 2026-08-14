import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { feedingDurationSeconds, parseDuration } from "../utils/formatters";

const PERIODS = [
  { id: "24h", label: "24 h", hours: 24 },
  { id: "3d", label: "3 días", hours: 72 },
  { id: "7d", label: "7 días", hours: 168 },
];

const list = (payload) =>
  Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];

function humanMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${h} h${m ? ` ${m} min` : ""}`;
}

function timestamp(entry, fields) {
  for (const field of fields) {
    if (!entry?.[field]) continue;
    const value = new Date(entry[field]).getTime();
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES");
}

function methodKey(entry) {
  const value = String(entry?.method || "").toLowerCase();
  if (value === "left breast") return "left";
  if (value === "right breast") return "right";
  if (value === "both breasts") return "both";
  return "";
}

function methodLabel(entry) {
  const value = String(entry?.method || "").trim();
  const lower = value.toLowerCase();
  if (lower === "left breast") return "Pecho izquierdo";
  if (lower === "right breast") return "Pecho derecho";
  if (lower === "both breasts") return "Ambos pechos";
  if (lower === "bottle") return "Biberón";
  return value || "—";
}

function diaperLabel(entry) {
  if (entry?.wet && entry?.solid) return "Pis + caca";
  if (entry?.wet) return "Pis";
  if (entry?.solid) return "Caca";
  return "Seco / otro";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function measurement(entries, field, dateFields, startMs) {
  const valid = [...entries]
    .filter((entry) => Number.isFinite(Number(entry?.[field])))
    .sort((a, b) => timestamp(b, dateFields) - timestamp(a, dateFields));
  const inPeriod = valid.filter((entry) => timestamp(entry, dateFields) >= startMs);
  return { inPeriod, latest: valid[0] || null, display: inPeriod[0] || valid[0] || null };
}

function measureText(entry, field) {
  if (!entry || !Number.isFinite(Number(entry[field]))) return "—";
  const value = Number(entry[field]).toLocaleString("es-ES", { maximumFractionDigits: 2 });
  return `${value}${entry.unit ? ` ${entry.unit}` : ""}`;
}

function summarize(data, startMs) {
  const feedingMinutes = Math.round(
    data.feedings.reduce((sum, entry) => sum + feedingDurationSeconds(entry), 0) / 60,
  );
  const breast = { left: 0, right: 0, both: 0 };
  data.feedings.forEach((entry) => {
    const key = methodKey(entry);
    if (key) breast[key] += Math.round(feedingDurationSeconds(entry) / 60);
  });

  const sleepMinutes = Math.round(
    data.sleep.reduce((sum, entry) => sum + parseDuration(entry.duration) * 60, 0),
  );
  const longestSleepMinutes = data.sleep.length
    ? Math.max(...data.sleep.map((entry) => Math.round(parseDuration(entry.duration) * 60)))
    : 0;

  const wet = data.changes.filter((entry) => entry.wet && !entry.solid).length;
  const solid = data.changes.filter((entry) => entry.solid && !entry.wet).length;
  const both = data.changes.filter((entry) => entry.wet && entry.solid).length;

  const tummyMinutes = Math.round(
    data.tummy.reduce((sum, entry) => sum + parseDuration(entry.duration) * 60, 0),
  );

  const tempValues = data.temperatures
    .map((entry) => Number(entry.temperature))
    .filter(Number.isFinite);
  const latestTempInPeriod = [...data.temperatures]
    .filter((entry) => Number.isFinite(Number(entry.temperature)))
    .sort((a, b) => timestamp(b, ["time", "date"]) - timestamp(a, ["time", "date"]))[0] || null;
  const latestTempOverall = [...data.latestTemperatures]
    .filter((entry) => Number.isFinite(Number(entry.temperature)))
    .sort((a, b) => timestamp(b, ["time", "date"]) - timestamp(a, ["time", "date"]))[0] || null;

  return {
    feedingCount: data.feedings.length,
    feedingMinutes,
    breast,
    sleepMinutes,
    sleepCount: data.sleep.length,
    longestSleepMinutes,
    diaperCount: data.changes.length,
    wet,
    solid,
    both,
    tummyMinutes,
    medicationCount: data.medications.length,
    tempCount: tempValues.length,
    tempAvg: tempValues.length ? tempValues.reduce((a, b) => a + b, 0) / tempValues.length : null,
    tempMin: tempValues.length ? Math.min(...tempValues) : null,
    tempMax: tempValues.length ? Math.max(...tempValues) : null,
    latestTemperature: latestTempInPeriod || latestTempOverall,
    weight: measurement(data.weights, "weight", ["date", "time"], startMs),
    height: measurement(data.heights, "height", ["date", "time"], startMs),
  };
}

function metricBox(label, value, detail) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 11, background: "var(--bg)", padding: 11 }}>
      <span style={{ display: "block", color: "var(--text-dim)", fontSize: 10 }}>{label}</span>
      <strong style={{ display: "block", marginTop: 3, fontSize: 18 }}>{value}</strong>
      {detail && <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11 }}>{detail}</span>}
    </div>
  );
}

function buttonStyle(active = false) {
  return {
    border: active ? "1px solid var(--text-muted)" : "1px solid var(--border)",
    borderRadius: 9,
    background: active ? "var(--surface)" : "var(--bg)",
    color: "var(--text)",
    padding: "8px 11px",
    fontFamily: "inherit",
    fontWeight: active ? 800 : 650,
    fontSize: 12,
    cursor: "pointer",
  };
}

function periodDetail(measure, emptyLabel, latestLabel, startMs) {
  if (!measure.display) return emptyLabel;
  const when = timestamp(measure.display, ["date", "time"]);
  if (when >= startMs) {
    return `${measure.inPeriod.length} registro${measure.inPeriod.length === 1 ? "" : "s"} en el periodo · ${formatDateTime(when)}`;
  }
  return `${latestLabel} · ${formatDateTime(when)}`;
}

function htmlRows(rows, cells, empty) {
  if (!rows.length) return `<tr><td colspan="${cells.length}" class="empty">${escapeHtml(empty)}</td></tr>`;
  return rows.map((row) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell(row))}</td>`).join("")}</tr>`).join("");
}

export default function ReportsPanel({ childId }) {
  const [period, setPeriod] = useState("24h");
  const [childName, setChildName] = useState("Bebé");
  const [data, setData] = useState({
    feedings: [], sleep: [], changes: [], tummy: [], temperatures: [], latestTemperatures: [], medications: [], weights: [], heights: [],
  });
  const [loading, setLoading] = useState(Boolean(childId));
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const selected = PERIODS.find((item) => item.id === period) || PERIODS[0];
  const startMs = useMemo(() => Date.now() - selected.hours * 60 * 60 * 1000, [selected.hours]);
  const startIso = new Date(startMs).toISOString();

  useEffect(() => {
    if (!childId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");

    Promise.all([
      api.getChildren().catch(() => ({ results: [] })),
      api.getFeedings({ child: childId, start_min: startIso, limit: 500, ordering: "-start" }),
      api.getSleep({ child: childId, start_min: startIso, limit: 500, ordering: "-start" }),
      api.getChanges({ child: childId, date_min: startIso, limit: 500, ordering: "-time" }),
      api.getTummyTimes({ child: childId, start_min: startIso, limit: 500, ordering: "-start" }),
      api.getTemperature({ child: childId, time_min: startIso, limit: 500, ordering: "-time" }),
      api.getTemperature({ child: childId, limit: 1, ordering: "-time" }).catch(() => ({ results: [] })),
      api.getMedication({ child: childId, time_min: startIso, limit: 500, ordering: "-time" }).catch(() => ({ results: [] })),
      api.getWeight({ child: childId, limit: 100, ordering: "-date" }).catch(() => ({ results: [] })),
      api.getHeight({ child: childId, limit: 100, ordering: "-date" }).catch(() => ({ results: [] })),
    ])
      .then(([children, feedings, sleep, changes, tummy, temperatures, latestTemperatures, medications, weights, heights]) => {
        if (cancelled) return;
        const child = list(children).find((entry) => Number(entry.id) === Number(childId));
        if (child?.first_name) setChildName(child.first_name);
        setData({
          feedings: list(feedings), sleep: list(sleep), changes: list(changes), tummy: list(tummy),
          temperatures: list(temperatures), latestTemperatures: list(latestTemperatures), medications: list(medications),
          weights: list(weights), heights: list(heights),
        });
      })
      .catch((err) => { if (!cancelled) setError(err?.message || "No se pudo generar el informe."); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [childId, startIso]);

  const summary = useMemo(() => summarize(data, startMs), [data, startMs]);

  const temperatureDetail = summary.tempCount
    ? `${summary.tempCount} mediciones · media ${summary.tempAvg.toFixed(1)} °C · mín. ${summary.tempMin.toFixed(1)} · máx. ${summary.tempMax.toFixed(1)}`
    : summary.latestTemperature
      ? `Sin mediciones en el periodo · última ${Number(summary.latestTemperature.temperature).toFixed(1)} °C · ${formatDateTime(timestamp(summary.latestTemperature, ["time", "date"]))}`
      : "Sin registros";

  const textReport = useMemo(() => [
    `Informe médico de ${childName} · ${selected.label}`,
    `Periodo: ${formatDateTime(startMs)} → ${formatDateTime(new Date())}`,
    "",
    `Tomas: ${summary.feedingCount} · ${summary.feedingMinutes} min`,
    `Lactancia: izquierdo ${summary.breast.left} min · derecho ${summary.breast.right} min · ambos ${summary.breast.both} min`,
    `Sueño: ${humanMinutes(summary.sleepMinutes)} · ${summary.sleepCount} tramos · máximo ${humanMinutes(summary.longestSleepMinutes)}`,
    `Pañales: ${summary.diaperCount} · ${summary.wet} pis · ${summary.solid} caca · ${summary.both} ambos`,
    `Medicación: ${summary.medicationCount} dosis · boca abajo: ${summary.tummyMinutes} min`,
    `Temperatura: ${temperatureDetail}`,
    summary.weight.display
      ? `${summary.weight.inPeriod.length ? "Peso" : "Último pesaje"}: ${measureText(summary.weight.display, "weight")} · ${formatDateTime(timestamp(summary.weight.display, ["date", "time"]))}`
      : "Peso: sin registros",
    summary.height.display
      ? `${summary.height.inPeriod.length ? "Altura" : "Última altura"}: ${measureText(summary.height.display, "height")} · ${formatDateTime(timestamp(summary.height.display, ["date", "time"]))}`
      : "Altura: sin registros",
  ].join("\n"), [childName, selected.label, startMs, summary, temperatureDetail]);

  const copyReport = async () => {
    try { await navigator.clipboard.writeText(textReport); }
    catch {
      const textarea = document.createElement("textarea");
      textarea.value = textReport; document.body.appendChild(textarea); textarea.select(); document.execCommand("copy"); textarea.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };

  const downloadCsv = () => {
    const rows = [
      ["Campo", "Valor"], ["Bebé", childName], ["Periodo", selected.label],
      ["Tomas", summary.feedingCount], ["Minutos de toma", summary.feedingMinutes],
      ["Pecho izquierdo (min)", summary.breast.left], ["Pecho derecho (min)", summary.breast.right], ["Ambos pechos (min)", summary.breast.both],
      ["Sueño total (min)", summary.sleepMinutes], ["Sueño más largo (min)", summary.longestSleepMinutes],
      ["Pañales", summary.diaperCount], ["Solo pis", summary.wet], ["Solo caca", summary.solid], ["Ambos", summary.both],
      ["Dosis de medicación", summary.medicationCount], ["Boca abajo (min)", summary.tummyMinutes],
      ["Temperaturas en periodo", summary.tempCount], ["Temperatura media", summary.tempAvg == null ? "" : summary.tempAvg.toFixed(1)],
      ["Temperatura mínima", summary.tempMin == null ? "" : summary.tempMin.toFixed(1)], ["Temperatura máxima", summary.tempMax == null ? "" : summary.tempMax.toFixed(1)],
      [summary.weight.inPeriod.length ? "Peso del periodo" : "Último peso", measureText(summary.weight.display, "weight")],
      ["Fecha peso", summary.weight.display ? formatDateTime(timestamp(summary.weight.display, ["date", "time"])) : ""],
      [summary.height.inPeriod.length ? "Altura del periodo" : "Última altura", measureText(summary.height.display, "height")],
      ["Fecha altura", summary.height.display ? formatDateTime(timestamp(summary.height.display, ["date", "time"])) : ""],
    ];
    const csv = "\ufeff" + rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `baby-buddy-${childName}-${period}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const popup = window.open("", "_blank", "width=980,height=1100");
    if (!popup) { setError("El navegador ha bloqueado la ventana de impresión."); return; }

    const feedings = [...data.feedings].sort((a, b) => timestamp(a, ["start"]) - timestamp(b, ["start"]));
    const changes = [...data.changes].sort((a, b) => timestamp(a, ["time", "date"]) - timestamp(b, ["time", "date"]));
    const temperatures = [...data.temperatures].sort((a, b) => timestamp(a, ["time", "date"]) - timestamp(b, ["time", "date"]));
    const weights = summary.weight.inPeriod.length ? [...summary.weight.inPeriod].reverse() : summary.weight.latest ? [summary.weight.latest] : [];
    const heights = summary.height.inPeriod.length ? [...summary.height.inPeriod].reverse() : summary.height.latest ? [summary.height.latest] : [];
    const medications = [...data.medications].sort((a, b) => timestamp(a, ["time", "date"]) - timestamp(b, ["time", "date"]));
    const tempRows = temperatures.length ? temperatures : summary.latestTemperature ? [summary.latestTemperature] : [];

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Informe médico · ${escapeHtml(childName)}</title><style>
      @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#172033;margin:0;font-size:10px;line-height:1.4}
      .head{border:1px solid #cbd5e1;border-radius:14px;padding:17px 19px;background:#f8fafc;margin-bottom:13px}.headrow{display:flex;justify-content:space-between;gap:20px}.meta{text-align:right;color:#64748b;font-size:9px}h1{font-size:23px;margin:0 0 3px}.sub{font-size:12px;color:#475569}
      h2{font-size:13px;margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.card{border:1px solid #dbe2ea;border-radius:10px;padding:9px}.label{font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:800}.value{font-size:16px;font-weight:850;margin:2px 0}.detail,.muted{color:#64748b;font-size:8.5px}
      table{width:100%;border-collapse:collapse;margin-top:5px}th{background:#f1f5f9;color:#475569;text-align:left;font-size:8px;text-transform:uppercase;padding:5px;border-bottom:1px solid #cbd5e1}td{padding:5px;border-bottom:1px solid #e2e8f0}.empty{text-align:center;color:#94a3b8;padding:9px}.section{break-inside:avoid}.footer{margin-top:16px;padding-top:7px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:8px;display:flex;justify-content:space-between}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>
      <div class="head"><div class="headrow"><div><h1>Informe médico · ${escapeHtml(childName)}</h1><div class="sub">Baby Buddy Dashboard · ${escapeHtml(selected.label)}</div></div><div class="meta"><strong>Periodo</strong><br>${escapeHtml(formatDateTime(startMs))}<br>${escapeHtml(formatDateTime(new Date()))}<br><br>Generado ${escapeHtml(new Date().toLocaleString("es-ES"))}</div></div></div>
      <div class="section"><h2>Resumen</h2><div class="grid">
        <div class="card"><div class="label">Tomas</div><div class="value">${summary.feedingCount}</div><div class="detail">${summary.feedingMinutes} min</div></div>
        <div class="card"><div class="label">Sueño</div><div class="value">${escapeHtml(humanMinutes(summary.sleepMinutes))}</div><div class="detail">${summary.sleepCount} tramos · máx. ${escapeHtml(humanMinutes(summary.longestSleepMinutes))}</div></div>
        <div class="card"><div class="label">Pañales</div><div class="value">${summary.diaperCount}</div><div class="detail">${summary.wet} pis · ${summary.solid} caca · ${summary.both} ambos</div></div>
        <div class="card"><div class="label">Peso</div><div class="value">${escapeHtml(measureText(summary.weight.display, "weight"))}</div><div class="detail">${summary.weight.display ? escapeHtml(formatDateTime(timestamp(summary.weight.display, ["date", "time"]))) : "Sin registros"}</div></div>
        <div class="card"><div class="label">Altura</div><div class="value">${escapeHtml(measureText(summary.height.display, "height"))}</div><div class="detail">${summary.height.display ? escapeHtml(formatDateTime(timestamp(summary.height.display, ["date", "time"]))) : "Sin registros"}</div></div>
        <div class="card"><div class="label">Temperatura</div><div class="value">${summary.latestTemperature ? `${Number(summary.latestTemperature.temperature).toFixed(1)} °C` : "—"}</div><div class="detail">${escapeHtml(temperatureDetail)}</div></div>
      </div></div>
      <div class="section"><h2>Lactancia</h2><div class="grid"><div class="card"><div class="label">Izquierdo</div><div class="value">${summary.breast.left} min</div></div><div class="card"><div class="label">Derecho</div><div class="value">${summary.breast.right} min</div></div><div class="card"><div class="label">Ambos</div><div class="value">${summary.breast.both} min</div></div></div></div>
      <div class="section"><h2>Detalle de tomas</h2><table><thead><tr><th>Inicio</th><th>Fin</th><th>Duración</th><th>Método</th></tr></thead><tbody>${htmlRows(feedings, [
        (r) => formatDateTime(r.start), (r) => r.end ? formatDateTime(r.end) : "—", (r) => humanMinutes(feedingDurationSeconds(r) / 60), (r) => methodLabel(r),
      ], "Sin tomas en el periodo")}</tbody></table></div>
      <div class="section"><h2>Pañales</h2><table><thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Notas</th></tr></thead><tbody>${htmlRows(changes, [
        (r) => formatDateTime(r.time || r.date), (r) => diaperLabel(r), (r) => r.notes || r.note || "—",
      ], "Sin cambios de pañal en el periodo")}</tbody></table></div>
      <div class="section"><h2>Temperatura</h2><div class="muted">${temperatures.length ? "Registros del periodo seleccionado." : "Sin temperatura en el periodo; se muestra la última medición disponible."}</div><table><thead><tr><th>Fecha y hora</th><th>Temperatura</th></tr></thead><tbody>${htmlRows(tempRows, [
        (r) => formatDateTime(r.time || r.date), (r) => `${Number(r.temperature).toFixed(1)} °C`,
      ], "Sin registros de temperatura")}</tbody></table></div>
      <div class="section"><h2>Peso y altura</h2><div class="muted">${summary.weight.inPeriod.length ? "Pesajes del periodo seleccionado." : "Sin pesaje en el periodo; se muestra el último disponible."}</div><table><thead><tr><th>Fecha</th><th>Peso</th></tr></thead><tbody>${htmlRows(weights, [(r) => formatDate(r.date || r.time), (r) => measureText(r, "weight")], "Sin registros de peso")}</tbody></table><div class="muted" style="margin-top:8px">${summary.height.inPeriod.length ? "Alturas del periodo seleccionado." : "Sin altura en el periodo; se muestra la última disponible."}</div><table><thead><tr><th>Fecha</th><th>Altura</th></tr></thead><tbody>${htmlRows(heights, [(r) => formatDate(r.date || r.time), (r) => measureText(r, "height")], "Sin registros de altura")}</tbody></table></div>
      <div class="section"><h2>Medicación y otros</h2><div class="grid"><div class="card"><div class="label">Medicación</div><div class="value">${summary.medicationCount}</div><div class="detail">dosis</div></div><div class="card"><div class="label">Boca abajo</div><div class="value">${summary.tummyMinutes} min</div></div><div class="card"><div class="label">Sueño más largo</div><div class="value">${escapeHtml(humanMinutes(summary.longestSleepMinutes))}</div></div></div><table><thead><tr><th>Fecha y hora</th><th>Registro</th></tr></thead><tbody>${htmlRows(medications, [
        (r) => formatDateTime(r.time || r.date), (r) => r.name || r.medication_name || r.medication || "Medicación",
      ], "Sin medicación en el periodo")}</tbody></table></div>
      <div class="footer"><span>Baby Buddy Dashboard ES · ES18.22</span><span>${escapeHtml(childName)} · ${escapeHtml(selected.label)}</span></div><script>window.onload=()=>window.print();</script>
    </body></html>`;

    popup.document.write(html); popup.document.close();
  };

  if (!childId) return <div style={{ color: "var(--text-dim)", padding: 20, textAlign: "center" }}>No se pudo determinar el bebé activo.</div>;

  const tempValue = summary.tempCount
    ? `${summary.tempAvg.toFixed(1)} °C`
    : summary.latestTemperature ? `${Number(summary.latestTemperature.temperature).toFixed(1)} °C` : "—";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {PERIODS.map((item) => <button type="button" key={item.id} style={buttonStyle(period === item.id)} onClick={() => setPeriod(item.id)}>{item.label}</button>)}
      </div>
      {loading ? <div style={{ padding: 22, textAlign: "center", color: "var(--text-muted)" }}>Generando informe…</div> : error ? <div style={{ color: "#ef4444", padding: 10 }}>{error}</div> : <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8 }}>
          {metricBox("🍼 TOMAS", summary.feedingCount, `${summary.feedingMinutes} min totales`)}
          {metricBox("😴 SUEÑO", humanMinutes(summary.sleepMinutes), `${summary.sleepCount} tramos · máx. ${humanMinutes(summary.longestSleepMinutes)}`)}
          {metricBox("🧷 PAÑALES", summary.diaperCount, `${summary.wet} pis · ${summary.solid} caca · ${summary.both} ambos`)}
          {metricBox("💊 MEDICACIÓN", summary.medicationCount, "dosis registradas")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8 }}>
          {metricBox("⚖️ PESO", measureText(summary.weight.display, "weight"), periodDetail(summary.weight, "Sin pesajes registrados", "Último pesaje", startMs))}
          {metricBox("📏 ALTURA", measureText(summary.height.display, "height"), periodDetail(summary.height, "Sin alturas registradas", "Última altura", startMs))}
          {metricBox("🌡️ TEMPERATURA", tempValue, temperatureDetail)}
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 11, background: "var(--bg)", padding: 11 }}>
          <strong style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Lactancia</strong>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>Izquierdo: <strong>{summary.breast.left} min</strong> · Derecho: <strong>{summary.breast.right} min</strong> · Ambos: <strong>{summary.breast.both} min</strong></div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button type="button" style={buttonStyle()} onClick={copyReport}>{copied ? "✓ Copiado" : "Copiar resumen"}</button>
          <button type="button" style={buttonStyle()} onClick={downloadCsv}>Descargar CSV</button>
          <button type="button" style={buttonStyle()} onClick={printReport}>Imprimir / Guardar PDF</button>
        </div>
      </>}
    </div>
  );
}
