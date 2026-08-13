export default function TimelineItem({ time, label, detail, color, isLast, author, audit }) {
  const authorLabel = author || audit?.created_by;
  const edited = Number(audit?.edit_count || 0) > 0;
  return (
    <div style={{ display: "flex", gap: 12, position: "relative", paddingBottom: isLast ? 0 : 16 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, border: "2px solid var(--card-bg)", boxShadow: `0 0 0 2px ${color}40`, flexShrink: 0, marginTop: 4 }} />
        {!isLast && <div style={{ width: 2, flex: 1, background: `${color}25`, marginTop: 4 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</span>
          <span
            style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--mono)", flexShrink: 0 }}
            title="Pulsa el registro para editarlo"
          >
            {time} <span aria-hidden="true" style={{ opacity: 0.75 }}>✎</span>
          </span>
        </div>
        {detail && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{detail}</div>}
        {authorLabel && (
          <div className="entry-author">
            Registrado por {authorLabel}{edited ? ` · editado ${audit.edit_count} ${audit.edit_count === 1 ? "vez" : "veces"}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
