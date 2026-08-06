import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";
import { getMockData } from "../utils/mockData";

function toLocalISODate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fixChildPicture(c) {
  if (c?.picture) {
    try {
      const url = new URL(c.picture);
      c.picture = `./api/media${url.pathname}`;
    } catch {
      // leave as-is if not a valid URL
    }
  }
  return c;
}

export function useBabyData() {
  const [children, setChildren] = useState([]);
  const [child, setChild] = useState(null);
  const [feedings, setFeedings] = useState([]);
  const [weeklyFeedings, setWeeklyFeedings] = useState([]);
  const [sleepEntries, setSleepEntries] = useState([]);
  const [weeklySleep, setWeeklySleep] = useState([]);
  const [changes, setChanges] = useState([]);
  const [recentChanges, setRecentChanges] = useState([]);
  const [tummyTimes, setTummyTimes] = useState([]);
  const [weeklyTummyTimes, setWeeklyTummyTimes] = useState([]);
  const [temperatures, setTemperatures] = useState([]);
  const [weights, setWeights] = useState([]);
  const [heights, setHeights] = useState([]);
  const [monthlyFeedings, setMonthlyFeedings] = useState([]);
  const [monthlySleep, setMonthlySleep] = useState([]);
  const [notes, setNotes] = useState([]);
  const [timers, setTimers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [unitSystem, setUnitSystem] = useState("metric");
  const [diaperSizes, setDiaperSizes] = useState({});
  const [diaperSizeSaving, setDiaperSizeSaving] = useState(false);
  const [roomStatuses, setRoomStatuses] = useState({});
  const [calendarStatuses, setCalendarStatuses] = useState({});
  const [alertsConfig, setAlertsConfig] = useState({ enabled: true, feeding_minutes: 240, active_timer_minutes: 180, room_temp_min: 18, room_temp_max: 27, diaper_stock_low_threshold: 10 });
  const intervalRef = useRef(null);
  const childIdRef = useRef(null);
  const defaultChildIdRef = useRef(null);

  const fetchData = useCallback(async (childId) => {
    try {
      const now = new Date();

      const todayStr = toLocalISODate(now);
      const todayMin = `${todayStr}T00:00:00`;
      const todayMax = `${todayStr}T23:59:59`;

      const twentyFourAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sleepMin = `${toLocalISODate(twentyFourAgo)}T${String(twentyFourAgo.getHours()).padStart(2, "0")}:${String(twentyFourAgo.getMinutes()).padStart(2, "0")}:00`;

      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 6);
      const weekMin = `${toLocalISODate(weekAgo)}T00:00:00`;

      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 29);
      const monthMin = `${toLocalISODate(monthAgo)}T00:00:00`;

      const c = childId || undefined;

      const [
        feedingsRes,
        weeklyFeedingsRes,
        sleepRes,
        weeklySleepRes,
        changesRes,
        recentChangesRes,
        tummyRes,
        weeklyTummyRes,
        tempRes,
        weightRes,
        heightRes,
        timersRes,
        notesRes,
        monthlyFeedingsRes,
        monthlySleepRes,
      ] = await Promise.all([
        api.getFeedings({ child: c, start_min: todayMin, start_max: todayMax, limit: 100, ordering: "-start" }),
        api.getFeedings({ child: c, start_min: weekMin, limit: 200, ordering: "-start" }),
        api.getSleep({ child: c, start_min: sleepMin, limit: 100, ordering: "-start" }),
        api.getSleep({ child: c, start_min: weekMin, limit: 200, ordering: "-start" }),
        api.getChanges({ child: c, date_min: todayMin, date_max: todayMax, limit: 100, ordering: "-time" }),
        api.getChanges({ child: c, limit: 20, ordering: "-time" }),
        api.getTummyTimes({ child: c, start_min: todayMin, start_max: todayMax, limit: 100, ordering: "-start" }),
        api.getTummyTimes({ child: c, start_min: weekMin, limit: 200, ordering: "-start" }),
        api.getTemperature({ child: c, limit: 10, ordering: "-time" }),
        api.getWeight({ child: c, limit: 20, ordering: "-date" }),
        api.getHeight({ child: c, limit: 20, ordering: "-date" }),
        api.getTimers(),
        api.getNotes({ child: c, limit: 20, ordering: "-time" }),
        api.getFeedings({ child: c, start_min: monthMin, limit: 500, ordering: "-start" }),
        api.getSleep({ child: c, start_min: monthMin, limit: 500, ordering: "-start" }),
      ]);

      setFeedings(feedingsRes.results || []);
      setWeeklyFeedings(weeklyFeedingsRes.results || []);
      setSleepEntries(sleepRes.results || []);
      setWeeklySleep(weeklySleepRes.results || []);
      setChanges(changesRes.results || []);
      setRecentChanges(recentChangesRes.results || []);
      setTummyTimes(tummyRes.results || []);
      setWeeklyTummyTimes(weeklyTummyRes.results || []);
      setTemperatures(tempRes.results || []);
      setWeights(weightRes.results || []);
      setHeights(heightRes.results || []);
      setTimers(timersRes.results || []);
      setNotes(notesRes.results || []);
      setMonthlyFeedings(monthlyFeedingsRes.results || []);
      setMonthlySleep(monthlySleepRes.results || []);
      setLastSync(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDiaperSizes = useCallback(async () => {
    try {
      const result = await api.getDiaperSizes();
      setDiaperSizes(result.sizes || {});
    } catch {
      // Diaper-size integration is optional; Baby Buddy data must keep working.
    }
  }, []);

  const fetchRoomStatuses = useCallback(async () => {
    try {
      const result = await api.getRoomStatuses();
      setRoomStatuses(result.rooms || {});
    } catch {
      // Room integration is optional.
    }
  }, []);

  const fetchCalendarStatuses = useCallback(async () => {
    try {
      const result = await api.getCalendarEvents();
      setCalendarStatuses(result.calendars || {});
    } catch {
      // Calendar integration is optional.
    }
  }, []);

  const toggleRoomLight = useCallback(async (childId) => {
    if (!childId) return null;
    const key = String(childId);
    let previousState = "off";
    setRoomStatuses((previous) => {
      previousState = previous[key]?.light === "on" ? "on" : "off";
      const optimisticState = previousState === "on" ? "off" : "on";
      return {
        ...previous,
        [key]: { ...(previous[key] || {}), light: optimisticState },
      };
    });
    try {
      const updated = await api.toggleRoomLight(childId);
      setRoomStatuses((previous) => ({
        ...previous,
        [key]: { ...(previous[key] || {}), light: updated.state },
      }));
      return updated;
    } catch (error) {
      setRoomStatuses((previous) => ({
        ...previous,
        [key]: { ...(previous[key] || {}), light: previousState },
      }));
      throw error;
    }
  }, []);

  const setDiaperSize = useCallback(async (childId, option) => {
    if (!childId || !option) return null;
    setDiaperSizeSaving(true);
    try {
      const updated = await api.setDiaperSize(childId, option);
      setDiaperSizes((previous) => ({
        ...previous,
        [String(childId)]: updated,
      }));
      await fetchRoomStatuses();
      return updated;
    } finally {
      setDiaperSizeSaving(false);
    }
  }, [fetchRoomStatuses]);

  const fetchAll = useCallback(async () => {
    try {
      const [childrenRes] = await Promise.all([
        api.getChildren(),
        fetchDiaperSizes(),
        fetchRoomStatuses(),
        fetchCalendarStatuses(),
      ]);
      const allChildren = (childrenRes.results || []).map(fixChildPicture);
      setChildren(allChildren);

      const preferredChildId = childIdRef.current ?? defaultChildIdRef.current;
      const active =
        allChildren.find((c) => c.id === preferredChildId) ||
        allChildren[0] ||
        null;
      if (active) {
        childIdRef.current = active.id;
        setChild(active);
      }

      await fetchData(active?.id);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [fetchData, fetchDiaperSizes, fetchRoomStatuses, fetchCalendarStatuses]);

  const selectChild = useCallback(
    (id) => {
      const selected = children.find((c) => c.id === id);
      if (!selected || selected.id === child?.id) return;
      childIdRef.current = id;
      setChild(selected);
      setLoading(true);
      fetchData(id);
    },
    [children, child, fetchData]
  );

  const loadMock = useCallback(() => {
    const mock = getMockData();
    setChildren(mock.children);
    setChild(mock.children[0]);
    childIdRef.current = mock.children[0].id;
    setFeedings(mock.feedings);
    setWeeklyFeedings(mock.weeklyFeedings);
    setSleepEntries(mock.sleepEntries);
    setWeeklySleep(mock.weeklySleep);
    setChanges(mock.changes);
    setRecentChanges(mock.changes);
    setTummyTimes(mock.tummyTimes);
    setWeeklyTummyTimes(mock.weeklyTummyTimes);
    setTemperatures(mock.temperatures);
    setWeights(mock.weights);
    setHeights(mock.heights);
    setTimers(mock.timers);
    setNotes(mock.notes);
    setMonthlyFeedings(mock.monthlyFeedings);
    setMonthlySleep(mock.monthlySleep);
    setDiaperSizes({ "1": { configured: true, available: true, state: "Talla 1", options: ["Talla 0", "Talla 1", "Talla 2"] } });
    setLastSync(new Date());
    setLoading(false);
  }, []);

  const selectMockChild = useCallback(
    (id) => {
      const selected = children.find((c) => c.id === id);
      if (!selected || selected.id === child?.id) return;
      childIdRef.current = id;
      setChild(selected);
      const mock = getMockData(id);
      setFeedings(mock.feedings);
      setWeeklyFeedings(mock.weeklyFeedings);
      setSleepEntries(mock.sleepEntries);
      setWeeklySleep(mock.weeklySleep);
      setChanges(mock.changes);
      setRecentChanges(mock.changes);
      setTummyTimes(mock.tummyTimes);
      setWeeklyTummyTimes(mock.weeklyTummyTimes);
      setTemperatures(mock.temperatures);
      setWeights(mock.weights);
      setHeights(mock.heights);
      setTimers(mock.timers);
      setNotes(mock.notes);
      setMonthlyFeedings(mock.monthlyFeedings);
      setMonthlySleep(mock.monthlySleep);
    },
    [children, child]
  );

  const demoRef = useRef(false);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        if (cfg.unit_system) setUnitSystem(cfg.unit_system);
        if (cfg.alerts) setAlertsConfig(cfg.alerts);
        const configuredDefault = Number(cfg.default_child_id || 0);
        defaultChildIdRef.current = configuredDefault > 0 ? configuredDefault : null;
        if (cfg.demo_mode) {
          demoRef.current = true;
          loadMock();
        } else {
          fetchAll();
          const ms = (cfg.refresh_interval || 30) * 1000;
          intervalRef.current = setInterval(fetchAll, ms);
        }
      })
      .catch(() => {
        fetchAll();
        intervalRef.current = setInterval(fetchAll, 30000);
      });

    return () => clearInterval(intervalRef.current);
  }, [fetchAll, loadMock]);

  return {
    children,
    child,
    selectChild: demoRef.current ? selectMockChild : selectChild,
    feedings,
    weeklyFeedings,
    sleepEntries,
    weeklySleep,
    changes,
    recentChanges,
    tummyTimes,
    weeklyTummyTimes,
    temperatures,
    weights,
    heights,
    monthlyFeedings,
    monthlySleep,
    notes,
    timers,
    loading,
    error,
    lastSync,
    unitSystem,
    diaperSizes,
    diaperSize: child ? diaperSizes[String(child.id)] : null,
    diaperSizeSaving,
    setDiaperSize,
    roomStatuses,
    roomStatus: child ? roomStatuses[String(child.id)] : null,
    toggleRoomLight,
    calendarStatuses,
    calendarStatus: child ? calendarStatuses[String(child.id)] : null,
    refreshCalendars: fetchCalendarStatuses,
    alertsConfig,
    refetch: fetchAll,
  };
}
