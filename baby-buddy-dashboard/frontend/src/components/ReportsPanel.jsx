import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  feedingDurationSeconds,
  parseDuration,
} from "../utils/formatters";

const PERIODS = [
  { id: "24h", label: "24 h", hours: 24 },
  { id: "3d", label: "3 días", hours: 72 },
  { id: "7d", label: "7 días", hours: 168 },
];

function resultList(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.results) ? payload.results : [];
}

function humanMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}

function method(entry) {
  const value = String(entry?.method || "").toLowerCase();
  if (value === "left breast") return "left";
  if (value === "right breast") return "right";
  if (value === "both breasts") return "both";
  return "";
}

function summarize(data) {
  const feedingMinutes = Math.round(
    data.feedings.reduce(
      (sum, entry) => sum + feedingDurationSeconds(entry),
      0,
    ) / 60,
  );

  const breast = {
    left: 0,
    right: 0,
    both: 0,
  };

  for (const entry of data.feedings) {
    const key = method(entry);
    if (key) {
      breast[key] += Math.round(feedingDurationSeconds(entry) / 60);
    }
  }

  const sleepMinutes = Math.round(
    data.sleep.reduce(
      (sum, entry) => sum + parseDuration(entry.duration) * 60,
      0,
    ),
  );

  const longestSleepMinutes = data.sleep.length
    ? Math.max(
        ...data.sleep.map((entry) =>
          Math.round(parseDuration(entry.duration) * 60),
        ),
      )
    : 0;

  const wet = data.changes.filter(
    (entry) => entry.wet && !entry.solid,
  ).length;
  const solid = data.changes.filter(
    (entry) => entry.solid && !entry.wet,
  ).length;
  const both = data.changes.filter(
    (entry) => entry.wet && entry.solid,
  ).length;

  const tummyMinutes = Math.round(
    data.tummy.reduce(
      (sum, entry) => sum + parseDuration(entry.duration) * 60,
      0,
    ),
  );

  const temperatures = data.temperatures
    .map((entry) => Number(entry.temperature))
    .filter(Number.isFinite);

  const tempMax = temperatures.length
    ? Math.max(...temperatures)
    : null;
  const tempAvg = temperatures.length
    ? temperatures.reduce((sum, value) => sum + value, 0) /
      temperatures.length
    : null;

  const latestWeight = [...data.weights]
    .filter((entry) => Number.isFinite(Number(entry.weight)))
    .sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    )[0];

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
    tempCount: temperatures.length,
    tempMax,
    tempAvg,
    latestWeight,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metricBox(label, value, detail) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 11,
        background: "var(--bg)",
        padding: 11,
      }}
    >
      <span style={{ display: "block", color: "var(--text-dim)", fontSize: 10 }}>
        {label}
      </span>
      <strong style={{ display: "block", marginTop: 3, fontSize: 18 }}>
        {value}
      </strong>
      {detail && (
        <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11 }}>
          {detail}
        </span>
      )}
    </div>
  );
}

function buttonStyle(active = false) {
  return {
    border: active
      ? "1px solid var(--text-muted)"
      : "1px solid var(--border)",
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

export default function ReportsPanel({ childId }) {
  const [period, setPeriod] = useState("24h");
  const [childName, setChildName] = useState("Bebé");
  const [data, setData] = useState({
    feedings: [],
    sleep: [],
    changes: [],
    tummy: [],
    temperatures: [],
    medications: [],
    weights: [],
  });
  const [loading, setLoading] = useState(Boolean(childId));
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const selected = PERIODS.find((item) => item.id === period) || PERIODS[0];

  useEffect(() => {
    if (!childId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const start = new Date(Date.now() - selected.hours * 60 * 60 * 1000);
    const iso = start.toISOString();

    setLoading(true);
    setError("");

    Promise.all([
      api.getChildren().catch(() => ({ results: [] })),
      api.getFeedings({
        child: childId,
        start_min: iso,
        limit: 500,
        ordering: "-start",
      }),
      api.getSleep({
        child: childId,
        start_min: iso,
        limit: 500,
        ordering: "-start",
      }),
      api.getChanges({
        child: childId,
        date_min: iso,
        limit: 500,
        ordering: "-time",
      }),
      api.getTummyTimes({
        child: childId,
        start_min: iso,
        limit: 500,
        ordering: "-start",
      }),
      api.getTemperature({
        child: childId,
        time_min: iso,
        limit: 500,
        ordering: "-time",
      }),
      api.getMedication({
        child: childId,
        time_min: iso,
        limit: 500,
        ordering: "-time",
      }).catch(() => ({ results: [] })),
      api.getWeight({
        child: childId,
        limit: 20,
        ordering: "-date",
      }).catch(() => ({ results: [] })),
    ])
      .then(
        ([
          children,
          feedings,
          sleep,
          changes,
          tummy,
          temperatures,
          medications,
          weights,
        ]) => {
          if (cancelled) return;

          const child = resultList(children).find(
            (entry) => Number(entry.id) === Number(childId),
          );
          if (child?.first_name) setChildName(child.first_name);

          setData({
            feedings: resultList(feedings),
            sleep: resultList(sleep),
            changes: resultList(changes),
            tummy: resultList(tummy),
            temperatures: resultList(temperatures),
            medications: resultList(medications),
            weights: resultList(weights),
          });
        },
      )
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "No se pudo generar el informe.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [childId, selected.hours]);

  const summary = useMemo(() => summarize(data), [data]);

  const textReport = useMemo(() => {
    const lines = [
      `Informe de ${childName} · ${selected.label}`,
      `Generado: ${new Date().toLocaleString("es-ES")}`,
      "",
      `Tomas: ${summary.feedingCount} · ${summary.feedingMinutes} min totales`,
      `Pecho izquierdo: ${summary.breast.left} min`,
      `Pecho derecho: ${summary.breast.right} min`,
      `Ambos pechos: ${summary.breast.both} min`,
      `Sueño: ${humanMinutes(summary.sleepMinutes)} · ${summary.sleepCount} tramos`,
      `Tramo de sueño más largo: ${humanMinutes(summary.longestSleepMinutes)}`,
      `Pañales: ${summary.diaperCount} · ${summary.wet} pis · ${summary.solid} caca · ${summary.both} ambos`,
      `Boca abajo: ${summary.tummyMinutes} min`,
      `Medicación: ${summary.medicationCount} dosis`,
      `Temperatura: ${
        summary.tempCount
          ? `${summary.tempCount} mediciones · media ${summary.tempAvg.toFixed(1)} °C · máxima ${summary.tempMax.toFixed(1)} °C`
          : "sin mediciones"
      }`,
    ];

    if (summary.latestWeight) {
      lines.push(
        `Último peso registrado: ${summary.latestWeight.weight} ${
          summary.latestWeight.unit || ""
        } · ${new Date(summary.latestWeight.date).toLocaleDateString("es-ES")}`,
      );
    }

    return lines.join("\n");
  }, [summary, childName, selected.label]);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(textReport);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = textReport;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const downloadCsv = () => {
    const rows = [
      ["Campo", "Valor"],
      ["Bebé", childName],
      ["Periodo", selected.label],
      ["Tomas", summary.feedingCount],
      ["Minutos de toma", summary.feedingMinutes],
      ["Pecho izquierdo (min)", summary.breast.left],
      ["Pecho derecho (min)", summary.breast.right],
      ["Ambos pechos (min)", summary.breast.both],
      ["Sueño total (min)", summary.sleepMinutes],
      ["Tramos de sueño", summary.sleepCount],
      ["Sueño más largo (min)", summary.longestSleepMinutes],
      ["Pañales", summary.diaperCount],
      ["Solo pis", summary.wet],
      ["Solo caca", summary.solid],
      ["Ambos", summary.both],
      ["Boca abajo (min)", summary.tummyMinutes],
      ["Dosis de medicación", summary.medicationCount],
      ["Temperaturas", summary.tempCount],
      ["Temperatura media", summary.tempAvg == null ? "" : summary.tempAvg.toFixed(1)],
      ["Temperatura máxima", summary.tempMax == null ? "" : summary.tempMax.toFixed(1)],
    ];

    const csv =
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
            .join(";"),
        )
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `baby-buddy-${childName}-${period}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const popup = window.open("", "_blank", "width=760,height=900");
    if (!popup) {
      setError("El navegador ha bloqueado la ventana de impresión.");
      return;
    }

    const body = textReport
      .split("\n")
      .map((line) =>
        line
          ? `<div>${escapeHtml(line)}</div>`
          : '<div style="height:10px"></div>',
      )
      .join("");

    popup.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Informe Baby Buddy</title>
<style>
body{font-family:Arial,sans-serif;color:#111;padding:32px;line-height:1.55}
h1{font-size:22px;margin:0 0 18px}
div{margin:3px 0}
@media print{body{padding:0}}
</style>
</head>
<body>
<h1>Informe Baby Buddy</h1>
${body}
<script>window.onload=()=>window.print();</script>
</body>
</html>`);
    popup.document.close();
  };

  if (!childId) {
    return (
      <div style={{ color: "var(--text-dim)", padding: 20, textAlign: "center" }}>
        No se pudo determinar el bebé activo.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {PERIODS.map((item) => (
          <button
            type="button"
            key={item.id}
            style={buttonStyle(period === item.id)}
            onClick={() => setPeriod(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 22, textAlign: "center", color: "var(--text-muted)" }}>
          Generando informe…
        </div>
      ) : error ? (
        <div style={{ color: "#ef4444", padding: 10 }}>{error}</div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
              gap: 8,
            }}
          >
            {metricBox(
              "🍼 TOMAS",
              summary.feedingCount,
              `${summary.feedingMinutes} min totales`,
            )}
            {metricBox(
              "😴 SUEÑO",
              humanMinutes(summary.sleepMinutes),
              `${summary.sleepCount} tramos · máx. ${humanMinutes(summary.longestSleepMinutes)}`,
            )}
            {metricBox(
              "🧷 PAÑALES",
              summary.diaperCount,
              `${summary.wet} pis · ${summary.solid} caca · ${summary.both} ambos`,
            )}
            {metricBox(
              "💊 MEDICACIÓN",
              summary.medicationCount,
              "dosis registradas",
            )}
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 11,
              background: "var(--bg)",
              padding: 11,
            }}
          >
            <strong style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
              Lactancia
            </strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
              Izquierdo: <strong>{summary.breast.left} min</strong> · Derecho:{" "}
              <strong>{summary.breast.right} min</strong> · Ambos:{" "}
              <strong>{summary.breast.both} min</strong>
            </div>
          </div>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <button type="button" style={buttonStyle()} onClick={copyReport}>
              {copied ? "✓ Copiado" : "Copiar resumen"}
            </button>
            <button type="button" style={buttonStyle()} onClick={downloadCsv}>
              Descargar CSV
            </button>
            <button type="button" style={buttonStyle()} onClick={printReport}>
              Imprimir / Guardar PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}
