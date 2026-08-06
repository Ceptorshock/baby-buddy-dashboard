import { useState } from "react";
import SectionCard from "./SectionCard";
import { Icons } from "./Icons";

export default function RoomCard({ childId, status, onToggleLight }) {
  const [showCamera, setShowCamera] = useState(false);
  const [cameraNonce, setCameraNonce] = useState(Date.now());
  const [lightBusy, setLightBusy] = useState(false);

  if (!status?.configured) return null;

  const lightOn = status.light === "on";
  const windowOpen = status.window === "on";
  const temp = status.temperature != null ? `${status.temperature} °C` : "—";
  const humidity = status.humidity != null ? `${status.humidity} %` : "—";

  const toggleLight = async () => {
    if (!status.has_light || lightBusy) return;
    setLightBusy(true);
    try {
      await onToggleLight?.();
    } finally {
      setLightBusy(false);
    }
  };

  const toggleCamera = () => {
    setShowCamera((value) => !value);
    setCameraNonce(Date.now());
  };

  return (
    <SectionCard title="Habitación" icon={<Icons.Home />} color="#22C55E">
      <div className="room-status-grid">
        <div className="room-reading">
          <span className="room-reading-icon room-reading-emoji">🌡️</span>
          <strong>{temp}</strong>
          <small>Temperatura</small>
        </div>

        <div className="room-reading">
          <span className="room-reading-icon room-reading-emoji">💧</span>
          <strong>{humidity}</strong>
          <small>Humedad</small>
        </div>

        {status.has_light ? (
          <button
            type="button"
            className={`room-reading room-reading-button${lightOn ? " room-reading-active" : ""}`}
            onClick={toggleLight}
            disabled={lightBusy}
            title={lightOn ? "Apagar luz" : "Encender luz"}
          >
            <span className="room-reading-icon"><Icons.Light /></span>
            <strong>{lightBusy ? "Cambiando…" : lightOn ? "Encendida" : "Apagada"}</strong>
            <small>Luz</small>
          </button>
        ) : (
          <div className="room-reading">
            <span className="room-reading-icon"><Icons.Light /></span>
            <strong>Sin configurar</strong>
            <small>Luz</small>
          </div>
        )}

        <div className={`room-reading${windowOpen ? " room-reading-warning" : ""}`}>
          <span className="room-reading-icon"><Icons.Window /></span>
          <strong>{windowOpen ? "Abierta" : "Cerrada"}</strong>
          <small>Ventana</small>
        </div>

        {status.has_camera && (
          <button
            type="button"
            className={`room-reading room-reading-button${showCamera ? " room-reading-camera-active" : ""}`}
            onClick={toggleCamera}
            title={showCamera ? "Ocultar cámara" : "Ver cámara"}
          >
            <span className="room-reading-icon"><Icons.Camera /></span>
            <strong>{showCamera ? "Visible" : "Abrir"}</strong>
            <small>Cámara</small>
          </button>
        )}
      </div>

      {showCamera && status.has_camera && (
        <div className="room-camera-wrap">
          <img src={`./api/room-camera/${childId}?t=${cameraNonce}`} alt="Cámara de la habitación" className="room-camera" />
          <button type="button" className="camera-refresh" onClick={() => setCameraNonce(Date.now())}>Actualizar imagen</button>
        </div>
      )}
    </SectionCard>
  );
}
