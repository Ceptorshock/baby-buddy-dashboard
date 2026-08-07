import { useEffect, useRef, useState } from "react";
import { useBabyData } from "./hooks/useBabyData";
import { useTimers } from "./hooks/useTimers";
import { UnitContext } from "./utils/units";
import { Icons } from "./components/Icons";
import { colors } from "./utils/colors";
import { getAge, formatElapsed } from "./utils/formatters";
import OverviewTab from "./tabs/OverviewTab";
import GrowthTab from "./tabs/GrowthTab";
import NotesTab from "./tabs/NotesTab";
import AuditTab from "./tabs/AuditTab";
import FeedingForm from "./components/forms/FeedingForm";
import SleepForm from "./components/forms/SleepForm";
import DiaperForm from "./components/forms/DiaperForm";
import TemperatureForm from "./components/forms/TemperatureForm";
import TummyTimeForm from "./components/forms/TummyTimeForm";
import NoteForm from "./components/forms/NoteForm";
import WeightForm from "./components/forms/WeightForm";
import HeightForm from "./components/forms/HeightForm";
import CalendarForm from "./components/forms/CalendarForm";
import MedicationForm from "./components/forms/MedicationForm";
import TimerButton from "./components/TimerButton";
import NowPanel from "./components/NowPanel";
import AlertsPanel from "./components/AlertsPanel";
import RoomCard from "./components/RoomCard";
import CalendarCard from "./components/CalendarCard";
import CalendarManagerModal from "./components/CalendarManagerModal";
import CalendarDeleteModal from "./components/CalendarDeleteModal";
import UndoToast from "./components/UndoToast";
import MedicationCard from "./components/MedicationCard";
import NightModePanel from "./components/NightModePanel";
import SettingsModal from "./components/SettingsModal";
import { api } from "./api";
import "./styles.css";

const TABS = [
  { id: "overview", label: "Ahora", icon: <Icons.Activity /> },
  { id: "growth", label: "Crecimiento", icon: <Icons.TrendUp /> },
  { id: "notes", label: "Notas", icon: <Icons.StickyNote /> },
  { id: "audit", label: "Registro", icon: <Icons.History /> },
];

const ACTION_GROUPS = [
  {
    label: "Registrar",
    actions: [
      { id: "feeding", label: "Toma", icon: <Icons.Bottle />, color: colors.feeding },
      { id: "sleep", label: "Sueño", icon: <Icons.Moon />, color: colors.sleep },
      { id: "diaper", label: "Pañal", icon: <Icons.Droplet />, color: colors.diaper },
      { id: "medication", label: "Medicamento", icon: <Icons.Pill />, color: colors.medication },
      { id: "tummy", label: "Boca abajo", icon: <Icons.Sun />, color: colors.tummy },
    ],
  },
  {
    label: "Medir",
    actions: [
      { id: "temp", label: "Temperatura", icon: <Icons.Temp />, color: colors.temp },
      { id: "weight", label: "Peso", icon: <Icons.Weight />, color: colors.growth },
      { id: "height", label: "Altura", icon: <Icons.Ruler />, color: colors.height },
    ],
  },
  {
    label: "Nota",
    actions: [
      { id: "note", label: "Nota", icon: <Icons.StickyNote />, color: colors.note },
    ],
  },
];

const TIMER_TYPES = [
  { id: "feeding", label: "Toma", icon: <Icons.Bottle />, color: colors.feeding },
  { id: "sleep", label: "Sueño", icon: <Icons.Moon />, color: colors.sleep },
  { id: "tummy", label: "Tiempo boca abajo", icon: <Icons.Sun />, color: colors.tummy },
];

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function timerNameToType(name) {
  if (!name) return "feeding";
  const n = name.toLowerCase();
  if (n.includes("sleep") || n.includes("sueño")) return "sleep";
  if (n.includes("tummy") || n.includes("boca abajo")) return "tummy";
  return "feeding";
}

function localizeTimerName(name) {
  const value = (name || "").toLowerCase();
  if (value.includes("sleep") || value.includes("sueño")) return "Sueño";
  if (value.includes("tummy") || value.includes("boca abajo")) return "Tiempo boca abajo";
  if (value.includes("feeding") || value.includes("toma")) return "Toma";
  return name || "Temporizador";
}

function isWithinNightWindow(now, start = "22:00", end = "07:00") {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value) => {
    const [hours, mins] = String(value || "00:00").split(":").map(Number);
    return (hours || 0) * 60 + (mins || 0);
  };
  const startMinutes = parse(start);
  const endMinutes = parse(end);
  if (startMinutes === endMinutes) return true;
  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}

export default function App() {
  const data = useBabyData();
  const timer = useTimers(data.timers, data.child?.id);
  const [activeTab, setActiveTab] = useState("overview");
  const [modal, setModal] = useState(null);
  const [showActions, setShowActions] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState("Registrar");
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [editingTimerId, setEditingTimerId] = useState(null);
  const [undoItem, setUndoItem] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoMessage, setUndoMessage] = useState("");
  const [nightModeSuppressed, setNightModeSuppressed] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const undoTimeoutRef = useRef(null);

  const closeModal = () => setModal(null);
  const handleFormDone = (createdEntry = null) => {
    closeModal();
    data.refetch();
    if (createdEntry?.id) {
      clearTimeout(undoTimeoutRef.current);
      setUndoMessage("");
      setUndoItem(createdEntry);
      undoTimeoutRef.current = setTimeout(() => setUndoItem(null), 18000);
    }
  };

  useEffect(() => () => clearTimeout(undoTimeoutRef.current), []);

  useEffect(() => {
    const interval = setInterval(() => setClockNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  const inNightWindow = isWithinNightWindow(clockNow, data.nightModeConfig?.start, data.nightModeConfig?.end);
  useEffect(() => {
    if (!inNightWindow && nightModeSuppressed) setNightModeSuppressed(false);
  }, [inNightWindow, nightModeSuppressed]);
  const nightModeActive = Boolean(data.nightModeConfig?.enabled && inNightWindow && !nightModeSuppressed);

  const handleUndo = async () => {
    if (!undoItem) return;
    setUndoBusy(true);
    try {
      const result = await api.undoEntry(undoItem);
      clearTimeout(undoTimeoutRef.current);
      setUndoItem(null);
      setUndoMessage(result.warning || "Registro deshecho correctamente.");
      setTimeout(() => setUndoMessage(""), 6000);
      await data.refetch();
    } catch (error) {
      setUndoMessage(`No se pudo deshacer: ${error.message}`);
    } finally {
      setUndoBusy(false);
    }
  };

  if (data.loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>Cargando...</span>
      </div>
    );
  }

  return (
    <UnitContext.Provider value={data.unitSystem}>
    <div className={`app${nightModeActive ? " night-mode-active" : ""}`}>
      {nightModeActive && (
        <NightModePanel
          data={data}
          timer={timer}
          onOpenForm={setModal}
          onCreated={handleFormDone}
          onDisable={() => setNightModeSuppressed(true)}
        />
      )}
      {/* Header */}
      <header className="app-header fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="avatar">
            {data.child?.picture ? (
              <img src={data.child.picture} alt={data.child.first_name} className="avatar-img" />
            ) : (
              <Icons.Baby />
            )}
          </div>
          <div>
            <h1 className="baby-name">
              {data.child?.first_name || "Bebé"}
            </h1>
            <div className="baby-meta-row">
              {data.child?.birth_date && (
                <span className="baby-age">{getAge(data.child.birth_date)}</span>
              )}
              {data.diaperSize?.configured && data.diaperSize.available && (
                <label className="diaper-size-pill" title="Talla activa usada para descontar pañales de Grocy">
                  <span>🧷</span>
                  <select
                    value={data.diaperSize.state || ""}
                    disabled={data.diaperSizeSaving}
                    onChange={(event) => data.setDiaperSize(data.child?.id, event.target.value)}
                  >
                    {(data.diaperSize.options || []).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
              )}
              {data.diaperSize?.configured && !data.diaperSize.available && (
                <span className="diaper-size-unconfigured">🧷 Talla no disponible</span>
              )}
              {!data.diaperSize?.configured && (
                <span className="diaper-size-unconfigured">🧷 Talla sin configurar</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {data.currentUser?.display_name && <span className="header-user"><Icons.User /> {data.currentUser.display_name}</span>}
          {data.error && (
            <span className="sync-error">Error de conexión</span>
          )}
          {data.lastSync && !data.error && (
            <span className="sync-time">
              {data.lastSync.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button className="refresh-btn" onClick={data.refetch} title="Actualizar / estado de conexión">
            <Icons.Activity />
          </button>
          <button className="refresh-btn settings-header-btn" onClick={() => setModal({ type: "settings" })} title="Ajustes">
            <Icons.Settings />
          </button>
        </div>
      </header>

      {/* Child Switcher (only when 2+ children) */}
      {data.children.length >= 2 && (
        <div className="child-switcher fade-in">
          {data.children.map((c) => (
            <button
              key={c.id}
              className={`child-chip${c.id === data.child?.id ? " child-chip-active" : ""}`}
              onClick={() => data.selectChild(c.id)}
            >
              <span>{c.first_name}</span>
              <span className="child-chip-size">
                {data.diaperSizes[String(c.id)]?.available ? data.diaperSizes[String(c.id)].state : "Sin talla"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Active Timer Bars */}
      {timer.activeTimers.length > 0 && (
        <div className="timer-stack fade-in">
          {timer.activeTimers.map((t) => (
        <div key={t.id} className="timer-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="timer-pulse" />
            <Icons.Timer />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {data.child?.first_name}: {localizeTimerName(t.name)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {editingTimerId === t.id ? (
              <input
                type="datetime-local"
                className="timer-edit-input"
                defaultValue={toLocalDatetime(t.start)}
                autoFocus
                onBlur={(e) => {
                  if (e.target.value) {
                    timer.editTimer(t.id, `${e.target.value}:00`);
                  }
                  setEditingTimerId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") setEditingTimerId(null);
                }}
              />
            ) : (
              <span
                className="timer-elapsed"
                style={{ cursor: "pointer" }}
                title="Pulsa para editar la hora de inicio"
                onClick={() => setEditingTimerId(t.id)}
              >
                {formatElapsed(timer.elapsedMap[t.id] || 0)}
              </span>
            )}
            <button
              className="timer-save-btn"
              onClick={async () => {
                const stopped = await timer.stopTimer(t.id);
                if (stopped) {
                  setModal({ type: timerNameToType(stopped.name), timerId: stopped.id });
                }
              }}
            >
              Finalizar
            </button>
            <button
              className="timer-discard-btn"
              onClick={() => timer.discardTimer(t.id)}
              title="Descartar temporizador"
            >
              <Icons.X />
            </button>
          </div>
        </div>
          ))}
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="tab-nav fade-in">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "tab-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <main className="tab-content">
        {activeTab === "overview" && (
          <>
            <AlertsPanel
              config={data.alertsConfig}
              weeklyFeedings={data.weeklyFeedings}
              activeTimers={timer.activeTimers}
              elapsedMap={timer.elapsedMap}
              roomStatus={data.roomStatus}
            />
            <NowPanel
              weeklyFeedings={data.weeklyFeedings}
              weeklySleep={data.weeklySleep}
              recentChanges={data.recentChanges}
              activeTimers={timer.activeTimers}
              elapsedMap={timer.elapsedMap}
            />
            <div className="overview-room-grid">
              <RoomCard
                childId={data.child?.id}
                status={data.roomStatus}
                onToggleLight={() => data.toggleRoomLight(data.child?.id)}
              />
              <CalendarCard
                status={data.calendarStatus}
                onAddEvent={() => setModal({ type: "calendar" })}
                onOpenCalendar={() => setModal({ type: "calendar-manager" })}
                onEditEvent={(event) => setModal({ type: "calendar", entry: event })}
                onDeleteEvent={(event) => setModal({ type: "calendar-delete", entry: event })}
              />
            </div>
          <MedicationCard
            medications={data.medications}
            childId={data.child?.id}
            onEditEntry={(type, entry, prefill, extra = {}) => setModal({ type, entry, prefill, ...extra })}
            onAdd={() => setModal({ type: "medication" })}
            onCreateScheduled={handleFormDone}
            onChanged={data.refetch}
          />
          <OverviewTab
            feedings={data.feedings}
            weeklyFeedings={data.weeklyFeedings}
            sleepEntries={data.sleepEntries}
            weeklySleep={data.weeklySleep}
            changes={data.changes}
            tummyTimes={data.tummyTimes}
            weeklyTummyTimes={data.weeklyTummyTimes}
            onEditEntry={(type, entry) => setModal({ type, entry })}
          />
          </>
        )}
        {activeTab === "growth" && (
          <GrowthTab
            weights={data.weights}
            heights={data.heights}
            monthlyFeedings={data.monthlyFeedings}
            monthlySleep={data.monthlySleep}
            onEditEntry={(type, entry) => setModal({ type, entry })}
          />
        )}
        {activeTab === "notes" && (
          <NotesTab
            notes={data.notes}
            onEditEntry={(type, entry) => setModal({ type, entry })}
          />
        )}
        {activeTab === "audit" && (
          <AuditTab entries={data.auditEntries} currentUser={data.currentUser} />
        )}
      </main>

      {/* Quick Action FAB */}
      <div className="fab-container">
        {showActions && (
          <div className="fab-menu fade-in">
            {ACTION_GROUPS.map((group) => {
              const isOpen = expandedGroup === group.label;
              return (
                <div key={group.label} className="fab-group">
                  <button
                    className={`fab-group-label${isOpen ? " fab-group-label-active" : ""}`}
                    onClick={() => setExpandedGroup(isOpen ? null : group.label)}
                  >
                    {group.label}
                  </button>
                  {isOpen && (
                    <div className="fab-group-items">
                      {group.actions.map((action) => (
                        <button
                          key={action.id}
                          className="fab-action"
                          onClick={() => {
                            setModal({ type: action.id });
                            setShowActions(false);
                          }}
                        >
                          <span
                            className="fab-action-icon"
                            style={{ background: `${action.color}18`, color: action.color }}
                          >
                            {action.icon}
                          </span>
                          <span className="fab-action-label">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {showTimerPicker && (
          <div className="fab-menu fade-in" style={{ right: 76 }}>
            {TIMER_TYPES.map((t) => (
              <button
                key={t.id}
                className="fab-action"
                onClick={() => {
                  timer.startTimer(t.id);
                  setShowTimerPicker(false);
                }}
              >
                <span
                  className="fab-action-icon"
                  style={{ background: `${t.color}18`, color: t.color }}
                >
                  {t.icon}
                </span>
                <span className="fab-action-label">{t.label}</span>
              </button>
            ))}
          </div>
        )}
        <TimerButton
          label="Temporizador"
          icon={<Icons.Timer />}
          color={colors.feeding}
          active={false}
          onClick={() => {
            setShowTimerPicker(!showTimerPicker);
            setShowActions(false);
          }}
        />
        <button
          className="fab-btn"
          style={{ background: showActions ? "var(--text-muted)" : colors.feeding }}
          onClick={() => { setShowActions(!showActions); setShowTimerPicker(false); setExpandedGroup("Registrar"); }}
        >
          <span style={{ transform: showActions ? "rotate(45deg)" : "none", transition: "transform 0.2s", display: "flex" }}>
            <Icons.Plus />
          </span>
        </button>
      </div>

      <UndoToast
        item={undoItem}
        busy={undoBusy}
        message={undoMessage}
        onUndo={handleUndo}
        onDismiss={() => { setUndoItem(null); setUndoMessage(""); }}
      />

      {/* Modals */}
      {modal?.type === "feeding" && (
        <FeedingForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "sleep" && (
        <SleepForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "diaper" && (
        <DiaperForm
          childId={data.child?.id}
          entry={modal.entry}
          diaperSize={data.diaperSize}
          onDiaperSizeChange={(option) => data.setDiaperSize(data.child?.id, option)}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "temp" && (
        <TemperatureForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "tummy" && (
        <TummyTimeForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "weight" && (
        <WeightForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "height" && (
        <HeightForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "note" && (
        <NoteForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "medication" && (
        <MedicationForm
          childId={data.child?.id}
          entry={modal.entry}
          prefill={modal.prefill}
          regimenOnly={Boolean(modal.regimenOnly)}
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "calendar" && (
        <CalendarForm
          childId={data.child?.id}
          childName={data.child?.first_name}
          entry={modal.entry}
          initialDate={modal.initialDate}
          onDone={async () => { closeModal(); await data.refreshCalendars(); }}
          onClose={closeModal}
        />
      )}
      {modal?.type === "calendar-manager" && (
        <CalendarManagerModal
          childName={data.child?.first_name}
          status={data.calendarStatus}
          onAdd={(date) => setModal({ type: "calendar", initialDate: date || null })}
          onEdit={(event) => setModal({ type: "calendar", entry: event })}
          onDelete={(event) => setModal({ type: "calendar-delete", entry: event })}
          onClose={closeModal}
        />
      )}
      {modal?.type === "calendar-delete" && (
        <CalendarDeleteModal
          childId={data.child?.id}
          event={modal.entry}
          onDone={async () => { closeModal(); await data.refreshCalendars(); }}
          onClose={closeModal}
        />
      )}
      {modal?.type === "settings" && (
        <SettingsModal
          onChanged={data.refetch}
          onClose={closeModal}
        />
      )}
    </div>
    </UnitContext.Provider>
  );
}
