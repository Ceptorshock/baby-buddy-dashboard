const API_BASE = "./api/baby-buddy";
const CONFIG_PATH = "./api/config";
const DIAPER_SIZES_PATH = "./api/diaper-sizes";
const ROOM_STATUS_PATH = "./api/room-status";
const CALENDAR_EVENTS_PATH = "./api/calendar-events";
const UNDO_PATH = "./api/undo-entry";

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


  // Home Assistant room controls
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

  // Config (our backend, not Baby Buddy)
  getConfig: () => fetch(CONFIG_PATH).then((r) => r.json()),
};
