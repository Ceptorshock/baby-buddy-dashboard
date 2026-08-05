import { useUnits } from "../utils/units";

const SERIES_NAMES = {
  amount: "Cantidad",
  hours: "Horas",
  minutes: "Minutos",
  weight: "Peso",
  height: "Altura",
};

export default function CustomTooltip({ active, payload, label, labelFormatter }) {
  const units = useUnits();
  if (!active || !payload?.length) return null;
  const formattedLabel = labelFormatter ? labelFormatter(label) : label;

  const getUnit = (name) => {
    if (name === "amount") return ` ${units.volume}`;
    if (name === "minutes") return " min";
    if (name === "hours") return " h";
    if (name === "weight") return ` ${units.weight}`;
    if (name === "height") return ` ${units.length}`;
    return "";
  };

  return (
    <div
      style={{
        background: "var(--tooltip-bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 12,
        color: "var(--text)",
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{formattedLabel}</div>
      {payload.map((p, i) => (
        <div
          key={i}
          style={{
            color: p.color,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: p.color,
              display: "inline-block",
            }}
          />
          {SERIES_NAMES[p.name] || p.name}: {p.value}{getUnit(p.name)}
        </div>
      ))}
    </div>
  );
}
