const API_BASE = "./api/baby-buddy";
const CONFIG_PATH = "./api/config";
const DIAPER_SIZES_PATH = "./api/diaper-sizes";
const DIAPER_STOCK_PATH = "./api/diaper-stock";
const DIAPER_PURCHASES_PATH = "./api/diaper-purchases";
const ROOM_STATUS_PATH = "./api/room-status";
const CALENDAR_EVENTS_PATH = "./api/calendar-events";
const UNDO_PATH = "./api/undo-entry";
const CURRENT_USER_PATH = "./api/current-user";
const AUDIT_PATH = "./api/audit";
const DASHBOARD_SETTINGS_PATH = "./api/dashboard-settings";
const MEDICATION_REGIMENS_PATH = "./api/medication-regimens";
const HANDOFF_PATH = "./api/handoff";

async function request(endpoint, options = {}) {
  const url = `${API_BASE}/${endpoint}`;
  const config = {
    headers: { "Content-Type": "application/json" },
    ...options,
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API error ${response.status}: ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function qs(params) {
  if (!params) return "";
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== "")
  );
  const s = new URLSearchParams(filtered).toString();
  return s ? `?${s}` : "";
}

export const api = {
  // Children
  getChildren: () => request("children/"),

  // Feedings
  getFeedings: (params) => request(`feedings/${qs(params)}`),
  createFeeding: (data) =>
    request("feedings/", { method: "POST", body: JSON.stringify(data) }),
  updateFeeding: (id, data) =>
    request(`feedings/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Sleep
  getSleep: (params) => request(`sleep/${qs(params)}`),
  createSleep: (data) =>
    request("sleep/", { method: "POST", body: JSON.stringify(data) }),
  updateSleep: (id, data) =>
    request(`sleep/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Diapers (changes)
  getChanges: (params) => request(`changes/${qs(params)}`),
  createChange: (data) =>
    request("changes/", { method: "POST", body: JSON.stringify(data) }),
  updateChange: (id, data) =>
    request(`changes/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Tummy time
  getTummyTimes: (params) => request(`tummy-times/${qs(params)}`),
  createTummyTime: (data) =>
    request("tummy-times/", { method: "POST", body: JSON.stringify(data) }),
  updateTummyTime: (id, data) =>
    request(`tummy-times/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Temperature
  getTemperature: (params) => request(`temperature/${qs(params)}`),
  createTemperature: (data) =>
    request("temperature/", { method: "POST", body: JSON.stringify(data) }),
  updateTemperature: (id, data) =>
    request(`temperature/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Weight
  getWeight: (params) => request(`weight/${qs(params)}`),
  createWeight: (data) =>
    request("weight/", { method: "POST", body: JSON.stringify(data) }),
  updateWeight: (id, data) =>
    request(`weight/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Height
  getHeight: (params) => request(`height/${qs(params)}`),
  createHeight: (data) =>
    request("height/", { method: "POST", body: JSON.stringify(data) }),
  updateHeight: (id, data) =>
    request(`height/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Medication (Baby Buddy 2.9+)
  getMedication: (params) => request(`medication/${qs(params)}`),
  createMedication: (data) =>
    request("medication/", { method: "POST", body: JSON.stringify(data) }),
  updateMedication: (id, data) =>
    request(`medication/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Pumping
  getPumping: (params) => request(`pumping/${qs(params)}`),
  createPumping: (data) =>
    request("pumping/", { method: "POST", body: JSON.stringify(data) }),

  // Notes
  getNotes: (params) => request(`notes/${qs(params)}`),
  createNote: (data) =>
    request("notes/", { method: "POST", body: JSON.stringify(data) }),
  updateNote: (id, data) =>
    request(`notes/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Timers
  getTimers: () => request("timers/"),
  createTimer: (data) =>
    request("timers/", { method: "POST", body: JSON.stringify(data) }),
  updateTimer: (id, data) =>
    request(`timers/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTimer: (id) => request(`timers/${id}/`, { method: "DELETE" }),

  // Home Assistant helpers exposed by our backend
  getDiaperSizes: async () => {
    const response = await fetch(DIAPER_SIZES_PATH);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Diaper-size API error ${response.status}: ${text}`);
    }
    return response.json();
  },
  setDiaperSize: async (childId, option) => {
    const response = await fetch(`${DIAPER_SIZES_PATH}/${childId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ option }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Diaper-size API error ${response.status}: ${text}`);
    }
    return response.json();
  },

  getDiaperStock: async () => {
    const response = await fetch(DIAPER_STOCK_PATH);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Diaper-stock API error ${response.status}: ${text}`);
    }
    return response.json();
  },
  adjustDiaperStock: async (productId, delta, meta = {}) => {
    const response = await fetch(`${DIAPER_STOCK_PATH}/${productId}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta, ...meta }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Diaper-stock API error ${response.status}`);
    }
    return response.json();
  },


  // Home Assistant room controls

  getDiaperPurchases: async (limit = 40) => {
    const response = await fetch(`${DIAPER_PURCHASES_PATH}?limit=${encodeURIComponent(limit)}`);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Historial de pañales ${response.status}: ${text}`);
    }
    return response.json();
  },
  correctDiaperPurchase: async (data) => {
    const response = await fetch(`${DIAPER_PURCHASES_PATH}/correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Historial de pañales ${response.status}`);
    }
    return response.json();
  },
  deleteDiaperPurchase: async (key) => {
    const response = await fetch(`${DIAPER_PURCHASES_PATH}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Historial de pañales ${response.status}`);
    }
    return response.json();
  },

  getRoomStatuses: async () => {
    const response = await fetch(ROOM_STATUS_PATH);
    if (!response.ok) throw new Error(`Room API error ${response.status}`);
    return response.json();
  },
  toggleRoomLight: async (childId) => {
    const response = await fetch(`./api/room-light/${childId}/toggle`, { method: "POST" });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Room API error ${response.status}: ${text}`);
    }
    return response.json();
  },

  // Home Assistant calendars configured per child
  getCalendarEvents: async () => {
    const response = await fetch(CALENDAR_EVENTS_PATH);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail || parsed.message || text;
      } catch {
        // Keep the raw response when it is not JSON.
      }
      throw new Error(`Calendar API error ${response.status}: ${detail}`);
    }
    return response.json();
  },
  createCalendarEvent: async (childId, data) => {
    const response = await fetch(`${CALENDAR_EVENTS_PATH}/${childId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail || parsed.message || text;
      } catch {
        // Keep the raw response when it is not JSON.
      }
      throw new Error(`Calendar API error ${response.status}: ${detail}`);
    }
    return response.json();
  },
  updateCalendarEvent: async (childId, data) => {
    const response = await fetch(`${CALENDAR_EVENTS_PATH}/${childId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || parsed.message || text; } catch {}
      throw new Error(`Calendar API error ${response.status}: ${detail}`);
    }
    return response.json();
  },
  deleteCalendarEvent: async (childId, data) => {
    const response = await fetch(`${CALENDAR_EVENTS_PATH}/${childId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || parsed.message || text; } catch {}
      throw new Error(`Calendar API error ${response.status}: ${detail}`);
    }
    return response.json();
  },

  // Undo a newly-created Baby Buddy entry. Diapers also request stock restoration.
  undoEntry: async (entry) => {
    const response = await fetch(UNDO_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Undo API error ${response.status}: ${text}`);
    }
    return response.json();
  },

  getCurrentUser: async () => {
    const response = await fetch(CURRENT_USER_PATH);
    if (!response.ok) throw new Error(`User API error ${response.status}`);
    return response.json();
  },
  getAudit: async (childId, limit = 200) => {
    const params = new URLSearchParams();
    if (childId) params.set("child_id", childId);
    params.set("limit", limit);
    const response = await fetch(`${AUDIT_PATH}?${params.toString()}`);
    if (!response.ok) throw new Error(`Audit API error ${response.status}`);
    return response.json();
  },

  // Dashboard settings: dynamic child visibility, profile editing and test reset
  getDashboardSettings: async () => {
    const response = await fetch(DASHBOARD_SETTINGS_PATH);
    if (!response.ok) throw new Error(`Settings API error ${response.status}`);
    return response.json();
  },
  getMedicationRegimens: async (childId) => {
    const response = await fetch(`${MEDICATION_REGIMENS_PATH}/${childId}`);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Medication-regimen API error ${response.status}: ${text}`);
    }
    return response.json();
  },
  setMedicationRegimen: async (childId, data) => {
    const response = await fetch(`${MEDICATION_REGIMENS_PATH}/${childId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Medication-regimen API error ${response.status}`);
    }
    return response.json();
  },
  deleteMedicationRegimen: async (childId, name) => {
    const response = await fetch(`${MEDICATION_REGIMENS_PATH}/${childId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Medication-regimen API error ${response.status}`);
    }
    return response.json();
  },

  getHandoff: async (childId) => {
    const response = await fetch(`${HANDOFF_PATH}/${childId}`);
    if (!response.ok) throw new Error(`Relevo API error ${response.status}`);
    return response.json();
  },
  setHandoffEnabled: async (childId, enabled) => {
    const response = await fetch(`${DASHBOARD_SETTINGS_PATH}/handoff/${childId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Relevo API error ${response.status}`);
    }
    return response.json();
  },
  updateHandoffNote: async (childId, note) => {
    const response = await fetch(`${HANDOFF_PATH}/${childId}/current-note`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Relevo API error ${response.status}`);
    }
    return response.json();
  },
  takeOverHandoff: async (childId, note = "") => {
    const response = await fetch(`${HANDOFF_PATH}/${childId}/take-over`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Relevo API error ${response.status}`);
    }
    return response.json();
  },
  snoozeTimerReminder: async (childId, timerId, minutes) => {
    const response = await fetch(`./api/timer-reminders/${childId}/${timerId}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Timer reminder API error ${response.status}`);
    }
    return response.json();
  },
  setTimerReminderSettings: async (data) => {
    const response = await fetch(`${DASHBOARD_SETTINGS_PATH}/timer-reminders`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Settings API error ${response.status}`);
    }
    return response.json();
  },

  setMedicationAlertSettings: async (data) => {
    const response = await fetch(`${DASHBOARD_SETTINGS_PATH}/medication-alerts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Settings API error ${response.status}`);
    }
    return response.json();
  },
  setChildEnabled: async (childId, enabled) => {
    const response = await fetch(`${DASHBOARD_SETTINGS_PATH}/children/${childId}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Settings API error ${response.status}`);
    }
    return response.json();
  },
  updateChildProfile: async (childId, data) => {
    const response = await fetch(`${DASHBOARD_SETTINGS_PATH}/children/${childId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Settings API error ${response.status}`);
    }
    return response.json();
  },
  clearChildHistory: async (childId, confirmation, includeAudit = true) => {
    const response = await fetch(`${DASHBOARD_SETTINGS_PATH}/children/${childId}/clear-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation, include_audit: includeAudit }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try { const parsed = JSON.parse(text); detail = parsed.detail || text; } catch {}
      throw new Error(detail || `Settings API error ${response.status}`);
    }
    return response.json();
  },

  // Config (our backend, not Baby Buddy)
  getConfig: () => fetch(CONFIG_PATH).then((r) => r.json()),
};
