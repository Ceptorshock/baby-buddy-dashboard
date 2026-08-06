import { useState } from "react";
import SectionCard from "./SectionCard";
import { Icons } from "./Icons";

export default function RoomCard({ childId, status, onToggleLight }) {
  const [showCamera, setShowCamera] = useState(false);
  const [cameraNonce, setCameraNonce] = useState(Date.now());
  if (!status?.configured) return null;
  const lightOn = status.light === "on";
  const windowOpen = status.window === "on";
  const temp = status.temperature != null ? `${status.temperature} °C` : "—";
  const humidity = status.humidity != null ? `${status.humidity} %` : "—";

  return (
    <SectionCard title="Habitación" icon={<Icons.Home />} color="#22C55E">
      <div className="room-status-grid">
        <div className="room-reading"><span>🌡️</span><strong>{temp}</strong><small>Temperatura</small></div>
        <div className="room-reading"><span>💧</span><strong>{humidity}</strong><small>Humedad</small></div>
        <div className={`room-reading${lightOn ? " room-reading-active" : ""}`}><Icons.Light /><strong>{lightOn ? "Encendida" : "Apagada"}</strong><small>Luz</small></div>
        <div className={`room-reading${windowOpen ? " room-reading-warning" : ""}`}><Icons.Window /><strong>{windowOpen ? "Abierta" : "Cerrada"}</strong><small>Ventana</small></div>
      </div>
      <div className="room-actions">
        {status.has_light && (
          <button className="room-action-btn" onClick={onToggleLight}>
            <Icons.Light /> {lightOn ? "Apagar luz" : "Encender luz"}
          </button>
        )}
        {status.has_camera && (
          <button className="room-action-btn" onClick={() => { setShowCamera((v) => !v); setCameraNonce(Date.now()); }}>
            <Icons.Camera /> {showCamera ? "Ocultar cámara" : "Ver cámara"}
          </button>
        )}
      </div>
      {showCamera && status.has_camera && (
        <div className="room-camera-wrap">
          <img src={`./api/room-camera/${childId}?t=${cameraNonce}`} alt="Cámara de la habitación" className="room-camera" />
          <button className="camera-refresh" onClick={() => setCameraNonce(Date.now())}>Actualizar imagen</button>
        </div>
      )}
    </SectionCard>
  );
}
