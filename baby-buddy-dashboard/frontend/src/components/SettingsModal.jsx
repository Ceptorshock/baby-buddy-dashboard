import { useEffect, useMemo, useState } from "react";
import Modal, { FormInput } from "./Modal";
import { Icons } from "./Icons";
import { api } from "../api";

function displayName(child) {
  return [child?.first_name, child?.last_name].filter(Boolean).join(" ") || "Bebé";
}

function errorText(error) {
  const raw = error?.message || String(error || "Error desconocido");
  try {
    const parsed = JSON.parse(raw);
    return parsed.detail || raw;
  } catch {
    return raw;
  }
}

export default function SettingsModal({ onClose, onChanged }) {
  const [settings, setSettings] = useState({ children: [] });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [profile, setProfile] = useState({ first_name: "", last_name: "", birth_date: "", birth_time: "" });
  const [resetChild, setResetChild] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [includeAudit, setIncludeAudit] = useState(true);
  const [resetResult, setResetResult] = useState(null);
  const [medicationAlerts, setMedicationAlerts] = useState({ enabled: true, minutes_before: 20, alert_at_due: true, ha_mobile: true, telegram: true });
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [timerReminders, setTimerReminders] = useState({ enabled: true, feeding_minutes: 90, tummy_minutes: 30, snooze_minutes: 30 });
  const [savingTimerReminders, setSavingTimerReminders] = useState(false);

  const children = settings.children || [];
  const enabledCount = useMemo(() => children.filter((child) => child.enabled).length, [children]);

  const load = async () => {
    try {
      setError("");
      const result = await api.getDashboardSettings();
      setSettings(result || { children: [] });
      if (result?.medication_alerts) setMedicationAlerts(result.medication_alerts);
      if (result?.timer_reminders) setTimerReminders(result.timer_reminders);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleChild = async (child) => {
    setBusyId(child.id);
    setError("");
    setMessage("");
    try {
      await api.setChildEnabled(child.id, !child.enabled);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const beginEdit = (child) => {
    setResetChild(null);
    setResetResult(null);
    setEditingId(child.id);
    setProfile({
      first_name: child.first_name || "",
      last_name: child.last_name || "",
      birth_date: child.birth_date || "",
      birth_time: child.birth_time || "",
    });
  };

  const saveProfile = async (child) => {
    setBusyId(child.id);
    setError("");
    setMessage("");
    try {
      await api.updateChildProfile(child.id, {
        first_name: profile.first_name.trim(),
        last_name: profile.last_name.trim(),
        birth_date: profile.birth_date,
        birth_time: profile.birth_time || null,
      });
      setEditingId(null);
      setMessage(`Datos de ${profile.first_name.trim() || "bebé"} actualizados.`);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const beginReset = (child) => {
    setEditingId(null);
    setResetChild(child);
    setConfirmation("");
    setIncludeAudit(true);
    setResetResult(null);
    setError("");
    setMessage("");
  };

  const runReset = async () => {
    if (!resetChild) return;
    setBusyId(resetChild.id);
    setError("");
    setMessage("");
    try {
      const result = await api.clearChildHistory(resetChild.id, confirmation, includeAudit);
      setResetResult(result);
      setMessage(`Historial de ${resetChild.first_name || "bebé"} limpiado: ${result.total_deleted || 0} entradas eliminadas.`);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const saveTimerReminders = async () => {
    setSavingTimerReminders(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.setTimerReminderSettings(timerReminders);
      setTimerReminders(saved);
      setMessage("Recordatorios de temporizadores actualizados.");
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingTimerReminders(false);
    }
  };

  const saveMedicationAlerts = async () => {
    setSavingAlerts(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.setMedicationAlertSettings(medicationAlerts);
      setMedicationAlerts(saved);
      setMessage("Avisos de medicación actualizados.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingAlerts(false);
    }
  };

  return (
    <Modal title="Ajustes" onClose={onClose} maxWidth={680}>
      <div className="settings-intro">
        <div className="settings-intro-icon"><Icons.Settings /></div>
        <div>
          <strong>Bebés de Baby Buddy</strong>
          <p>La lista se obtiene automáticamente del servidor. Ocultar un bebé no borra ningún dato.</p>
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}
      {message && <div className="settings-success">{message}</div>}

      <section className="settings-child-card is-enabled" style={{ marginBottom: 16 }}>
        <div className="settings-child-head">
          <div className="settings-child-avatar"><Icons.Timer /></div>
          <div className="settings-child-title">
            <strong>¿Te has olvidado de parar?</strong>
            <span>Avisa dentro de la app si una toma o el tiempo boca abajo parecen haberse quedado activos.</span>
          </div>
          <label className="settings-switch">
            <input type="checkbox" checked={Boolean(timerReminders.enabled)} onChange={(e) => setTimerReminders({ ...timerReminders, enabled: e.target.checked })} />
            <span className="settings-switch-track"><span /></span>
            <em>{timerReminders.enabled ? "Activo" : "Desactivado"}</em>
          </label>
        </div>
        <div className="settings-editor" style={{ marginTop: 10 }}>
          <div className="settings-fields-grid">
            <label><span>Aviso en tomas</span><FormInput type="number" min="15" max="360" value={timerReminders.feeding_minutes ?? 90} onChange={(e) => setTimerReminders({ ...timerReminders, feeding_minutes: Number(e.target.value || 90) })} /><small>Minutos. Por defecto: 90.</small></label>
            <label><span>Aviso boca abajo</span><FormInput type="number" min="5" max="180" value={timerReminders.tummy_minutes ?? 30} onChange={(e) => setTimerReminders({ ...timerReminders, tummy_minutes: Number(e.target.value || 30) })} /><small>Minutos. Por defecto: 30.</small></label>
            <label><span>Posponer «Sí, sigue»</span><FormInput type="number" min="5" max="120" value={timerReminders.snooze_minutes ?? 30} onChange={(e) => setTimerReminders({ ...timerReminders, snooze_minutes: Number(e.target.value || 30) })} /><small>Cuánto tarda en volver a preguntar.</small></label>
          </div>
          <p className="settings-help">El sueño no genera este aviso porque puede durar varias horas con normalidad.</p>
          <div className="settings-editor-actions"><button className="settings-primary" onClick={saveTimerReminders} disabled={savingTimerReminders}>{savingTimerReminders ? "Guardando…" : "Guardar recordatorios"}</button></div>
        </div>
      </section>

      <section className="settings-child-card is-enabled" style={{ marginBottom: 16 }}>
        <div className="settings-child-head">
          <div className="settings-child-avatar"><Icons.Pill /></div>
          <div className="settings-child-title">
            <strong>Avisos de medicación</strong>
            <span>Configura cuándo y por dónde avisar de una pauta activa.</span>
          </div>
          <label className="settings-switch">
            <input type="checkbox" checked={Boolean(medicationAlerts.enabled)} onChange={(e) => setMedicationAlerts({ ...medicationAlerts, enabled: e.target.checked })} />
            <span className="settings-switch-track"><span /></span>
            <em>{medicationAlerts.enabled ? "Activos" : "Desactivados"}</em>
          </label>
        </div>
        <div className="settings-editor" style={{ marginTop: 10 }}>
          <div className="settings-fields-grid">
            <label>
              <span>Avisar antes de la dosis</span>
              <FormInput type="number" min="0" max="120" value={medicationAlerts.minutes_before ?? 20} onChange={(e) => setMedicationAlerts({ ...medicationAlerts, minutes_before: Number(e.target.value || 0) })} />
              <small>Minutos. Recomendado: 20.</small>
            </label>
          </div>
          <label className="settings-check-row"><input type="checkbox" checked={Boolean(medicationAlerts.alert_at_due)} onChange={(e) => setMedicationAlerts({ ...medicationAlerts, alert_at_due: e.target.checked })} /><span>Avisar de nuevo al llegar/pasar la hora</span></label>
          <label className="settings-check-row"><input type="checkbox" checked={Boolean(medicationAlerts.ha_mobile)} onChange={(e) => setMedicationAlerts({ ...medicationAlerts, ha_mobile: e.target.checked })} /><span>Home Assistant y móviles configurados</span></label>
          <label className="settings-check-row"><input type="checkbox" checked={Boolean(medicationAlerts.telegram)} onChange={(e) => setMedicationAlerts({ ...medicationAlerts, telegram: e.target.checked })} /><span>Telegram</span></label>
          <div className="settings-editor-actions"><button className="settings-primary" onClick={saveMedicationAlerts} disabled={savingAlerts}>{savingAlerts ? "Guardando…" : "Guardar avisos"}</button></div>
        </div>
      </section>

      {loading ? (
        <div className="settings-loading">Leyendo bebés de Baby Buddy…</div>
      ) : children.length === 0 ? (
        <div className="settings-loading">No se han encontrado bebés.</div>
      ) : (
        <div className="settings-child-list">
          {children.map((child) => {
            const isBusy = busyId === child.id;
            const isEditing = editingId === child.id;
            const isResetting = resetChild?.id === child.id;
            return (
              <section key={child.id} className={`settings-child-card${child.enabled ? " is-enabled" : " is-disabled"}`}>
                <div className="settings-child-head">
                  <div className="settings-child-avatar"><Icons.Baby /></div>
                  <div className="settings-child-title">
                    <strong>{displayName(child)}</strong>
                    <span>{child.birth_date ? `Nacimiento: ${child.birth_date}` : "Fecha de nacimiento sin definir"}</span>
                  </div>
                  <label className="settings-switch" title={child.enabled ? "Visible y monitorizado" : "Oculto y sin avisos"}>
                    <input
                      type="checkbox"
                      checked={Boolean(child.enabled)}
                      disabled={isBusy || (child.enabled && enabledCount <= 1)}
                      onChange={() => toggleChild(child)}
                    />
                    <span className="settings-switch-track"><span /></span>
                    <em>{child.enabled ? "Activo" : "Oculto"}</em>
                  </label>
                </div>

                <div className="settings-child-actions">
                  <button onClick={() => isEditing ? setEditingId(null) : beginEdit(child)} disabled={isBusy}>
                    <Icons.Pencil /> {isEditing ? "Cerrar edición" : "Editar datos"}
                  </button>
                  <button className="settings-danger-link" onClick={() => beginReset(child)} disabled={isBusy}>
                    <Icons.Trash /> Borrar historial de pruebas
                  </button>
                </div>

                {isEditing && (
                  <div className="settings-editor">
                    <div className="settings-fields-grid">
                      <label>
                        <span>Nombre</span>
                        <FormInput value={profile.first_name} onChange={(e) => setProfile({ ...profile, first_name: e.target.value })} />
                      </label>
                      <label>
                        <span>Apellidos</span>
                        <FormInput value={profile.last_name} onChange={(e) => setProfile({ ...profile, last_name: e.target.value })} />
                      </label>
                      <label>
                        <span>Fecha de nacimiento</span>
                        <FormInput type="date" value={profile.birth_date || ""} onChange={(e) => setProfile({ ...profile, birth_date: e.target.value })} />
                      </label>
                      <label>
                        <span>Hora de nacimiento</span>
                        <FormInput type="time" value={(profile.birth_time || "").slice(0, 5)} onChange={(e) => setProfile({ ...profile, birth_time: e.target.value })} />
                      </label>
                    </div>
                    <p className="settings-help">Esto modifica el perfil real de Baby Buddy. El ID interno del bebé no cambia.</p>
                    <div className="settings-editor-actions">
                      <button onClick={() => setEditingId(null)}>Cancelar</button>
                      <button className="settings-primary" onClick={() => saveProfile(child)} disabled={isBusy || !profile.first_name.trim() || !profile.birth_date}>
                        {isBusy ? "Guardando…" : "Guardar datos"}
                      </button>
                    </div>
                  </div>
                )}

                {isResetting && (
                  <div className="settings-reset-panel">
                    <div className="settings-danger-title"><Icons.Alert /> Reinicio de historial</div>
                    <p>
                      Se eliminarán las entradas de <strong>{displayName(child)}</strong>: tomas, sueño, pañales, medicamentos,
                      temperaturas, peso, altura, notas, bombeos, tiempo boca abajo y temporizadores. <strong>El perfil del bebé no se borra.</strong>
                    </p>
                    <p>Las existencias de Grocy no se modifican durante esta limpieza.</p>
                    <label className="settings-check-row">
                      <input type="checkbox" checked={includeAudit} onChange={(e) => setIncludeAudit(e.target.checked)} />
                      <span>Borrar también el historial de auditoría de este bebé</span>
                    </label>
                    <label className="settings-confirm-label">
                      Para confirmar, escribe <code>BORRAR {child.first_name || "Bebé"}</code>
                      <FormInput
                        value={confirmation}
                        autoComplete="off"
                        onChange={(e) => setConfirmation(e.target.value)}
                        placeholder={`BORRAR ${child.first_name || "Bebé"}`}
                      />
                    </label>
                    <div className="settings-editor-actions">
                      <button onClick={() => { setResetChild(null); setResetResult(null); }}>Cancelar</button>
                      <button
                        className="settings-danger-button"
                        onClick={runReset}
                        disabled={isBusy || confirmation !== `BORRAR ${child.first_name || "Bebé"}`}
                      >
                        {isBusy ? "Borrando…" : "Borrar historial"}
                      </button>
                    </div>
                    {resetResult && (
                      <div className="settings-reset-result">
                        <strong>{resetResult.total_deleted || 0} entradas eliminadas</strong>
                        {resetResult.audit_deleted > 0 && <span>{resetResult.audit_deleted} registros de auditoría eliminados</span>}
                        {(resetResult.errors || []).length > 0 && <span className="settings-reset-warning">Algunas categorías dieron error: {resetResult.errors.join(" · ")}</span>}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="settings-footer-note">
        Los bebés nuevos que aparezcan en Baby Buddy se detectarán automáticamente. Debe quedar al menos uno activo en la app.
      </div>
    </Modal>
  );
}
