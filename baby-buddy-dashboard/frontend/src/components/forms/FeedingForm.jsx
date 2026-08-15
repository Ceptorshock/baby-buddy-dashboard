import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import Modal, {
  FormField,
  FormSelect,
  FormInput,
  FormButton,
} from "../Modal";
import { colors } from "../../utils/colors";
import { useUnits } from "../../utils/units";
import {
  feedingDurationSeconds,
  feedingSegments,
  feedingSession,
  isAlexaFeeding,
  isPausedFeeding,
} from "../../utils/formatters";

const TYPES = [
  { value: "breast milk", label: "Leche materna" },
  { value: "formula", label: "Leche de fórmula" },
  { value: "fortified breast milk", label: "Leche materna fortificada" },
  { value: "solid food", label: "Alimentos sólidos" },
];

const METHODS = [
  { value: "bottle", label: "Biberón" },
  { value: "left breast", label: "Pecho izquierdo" },
  { value: "right breast", label: "Pecho derecho" },
  { value: "both breasts", label: "Ambos pechos" },
  { value: "parent fed", label: "Dado por un adulto" },
  { value: "self fed", label: "Comió solo/a" },
];

const BREAST_METHODS = [
  { value: "left breast", label: "Izquierdo" },
  { value: "right breast", label: "Derecho" },
  { value: "both breasts", label: "Ambos" },
];

const RETRO_MINUTES = [5, 10, 15, 20, 25, 30, 45, 60];
const CONTINUATION_RE = /(?:continuaci[oó]n|continue|continuation)\s*#(\d+)/i;

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shiftMinutes(value, minutes) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return toLocalDatetime(new Date(parsed.getTime() + minutes * 60000));
}

function timerList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function resultList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function clock(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function breastMergeMethod(previousMethod, currentMethod) {
  if (previousMethod === currentMethod) return currentMethod;
  const values = new Set([
    String(previousMethod || "").toLowerCase(),
    String(currentMethod || "").toLowerCase(),
  ]);
  if (
    values.has("both breasts") ||
    (values.has("left breast") && values.has("right breast"))
  ) {
    return "both breasts";
  }
  return currentMethod || previousMethod || "bottle";
}

function feedingTagName(tag) {
  if (typeof tag === "string") return tag.trim();
  return String(tag?.name || tag?.label || tag?.value || "").trim();
}

function normalizeFeedingTags(tags) {
  const seen = new Set();
  const result = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const name = feedingTagName(tag);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function stripAlexaNoteMarker(value) {
  return String(value || "")
    .replace(/registrado\s+mediante\s+alexa/gi, "")
    .replace(/registrado\s+por\s+alexa/gi, "")
    .replace(/controlado\s+por\s+alexa/gi, "")
    .replace(/\s*\|\s*\|\s*/g, " | ")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function applyAlexaMetadata(notes, tags, enabled) {
  const cleanNotes = stripAlexaNoteMarker(notes);
  const cleanTags = normalizeFeedingTags(tags).filter(
    (tag) => tag.toLowerCase() !== "alexa",
  );
  if (!enabled) return { notes: cleanNotes, tags: cleanTags };
  return {
    notes: cleanNotes
      ? `${cleanNotes} | Registrado mediante Alexa`
      : "Registrado mediante Alexa",
    tags: [...cleanTags, "Alexa"],
  };
}

function combinedUserNotes(a, b) {
  const first = stripAlexaNoteMarker(a);
  const second = stripAlexaNoteMarker(b);
  if (!first) return second;
  if (!second || first === second) return first;
  return `${first} | ${second}`;
}

function apiPayloadFromEntry(entry) {
  if (!entry) return null;
  const payload = {
    start: entry.start,
    end: entry.end,
    type: entry.type,
    method: entry.method,
    notes: entry.notes || "",
    tags: normalizeFeedingTags(entry.tags),
  };
  if (entry.amount !== null && entry.amount !== undefined && entry.amount !== "") {
    payload.amount = Number(entry.amount);
  }
  return payload;
}

function segmentSeconds(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 1000));
}

const quickButtonStyle = {
  flex: "1 1 68px",
  minWidth: 64,
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 9px",
  background: "var(--bg)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "inherit",
};

function QuickRow({ children }) {
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 7 }}>
      {children}
    </div>
  );
}

export default function FeedingForm({
  childId,
  timerId,
  entry,
  onDone,
  onClose,
}) {
  const units = useUnits();
  const isEdit = Boolean(entry);
  const now = new Date();
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const [type, setType] = useState(entry?.type || "breast milk");
  const [method, setMethod] = useState(entry?.method || "bottle");
  const [amount, setAmount] = useState(
    entry?.amount != null ? String(entry.amount) : "",
  );
  const [start, setStart] = useState(
    entry?.start
      ? toLocalDatetime(new Date(entry.start))
      : toLocalDatetime(fifteenMinsAgo),
  );
  const [end, setEnd] = useState(
    entry?.end ? toLocalDatetime(new Date(entry.end)) : toLocalDatetime(now),
  );
  const [notes, setNotes] = useState(stripAlexaNoteMarker(entry?.notes || ""));
  const [alexaMarked, setAlexaMarked] = useState(() => isAlexaFeeding(entry));
  const [effectiveMinutes, setEffectiveMinutes] = useState(() =>
    entry?._session
      ? Math.max(0, Math.round(feedingDurationSeconds(entry) / 60))
      : 0,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [timerLoading, setTimerLoading] = useState(Boolean(timerId));
  const [timerResolved, setTimerResolved] = useState(!timerId);
  const [timerInfo, setTimerInfo] = useState(null);
  const [continuationBase, setContinuationBase] = useState(null);
  const [retroMinutes, setRetroMinutes] = useState("25");
  const [previousFeeding, setPreviousFeeding] = useState(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  const continuationId = useMemo(() => {
    const match = String(timerInfo?.name || "").match(CONTINUATION_RE);
    return match ? Number(match[1]) : 0;
  }, [timerInfo?.name]);

  useEffect(() => {
    if (!timerId || entry) return;
    let cancelled = false;

    api.getTimers()
      .then(async (payload) => {
        if (cancelled) return;
        const found = timerList(payload).find(
          (item) => String(item.id) === String(timerId),
        );
        if (!found) return;
        setTimerInfo(found);
        if (found.start) {
          setStart(toLocalDatetime(new Date(found.start)));
          setEnd(toLocalDatetime(new Date()));
          setTimerResolved(true);
        }

        const match = String(found.name || "").match(CONTINUATION_RE);
        if (!match) return;
        const base = await api.getFeeding(match[1]);
        if (cancelled || !base) return;
        setContinuationBase(base);
        setType(base.type || "breast milk");
        setMethod(base.method || "both breasts");
        setAmount("");
        setNotes(stripAlexaNoteMarker(base.notes || ""));
        setAlexaMarked(isAlexaFeeding(base));
      })
      .catch((err) => setError(err?.message || "No se pudo recuperar el temporizador."))
      .finally(() => {
        if (!cancelled) setTimerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [timerId, entry]);

  useEffect(() => {
    if (!isEdit || !childId || !entry?.start) {
      setPreviousFeeding(null);
      return;
    }
    let cancelled = false;
    api.getFeedings({ child: childId, ordering: "-start", limit: 25 })
      .then((payload) => {
        if (cancelled) return;
        const currentStart = new Date(entry.start).getTime();
        const candidates = resultList(payload)
          .filter(
            (item) =>
              String(item?.id) !== String(entry.id) &&
              item?.start &&
              new Date(item.start).getTime() < currentStart,
          )
          .sort(
            (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime(),
          );
        const previous = candidates[0] || null;
        if (!previous) return setPreviousFeeding(null);
        const previousEnd = new Date(previous.end || previous.start).getTime();
        const gapMinutes = Math.round((currentStart - previousEnd) / 60000);
        setPreviousFeeding(gapMinutes >= 0 && gapMinutes <= 60 ? previous : null);
      })
      .catch(() => setPreviousFeeding(null));
    return () => {
      cancelled = true;
    };
  }, [isEdit, childId, entry?.id, entry?.start]);

  const wallMinutes = useMemo(
    () => Math.round(segmentSeconds(start, end) / 60),
    [start, end],
  );

  const setRetrospectiveStart = (minutes) => {
    const parsed = Math.max(1, Math.round(Number(minutes) || 0));
    if (parsed) setStart(shiftMinutes(end, -parsed));
  };

  const metadataFor = (userNotes, sourceTags, marked) =>
    applyAlexaMetadata(userNotes, sourceTags, marked);

  const finishContinuation = async (paused) => {
    if (!continuationBase || !timerId) return false;
    const segmentStart = new Date(start);
    const segmentEnd = new Date(end);
    if (segmentEnd < segmentStart) throw new Error("La hora de fin no puede ser anterior al inicio.");

    const oldSession = feedingSession(continuationBase);
    const baseSeconds = feedingDurationSeconds(continuationBase);
    const newSeconds = baseSeconds + segmentSeconds(start, end);
    const newSegments = feedingSegments(continuationBase) + 1;
    const meta = metadataFor(
      notes,
      continuationBase.tags,
      alexaMarked || isAlexaFeeding(continuationBase),
    );
    const currentAmount = Number(amount || 0);
    const baseAmount = Number(continuationBase.amount || 0);
    const data = {
      end: `${end}:00`,
      type: type || continuationBase.type,
      method: breastMergeMethod(continuationBase.method, method),
      notes: meta.notes,
      tags: meta.tags,
    };
    if (baseAmount + currentAmount > 0) data.amount = baseAmount + currentAmount;

    const restore = apiPayloadFromEntry(continuationBase);
    await api.updateFeeding(continuationBase.id, data);
    await api.setFeedingSession(continuationBase.id, {
      active_seconds: newSeconds,
      segments: newSegments,
      paused,
    });
    await api.deleteTimer(timerId).catch(() => null);

    onDone({
      type: "feeding",
      id: continuationBase.id,
      label: paused ? "Toma pausada" : "Toma continuada",
      successMessage: paused ? "Toma pausada" : "Toma continuada y guardada",
      undoKind: "restore-feeding",
      restore,
      restoreSession: oldSession,
      recreateTimer: {
        child: childId,
        name: timerInfo?.name || `Toma continuación #${continuationBase.id}`,
        start: `${start}:00`,
      },
    });
    return true;
  };

  const saveNewTimerFeeding = async (paused) => {
    const meta = metadataFor(notes, [], alexaMarked);
    const data = {
      child: childId,
      start: `${start}:00`,
      end: `${end}:00`,
      type,
      method,
      notes: meta.notes,
      tags: meta.tags,
    };
    if (amount) data.amount = Number(amount);
    const created = await api.createFeeding(data);
    if (paused) {
      await api.setFeedingSession(created.id, {
        active_seconds: segmentSeconds(start, end),
        segments: 1,
        paused: true,
      });
    }
    if (timerId) await api.deleteTimer(timerId).catch(() => null);
    onDone({
      type: "feeding",
      id: created.id,
      label: paused ? "Toma pausada" : "Toma",
      successMessage: paused ? "Toma pausada" : "Toma guardada",
      childId,
      recreateTimer: timerId
        ? {
            child: childId,
            name: timerInfo?.name || "feeding",
            start: `${start}:00`,
          }
        : null,
    });
  };

  const handlePause = async () => {
    if (!timerId || saving || timerLoading) return;
    setSaving(true);
    setError("");
    const pauseEnd = toLocalDatetime(new Date());
    setEnd(pauseEnd);

    try {
      if (continuationBase) {
        const oldSession = feedingSession(continuationBase);
        const meta = metadataFor(
          notes,
          continuationBase.tags,
          alexaMarked || isAlexaFeeding(continuationBase),
        );
        const activeSeconds =
          feedingDurationSeconds(continuationBase) +
          segmentSeconds(start, pauseEnd);
        const data = {
          end: `${pauseEnd}:00`,
          type: type || continuationBase.type,
          method: breastMergeMethod(continuationBase.method, method),
          notes: meta.notes,
          tags: meta.tags,
        };
        const totalAmount =
          Number(continuationBase.amount || 0) + Number(amount || 0);
        if (totalAmount > 0) data.amount = totalAmount;

        const restore = apiPayloadFromEntry(continuationBase);
        await api.updateFeeding(continuationBase.id, data);
        await api.setFeedingSession(continuationBase.id, {
          active_seconds: activeSeconds,
          segments: feedingSegments(continuationBase) + 1,
          paused: true,
        });
        await api.deleteTimer(timerId).catch(() => null);
        onDone({
          type: "feeding",
          id: continuationBase.id,
          label: "Toma pausada",
          successMessage: "Toma pausada",
          undoKind: "restore-feeding",
          restore,
          restoreSession: oldSession,
          recreateTimer: {
            child: childId,
            name: timerInfo?.name || `Toma continuación #${continuationBase.id}`,
            start: `${start}:00`,
          },
        });
        return;
      }

      const meta = metadataFor(notes, [], alexaMarked);
      const data = {
        child: childId,
        start: `${start}:00`,
        end: `${pauseEnd}:00`,
        type,
        method,
        notes: meta.notes,
        tags: meta.tags,
      };
      if (amount) data.amount = Number(amount);
      const created = await api.createFeeding(data);
      await api.setFeedingSession(created.id, {
        active_seconds: segmentSeconds(start, pauseEnd),
        segments: 1,
        paused: true,
      });
      await api.deleteTimer(timerId).catch(() => null);
      onDone({
        type: "feeding",
        id: created.id,
        label: "Toma pausada",
        successMessage: "Toma pausada",
        childId,
        recreateTimer: {
          child: childId,
          name: timerInfo?.name || "feeding",
          start: `${start}:00`,
        },
      });
    } catch (err) {
      setError(err?.message || "No se pudo pausar la toma.");
      setSaving(false);
    }
  };


  const handleMerge = async () => {
    if (!previousFeeding || !entry || mergeBusy) return;
    setError("");
    const currentStart = new Date(start);
    const currentEnd = new Date(end);
    const previousStart = new Date(previousFeeding.start);
    const previousEnd = new Date(previousFeeding.end || previousFeeding.start);
    if ([currentStart, currentEnd, previousStart, previousEnd].some((d) => Number.isNaN(d.getTime()))) {
      setError("No se pueden calcular las horas para fusionar.");
      return;
    }
    const mergedStart = previousStart < currentStart ? previousStart : currentStart;
    const mergedEnd = previousEnd > currentEnd ? previousEnd : currentEnd;
    const effectiveSeconds =
      feedingDurationSeconds(previousFeeding) +
      (entry?._session ? Math.round(effectiveMinutes * 60) : segmentSeconds(start, end));
    const mergedSegments = feedingSegments(previousFeeding) + feedingSegments(entry);
    const confirmed = window.confirm(
      `¿Fusionar estas dos tomas?\n\nAnterior: ${clock(previousStart)}–${clock(previousEnd)}\nActual: ${clock(currentStart)}–${clock(currentEnd)}\n\nQuedará ${clock(mergedStart)}–${clock(mergedEnd)}, con ${Math.round(effectiveSeconds / 60)} min efectivos.`,
    );
    if (!confirmed) return;

    setMergeBusy(true);
    try {
      const mergedAlexa = isAlexaFeeding(previousFeeding) || alexaMarked;
      const mergedMeta = metadataFor(
        combinedUserNotes(previousFeeding.notes, notes),
        [
          ...normalizeFeedingTags(previousFeeding.tags),
          ...normalizeFeedingTags(entry.tags),
        ],
        mergedAlexa,
      );
      const payload = {
        start: `${toLocalDatetime(mergedStart)}:00`,
        end: `${toLocalDatetime(mergedEnd)}:00`,
        type: type || previousFeeding.type,
        method: breastMergeMethod(previousFeeding.method, method),
        notes: mergedMeta.notes,
        tags: mergedMeta.tags,
      };
      const mergedAmount = Number(previousFeeding.amount || 0) + Number(amount || 0);
      if (mergedAmount > 0) payload.amount = mergedAmount;

      const restorePrevious = apiPayloadFromEntry(previousFeeding);
      const restoreCurrent = { child: childId, ...apiPayloadFromEntry(entry) };
      const restorePreviousSession = feedingSession(previousFeeding);
      const restoreCurrentSession = feedingSession(entry);

      await api.deleteFeeding(entry.id);
      try {
        await api.updateFeeding(previousFeeding.id, payload);
        await api.setFeedingSession(previousFeeding.id, {
          active_seconds: effectiveSeconds,
          segments: mergedSegments,
          paused: isPausedFeeding(entry),
        });
      } catch (mergeError) {
        await api.createFeeding(restoreCurrent).catch(() => null);
        throw mergeError;
      }

      onDone({
        type: "feeding",
        id: previousFeeding.id,
        label: "Tomas fusionadas",
        successMessage: "Tomas fusionadas",
        undoKind: "restore-feeding-merge",
        restorePrevious,
        restorePreviousSession,
        recreateDeleted: restoreCurrent,
        restoreDeletedSession: restoreCurrentSession,
      });
    } catch (err) {
      setError(err?.message || "No se pudieron fusionar las tomas.");
      setMergeBusy(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      endDate < startDate
    ) {
      setError("La hora de fin debe ser igual o posterior a la hora de inicio.");
      return;
    }

    setSaving(true);
    try {
      if (continuationBase && timerId) {
        await finishContinuation(false);
        return;
      }

      if (isEdit) {
        const meta = metadataFor(notes, entry.tags, alexaMarked);
        const data = {
          start: `${start}:00`,
          end: `${end}:00`,
          type,
          method,
          notes: meta.notes,
          tags: meta.tags,
        };
        if (amount) data.amount = Number(amount);
        else if (entry.amount) data.amount = null;
        const restore = apiPayloadFromEntry(entry);
        const oldSession = feedingSession(entry);
        await api.updateFeeding(entry.id, data);
        if (oldSession) {
          await api.setFeedingSession(entry.id, {
            active_seconds: Math.max(0, Math.round(effectiveMinutes * 60)),
            segments: oldSession.segments,
            paused: oldSession.paused,
          });
        }
        onDone({
          type: "feeding",
          id: entry.id,
          label: "Corrección de toma",
          successMessage: "Toma actualizada",
          undoKind: "restore-feeding",
          restore,
          restoreSession: oldSession,
        });
        return;
      }

      if (timerId) {
        await saveNewTimerFeeding(false);
        return;
      }

      const meta = metadataFor(notes, [], alexaMarked);
      const data = {
        child: childId,
        start: `${start}:00`,
        end: `${end}:00`,
        type,
        method,
        notes: meta.notes,
        tags: meta.tags,
      };
      if (amount) data.amount = Number(amount);
      const created = await api.createFeeding(data);
      onDone({ type: "feeding", id: created.id, label: "Toma", childId });
    } catch (err) {
      setError(err?.message || "No se pudo guardar la toma.");
      setSaving(false);
    }
  };

  const session = feedingSession(entry);
  const title = continuationBase
    ? "Continuar toma"
    : isEdit
      ? "Editar toma"
      : "Registrar toma";

  return (
    <Modal title={title} onClose={onClose} maxWidth={460}>
      <form onSubmit={handleSubmit}>
        {(isEdit || timerId) && (
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: "var(--text)" }}>
              {continuationBase
                ? `Continuación de ${clock(continuationBase.start)}–${clock(continuationBase.end)}`
                : isEdit
                  ? "Corrige la toma sin crear otra"
                  : timerLoading
                    ? "Cargando temporizador…"
                    : "Temporizador recuperado"}
            </strong>
            <div style={{ marginTop: 4 }}>
              {continuationBase
                ? `La hora inicial seguirá siendo ${clock(continuationBase.start)}. El tiempo efectivo sumará solo los tramos en los que ha estado tomando.`
                : isEdit
                  ? "Puedes corregir inicio, fin, pecho y, si hubo pausas, el tiempo efectivo real de toma."
                  : "Puedes corregir las horas antes de guardar o pausar la toma."}
            </div>
          </div>
        )}

        <FormField label="Tipo">
          <FormSelect options={TYPES} value={type} onChange={(e) => setType(e.target.value)} />
        </FormField>

        <FormField label={continuationBase ? "Método de este tramo" : "Método"}>
          {type === "breast milk" && (
            <QuickRow>
              {BREAST_METHODS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setMethod(item.value)}
                  style={{
                    ...quickButtonStyle,
                    border: method === item.value
                      ? `1px solid ${colors.feeding}`
                      : "1px solid var(--border)",
                    color: method === item.value ? colors.feeding : "var(--text)",
                    background: method === item.value ? `${colors.feeding}10` : "var(--bg)",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </QuickRow>
          )}
          <FormSelect
            options={METHODS}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            style={{ marginTop: type === "breast milk" ? 8 : 0 }}
          />
        </FormField>

        <FormField label={`Cantidad (${units.volume})`}>
          <FormInput
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={continuationBase ? "Cantidad añadida en este tramo (opcional)" : "Opcional"}
            min="0"
            step="5"
          />
        </FormField>

        {(!timerId || timerResolved || isEdit) && (
          <>
            <FormField label={continuationBase ? "Inicio de este tramo" : "Inicio"}>
              <FormInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              {(isEdit || timerId) && (
                <QuickRow>
                  {[-10, -5, 5, 10].map((delta) => (
                    <button key={delta} type="button" style={quickButtonStyle} onClick={() => setStart(shiftMinutes(start, delta))}>
                      Inicio {delta > 0 ? "+" : ""}{delta}
                    </button>
                  ))}
                </QuickRow>
              )}
            </FormField>

            <FormField label="Fin">
              <FormInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
              {(isEdit || timerId) && (
                <QuickRow>
                  {[-10, -5, 5, 10].map((delta) => (
                    <button key={delta} type="button" style={quickButtonStyle} onClick={() => setEnd(shiftMinutes(end, delta))}>
                      Fin {delta > 0 ? "+" : ""}{delta}
                    </button>
                  ))}
                  <button type="button" style={quickButtonStyle} onClick={() => setEnd(toLocalDatetime(new Date()))}>
                    Fin = ahora
                  </button>
                </QuickRow>
              )}
            </FormField>

            {!isEdit && !timerId && (
              <div style={{ marginBottom: 14, padding: 10, border: "1px solid var(--border)", borderRadius: 11, background: "var(--bg)" }}>
                <strong style={{ fontSize: 12 }}>Empezó hace…</strong>
                <QuickRow>
                  {RETRO_MINUTES.map((minutes) => (
                    <button key={minutes} type="button" style={quickButtonStyle} onClick={() => setRetrospectiveStart(minutes)}>
                      {minutes} min
                    </button>
                  ))}
                </QuickRow>
                <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                  <FormInput type="number" min="1" max="720" value={retroMinutes} onChange={(e) => setRetroMinutes(e.target.value)} style={{ width: 90 }} />
                  <button type="button" style={{ ...quickButtonStyle, flex: 1 }} onClick={() => setRetrospectiveStart(retroMinutes)}>
                    Aplicar minutos
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {isEdit && session && (
          <div style={{ marginBottom: 14, padding: 11, borderRadius: 11, border: `1px solid ${colors.feeding}45`, background: `${colors.feeding}08` }}>
            <strong style={{ color: "var(--text)", fontSize: 12 }}>Tiempo efectivo de toma</strong>
            <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11 }}>
              El registro va de {clock(start)} a {clock(end)}, pero hubo {session.segments} {session.segments === 1 ? "tramo" : "tramos"}. Corrige aquí solo los minutos en los que realmente estuvo tomando.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 9 }}>
              <FormInput
                type="number"
                min="0"
                max={Math.max(0, wallMinutes)}
                value={effectiveMinutes}
                onChange={(e) => setEffectiveMinutes(Math.max(0, Number(e.target.value || 0)))}
                style={{ width: 100 }}
              />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>min efectivos</span>
            </div>
            <QuickRow>
              {[-5, -1, 1, 5].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  style={quickButtonStyle}
                  onClick={() => setEffectiveMinutes((value) => Math.max(0, Math.min(wallMinutes, Number(value || 0) + delta)))}
                >
                  {delta > 0 ? "+" : ""}{delta} min
                </button>
              ))}
            </QuickRow>
          </div>
        )}

        <FormField label="Notas">
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </FormField>

        {(isEdit || continuationBase) && (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, padding: 11, borderRadius: 11, border: alexaMarked ? `1px solid ${colors.feeding}55` : "1px solid var(--border)", background: alexaMarked ? `${colors.feeding}08` : "var(--bg)", cursor: "pointer" }}>
            <input type="checkbox" checked={alexaMarked} onChange={(e) => setAlexaMarked(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <strong style={{ display: "block", color: "var(--text)", fontSize: 12 }}>🎙️ Registrada mediante Alexa</strong>
              <span style={{ display: "block", marginTop: 3, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>
                Si la desmarcas y guardas, desaparecen la etiqueta y la nota automática de Alexa.
              </span>
            </span>
          </label>
        )}

        {isEdit && previousFeeding && (
          <div style={{ marginBottom: 14, padding: 11, borderRadius: 11, border: `1px solid ${colors.feeding}45`, background: `${colors.feeding}08` }}>
            <strong style={{ fontSize: 12, color: "var(--text)" }}>¿Era continuación de la toma anterior?</strong>
            <div style={{ marginTop: 4, marginBottom: 8, color: "var(--text-muted)", fontSize: 11 }}>
              Anterior: {clock(previousFeeding.start)}–{clock(previousFeeding.end)}. Al fusionar se conserva el intervalo completo, pero el tiempo de toma será la suma de los minutos efectivos de ambas.
            </div>
            <button type="button" disabled={mergeBusy} onClick={handleMerge} style={{ width: "100%", border: `1px solid ${colors.feeding}`, borderRadius: 9, background: "transparent", color: colors.feeding, padding: "9px 10px", fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: mergeBusy ? "default" : "pointer" }}>
              {mergeBusy ? "Fusionando…" : "Fusionar con la toma anterior"}
            </button>
          </div>
        )}

        {error && <div style={{ marginBottom: 12, color: "#ef4444", fontSize: 12 }}>{error}</div>}

        {timerId && (
          <button
            type="button"
            disabled={saving || timerLoading || mergeBusy}
            onClick={handlePause}
            style={{ width: "100%", marginBottom: 9, padding: "11px 16px", borderRadius: 12, border: `1px solid ${colors.feeding}`, background: "transparent", color: colors.feeding, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
          >
            ⏸️ Pausar toma
          </button>
        )}

        <FormButton color={colors.feeding} disabled={saving || timerLoading || mergeBusy}>
          {saving
            ? "Guardando…"
            : continuationBase
              ? "Finalizar continuación"
              : isEdit
                ? "Actualizar toma"
                : timerId
                  ? "Finalizar toma"
                  : "Guardar toma"}
        </FormButton>
      </form>
    </Modal>
  );
}
