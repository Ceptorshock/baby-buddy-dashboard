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
import { isAlexaFeeding } from "../../utils/formatters";

const TYPES = [
  { value: "breast milk", label: "Leche materna" },
  { value: "formula", label: "Leche de fórmula" },
  {
    value: "fortified breast milk",
    label: "Leche materna fortificada",
  },
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

const RETRO_MINUTES = [5, 10, 15, 20, 25, 30, 45, 60];

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutes(value, minutes) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return toLocalDatetime(
    new Date(parsed.getTime() + minutes * 60000),
  );
}

function subtractMinutes(value, minutes) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return toLocalDatetime(
    new Date(parsed.getTime() - minutes * 60000),
  );
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

function combinedNotes(previousNotes, currentNotes) {
  const previous = String(previousNotes || "").trim();
  const current = String(currentNotes || "").trim();

  if (!previous) return current;
  if (!current || current === previous) return previous;
  return `${previous} | ${current}`;
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

  if (!enabled) {
    return { notes: cleanNotes, tags: cleanTags };
  }

  return {
    notes: cleanNotes
      ? `${cleanNotes} | Registrado mediante Alexa`
      : "Registrado mediante Alexa",
    tags: [...cleanTags, "Alexa"],
  };
}

async function deleteFeeding(id) {
  const response = await fetch(`./api/baby-buddy/feedings/${id}/`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `No se pudo eliminar la toma duplicada (${response.status})${
        text ? `: ${text}` : ""
      }`,
    );
  }
}

const quickButtonStyle = {
  flex: "1 1 70px",
  minWidth: 66,
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 9px",
  background: "var(--bg)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

export default function FeedingForm({
  childId,
  timerId,
  entry,
  onDone,
  onClose,
}) {
  const units = useUnits();
  const isEdit = !!entry;

  const now = new Date();
  const fifteenMinsAgo = new Date(
    now.getTime() - 15 * 60 * 1000,
  );

  const [type, setType] = useState(
    entry?.type || "breast milk",
  );
  const [method, setMethod] = useState(
    entry?.method || "bottle",
  );
  const [amount, setAmount] = useState(
    entry?.amount != null ? String(entry.amount) : "",
  );
  const [start, setStart] = useState(
    entry?.start
      ? toLocalDatetime(new Date(entry.start))
      : toLocalDatetime(fifteenMinsAgo),
  );
  const [end, setEnd] = useState(
    entry?.end
      ? toLocalDatetime(new Date(entry.end))
      : toLocalDatetime(now),
  );
  const [notes, setNotes] = useState(entry?.notes || "");
  const [alexaMarked, setAlexaMarked] = useState(() =>
    isAlexaFeeding(entry),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [timerLoading, setTimerLoading] = useState(
    Boolean(timerId),
  );
  const [timerResolved, setTimerResolved] = useState(
    !timerId,
  );

  const [retroMinutes, setRetroMinutes] = useState("25");
  const [previousFeeding, setPreviousFeeding] = useState(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  useEffect(() => {
    if (!timerId || entry) return;
    let cancelled = false;

    api
      .getTimers()
      .then((payload) => {
        if (cancelled) return;

        const timer = timerList(payload).find(
          (item) => String(item.id) === String(timerId),
        );

        if (timer?.start) {
          setStart(toLocalDatetime(new Date(timer.start)));
          setEnd(toLocalDatetime(new Date()));
          setTimerResolved(true);
        }
      })
      .catch(() => null)
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

    api
      .getFeedings({
        child: childId,
        ordering: "-start",
        limit: 25,
      })
      .then((payload) => {
        if (cancelled) return;

        const currentStart = new Date(entry.start).getTime();

        const candidates = resultList(payload)
          .filter(
            (item) =>
              item?.id !== entry.id &&
              item?.start &&
              new Date(item.start).getTime() < currentStart,
          )
          .sort(
            (a, b) =>
              new Date(b.start).getTime() -
              new Date(a.start).getTime(),
          );

        const previous = candidates[0] || null;
        if (!previous) {
          setPreviousFeeding(null);
          return;
        }

        const previousEnd = previous.end
          ? new Date(previous.end).getTime()
          : new Date(previous.start).getTime();

        const gapMinutes = Math.round(
          (currentStart - previousEnd) / 60000,
        );

        // Solo proponemos fusión para tomas cercanas: evita unir
        // accidentalmente tomas normales separadas por horas.
        if (gapMinutes <= 60) {
          setPreviousFeeding(previous);
        } else {
          setPreviousFeeding(null);
        }
      })
      .catch(() => setPreviousFeeding(null));

    return () => {
      cancelled = true;
    };
  }, [isEdit, childId, entry?.id, entry?.start]);

  const currentDurationMinutes = useMemo(() => {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return 0;
    }

    return Math.max(
      0,
      Math.round(
        (endDate.getTime() - startDate.getTime()) / 60000,
      ),
    );
  }, [start, end]);

  const setRetrospectiveStart = (minutes) => {
    const parsed = Math.max(1, Math.round(Number(minutes) || 0));
    if (!parsed) return;
    setStart(subtractMinutes(end, parsed));
  };

  const handleMerge = async () => {
    if (!previousFeeding || mergeBusy) return;

    setError("");

    const currentStart = new Date(start);
    const currentEnd = new Date(end);
    const previousStart = new Date(previousFeeding.start);
    const previousEnd = previousFeeding.end
      ? new Date(previousFeeding.end)
      : previousStart;

    if (
      [currentStart, currentEnd, previousStart, previousEnd].some(
        (date) => Number.isNaN(date.getTime()),
      )
    ) {
      setError("No se pueden calcular las horas para fusionar.");
      return;
    }

    const mergedStart =
      previousStart < currentStart ? previousStart : currentStart;
    const mergedEnd =
      previousEnd > currentEnd ? previousEnd : currentEnd;

    const preview =
      `${clock(mergedStart)} – ${clock(mergedEnd)} ` +
      `(${Math.round(
        (mergedEnd.getTime() - mergedStart.getTime()) / 60000,
      )} min)`;

    const confirmed = window.confirm(
      `¿Fusionar estas dos tomas?\n\n` +
        `Anterior: ${clock(previousStart)} – ${clock(previousEnd)}\n` +
        `Actual: ${clock(currentStart)} – ${clock(currentEnd)}\n\n` +
        `Resultado: ${preview}\n\n` +
        `La toma actual se eliminará y quedará un único registro.`,
    );

    if (!confirmed) return;

    setMergeBusy(true);

    try {
      const previousAmount = Number(previousFeeding.amount || 0);
      const currentAmount = Number(amount || entry?.amount || 0);
      const mergedAmount = previousAmount + currentAmount;

      const payload = {
        start: toLocalDatetime(mergedStart) + ":00",
        end: toLocalDatetime(mergedEnd) + ":00",
        type:
          previousFeeding.type === type
            ? type
            : type || previousFeeding.type,
        method: breastMergeMethod(
          previousFeeding.method,
          method,
        ),
      };

      if (mergedAmount > 0) payload.amount = mergedAmount;

      const mergedAlexa =
        isAlexaFeeding(previousFeeding) || alexaMarked;
      const mergedNotes = combinedNotes(
        previousFeeding.notes,
        notes,
      );
      const mergedMetadata = applyAlexaMetadata(
        mergedNotes,
        [
          ...normalizeFeedingTags(previousFeeding.tags),
          ...normalizeFeedingTags(entry?.tags),
        ],
        mergedAlexa,
      );
      payload.notes = mergedMetadata.notes;
      payload.tags = mergedMetadata.tags;

      // Baby Buddy no permite ampliar un registro si durante ese
      // mismo PATCH todavía existe otro que se solapa. Por eso
      // eliminamos primero la toma actual y después ampliamos la
      // anterior. Si el PATCH falla, recreamos la toma actual para
      // no perder el registro.
      const rollbackData = {
        child: childId,
        start: `${start}:00`,
        end: `${end}:00`,
        type,
        method,
      };

      if (amount) rollbackData.amount = parseFloat(amount);
      const rollbackMetadata = applyAlexaMetadata(
        notes,
        entry?.tags,
        alexaMarked,
      );
      rollbackData.notes = rollbackMetadata.notes;
      rollbackData.tags = rollbackMetadata.tags;

      await deleteFeeding(entry.id);

      try {
        await api.updateFeeding(previousFeeding.id, payload);
      } catch (mergeError) {
        try {
          await api.createFeeding(rollbackData);
        } catch (rollbackError) {
          throw new Error(
            `Falló la fusión y también la restauración automática. ` +
            `Fusión: ${mergeError?.message || mergeError}. ` +
            `Restauración: ${rollbackError?.message || rollbackError}`,
          );
        }

        throw new Error(
          `No se pudo fusionar. La toma actual se ha restaurado automáticamente. ` +
          `${mergeError?.message || mergeError}`,
        );
      }

      onDone();
    } catch (err) {
      setError(
        err?.message || "No se pudieron fusionar las tomas.",
      );
      setMergeBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      endDate < startDate
    ) {
      setError(
        "La hora de fin debe ser igual o posterior a la hora de inicio.",
      );
      return;
    }

    setSaving(true);

    try {
      const data = { type, method };

      if (amount) data.amount = parseFloat(amount);

      if (isEdit) {
        const metadata = applyAlexaMetadata(
          notes,
          entry?.tags,
          alexaMarked,
        );
        data.notes = metadata.notes;
        data.tags = metadata.tags;
        data.start = `${start}:00`;
        data.end = `${end}:00`;
        await api.updateFeeding(entry.id, data);
        onDone();
        return;
      }

      if (notes.trim()) data.notes = notes.trim();
      data.child = childId;

      if (timerId && !timerResolved) {
        data.timer = timerId;
      } else {
        data.start = `${start}:00`;
        data.end = `${end}:00`;
      }

      const created = await api.createFeeding(data);

      if (timerId && timerResolved) {
        await api.deleteTimer(timerId).catch(() => null);
      }

      onDone({
        type: "feeding",
        id: created.id,
        label: "Toma",
        childId,
      });
    } catch (err) {
      setError(
        err?.message || "No se pudo guardar la toma.",
      );
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Editar toma" : "Registrar toma"}
      onClose={onClose}
    >
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
            {isEdit ? (
              <>
                <strong style={{ color: "var(--text)" }}>
                  Corrige la toma sin crear otra
                </strong>
                <div style={{ marginTop: 4 }}>
                  Puedes cambiar inicio y fin. La referencia de
                  alimentación sigue contando desde el{" "}
                  <strong>inicio</strong>.
                </div>
              </>
            ) : timerLoading ? (
              <strong>
                Cargando las horas del temporizador…
              </strong>
            ) : timerResolved ? (
              <>
                <strong style={{ color: "var(--text)" }}>
                  Temporizador recuperado
                </strong>
                <div style={{ marginTop: 4 }}>
                  Puedes corregir la hora real de inicio y fin
                  antes de guardar.
                </div>
              </>
            ) : (
              <div>
                No se pudo recuperar el inicio del
                temporizador; se usará el temporizador
                original.
              </div>
            )}
          </div>
        )}

        <FormField label="Tipo">
          <FormSelect
            options={TYPES}
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        </FormField>

        <FormField label="Método">
          <FormSelect
            options={METHODS}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          />
        </FormField>

        <FormField label={`Cantidad (${units.volume})`}>
          <FormInput
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Opcional"
            min="0"
            step="5"
          />
        </FormField>

        {(!timerId || timerResolved || isEdit) && (
          <>
            <FormField label="Inicio">
              <FormInput
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Fin">
              <FormInput
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </FormField>

            {!isEdit && (
              <div
                style={{
                  marginTop: -3,
                  marginBottom: 14,
                  padding: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 11,
                  background: "var(--bg)",
                }}
              >
                <div
                  style={{
                    marginBottom: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    color: "var(--text)",
                  }}
                >
                  Empezó hace…
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  {RETRO_MINUTES.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      style={quickButtonStyle}
                      onClick={() =>
                        setRetrospectiveStart(minutes)
                      }
                    >
                      {minutes} min
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 7,
                    marginTop: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="720"
                    value={retroMinutes}
                    onChange={(e) =>
                      setRetroMinutes(e.target.value)
                    }
                    style={{
                      minWidth: 0,
                      width: 90,
                      border: "1px solid var(--border)",
                      borderRadius: 9,
                      background: "var(--card-bg)",
                      color: "var(--text)",
                      padding: "8px 9px",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    type="button"
                    style={{
                      ...quickButtonStyle,
                      flex: "0 0 auto",
                    }}
                    onClick={() =>
                      setRetrospectiveStart(retroMinutes)
                    }
                  >
                    Aplicar minutos
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 7,
                    color: "var(--text-dim)",
                    fontSize: 11,
                  }}
                >
                  Duración actual: {currentDurationMinutes} min
                </div>
              </div>
            )}

            {(isEdit || timerId) && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: -4,
                  marginBottom: 14,
                }}
              >
                <button
                  type="button"
                  style={quickButtonStyle}
                  onClick={() => setEnd(addMinutes(end, 5))}
                >
                  Fin +5 min
                </button>
                <button
                  type="button"
                  style={quickButtonStyle}
                  onClick={() => setEnd(addMinutes(end, 10))}
                >
                  Fin +10 min
                </button>
                <button
                  type="button"
                  style={quickButtonStyle}
                  onClick={() => setEnd(addMinutes(end, 15))}
                >
                  Fin +15 min
                </button>
                <button
                  type="button"
                  style={quickButtonStyle}
                  onClick={() =>
                    setEnd(toLocalDatetime(new Date()))
                  }
                >
                  Fin = ahora
                </button>
              </div>
            )}
          </>
        )}

        <FormField label="Notas">
          <FormInput
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional"
          />
        </FormField>

        {isEdit && (
          <label
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              marginBottom: 14,
              padding: 11,
              borderRadius: 11,
              border: alexaMarked
                ? `1px solid ${colors.feeding}55`
                : "1px solid var(--border)",
              background: alexaMarked
                ? `${colors.feeding}08`
                : "var(--bg)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={alexaMarked}
              onChange={(event) =>
                setAlexaMarked(event.target.checked)
              }
              style={{ marginTop: 2 }}
            />
            <span>
              <strong
                style={{
                  display: "block",
                  color: "var(--text)",
                  fontSize: 12,
                }}
              >
                🎙️ Registrada mediante Alexa
              </strong>
              <span
                style={{
                  display: "block",
                  marginTop: 3,
                  color: "var(--text-muted)",
                  fontSize: 11,
                  lineHeight: 1.4,
                }}
              >
                Si la desmarcas y guardas, se eliminan la etiqueta
                Alexa y la nota automática. La toma seguirá siendo
                editable normalmente.
              </span>
            </span>
          </label>
        )}

        {isEdit && previousFeeding && (
          <div
            style={{
              marginBottom: 14,
              padding: 11,
              borderRadius: 11,
              border: `1px solid ${colors.feeding}45`,
              background: `${colors.feeding}08`,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "var(--text)",
              }}
            >
              ¿Era continuación de la toma anterior?
            </div>

            <div
              style={{
                marginTop: 4,
                marginBottom: 8,
                color: "var(--text-muted)",
                fontSize: 11,
                lineHeight: 1.45,
              }}
            >
              Anterior: {clock(previousFeeding.start)} –{" "}
              {previousFeeding.end
                ? clock(previousFeeding.end)
                : "en curso"}
              . Puedes unir ambas y dejar un único registro.
            </div>

            <button
              type="button"
              disabled={mergeBusy}
              onClick={handleMerge}
              style={{
                width: "100%",
                border: `1px solid ${colors.feeding}`,
                borderRadius: 9,
                background: "transparent",
                color: colors.feeding,
                padding: "9px 10px",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 800,
                cursor: mergeBusy
                  ? "default"
                  : "pointer",
                opacity: mergeBusy ? 0.6 : 1,
              }}
            >
              {mergeBusy
                ? "Fusionando…"
                : "Fusionar con la toma anterior"}
            </button>
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 12,
              color: "#ef4444",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <FormButton
          color={colors.feeding}
          disabled={saving || timerLoading || mergeBusy}
        >
          {saving
            ? "Guardando..."
            : isEdit
              ? "Actualizar toma"
              : "Guardar toma"}
        </FormButton>
      </form>
    </Modal>
  );
}
