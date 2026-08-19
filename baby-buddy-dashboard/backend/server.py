import os
import json
import asyncio
import logging
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import httpx
import websockets

# --- Configuration ---

BABY_BUDDY_URL = os.environ.get("BABY_BUDDY_URL", "").rstrip("/")
BABY_BUDDY_API_KEY = os.environ.get("BABY_BUDDY_API_KEY", "")
REFRESH_INTERVAL = int(os.environ.get("REFRESH_INTERVAL", "30"))
DEMO_MODE = os.environ.get("DEMO_MODE", "").lower() in ("true", "1", "yes")
UNIT_SYSTEM = os.environ.get("UNIT_SYSTEM", "metric").lower()
DEFAULT_CHILD_ID = int(os.environ.get("DEFAULT_CHILD_ID", "0") or 0)
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")

logger = logging.getLogger("baby_buddy_dashboard")

AUDIT_DB_PATH = Path("/data/baby_buddy_dashboard_audit.sqlite3")
APP_SETTINGS_PATH = Path("/data/baby_buddy_dashboard_settings.json")


def _init_audit_db():
    AUDIT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                user_id TEXT,
                user_name TEXT,
                user_display_name TEXT NOT NULL,
                action TEXT NOT NULL,
                resource TEXT NOT NULL,
                entry_id TEXT,
                child_id INTEGER,
                before_json TEXT,
                after_json TEXT
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_resource_entry ON audit_log(resource, entry_id, id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_child_time ON audit_log(child_id, timestamp DESC)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS diaper_purchase_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                product_id INTEGER NOT NULL,
                size TEXT NOT NULL,
                amount INTEGER NOT NULL,
                user_display_name TEXT NOT NULL DEFAULT 'Acceso directo'
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS diaper_purchase_overrides (
                purchase_key TEXT PRIMARY KEY,
                hidden INTEGER NOT NULL DEFAULT 0,
                product_id INTEGER,
                size TEXT,
                amount INTEGER,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS handoff_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                child_id INTEGER NOT NULL,
                from_user_id TEXT,
                from_user_name TEXT,
                to_user_id TEXT,
                to_user_name TEXT NOT NULL,
                note TEXT
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_handoff_child_time ON handoff_events(child_id, timestamp DESC)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS feeding_session_meta (
                entry_id TEXT PRIMARY KEY,
                active_seconds INTEGER NOT NULL DEFAULT 0,
                segments INTEGER NOT NULL DEFAULT 1,
                paused INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                details_json TEXT,
                last_breast TEXT
            )
            """
        )
        columns = {
            str(row[1])
            for row in connection.execute("PRAGMA table_info(feeding_session_meta)").fetchall()
        }
        if "details_json" not in columns:
            connection.execute("ALTER TABLE feeding_session_meta ADD COLUMN details_json TEXT")
        if "last_breast" not in columns:
            connection.execute("ALTER TABLE feeding_session_meta ADD COLUMN last_breast TEXT")
        connection.commit()


def _request_user(request: Request) -> dict:
    headers = request.headers
    user_id = str(headers.get("X-Remote-User-Id", "") or "").strip()
    user_name = str(headers.get("X-Remote-User-Name", "") or "").strip()
    display_name = str(headers.get("X-Remote-User-Display-Name", "") or "").strip()
    if not display_name:
        display_name = user_name or (f"Usuario {user_id[:8]}" if user_id else "Acceso directo")
    return {
        "id": user_id,
        "name": user_name,
        "display_name": display_name,
        "via_ingress": bool(user_id or user_name),
    }


def _json_text(value) -> str | None:
    if value is None:
        return None
    try:
        return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        return json.dumps({"value": str(value)}, ensure_ascii=False)


def _child_id_from_entry(*entries) -> int | None:
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        value = entry.get("child")
        if isinstance(value, dict):
            value = value.get("id")
        try:
            child_id = int(value)
        except (TypeError, ValueError):
            continue
        if child_id > 0:
            return child_id
    return None


def _record_audit(
    request: Request,
    action: str,
    resource: str,
    entry_id,
    before=None,
    after=None,
    child_id: int | None = None,
):
    user = _request_user(request)
    resolved_child_id = child_id or _child_id_from_entry(after, before)
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        connection.execute(
            """
            INSERT INTO audit_log (
                timestamp, user_id, user_name, user_display_name,
                action, resource, entry_id, child_id, before_json, after_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(),
                user["id"],
                user["name"],
                user["display_name"],
                action,
                resource,
                str(entry_id) if entry_id not in (None, "") else None,
                resolved_child_id,
                _json_text(before),
                _json_text(after),
            ),
        )
        connection.commit()


def _parse_json_text(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def _audit_row_to_dict(row) -> dict:
    return {
        "id": row[0],
        "timestamp": row[1],
        "user_id": row[2] or "",
        "user_name": row[3] or "",
        "user_display_name": row[4] or "Autor no registrado",
        "action": row[5],
        "resource": row[6],
        "entry_id": row[7],
        "child_id": row[8],
        "before": _parse_json_text(row[9]),
        "after": _parse_json_text(row[10]),
    }


def _audit_metadata(resource: str, entry_ids: list[str]) -> dict[str, dict]:
    clean_ids = [str(value) for value in entry_ids if value not in (None, "")]
    if not clean_ids:
        return {}
    placeholders = ",".join("?" for _ in clean_ids)
    query = f"""
        SELECT id, timestamp, user_id, user_name, user_display_name,
               action, resource, entry_id, child_id, before_json, after_json
        FROM audit_log
        WHERE resource = ? AND entry_id IN ({placeholders})
        ORDER BY id ASC
    """
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        rows = connection.execute(query, [resource, *clean_ids]).fetchall()
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        item = _audit_row_to_dict(row)
        grouped.setdefault(str(item["entry_id"]), []).append(item)
    result = {}
    for entry_id, history in grouped.items():
        created = next((item for item in history if item["action"] == "create"), None)
        latest = history[-1]
        edits = sum(1 for item in history if item["action"] in ("update", "delete", "undo"))
        result[entry_id] = {
            "created_by": created["user_display_name"] if created else "Autor no registrado",
            "created_at": created["timestamp"] if created else None,
            "updated_by": latest["user_display_name"],
            "updated_at": latest["timestamp"],
            "last_action": latest["action"],
            "edit_count": edits,
        }
    return result


def _attach_audit(resource: str, payload):
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        entries = [item for item in payload["results"] if isinstance(item, dict)]
    elif isinstance(payload, dict) and payload.get("id") not in (None, ""):
        entries = [payload]
    else:
        return payload
    metadata = _audit_metadata(resource, [entry.get("id") for entry in entries])
    for entry in entries:
        entry["_audit"] = metadata.get(
            str(entry.get("id")),
            {
                "created_by": "Autor no registrado",
                "created_at": None,
                "updated_by": None,
                "updated_at": None,
                "last_action": None,
                "edit_count": 0,
            },
        )
    return payload


def _normalize_feeding_segment_details(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        method = str(item.get("method", "") or "").strip().lower()
        try:
            active_seconds = max(0, int(item.get("active_seconds", 0) or 0))
        except (TypeError, ValueError):
            active_seconds = 0
        result.append(
            {
                "start": item.get("start") or None,
                "end": item.get("end") or None,
                "active_seconds": active_seconds,
                "method": method,
            }
        )
    return result


def _normalize_last_breast(value) -> str | None:
    method = str(value or "").strip().lower()
    return method if method in ("left breast", "right breast") else None


def _feeding_session_meta(entry_ids: list[str]) -> dict[str, dict]:
    clean_ids = [str(value) for value in entry_ids if value not in (None, "")]
    if not clean_ids:
        return {}
    placeholders = ",".join("?" for _ in clean_ids)
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        rows = connection.execute(
            f"SELECT entry_id, active_seconds, segments, paused, updated_at, details_json, last_breast "
            f"FROM feeding_session_meta WHERE entry_id IN ({placeholders})",
            clean_ids,
        ).fetchall()
    result = {}
    for row in rows:
        details = []
        if row[5]:
            try:
                details = _normalize_feeding_segment_details(json.loads(row[5]))
            except (json.JSONDecodeError, TypeError):
                details = []
        result[str(row[0])] = {
            "active_seconds": max(0, int(row[1] or 0)),
            "segments": max(1, int(row[2] or 1)),
            "paused": bool(row[3]),
            "updated_at": row[4],
            "details": details,
            "last_breast": _normalize_last_breast(row[6]),
        }
    return result


def _attach_feeding_session_meta(payload):
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        entries = [item for item in payload["results"] if isinstance(item, dict)]
    elif isinstance(payload, dict) and payload.get("id") not in (None, ""):
        entries = [payload]
    else:
        return payload
    metadata = _feeding_session_meta([entry.get("id") for entry in entries])
    for entry in entries:
        session = metadata.get(str(entry.get("id")))
        if session:
            entry["_session"] = session
    return payload


def _set_feeding_session_meta(
    entry_id,
    active_seconds: int,
    segments: int,
    paused: bool,
    details=None,
    last_breast=None,
):
    normalized_details = _normalize_feeding_segment_details(details)
    normalized_last_breast = _normalize_last_breast(last_breast)
    if not normalized_last_breast:
        for item in reversed(normalized_details):
            candidate = _normalize_last_breast(item.get("method"))
            if candidate:
                normalized_last_breast = candidate
                break
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        connection.execute(
            """
            INSERT INTO feeding_session_meta (
                entry_id, active_seconds, segments, paused, updated_at, details_json, last_breast
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entry_id) DO UPDATE SET
                active_seconds=excluded.active_seconds,
                segments=excluded.segments,
                paused=excluded.paused,
                updated_at=excluded.updated_at,
                details_json=excluded.details_json,
                last_breast=excluded.last_breast
            """,
            (
                str(entry_id),
                max(0, int(active_seconds or 0)),
                max(1, int(segments or 1)),
                1 if paused else 0,
                datetime.now(timezone.utc).isoformat(),
                _json_text(normalized_details) if normalized_details else None,
                normalized_last_breast,
            ),
        )
        connection.commit()


def _delete_feeding_session_meta(entry_id):
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        connection.execute(
            "DELETE FROM feeding_session_meta WHERE entry_id = ?",
            (str(entry_id),),
        )
        connection.commit()


def _path_resource_and_id(path: str) -> tuple[str, str | None]:
    parts = [part for part in path.strip("/").split("/") if part]
    return (parts[0] if parts else "", parts[1] if len(parts) > 1 else None)


def _load_options() -> dict:
    options_path = Path("/data/options.json")
    if not options_path.exists():
        return {}
    try:
        return json.loads(options_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _load_child_entity_map(options: dict, key: str, entity_field: str) -> dict[int, str]:
    raw = options.get(key, [])
    result: dict[int, str] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                child_id = int(item.get("child_id"))
            except (TypeError, ValueError):
                continue
            entity_id = str(item.get(entity_field, "") or "").strip()
            if entity_id:
                result[child_id] = entity_id
    elif isinstance(raw, dict):
        for child_key, value in raw.items():
            try:
                child_id = int(child_key)
            except (TypeError, ValueError):
                continue
            entity_id = str(value or "").strip()
            if entity_id:
                result[child_id] = entity_id
    return result


def _load_diaper_size_entities(options: dict) -> dict[int, str]:
    result = _load_child_entity_map(options, "diaper_size_entities", "entity_id")
    if not result:
        result[1] = "input_select.bollito_talla_panal"
        result[2] = "input_select.bollito2_talla_panal"
    return result


def _load_diaper_product_ids(options: dict) -> dict[str, int]:
    raw = options.get("diaper_product_ids", [])
    result: dict[str, int] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            size = str(item.get("size", "") or "").strip()
            try:
                product_id = int(item.get("product_id"))
            except (TypeError, ValueError):
                continue
            if size and product_id > 0:
                result[size] = product_id
    return result


def _load_room_entities(options: dict) -> dict[int, dict[str, str]]:
    raw = options.get("room_entities", [])
    result: dict[int, dict[str, str]] = {}
    if not isinstance(raw, list):
        return result
    fields = (
        "temperature_entity",
        "humidity_entity",
        "light_entity",
        "window_entity",
        "camera_entity",
        "diaper_stock_entity",
    )
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            child_id = int(item.get("child_id"))
        except (TypeError, ValueError):
            continue
        config = {field: str(item.get(field, "") or "").strip() for field in fields}
        if any(config.values()):
            result[child_id] = config
    return result


def _load_calendar_entities(options: dict) -> dict[int, str]:
    result = _load_child_entity_map(options, "calendar_entities", "entity_id")
    if not result:
        result[1] = "calendar.bollito"
        result[2] = "calendar.bollito2"
    return result


def _load_child_names(options: dict) -> dict[int, str]:
    raw = options.get("child_names", [])
    result: dict[int, str] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                child_id = int(item.get("child_id"))
            except (TypeError, ValueError):
                continue
            name = str(item.get("name", "") or "").strip()
            if child_id > 0 and name:
                result[child_id] = name
    elif isinstance(raw, dict):
        for raw_id, raw_name in raw.items():
            try:
                child_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            name = str(raw_name or "").strip()
            if child_id > 0 and name:
                result[child_id] = name
    if not result:
        result = {1: "Bollito", 2: "Bollito2"}
    return result


def _parse_service_list(value) -> list[str]:
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r"[,\n;]+", str(value or ""))
    result: list[str] = []
    for item in raw_items:
        service = str(item or "").strip()
        if service and "." in service and service not in result:
            result.append(service)
    return result


def _parse_int_set(value) -> set[int]:
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r"[,\n; ]+", str(value or ""))
    result: set[int] = set()
    for item in raw_items:
        try:
            parsed = int(str(item).strip())
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            result.add(parsed)
    return result


def _interval_seconds(value) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    parts = text.split(":")
    try:
        hours = int(parts[0] or 0) if len(parts) > 0 else 0
        minutes = int(parts[1] or 0) if len(parts) > 1 else 0
        seconds = int(float(parts[2] or 0)) if len(parts) > 2 else 0
    except (TypeError, ValueError):
        return 0
    return max(0, hours * 3600 + minutes * 60 + seconds)


OPTIONS = _load_options()
if not BABY_BUDDY_URL:
    BABY_BUDDY_URL = OPTIONS.get("baby_buddy_url", "").rstrip("/")
    BABY_BUDDY_API_KEY = OPTIONS.get("baby_buddy_api_key", "")
    REFRESH_INTERVAL = OPTIONS.get("refresh_interval", 30)
    DEMO_MODE = DEMO_MODE or OPTIONS.get("demo_mode", False)
    UNIT_SYSTEM = OPTIONS.get("unit_system", UNIT_SYSTEM)

if not DEFAULT_CHILD_ID:
    try:
        DEFAULT_CHILD_ID = int(OPTIONS.get("default_child_id", 0) or 0)
    except (TypeError, ValueError):
        DEFAULT_CHILD_ID = 0

DIAPER_SIZE_ENTITIES = _load_diaper_size_entities(OPTIONS)
DIAPER_LAST_PROCESSED_ENTITIES = _load_child_entity_map(OPTIONS, "diaper_size_entities", "last_processed_entity")
DIAPER_PRODUCT_IDS = _load_diaper_product_ids(OPTIONS)
ROOM_ENTITIES = _load_room_entities(OPTIONS)
CALENDAR_ENTITIES = _load_calendar_entities(OPTIONS)
CHILD_NAMES = _load_child_names(OPTIONS)
# Bebés visibles/activos. A partir de ES18.3 se gestionan desde la propia app y
# se persisten en /data. Si todavía no existe ese fichero, migramos una sola vez
# los ajustes antiguos del complemento para mantener el comportamiento previo.
def _initial_disabled_child_ids() -> set[int]:
    legacy = _parse_int_set(OPTIONS.get("disabled_child_ids", ""))
    if "bollito2_enabled" in OPTIONS:
        if bool(OPTIONS.get("bollito2_enabled", False)):
            legacy.discard(2)
        else:
            legacy.add(2)
    elif not legacy:
        # Compatibilidad con vuestra instalación actual: el segundo perfil de
        # pruebas permanece oculto hasta activarlo desde Ajustes.
        legacy.add(2)
    if APP_SETTINGS_PATH.exists():
        try:
            payload = json.loads(APP_SETTINGS_PATH.read_text())
            stored = payload.get("disabled_child_ids")
            if isinstance(stored, list):
                return {int(value) for value in stored if int(value) > 0}
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            logger.warning("No se pudo leer %s; se usarán los ajustes heredados", APP_SETTINGS_PATH)
    return legacy


def _load_known_child_ids() -> set[int] | None:
    if not APP_SETTINGS_PATH.exists():
        return None
    try:
        payload = json.loads(APP_SETTINGS_PATH.read_text())
        stored = payload.get("known_child_ids")
        if isinstance(stored, list):
            return {int(value) for value in stored if int(value) > 0}
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        pass
    return None


def _save_app_settings(extra: dict | None = None):
    APP_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {}
    if APP_SETTINGS_PATH.exists():
        try:
            current = json.loads(APP_SETTINGS_PATH.read_text())
            if isinstance(current, dict):
                payload.update(current)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    payload["disabled_child_ids"] = sorted(DISABLED_CHILD_IDS)
    if KNOWN_CHILD_IDS is not None:
        payload["known_child_ids"] = sorted(KNOWN_CHILD_IDS)
    if extra:
        payload.update(extra)
    temporary = APP_SETTINGS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    temporary.replace(APP_SETTINGS_PATH)


DISABLED_CHILD_IDS = _initial_disabled_child_ids()
KNOWN_CHILD_IDS = _load_known_child_ids()
# Guardamos inmediatamente la migración para que a partir de ahora mande la UI.
try:
    _save_app_settings()
except OSError:
    logger.warning("No se pudieron persistir inicialmente los ajustes de bebés")
try:
    SHARED_ROOM_CHILD_ID = int(OPTIONS.get("shared_room_child_id", 0) or 0)
except (TypeError, ValueError):
    SHARED_ROOM_CHILD_ID = 0
CALENDAR_DAYS_AHEAD = max(1, int(OPTIONS.get("calendar_days_ahead", 90) or 90))
CALENDAR_MAX_EVENTS = max(1, int(OPTIONS.get("calendar_max_events", 4) or 4))
CALENDAR_FULL_MAX_EVENTS = max(10, int(OPTIONS.get("calendar_full_max_events", 200) or 200))
GROCY_CONSUME_SERVICE = str(OPTIONS.get("grocy_consume_service", "rest_command.grocy_consumir_panal") or "").strip()
GROCY_RESTORE_SERVICE = str(OPTIONS.get("grocy_restore_service", "") or "").strip()
GROCY_STOCK_ENTITY = str(OPTIONS.get("grocy_stock_entity", "sensor.grocy_stock_por_ubicacion") or "").strip()
GROCY_URL = str(OPTIONS.get("grocy_url", "") or "").strip().rstrip("/")
GROCY_API_KEY = str(OPTIONS.get("grocy_api_key", "") or "").strip()
if GROCY_URL.endswith("/api"):
    GROCY_URL = GROCY_URL[:-4]
HOME_ASSISTANT_ALERT_NOTIFICATIONS = bool(OPTIONS.get("home_assistant_alert_notifications", True))
MOBILE_NOTIFY_SERVICE = str(OPTIONS.get("mobile_notify_service", "") or "").strip()
MOBILE_NOTIFY_SERVICES = _parse_service_list(OPTIONS.get("mobile_notify_services", ""))
if MOBILE_NOTIFY_SERVICE and MOBILE_NOTIFY_SERVICE not in MOBILE_NOTIFY_SERVICES:
    MOBILE_NOTIFY_SERVICES.append(MOBILE_NOTIFY_SERVICE)
ALEXA_NOTIFY_SERVICE = str(OPTIONS.get("alexa_notify_service", "") or "").strip()
ALEXA_ALERT_TYPES = {
    item.strip()
    for item in str(OPTIONS.get("alexa_alert_types", "temperature,active_timer") or "").split(",")
    if item.strip()
}
TELEGRAM_ACTIVITY_NOTIFICATIONS = bool(OPTIONS.get("telegram_activity_notifications", True))
TELEGRAM_CHAT_ID_RAW = str(OPTIONS.get("telegram_chat_id", "-5472345660") or "").strip()
try:
    TELEGRAM_CHAT_ID: int | str = int(TELEGRAM_CHAT_ID_RAW)
except (TypeError, ValueError):
    TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID_RAW
TELEGRAM_ACTIVITY_TYPES = {
    item.strip().lower()
    for item in str(
        OPTIONS.get(
            "telegram_activity_types",
            "timer,feeding,sleep,diaper,tummy,temperature,weight,height,note,pumping,medication",
        )
        or ""
    ).split(",")
    if item.strip()
}
ALERTS_CONFIG = {
    "enabled": bool(OPTIONS.get("alerts_enabled", True)),
    "feeding_minutes": int(OPTIONS.get("feeding_alert_minutes", 240) or 240),
    "active_timer_minutes": int(OPTIONS.get("active_timer_alert_minutes", 180) or 180),
    "room_temp_min": float(OPTIONS.get("room_temp_min", 18) or 18),
    "room_temp_max": float(OPTIONS.get("room_temp_max", 27) or 27),
    "diaper_stock_low_threshold": int(OPTIONS.get("diaper_stock_low_threshold", 10) or 10),
}

def _initial_medication_alert_settings() -> dict:
    values = {
        "enabled": True,
        "minutes_before": 20,
        "alert_at_due": True,
        "ha_mobile": True,
        "telegram": True,
    }
    if APP_SETTINGS_PATH.exists():
        try:
            payload = json.loads(APP_SETTINGS_PATH.read_text())
            stored = payload.get("medication_alerts") if isinstance(payload, dict) else None
            if isinstance(stored, dict):
                values["enabled"] = bool(stored.get("enabled", values["enabled"]))
                values["minutes_before"] = max(0, min(120, int(stored.get("minutes_before", values["minutes_before"]))))
                values["alert_at_due"] = bool(stored.get("alert_at_due", values["alert_at_due"]))
                values["ha_mobile"] = bool(stored.get("ha_mobile", values["ha_mobile"]))
                values["telegram"] = bool(stored.get("telegram", values["telegram"]))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            logger.warning("No se pudieron leer los ajustes de avisos de medicación")
    return values


MEDICATION_ALERT_SETTINGS = _initial_medication_alert_settings()


def _initial_handoff_settings() -> dict:
    values = {"enabled_child_ids": [], "started_at": {}}
    if APP_SETTINGS_PATH.exists():
        try:
            payload = json.loads(APP_SETTINGS_PATH.read_text())
            stored = payload.get("handoff") if isinstance(payload, dict) else None
            if isinstance(stored, dict) and isinstance(stored.get("enabled_child_ids"), list):
                values["enabled_child_ids"] = [int(value) for value in stored["enabled_child_ids"] if int(value) > 0]
                if isinstance(stored.get("started_at"), dict):
                    values["started_at"] = {str(key): str(value) for key, value in stored["started_at"].items() if value}
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            logger.warning("No se pudieron leer los ajustes de relevo")
    return values


def _initial_timer_reminder_settings() -> dict:
    values = {"enabled": True, "feeding_minutes": 90, "tummy_minutes": 30, "snooze_minutes": 30}
    if APP_SETTINGS_PATH.exists():
        try:
            payload = json.loads(APP_SETTINGS_PATH.read_text())
            stored = payload.get("timer_reminders") if isinstance(payload, dict) else None
            if isinstance(stored, dict):
                values["enabled"] = bool(stored.get("enabled", True))
                values["feeding_minutes"] = max(15, min(360, int(stored.get("feeding_minutes", 90))))
                values["tummy_minutes"] = max(5, min(180, int(stored.get("tummy_minutes", 30))))
                values["snooze_minutes"] = max(5, min(120, int(stored.get("snooze_minutes", 30))))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            logger.warning("No se pudieron leer los ajustes de recordatorio de temporizadores")
    return values


HANDOFF_SETTINGS = _initial_handoff_settings()
TIMER_REMINDER_SETTINGS = _initial_timer_reminder_settings()


def _handoff_enabled(child_id: int) -> bool:
    return int(child_id) in {int(value) for value in HANDOFF_SETTINGS.get("enabled_child_ids", [])}


def _medication_regimen_key(child_id: int, name: str) -> str:
    return f"{int(child_id)}::{str(name or '').strip().casefold()}"


def _normalize_medication_schedule_type(value, interval: str = "", slots=None) -> str:
    schedule_type = str(value or "").strip().lower()
    if schedule_type in {"interval", "daily_slots", "prn"}:
        return schedule_type
    if interval:
        return "interval"
    if isinstance(slots, list) and any(isinstance(slot, dict) and slot.get("enabled", True) and slot.get("time") for slot in slots):
        return "daily_slots"
    return "prn"


def _normalize_medication_slots(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    result: list[dict] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or f"slot_{index + 1}").strip()
        label = str(item.get("label") or key).strip()
        raw_time = str(item.get("time") or "").strip()
        if not key or key in seen or not re.fullmatch(r"\d{2}:\d{2}", raw_time):
            continue
        try:
            hours, minutes = (int(part) for part in raw_time.split(":", 1))
        except (TypeError, ValueError):
            continue
        if not (0 <= hours <= 23 and 0 <= minutes <= 59):
            continue
        seen.add(key)
        result.append({
            "key": key,
            "label": label or key,
            "time": f"{hours:02d}:{minutes:02d}",
            "enabled": bool(item.get("enabled", True)),
        })
    return result


def _initial_medication_regimens() -> dict[str, dict]:
    if not APP_SETTINGS_PATH.exists():
        return {}
    try:
        payload = json.loads(APP_SETTINGS_PATH.read_text())
        stored = payload.get("medication_regimens") if isinstance(payload, dict) else None
        if not isinstance(stored, dict):
            return {}
        result: dict[str, dict] = {}
        for key, value in stored.items():
            if not isinstance(value, dict):
                continue
            try:
                child_id = int(value.get("child_id") or str(key).split("::", 1)[0])
            except (TypeError, ValueError):
                continue
            name = str(value.get("name") or "").strip()
            if child_id <= 0 or not name:
                continue
            normalized = _medication_regimen_key(child_id, name)
            interval = str(value.get("next_dose_interval") or "").strip()
            slots = _normalize_medication_slots(value.get("slots"))
            result[normalized] = {
                "child_id": child_id,
                "name": name,
                "dosage": value.get("dosage"),
                "dosage_unit": str(value.get("dosage_unit") or "").strip(),
                "schedule_type": _normalize_medication_schedule_type(value.get("schedule_type"), interval, slots),
                "next_dose_interval": interval,
                "slots": slots,
                "last_scheduled_for": value.get("last_scheduled_for"),
                "active": bool(value.get("active", True)),
                "updated_at": value.get("updated_at"),
            }
        return result
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        logger.warning("No se pudieron leer las plantillas de pautas de medicación")
        return {}


MEDICATION_REGIMENS = _initial_medication_regimens()
try:
    _save_app_settings({
        "medication_alerts": MEDICATION_ALERT_SETTINGS,
        "medication_regimens": MEDICATION_REGIMENS,
    })
except OSError:
    logger.warning("No se pudieron persistir los ajustes de medicación")


def _medication_regimen_for(child_id: int, name: str) -> dict | None:
    regimen = MEDICATION_REGIMENS.get(_medication_regimen_key(child_id, name))
    if not isinstance(regimen, dict) or not regimen.get("active", True):
        return None
    return regimen


def _effective_medication(child_id: int, medication: dict) -> dict:
    effective = dict(medication or {})
    regimen = _medication_regimen_for(child_id, effective.get("name", ""))
    if regimen:
        if regimen.get("dosage") not in (None, ""):
            effective["dosage"] = regimen.get("dosage")
        if regimen.get("dosage_unit"):
            effective["dosage_unit"] = regimen.get("dosage_unit")
        if regimen.get("next_dose_interval"):
            effective["next_dose_interval"] = regimen.get("next_dose_interval")
        effective["schedule_type"] = regimen.get("schedule_type")
        effective["slots"] = regimen.get("slots") or []
        effective["last_scheduled_for"] = regimen.get("last_scheduled_for")
    return effective

NIGHT_MODE_CONFIG = {
    "enabled": bool(OPTIONS.get("night_mode_enabled", True)),
    "start": str(OPTIONS.get("night_mode_start", "22:00") or "22:00"),
    "end": str(OPTIONS.get("night_mode_end", "07:00") or "07:00"),
}

STATIC_DIR = Path(__file__).parent.parent / "static"

# --- App lifecycle ---

http_client: httpx.AsyncClient | None = None
ha_client: httpx.AsyncClient | None = None
active_alerts: dict[str, dict] = {}
timer_reminder_snoozes: dict[str, datetime] = {}
child_name_cache: dict[int, str] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, ha_client
    _init_audit_db()
    http_client = httpx.AsyncClient(
        base_url=BABY_BUDDY_URL,
        headers={
            "Authorization": f"Token {BABY_BUDDY_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=15.0,
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
    )
    ha_client = httpx.AsyncClient(
        base_url="http://supervisor/core/api/",
        headers={
            "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
            "Content-Type": "application/json",
        },
        timeout=10.0,
        limits=httpx.Limits(max_connections=5, max_keepalive_connections=3),
    )
    alert_task = None
    if (
        ALERTS_CONFIG.get("enabled")
        and SUPERVISOR_TOKEN
        and (HOME_ASSISTANT_ALERT_NOTIFICATIONS or MOBILE_NOTIFY_SERVICES or ALEXA_NOTIFY_SERVICE)
        and not DEMO_MODE
    ):
        alert_task = asyncio.create_task(_alert_monitor_loop())
    try:
        yield
    finally:
        if alert_task:
            alert_task.cancel()
            try:
                await alert_task
            except asyncio.CancelledError:
                pass
        await http_client.aclose()
        await ha_client.aclose()


app = FastAPI(lifespan=lifespan)

# --- Helpers ---


def _require_home_assistant_api():
    if not SUPERVISOR_TOKEN:
        raise HTTPException(503, "Home Assistant API access is not available")


async def _get_ha_state(entity_id: str) -> dict:
    _require_home_assistant_api()
    try:
        response = await ha_client.get(f"states/{entity_id}")
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Home Assistant")
    except httpx.TimeoutException:
        raise HTTPException(504, "Home Assistant request timed out")
    if response.status_code == 404:
        raise HTTPException(404, f"Entity not found: {entity_id}")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    return response.json()


async def _call_ha_service(service_name: str, data: dict) -> list | dict:
    _require_home_assistant_api()
    if "." not in service_name:
        raise HTTPException(500, f"Invalid Home Assistant service: {service_name}")
    domain, service = service_name.split(".", 1)
    try:
        response = await ha_client.post(f"services/{domain}/{service}", json=data)
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Home Assistant")
    except httpx.TimeoutException:
        raise HTTPException(504, "Home Assistant request timed out")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    if not response.content:
        return {}
    try:
        return response.json()
    except json.JSONDecodeError:
        return {}


async def _ha_ws_command(command: dict) -> dict:
    """Run a native Home Assistant WebSocket command through Supervisor."""
    _require_home_assistant_api()
    payload = dict(command)
    payload["id"] = 1
    try:
        async with websockets.connect(
            "ws://supervisor/core/websocket",
            additional_headers={"Authorization": f"Bearer {SUPERVISOR_TOKEN}"},
            open_timeout=10,
            close_timeout=5,
            ping_interval=20,
        ) as websocket:
            first = json.loads(await asyncio.wait_for(websocket.recv(), timeout=10))
            if first.get("type") == "auth_required":
                await websocket.send(json.dumps({"type": "auth", "access_token": SUPERVISOR_TOKEN}))
                auth = json.loads(await asyncio.wait_for(websocket.recv(), timeout=10))
                if auth.get("type") != "auth_ok":
                    raise HTTPException(502, f"Home Assistant WebSocket authentication failed: {auth}")
            elif first.get("type") != "auth_ok":
                raise HTTPException(502, f"Unexpected Home Assistant WebSocket response: {first}")

            await websocket.send(json.dumps(payload))
            while True:
                result = json.loads(await asyncio.wait_for(websocket.recv(), timeout=15))
                if result.get("id") != 1:
                    continue
                if result.get("type") != "result":
                    continue
                if not result.get("success"):
                    error = result.get("error") or {}
                    raise HTTPException(502, error.get("message") or str(error) or "Home Assistant rejected the calendar operation")
                return result.get("result") or {}
    except HTTPException:
        raise
    except (OSError, asyncio.TimeoutError, websockets.WebSocketException) as exc:
        raise HTTPException(502, f"Home Assistant WebSocket error: {exc}")


async def _call_ha_service_response(service_name: str, data: dict) -> dict:
    """Call a Home Assistant action and request its response data.

    WebSocket is preferred because it is the native HA path. A REST fallback
    keeps Grocy consumption working even if the Supervisor WebSocket proxy is
    temporarily unavailable.
    """
    if "." not in service_name:
        raise HTTPException(500, f"Invalid Home Assistant service: {service_name}")
    domain, service = service_name.split(".", 1)
    try:
        result = await _ha_ws_command({
            "type": "call_service",
            "domain": domain,
            "service": service,
            "service_data": data,
            "return_response": True,
        })
        response = result.get("response") if isinstance(result, dict) else None
        if isinstance(response, dict):
            return response
        if isinstance(result, dict):
            return result
    except HTTPException as websocket_error:
        logger.warning(
            "WebSocket action response failed for %s; trying REST: %s",
            service_name,
            websocket_error.detail,
        )

    _require_home_assistant_api()
    try:
        response = await ha_client.post(
            f"services/{domain}/{service}?return_response",
            json=data,
        )
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Home Assistant")
    except httpx.TimeoutException:
        raise HTTPException(504, "Home Assistant request timed out")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    if not response.content:
        return {}
    try:
        payload = response.json()
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


async def _get_ha_services() -> set[str]:
    _require_home_assistant_api()
    try:
        response = await ha_client.get("services")
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Home Assistant")
    except httpx.TimeoutException:
        raise HTTPException(504, "Home Assistant request timed out")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    result: set[str] = set()
    payload = response.json()
    if isinstance(payload, list):
        for domain_item in payload:
            if not isinstance(domain_item, dict):
                continue
            domain = str(domain_item.get("domain") or "").strip()
            services = domain_item.get("services", [])
            if isinstance(services, dict):
                names = services.keys()
            elif isinstance(services, list):
                names = services
            else:
                names = []
            for service in names:
                service_name = str(service or "").strip()
                if domain and service_name:
                    result.add(f"{domain}.{service_name}")
    return result


async def _calendar_write_capability(entity_id: str) -> dict:
    state = await _get_ha_state(entity_id)
    attributes = state.get("attributes", {}) or {}
    try:
        supported_features = int(attributes.get("supported_features", 0) or 0)
    except (TypeError, ValueError):
        supported_features = 0

    can_create = bool(supported_features & 1)
    can_delete = bool(supported_features & 2)
    can_update_native = bool(supported_features & 4)
    # Google Calendar currently exposes create + delete but not UPDATE_EVENT.
    # In that case the dashboard can still edit safely by creating the revised
    # event, confirming it exists, and only then deleting the original.
    can_replace = can_create and can_delete
    can_update = can_update_native or can_replace
    update_mode = "native" if can_update_native else ("replace" if can_replace else "none")
    services: set[str] = set()
    try:
        services = await _get_ha_services()
    except HTTPException:
        pass
    available_actions = [
        action for action in ("calendar.create_event", "google.create_event")
        if action in services
    ]
    create_error = ""
    if not can_create:
        create_error = (
            f"{entity_id} está en solo lectura. En Ajustes → Dispositivos y servicios → "
            "Google Calendar → Configurar, activa el acceso de lectura y escritura y vuelve "
            "a autorizar la cuenta."
        )
    return {
        "writable": can_create,
        "can_create": can_create,
        "can_update": can_update,
        "can_update_native": can_update_native,
        "can_replace": can_replace,
        "update_mode": update_mode,
        "can_delete": can_delete,
        "write_error": create_error,
        "supported_features": supported_features,
        "available_actions": available_actions,
    }


async def _safe_state(entity_id: str) -> dict | None:
    if not entity_id:
        return None
    try:
        return await _get_ha_state(entity_id)
    except HTTPException:
        return None


def _number_or_none(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def _active_diaper_stock(child_id: int) -> dict:
    size_entity = DIAPER_SIZE_ENTITIES.get(child_id, "")
    room_stock_entity = _room_config_for_child(child_id).get("diaper_stock_entity", "")
    size_state, grocy_state = await asyncio.gather(
        _safe_state(size_entity),
        _safe_state(GROCY_STOCK_ENTITY),
    )
    size = str(size_state.get("state") or "").strip() if size_state else ""
    product_id = DIAPER_PRODUCT_IDS.get(size)

    if grocy_state and product_id:
        attributes = grocy_state.get("attributes", {}) or {}
        if not attributes.get("error"):
            products = attributes.get("products", [])
            if isinstance(products, list):
                total = 0.0
                for item in products:
                    if not isinstance(item, dict):
                        continue
                    try:
                        item_product_id = int(item.get("product_id") or 0)
                    except (TypeError, ValueError):
                        continue
                    if item_product_id == product_id:
                        total += _number_or_none(item.get("amount")) or 0.0
                return {
                    "available": True,
                    "stock": total,
                    "size": size,
                    "product_id": product_id,
                    "source": GROCY_STOCK_ENTITY,
                }

    # Compatibility fallback for a dedicated stock sensor configured in room_entities.
    fallback_state = await _safe_state(room_stock_entity) if room_stock_entity else None
    fallback_stock = _number_or_none(fallback_state.get("state")) if fallback_state else None
    return {
        "available": fallback_stock is not None,
        "stock": fallback_stock,
        "size": size,
        "product_id": product_id,
        "source": room_stock_entity,
    }




async def _all_diaper_stocks() -> dict:
    """Return stock for every diaper size mapped to a Grocy product."""
    grocy_state = await _safe_state(GROCY_STOCK_ENTITY) if GROCY_STOCK_ENTITY else None
    source_available = False
    totals: dict[int, float] = {}
    error = ""

    if grocy_state:
        attributes = grocy_state.get("attributes", {}) or {}
        error = str(attributes.get("error") or "").strip()
        products = attributes.get("products", [])
        if not error and isinstance(products, list):
            source_available = True
            for item in products:
                if not isinstance(item, dict):
                    continue
                try:
                    product_id = int(item.get("product_id") or 0)
                except (TypeError, ValueError):
                    continue
                if not product_id:
                    continue
                totals[product_id] = totals.get(product_id, 0.0) + (_number_or_none(item.get("amount")) or 0.0)

    items = []
    for size, product_id in DIAPER_PRODUCT_IDS.items():
        stock = totals.get(int(product_id), 0.0) if source_available else None
        items.append({
            "size": size,
            "product_id": int(product_id),
            "stock": stock,
            "available": source_available,
        })

    return {
        "available": source_available,
        "source": GROCY_STOCK_ENTITY,
        "error": error,
        "can_add": bool(GROCY_RESTORE_SERVICE),
        "can_remove": bool(GROCY_CONSUME_SERVICE),
        "items": items,
    }



def _size_for_product(product_id: int) -> str | None:
    return next((name for name, pid in DIAPER_PRODUCT_IDS.items() if int(pid) == int(product_id)), None)


def _save_diaper_purchase_event(request: Request, product_id: int, amount: int):
    size = _size_for_product(product_id)
    if not size or amount <= 0:
        return
    user = _request_user(request)
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        connection.execute(
            "INSERT INTO diaper_purchase_events (timestamp, product_id, size, amount, user_display_name) VALUES (?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), int(product_id), size, int(amount), user["display_name"]),
        )
        connection.commit()


def _local_diaper_purchase_history(limit: int = 40) -> list[dict]:
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        rows = connection.execute(
            "SELECT id, timestamp, product_id, size, amount, user_display_name FROM diaper_purchase_events ORDER BY id DESC LIMIT ?",
            (max(1, min(int(limit), 200)),),
        ).fetchall()
    return [
        {
            "key": f"app:{row[0]}",
            "timestamp": row[1],
            "product_id": int(row[2]),
            "size": row[3],
            "amount": int(row[4]),
            "source": "app",
            "source_label": "App",
            "user": row[5] or "Acceso directo",
        }
        for row in rows
    ]


def _purchase_overrides() -> dict[str, dict]:
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        rows = connection.execute(
            "SELECT purchase_key, hidden, product_id, size, amount, updated_at FROM diaper_purchase_overrides"
        ).fetchall()
    return {
        str(row[0]): {
            "hidden": bool(row[1]),
            "product_id": row[2],
            "size": row[3],
            "amount": row[4],
            "updated_at": row[5],
        }
        for row in rows
    }


def _set_purchase_override(purchase_key: str, *, hidden: bool, product_id: int | None, size: str | None, amount: int | None):
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        connection.execute(
            """
            INSERT INTO diaper_purchase_overrides (purchase_key, hidden, product_id, size, amount, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(purchase_key) DO UPDATE SET
                hidden=excluded.hidden,
                product_id=excluded.product_id,
                size=excluded.size,
                amount=excluded.amount,
                updated_at=excluded.updated_at
            """,
            (purchase_key, 1 if hidden else 0, product_id, size, amount, datetime.now(timezone.utc).isoformat()),
        )
        connection.commit()


async def _grocy_diaper_purchase_history(limit: int = 80) -> tuple[list[dict], str]:
    if not GROCY_URL or not GROCY_API_KEY:
        return [], ""
    url = f"{GROCY_URL}/api/objects/stock_log"
    headers = {"GROCY-API-KEY": GROCY_API_KEY, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url, headers=headers)
        response.raise_for_status()
        rows = response.json()
    except Exception as exc:
        logger.warning("No se pudo consultar el diario de stock de Grocy: %s", exc)
        return [], str(exc)
    if not isinstance(rows, list):
        return [], "Respuesta de Grocy no válida"

    valid_products = {int(pid): size for size, pid in DIAPER_PRODUCT_IDS.items()}
    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            product_id = int(row.get("product_id") or 0)
        except (TypeError, ValueError):
            continue
        if product_id not in valid_products:
            continue
        transaction_type = str(row.get("transaction_type") or "").strip().lower()
        try:
            amount = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            continue
        if transaction_type != "purchase" or amount <= 0:
            continue
        booking_id = row.get("id")
        timestamp = row.get("row_created_timestamp") or row.get("purchased_date") or row.get("created_timestamp") or row.get("timestamp")
        if booking_id in (None, ""):
            continue
        items.append({
            "key": f"grocy:{booking_id}",
            "booking_id": int(booking_id),
            "timestamp": timestamp,
            "product_id": product_id,
            "size": valid_products[product_id],
            "amount": amount,
            "source": "grocy",
            "source_label": "Grocy",
            "user": "Grocy",
        })
    items.sort(key=lambda item: str(item.get("timestamp") or ""), reverse=True)
    return items[:max(1, min(int(limit), 200))], ""


def _apply_purchase_overrides(items: list[dict]) -> list[dict]:
    overrides = _purchase_overrides()
    result = []
    for item in items:
        override = overrides.get(str(item.get("key")))
        if override:
            if override.get("hidden"):
                continue
            if override.get("product_id") is not None:
                item = dict(item)
                item["product_id"] = int(override["product_id"])
                item["size"] = override.get("size") or _size_for_product(item["product_id"]) or item.get("size")
                item["amount"] = int(override.get("amount") or 0)
                item["corrected"] = True
        result.append(item)
    return result


async def _diaper_purchase_history(limit: int = 40) -> dict:
    grocy_items, error = await _grocy_diaper_purchase_history(limit)
    direct = bool(GROCY_URL and GROCY_API_KEY)
    items = grocy_items if direct and not error else _local_diaper_purchase_history(limit)
    items = _apply_purchase_overrides(items)
    return {
        "items": items,
        "source": "grocy" if direct and not error else "app",
        "source_label": "Diario de Grocy" if direct and not error else "Compras registradas desde esta app",
        "grocy_direct": direct and not error,
        "grocy_configured": direct,
        "error": error,
    }


async def _undo_grocy_booking(booking_id: int) -> None:
    if not GROCY_URL or not GROCY_API_KEY:
        raise HTTPException(409, "La conexión directa con Grocy no está configurada")
    url = f"{GROCY_URL}/api/stock/bookings/{int(booking_id)}/undo"
    headers = {"GROCY-API-KEY": GROCY_API_KEY, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(url, headers=headers)
    except Exception as exc:
        raise HTTPException(502, f"No se pudo conectar con Grocy: {exc}")
    if response.status_code not in (200, 201, 204):
        raise HTTPException(response.status_code if response.status_code < 500 else 502, f"Grocy no pudo deshacer la compra: {response.text}")


async def _apply_stock_delta(product_id: int, delta: int) -> None:
    if delta == 0:
        return
    size = _size_for_product(product_id)
    if not size:
        raise HTTPException(404, "Ese producto no está configurado como talla de pañal")
    current_payload = await _all_diaper_stocks()
    current_item = next((item for item in current_payload.get("items", []) if int(item.get("product_id") or 0) == int(product_id)), None)
    current_stock = _number_or_none((current_item or {}).get("stock"))
    if current_stock is not None and current_stock + delta < 0:
        raise HTTPException(400, f"No hay suficientes pañales de {size} para realizar esa corrección")
    service = GROCY_RESTORE_SERVICE if delta > 0 else GROCY_CONSUME_SERVICE
    if not service:
        raise HTTPException(409, "No está configurada la acción necesaria de Grocy")
    response = await _call_ha_service_response(service, {"product_id": int(product_id), "amount": abs(int(delta))})
    status = _grocy_response_status(response)
    if status is not None and status not in (200, 201, 204):
        raise HTTPException(502, f"Grocy devolvió HTTP {status}: {response.get('content', '')}")


def _grocy_response_status(payload: dict) -> int | None:
    if not isinstance(payload, dict):
        return None
    status = payload.get("status")
    if status is None and isinstance(payload.get("service_response"), dict):
        status = payload["service_response"].get("status")
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None


def _parse_datetime(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _next_daily_medication_slot(regimen: dict, administered: datetime | None, now: datetime, early_grace_minutes: int = 20):
    slots = [slot for slot in _normalize_medication_slots(regimen.get("slots")) if slot.get("enabled", True)]
    if not slots:
        return None
    slots.sort(key=lambda item: item.get("time", ""))

    local_tz = administered.tzinfo if administered and administered.tzinfo else datetime.now().astimezone().tzinfo
    now_local = now.astimezone(local_tz)
    if administered:
        reference = administered.astimezone(local_tz) + timedelta(minutes=max(0, int(early_grace_minutes or 0)))
    else:
        reference = now_local - timedelta(days=1)

    marker = _parse_datetime(regimen.get("last_scheduled_for"))
    if marker:
        marker = marker.astimezone(local_tz)
        if marker > reference:
            reference = marker

    candidates: list[tuple[datetime, dict]] = []
    base = reference - timedelta(days=1)
    for day_offset in range(4):
        day = base + timedelta(days=day_offset)
        for slot in slots:
            try:
                hours, minutes = (int(part) for part in slot["time"].split(":", 1))
            except (KeyError, TypeError, ValueError):
                continue
            candidate = day.replace(hour=hours, minute=minutes, second=0, microsecond=0)
            if candidate > reference:
                candidates.append((candidate, slot))
    candidates.sort(key=lambda item: item[0])
    if not candidates:
        return None

    due = [item for item in candidates if item[0] <= now_local]
    return due[-1] if due else candidates[0]


def _calendar_start(event: dict) -> tuple[str | None, bool]:
    raw = event.get("start")
    if isinstance(raw, dict):
        if raw.get("dateTime"):
            return str(raw["dateTime"]), False
        if raw.get("date"):
            return str(raw["date"]), True
    if isinstance(raw, str):
        return raw, len(raw) == 10
    return None, False


def _calendar_end(event: dict) -> tuple[str | None, bool]:
    raw = event.get("end")
    if isinstance(raw, dict):
        if raw.get("dateTime"):
            return str(raw["dateTime"]), False
        if raw.get("date"):
            return str(raw["date"]), True
    if isinstance(raw, str):
        return raw, len(raw) == 10
    return None, False


def _calendar_sort_key(event: dict) -> str:
    start, _ = _calendar_start(event)
    return start or "9999-12-31T23:59:59"


async def _get_calendar_events(entity_id: str) -> list[dict]:
    _require_home_assistant_api()
    start = datetime.now(timezone.utc)
    end = start + timedelta(days=CALENDAR_DAYS_AHEAD)
    try:
        response = await ha_client.get(
            f"calendars/{entity_id}",
            params={"start": start.isoformat(), "end": end.isoformat()},
        )
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Home Assistant")
    except httpx.TimeoutException:
        raise HTTPException(504, "Calendar request timed out")
    if response.status_code == 404:
        raise HTTPException(404, f"Calendar not found: {entity_id}")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    try:
        payload = response.json()
    except json.JSONDecodeError:
        raise HTTPException(502, "Home Assistant returned invalid calendar data")
    if not isinstance(payload, list):
        return []
    return sorted(payload, key=_calendar_sort_key)


async def _baby_buddy_results(resource: str, params: dict | None = None) -> list[dict]:
    try:
        response = await http_client.get(f"/api/{resource}/", params=params or {})
    except (httpx.ConnectError, httpx.TimeoutException):
        return []
    if response.status_code >= 400:
        return []
    try:
        payload = response.json()
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        results = payload.get("results", [])
        return results if isinstance(results, list) else []
    return payload if isinstance(payload, list) else []


def _timer_child_id(timer: dict) -> int:
    raw = timer.get("child")
    if isinstance(raw, dict):
        raw = raw.get("id")
    try:
        return int(raw or 0)
    except (TypeError, ValueError):
        return 0


async def _consume_diaper_for_entry(payload: dict, result: dict) -> dict:
    """Consume one active-size diaper immediately and mark the change as processed."""
    child_id = _entry_child_id(payload, result)
    entry_id = result.get("id") or payload.get("id")
    if not child_id or entry_id in (None, ""):
        return {"consumed": False, "reason": "missing child or change id"}
    if not GROCY_CONSUME_SERVICE:
        return {"consumed": False, "reason": "consume service not configured"}

    size_entity = DIAPER_SIZE_ENTITIES.get(child_id, "")
    processed_entity = DIAPER_LAST_PROCESSED_ENTITIES.get(child_id, "")
    requested_size = str(payload.get("_dashboard_diaper_size") or "").strip()
    size_state = await _safe_state(size_entity) if size_entity and not requested_size else None
    size = requested_size or str((size_state or {}).get("state") or "").strip()
    product_id = DIAPER_PRODUCT_IDS.get(size)
    if not product_id:
        await _call_ha_service(
            "persistent_notification.create",
            {
                "notification_id": f"baby_buddy_grocy_no_size_{child_id}",
                "title": "No se pudo descontar el pañal",
                "message": f"El cambio {entry_id} de {await _child_name(child_id)} se guardó, pero la talla activa «{size or 'sin definir'}» no tiene producto de Grocy.",
            },
        )
        return {"consumed": False, "reason": "unknown size"}

    try:
        grocy_response = await _call_ha_service_response(
            GROCY_CONSUME_SERVICE,
            {"product_id": product_id, "amount": 1},
        )
        # REST commands return status/content/headers as their action response.
        status = grocy_response.get("status") if isinstance(grocy_response, dict) else None
        if status is None and isinstance(grocy_response.get("service_response"), dict):
            status = grocy_response["service_response"].get("status")
        if status is not None and int(status) not in (200, 201, 204):
            raise HTTPException(502, f"Grocy devolvió HTTP {status}: {grocy_response.get('content', '')}")
        if processed_entity:
            await _call_ha_service(
                "input_text.set_value",
                {"entity_id": processed_entity, "value": str(entry_id)},
            )
        if GROCY_STOCK_ENTITY:
            try:
                await _call_ha_service("homeassistant.update_entity", {"entity_id": GROCY_STOCK_ENTITY})
            except HTTPException:
                pass
        for notification_id in (
            f"baby_buddy_grocy_no_size_{child_id}",
            f"baby_buddy_grocy_error_{child_id}",
        ):
            try:
                await _call_ha_service("persistent_notification.dismiss", {"notification_id": notification_id})
            except HTTPException:
                pass
        return {"consumed": True, "size": size, "product_id": product_id}
    except HTTPException as exc:
        try:
            await _call_ha_service(
                "persistent_notification.create",
                {
                    "notification_id": f"baby_buddy_grocy_error_{child_id}",
                    "title": "Error al descontar el pañal",
                    "message": f"El cambio {entry_id} de {await _child_name(child_id)} se guardó, pero Grocy rechazó el consumo de {size}: {exc.detail}",
                },
            )
        except HTTPException:
            pass
        logger.warning("No se pudo descontar el pañal %s de %s: %s", entry_id, child_id, exc.detail)
        return {"consumed": False, "reason": str(exc.detail)}


def _notification_id(key: str) -> str:
    safe = "".join(ch if ch.isalnum() else "_" for ch in key.lower())
    return f"baby_buddy_{safe}"[:180]




def _coerce_child_id(value) -> int:
    if isinstance(value, dict):
        value = value.get("id")
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _child_enabled(child_id: int) -> bool:
    return int(child_id or 0) not in DISABLED_CHILD_IDS


def _reconcile_child_visibility(children: list[dict]):
    global KNOWN_CHILD_IDS, DISABLED_CHILD_IDS
    current_ids = {_coerce_child_id(item) for item in children if _coerce_child_id(item) > 0}
    changed = False
    if KNOWN_CHILD_IDS is None:
        KNOWN_CHILD_IDS = set(current_ids)
        changed = True
    else:
        new_ids = current_ids - KNOWN_CHILD_IDS
        if new_ids:
            # Perfiles creados más adelante aparecen en Ajustes pero comienzan
            # ocultos para evitar alarmas inesperadas hasta activarlos.
            DISABLED_CHILD_IDS.update(new_ids)
            KNOWN_CHILD_IDS.update(new_ids)
            changed = True
    if changed:
        try:
            _save_app_settings()
        except OSError:
            logger.warning("No se pudieron persistir los bebés detectados")


def _room_config_for_child(child_id: int) -> dict[str, str]:
    config = ROOM_ENTITIES.get(child_id)
    if config:
        return config
    if SHARED_ROOM_CHILD_ID > 0:
        return ROOM_ENTITIES.get(SHARED_ROOM_CHILD_ID, {})
    return {}


async def _child_name(child_id: int) -> str:
    if child_id <= 0:
        child_id = DEFAULT_CHILD_ID
    if child_id in child_name_cache:
        return child_name_cache[child_id]
    try:
        # El nombre real de Baby Buddy tiene prioridad sobre los alias heredados
        # de config.yaml, de modo que renombrar el perfil desde Ajustes se refleja
        # también en alertas y Telegram sin tocar YAML.
        children = await _all_children_raw()
        child = next((item for item in children if _coerce_child_id(item) == child_id), None)
        if child:
            name = " ".join(
                part.strip() for part in (str(child.get("first_name") or ""), str(child.get("last_name") or ""))
                if part.strip()
            )
            if name:
                child_name_cache[child_id] = name
                return name
    except Exception:
        pass
    configured_name = CHILD_NAMES.get(child_id)
    if configured_name:
        child_name_cache[child_id] = configured_name
        return configured_name
    try:
        response = await http_client.get(f"/api/children/{child_id}/")
        if response.status_code < 400:
            payload = response.json()
            if isinstance(payload, dict):
                name = str(
                    payload.get("first_name")
                    or payload.get("name")
                    or payload.get("full_name")
                    or ""
                ).strip()
                if name:
                    child_name_cache[child_id] = name
                    return name
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError):
        pass
    return f"Bebé {child_id}"


def _clock_text(*values) -> str:
    for value in values:
        parsed = _parse_datetime(value)
        if parsed:
            return parsed.strftime("%H:%M")
    return datetime.now().astimezone().strftime("%H:%M")


def _duration_seconds(start, end) -> int:
    start_dt = _parse_datetime(start)
    end_dt = _parse_datetime(end)
    if not start_dt or not end_dt:
        return 0
    return max(0, int((end_dt - start_dt).total_seconds()))


def _duration_text(start, end) -> str:
    seconds = _duration_seconds(start, end)
    if seconds <= 0:
        return ""
    minutes = max(1, round(seconds / 60))
    hours, remainder = divmod(minutes, 60)
    if hours:
        return f"{hours} h {remainder} min" if remainder else f"{hours} h"
    return f"{minutes} min"


def _human_feeding_type(value) -> str:
    labels = {
        "breast milk": "leche materna",
        "formula": "fórmula",
        "fortified breast milk": "leche materna enriquecida",
        "solid food": "sólidos",
    }
    text = str(value or "").strip().lower()
    return labels.get(text, text)


def _human_feeding_method(value) -> str:
    labels = {
        "bottle": "biberón",
        "left breast": "pecho izquierdo",
        "right breast": "pecho derecho",
        "both breasts": "ambos pechos",
        "parent fed": "alimentado por adulto",
        "self fed": "come solo",
    }
    text = str(value or "").strip().lower()
    return labels.get(text, text)


def _timer_kind(name: str) -> tuple[str, str]:
    value = str(name or "").strip().lower()
    if "sleep" in value or "sueño" in value or "sueno" in value or "siesta" in value:
        return "sleep", "el sueño"
    if "tummy" in value or "boca abajo" in value:
        return "tummy", "el tiempo boca abajo"
    if "feed" in value or "toma" in value:
        return "feeding", "una toma"
    return "timer", f"la actividad «{name or 'Temporizador'}»"


def _entry_child_id(payload: dict, result: dict) -> int:
    for source in (result, payload):
        child_id = _coerce_child_id(source.get("child"))
        if child_id:
            return child_id
    return 0


def _message_parts(parts: list[str]) -> str:
    return " · ".join(str(part).strip() for part in parts if str(part or "").strip()) + "."


async def _send_telegram_activity(message: str):
    if not (
        TELEGRAM_ACTIVITY_NOTIFICATIONS
        and TELEGRAM_CHAT_ID not in ("", 0)
        and SUPERVISOR_TOKEN
        and message
    ):
        return
    try:
        await _call_ha_service(
            "telegram_bot.send_message",
            {
                "chat_id": TELEGRAM_CHAT_ID,
                "message": message,
                "parse_mode": "plain_text",
                "message_tag": "baby_buddy_app",
            },
        )
    except HTTPException as exc:
        logger.warning("No se pudo enviar el aviso de Telegram de Baby Buddy: %s", exc.detail)
    except Exception as exc:  # Never break a Baby Buddy write because Telegram failed.
        logger.warning("Error inesperado enviando Telegram de Baby Buddy: %s", exc)


async def _notify_created_entry(resource: str, payload: dict, result: dict):
    resource = resource.strip("/").split("/", 1)[0]
    type_map = {
        "timers": "timer",
        "feedings": "feeding",
        "sleep": "sleep",
        "changes": "diaper",
        "tummy-times": "tummy",
        "temperature": "temperature",
        "weight": "weight",
        "height": "height",
        "notes": "note",
        "pumping": "pumping",
        "medication": "medication",
    }
    notification_type = type_map.get(resource)
    if not notification_type or notification_type not in TELEGRAM_ACTIVITY_TYPES:
        return

    child_id = _entry_child_id(payload, result)
    if child_id > 0 and not _child_enabled(child_id):
        return
    child_name = await _child_name(child_id)
    combined = {**payload, **result}
    message = ""

    if resource == "timers":
        timer_name = str(combined.get("name") or "Temporizador")
        timer_type, activity_text = _timer_kind(timer_name)
        if timer_type not in TELEGRAM_ACTIVITY_TYPES and "timer" not in TELEGRAM_ACTIVITY_TYPES:
            return
        icon = {"feeding": "🍼", "sleep": "😴", "tummy": "🌞"}.get(timer_type, "▶️")
        message = _message_parts([
            f"{icon} Se ha iniciado {activity_text} de {child_name}",
            _clock_text(combined.get("start")),
        ])

    elif resource == "feedings":
        finished_timer = payload.get("timer") not in (None, "", 0, False)
        parts = [
            f"{'✅ Ha terminado' if finished_timer else '🍼 Se ha registrado'} una toma de {child_name}"
        ]
        amount = combined.get("amount")
        try:
            amount_value = float(amount) if amount not in (None, "") else 0
        except (TypeError, ValueError):
            amount_value = 0
        if amount_value > 0:
            parts.append(f"{amount_value:g} ml")
        feeding_type = _human_feeding_type(combined.get("type"))
        method = _human_feeding_method(combined.get("method"))
        if feeding_type:
            parts.append(feeding_type)
        if method:
            parts.append(method)
        duration = _duration_text(combined.get("start"), combined.get("end"))
        if duration:
            parts.append(duration)
        parts.append(_clock_text(combined.get("end"), combined.get("start")))
        message = _message_parts(parts)

    elif resource == "sleep":
        finished_timer = payload.get("timer") not in (None, "", 0, False)
        is_nap = bool(combined.get("nap"))
        activity = "la siesta" if is_nap else "el sueño"
        icon = "☀️" if finished_timer else "😴"
        verb = "Ha terminado" if finished_timer else "Se ha registrado"
        parts = [f"{icon} {verb} {activity} de {child_name}"]
        duration = _duration_text(combined.get("start"), combined.get("end"))
        if duration:
            parts.append(duration)
        parts.append(_clock_text(combined.get("end"), combined.get("start")))
        message = _message_parts(parts)

    elif resource == "tummy-times":
        finished_timer = payload.get("timer") not in (None, "", 0, False)
        verb = "Ha terminado" if finished_timer else "Se ha registrado"
        parts = [f"🌞 {verb} el tiempo boca abajo de {child_name}"]
        duration = _duration_text(combined.get("start"), combined.get("end"))
        if duration:
            parts.append(duration)
        parts.append(_clock_text(combined.get("end"), combined.get("start")))
        message = _message_parts(parts)

    elif resource == "changes":
        wet = bool(combined.get("wet"))
        solid = bool(combined.get("solid"))
        if wet and solid:
            contents = "pis y caca"
        elif wet:
            contents = "pis"
        elif solid:
            contents = "caca"
        else:
            contents = "sin contenido indicado"
        message = _message_parts([
            f"🧷 Se ha cambiado el pañal de {child_name}",
            contents,
            _clock_text(combined.get("time")),
        ])

    elif resource == "temperature":
        value = combined.get("temperature")
        message = _message_parts([
            f"🌡 Se ha registrado la temperatura de {child_name}",
            f"{value} °C" if value not in (None, "") else "",
            _clock_text(combined.get("time")),
        ])

    elif resource == "weight":
        value = combined.get("weight")
        message = _message_parts([
            f"⚖️ Se ha registrado el peso de {child_name}",
            f"{value} kg" if value not in (None, "") else "",
            _clock_text(combined.get("time")),
        ])

    elif resource == "height":
        value = combined.get("height")
        message = _message_parts([
            f"📏 Se ha registrado la altura de {child_name}",
            f"{value} cm" if value not in (None, "") else "",
            _clock_text(combined.get("time")),
        ])

    elif resource == "notes":
        note_text = str(combined.get("note") or combined.get("text") or "").strip()
        if len(note_text) > 120:
            note_text = note_text[:117].rstrip() + "…"
        message = _message_parts([
            f"📝 Se ha añadido una nota de {child_name}",
            note_text,
            _clock_text(combined.get("time")),
        ])

    elif resource == "pumping":
        amount = combined.get("amount")
        message = _message_parts([
            f"🥛 Se ha registrado una extracción para {child_name}",
            f"{amount} ml" if amount not in (None, "") else "",
            _clock_text(combined.get("end"), combined.get("start")),
        ])

    elif resource == "medication":
        name = str(combined.get("name") or "Medicamento").strip()
        dosage = combined.get("dosage")
        unit = str(combined.get("dosage_unit") or "").strip()
        dose_text = ""
        if dosage not in (None, ""):
            dose_text = f"{dosage} {unit}".strip()
        interval = str(combined.get("next_dose_interval") or "").strip()
        regimen = _medication_regimen_for(child_id, name) if child_id else None
        schedule_type = _normalize_medication_schedule_type(
            regimen.get("schedule_type") if regimen else None,
            interval,
            regimen.get("slots") if regimen else None,
        )
        if schedule_type == "daily_slots":
            enabled_labels = [slot.get("label") for slot in _normalize_medication_slots(regimen.get("slots")) if slot.get("enabled", True)]
            schedule_text = "Horarios: " + " · ".join(str(label) for label in enabled_labels if label)
        elif schedule_type == "prn":
            schedule_text = "Según necesidad · sin avisos"
        else:
            schedule_text = f"Próxima pauta: {interval}" if interval else ""
        message = _message_parts([
            f"💊 Se ha administrado {name} a {child_name}",
            dose_text,
            schedule_text,
            _clock_text(combined.get("time")),
        ])

    if message:
        await _send_telegram_activity(message)


async def _send_alert(alert: dict):
    notification_id = _notification_id(alert["key"])
    title = alert.get("title", "Aviso de Baby Buddy")
    message = alert.get("message", "")
    is_medication = alert.get("type") == "medication"
    allow_ha_mobile = (not is_medication) or MEDICATION_ALERT_SETTINGS.get("ha_mobile", True)

    if HOME_ASSISTANT_ALERT_NOTIFICATIONS and allow_ha_mobile:
        try:
            await _call_ha_service(
                "persistent_notification.create",
                {
                    "title": title,
                    "message": message,
                    "notification_id": notification_id,
                },
            )
        except HTTPException:
            pass

    if allow_ha_mobile:
        for mobile_service in MOBILE_NOTIFY_SERVICES:
            try:
                await _call_ha_service(
                    mobile_service,
                    {
                        "title": title,
                        "message": message,
                        "data": {"tag": notification_id},
                    },
                )
            except HTTPException:
                pass

    if is_medication and MEDICATION_ALERT_SETTINGS.get("telegram", True):
        await _send_telegram_activity(f"💊 {title} · {message}")

    if ALEXA_NOTIFY_SERVICE and alert.get("type") in ALEXA_ALERT_TYPES:
        try:
            await _call_ha_service(
                ALEXA_NOTIFY_SERVICE,
                {
                    "message": alert.get("alexa_message", message),
                    "data": {"type": "announce"},
                },
            )
        except HTTPException:
            pass


async def _dismiss_alert(key: str):
    if not HOME_ASSISTANT_ALERT_NOTIFICATIONS:
        return
    try:
        await _call_ha_service(
            "persistent_notification.dismiss",
            {"notification_id": _notification_id(key)},
        )
    except HTTPException:
        pass


async def _collect_alerts() -> list[dict]:
    now = datetime.now(timezone.utc)
    children = await _baby_buddy_results("children", {"limit": 100})
    _reconcile_child_visibility(children)
    timers = await _baby_buddy_results("timers", {"limit": 100})
    alerts: list[dict] = []

    for child in children:
        try:
            child_id = int(child.get("id"))
        except (TypeError, ValueError):
            continue
        if not _child_enabled(child_id):
            continue
        child_name = await _child_name(child_id)

        feedings = await _baby_buddy_results(
            "feedings",
            {"child": child_id, "limit": 1, "ordering": "-start"},
        )
        if feedings:
            feeding = feedings[0]
            feeding_time = _parse_datetime(feeding.get("start") or feeding.get("end"))
            if feeding_time:
                elapsed_minutes = max(0, int((now - feeding_time.astimezone(timezone.utc)).total_seconds() // 60))
                if elapsed_minutes >= ALERTS_CONFIG["feeding_minutes"]:
                    alerts.append({
                        "key": f"feeding_overdue:{child_id}:{feeding.get('id', 'last')}",
                        "type": "feeding",
                        "title": f"Toma pendiente · {child_name}",
                        "message": (
                            f"Han pasado {elapsed_minutes // 60} h "
                            f"{elapsed_minutes % 60} min desde la última toma de {child_name}."
                        ),
                    })

        if TIMER_REMINDER_SETTINGS.get("enabled", True):
            for timer in timers:
                timer_child = _timer_child_id(timer)
                if timer_child not in (0, child_id):
                    continue
                started = _parse_datetime(timer.get("start"))
                if not started:
                    continue
                timer_name = str(timer.get("name") or "Actividad")
                timer_key = timer_name.casefold()
                if "sleep" in timer_key or "sueño" in timer_key:
                    continue
                is_tummy = "tummy" in timer_key or "boca abajo" in timer_key
                threshold = int(TIMER_REMINDER_SETTINGS.get("tummy_minutes" if is_tummy else "feeding_minutes", 30 if is_tummy else 90))
                elapsed_minutes = max(0, int((now - started.astimezone(timezone.utc)).total_seconds() // 60))
                if elapsed_minutes >= threshold:
                    activity_label = "el tiempo boca abajo" if is_tummy else "la toma"
                    alert_key = f"active_timer:{child_id}:{timer.get('id', timer_name)}"
                    snoozed_until = timer_reminder_snoozes.get(alert_key)
                    if snoozed_until and now < snoozed_until:
                        continue
                    if snoozed_until and now >= snoozed_until:
                        timer_reminder_snoozes.pop(alert_key, None)
                    alerts.append({
                        "key": alert_key,
                        "type": "active_timer",
                        "title": f"¿Sigue {activity_label}? · {child_name}",
                        "message": f"{activity_label.capitalize()} lleva {elapsed_minutes} minutos activa. Comprueba si olvidaste finalizarla.",
                        "alexa_message": f"Aviso. Comprueba si {activity_label} de {child_name} sigue activa. Lleva {elapsed_minutes} minutos.",
                    })

        if MEDICATION_ALERT_SETTINGS.get("enabled", True):
            medications = await _baby_buddy_results(
                "medication",
                {"child": child_id, "limit": 50, "ordering": "-time"},
            )
            latest_by_name: dict[str, dict] = {}
            for medication in medications:
                name_key = str(medication.get("name") or "").strip().casefold()
                if not name_key or name_key in latest_by_name:
                    continue
                latest_by_name[name_key] = medication
            for medication in latest_by_name.values():
                raw_medication = medication
                medication = _effective_medication(child_id, medication)
                regimen = _medication_regimen_for(child_id, medication.get("name", ""))
                if not regimen:
                    legacy_interval = str(raw_medication.get("next_dose_interval") or "").strip()
                    if legacy_interval:
                        regimen = {
                            "child_id": child_id,
                            "name": medication.get("name"),
                            "dosage": medication.get("dosage"),
                            "dosage_unit": medication.get("dosage_unit") or "",
                            "schedule_type": "interval",
                            "next_dose_interval": legacy_interval,
                            "slots": [],
                            "active": True,
                        }
                    else:
                        continue
                schedule_type = _normalize_medication_schedule_type(
                    regimen.get("schedule_type"),
                    str(regimen.get("next_dose_interval") or medication.get("next_dose_interval") or "").strip(),
                    regimen.get("slots"),
                )
                if schedule_type == "prn":
                    continue

                administered = _parse_datetime(raw_medication.get("time"))
                if not administered:
                    continue
                advance = max(0, int(MEDICATION_ALERT_SETTINGS.get("minutes_before", 20) or 0))
                slot = None
                if schedule_type == "daily_slots":
                    next_slot = _next_daily_medication_slot(regimen, administered, now, advance)
                    if not next_slot:
                        continue
                    next_at, slot = next_slot
                else:
                    interval_seconds = _interval_seconds(regimen.get("next_dose_interval") or medication.get("next_dose_interval"))
                    if interval_seconds <= 0:
                        continue
                    next_at = administered + timedelta(seconds=interval_seconds)

                next_utc = next_at.astimezone(timezone.utc)
                alert_at = next_at - timedelta(minutes=advance)
                if now < alert_at.astimezone(timezone.utc):
                    continue
                due = now >= next_utc
                if due and not MEDICATION_ALERT_SETTINGS.get("alert_at_due", True):
                    continue
                med_name = str(medication.get("name") or "Medicamento").strip() or "Medicamento"
                dosage = medication.get("dosage")
                unit = str(medication.get("dosage_unit") or "").strip()
                dose_text = ""
                if dosage not in (None, ""):
                    dose_text = f" · {dosage} {unit}".rstrip()
                due_text = next_at.strftime("%H:%M")
                slot_text = f"{slot.get('label')} · " if isinstance(slot, dict) and slot.get("label") else ""
                if due:
                    title = f"Medicamento pendiente · {child_name}"
                    timing_text = f"{slot_text}tocaba a las {due_text}"
                else:
                    title = f"Medicamento próximo · {child_name}"
                    timing_text = f"{slot_text}está previsto a las {due_text} (aviso {advance} min antes)"
                scheduled_token = next_at.astimezone(timezone.utc).strftime("%Y%m%dT%H%M")
                alerts.append({
                    "key": f"medication_due:{child_id}:{med_name.casefold()}:{scheduled_token}",
                    "type": "medication",
                    "title": title,
                    "message": f"{med_name}{dose_text} {timing_text}. Puedes registrarlo antes o después desde la pauta activa.",
                    "alexa_message": f"Aviso. Según la pauta registrada, toca {med_name} de {child_name}.",
                })

        room_config = _room_config_for_child(child_id)
        if room_config:
            temp_state, diaper_stock = await asyncio.gather(
                _safe_state(room_config.get("temperature_entity", "")),
                _active_diaper_stock(child_id),
            )
            try:
                temperature = float(temp_state.get("state")) if temp_state else None
            except (TypeError, ValueError):
                temperature = None
            if temperature is not None:
                if temperature < ALERTS_CONFIG["room_temp_min"]:
                    alerts.append({
                        "key": f"temperature_low:{child_id}",
                        "type": "temperature",
                        "title": f"Habitación fría · {child_name}",
                        "message": f"La habitación de {child_name} está a {temperature:.1f} °C.",
                        "alexa_message": f"Aviso. La habitación de {child_name} está fría, a {temperature:.1f} grados.",
                    })
                elif temperature > ALERTS_CONFIG["room_temp_max"]:
                    alerts.append({
                        "key": f"temperature_high:{child_id}",
                        "type": "temperature",
                        "title": f"Habitación caliente · {child_name}",
                        "message": f"La habitación de {child_name} está a {temperature:.1f} °C.",
                        "alexa_message": f"Aviso. La habitación de {child_name} está caliente, a {temperature:.1f} grados.",
                    })

            stock = diaper_stock.get("stock") if diaper_stock.get("available") else None
            size = diaper_stock.get("size") or "talla activa"
            if stock is not None and stock <= ALERTS_CONFIG["diaper_stock_low_threshold"]:
                alerts.append({
                    "key": f"diaper_stock:{child_id}",
                    "type": "diaper_stock",
                    "title": f"Pocos pañales · {child_name}",
                    "message": f"Quedan {stock:g} pañales de {size} para {child_name}.",
                })

    return alerts


async def _alert_monitor_loop():
    global active_alerts
    await asyncio.sleep(8)
    while True:
        try:
            alerts = await _collect_alerts()
            current = {alert["key"]: alert for alert in alerts}
            new_or_changed = {
                key
                for key, alert in current.items()
                if key not in active_alerts
                or active_alerts[key].get("title") != alert.get("title")
                or active_alerts[key].get("message") != alert.get("message")
            }
            resolved_keys = set(active_alerts) - set(current)
            for key in sorted(new_or_changed):
                await _send_alert(current[key])
            for key in sorted(resolved_keys):
                await _dismiss_alert(key)

            # Clear a stale diaper warning left by an earlier app restart or size change.
            for child_id in DIAPER_SIZE_ENTITIES:
                if not _child_enabled(child_id):
                    continue
                key = f"diaper_stock:{child_id}"
                if key not in current:
                    await _dismiss_alert(key)

            active_alerts = current
        except asyncio.CancelledError:
            raise
        except Exception:
            # Alerts are supplementary and must never stop the dashboard.
            logger.exception("No se pudieron actualizar los avisos de Baby Buddy")
        await asyncio.sleep(max(30, int(REFRESH_INTERVAL)))


# --- API routes ---


@app.get("/api/config")
async def get_config():
    return {
        "refresh_interval": REFRESH_INTERVAL,
        "demo_mode": DEMO_MODE,
        "unit_system": UNIT_SYSTEM,
        "default_child_id": DEFAULT_CHILD_ID,
        "disabled_child_ids": sorted(DISABLED_CHILD_IDS),
        "alerts": ALERTS_CONFIG,
        "night_mode": NIGHT_MODE_CONFIG,
        "calendar_days_ahead": CALENDAR_DAYS_AHEAD,
        "calendar_max_events": CALENDAR_MAX_EVENTS,
        "calendar_full_max_events": CALENDAR_FULL_MAX_EVENTS,
        "grocy_consume_service": GROCY_CONSUME_SERVICE,
        "grocy_stock_entity": GROCY_STOCK_ENTITY,
        "notifications": {
            "home_assistant": HOME_ASSISTANT_ALERT_NOTIFICATIONS,
            "mobile_service": MOBILE_NOTIFY_SERVICE,
            "mobile_services": MOBILE_NOTIFY_SERVICES,
            "alexa_service": ALEXA_NOTIFY_SERVICE,
            "alexa_alert_types": sorted(ALEXA_ALERT_TYPES),
            "telegram_activity_notifications": TELEGRAM_ACTIVITY_NOTIFICATIONS,
            "telegram_chat_id": TELEGRAM_CHAT_ID_RAW,
            "telegram_activity_types": sorted(TELEGRAM_ACTIVITY_TYPES),
        },
    }


# Recursos que forman el historial de un bebé. Algunos existen solo en versiones
# recientes de Baby Buddy; si un endpoint no existe se marca como omitido.
CHILD_HISTORY_RESOURCES = (
    "changes",
    "feedings",
    "sleep",
    "tummy-times",
    "temperature",
    "weight",
    "height",
    "head-circumference",
    "bmi",
    "notes",
    "pumping",
    "medication",
    "timers",
)


async def _all_children_raw() -> list[dict]:
    response = await http_client.get("/api/children/", params={"limit": 200})
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    payload = response.json()
    children = [item for item in payload.get("results", []) if isinstance(item, dict)] if isinstance(payload, dict) else []
    _reconcile_child_visibility(children)
    return children


async def _child_raw(child_id: int) -> dict:
    children = await _all_children_raw()
    child = next((item for item in children if _coerce_child_id(item) == child_id), None)
    if not child:
        raise HTTPException(404, "No se encontró ese bebé en Baby Buddy")
    return child


@app.get("/api/dashboard-settings")
async def get_dashboard_settings():
    children = await _all_children_raw()
    return {
        "children": [
            {**child, "enabled": _child_enabled(_coerce_child_id(child))}
            for child in children
        ],
        "disabled_child_ids": sorted(DISABLED_CHILD_IDS),
        "medication_alerts": MEDICATION_ALERT_SETTINGS,
        "handoff": HANDOFF_SETTINGS,
        "timer_reminders": TIMER_REMINDER_SETTINGS,
    }


@app.put("/api/dashboard-settings/medication-alerts")
async def set_medication_alert_settings(request: Request):
    payload = await request.json()
    MEDICATION_ALERT_SETTINGS["enabled"] = bool(payload.get("enabled", MEDICATION_ALERT_SETTINGS.get("enabled", True)))
    try:
        minutes = int(payload.get("minutes_before", MEDICATION_ALERT_SETTINGS.get("minutes_before", 20)))
    except (TypeError, ValueError):
        raise HTTPException(400, "La antelación debe ser un número de minutos")
    MEDICATION_ALERT_SETTINGS["minutes_before"] = max(0, min(120, minutes))
    MEDICATION_ALERT_SETTINGS["alert_at_due"] = bool(payload.get("alert_at_due", MEDICATION_ALERT_SETTINGS.get("alert_at_due", True)))
    MEDICATION_ALERT_SETTINGS["ha_mobile"] = bool(payload.get("ha_mobile", MEDICATION_ALERT_SETTINGS.get("ha_mobile", True)))
    MEDICATION_ALERT_SETTINGS["telegram"] = bool(payload.get("telegram", MEDICATION_ALERT_SETTINGS.get("telegram", True)))
    try:
        _save_app_settings({"medication_alerts": MEDICATION_ALERT_SETTINGS})
    except OSError as exc:
        raise HTTPException(500, f"No se pudieron guardar los avisos de medicación: {exc}")
    _record_audit(request, "update", "settings", "medication_alerts", after=MEDICATION_ALERT_SETTINGS)
    return MEDICATION_ALERT_SETTINGS


@app.put("/api/dashboard-settings/handoff/{child_id}")
async def set_handoff_enabled(child_id: int, request: Request):
    await _child_raw(child_id)
    payload = await request.json()
    enabled = bool(payload.get("enabled", True))
    enabled_ids = {int(value) for value in HANDOFF_SETTINGS.get("enabled_child_ids", [])}
    was_enabled = child_id in enabled_ids
    started_at = dict(HANDOFF_SETTINGS.get("started_at") or {})
    if enabled:
        enabled_ids.add(child_id)
        if not was_enabled:
            started_at[str(child_id)] = datetime.now(timezone.utc).isoformat()
    else:
        enabled_ids.discard(child_id)
    HANDOFF_SETTINGS["enabled_child_ids"] = sorted(enabled_ids)
    HANDOFF_SETTINGS["started_at"] = started_at
    try:
        _save_app_settings({"handoff": HANDOFF_SETTINGS, "timer_reminders": TIMER_REMINDER_SETTINGS, "medication_alerts": MEDICATION_ALERT_SETTINGS})
    except OSError as exc:
        raise HTTPException(500, f"No se pudo guardar el modo relevo: {exc}")
    _record_audit(request, "update", "settings", f"handoff:{child_id}", after={"enabled": enabled}, child_id=child_id)
    return {"child_id": child_id, "enabled": enabled}


@app.put("/api/dashboard-settings/timer-reminders")
async def set_timer_reminder_settings(request: Request):
    payload = await request.json()
    TIMER_REMINDER_SETTINGS["enabled"] = bool(payload.get("enabled", TIMER_REMINDER_SETTINGS.get("enabled", True)))
    for key, minimum, maximum, default in (("feeding_minutes", 15, 360, 90), ("tummy_minutes", 5, 180, 30), ("snooze_minutes", 5, 120, 30)):
        try:
            value = int(payload.get(key, TIMER_REMINDER_SETTINGS.get(key, default)))
        except (TypeError, ValueError):
            raise HTTPException(400, "Los tiempos de recordatorio deben ser minutos válidos")
        TIMER_REMINDER_SETTINGS[key] = max(minimum, min(maximum, value))
    try:
        _save_app_settings({"handoff": HANDOFF_SETTINGS, "timer_reminders": TIMER_REMINDER_SETTINGS, "medication_alerts": MEDICATION_ALERT_SETTINGS})
    except OSError as exc:
        raise HTTPException(500, f"No se pudieron guardar los recordatorios: {exc}")
    _record_audit(request, "update", "settings", "timer_reminders", after=TIMER_REMINDER_SETTINGS)
    return TIMER_REMINDER_SETTINGS


@app.post("/api/timer-reminders/{child_id}/{timer_id}/snooze")
async def snooze_timer_reminder(child_id: int, timer_id: str, request: Request):
    payload = await request.json()
    try:
        minutes = int(payload.get("minutes", TIMER_REMINDER_SETTINGS.get("snooze_minutes", 30)))
    except (TypeError, ValueError):
        raise HTTPException(400, "Minutos de pausa no válidos")
    minutes = max(5, min(120, minutes))
    key = f"active_timer:{child_id}:{timer_id}"
    timer_reminder_snoozes[key] = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    await _dismiss_alert(key)
    active_alerts.pop(key, None)
    return {"ok": True, "minutes": minutes, "until": timer_reminder_snoozes[key].isoformat()}


@app.get("/api/medication-regimens/{child_id}")
async def get_medication_regimens(child_id: int):
    await _child_raw(child_id)
    items = [
        dict(value)
        for value in MEDICATION_REGIMENS.values()
        if isinstance(value, dict) and int(value.get("child_id") or 0) == child_id and value.get("active", True)
    ]
    return {"regimens": items}


@app.put("/api/medication-regimens/{child_id}")
async def set_medication_regimen(child_id: int, request: Request):
    await _child_raw(child_id)
    if not _child_enabled(child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")
    payload = await request.json()
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Falta el nombre del medicamento")
    dosage = payload.get("dosage")
    if dosage not in (None, ""):
        try:
            dosage = float(dosage)
        except (TypeError, ValueError):
            raise HTTPException(400, "La dosis debe ser un número")
    else:
        dosage = None
    unit = str(payload.get("dosage_unit") or "").strip()
    interval = str(payload.get("next_dose_interval") or "").strip()
    slots = _normalize_medication_slots(payload.get("slots"))
    schedule_type = _normalize_medication_schedule_type(payload.get("schedule_type"), interval, slots)
    if schedule_type == "interval":
        if not interval or _interval_seconds(interval) <= 0:
            raise HTTPException(400, "El intervalo de la pauta no es válido")
    else:
        interval = ""
    if schedule_type == "daily_slots" and not any(slot.get("enabled", True) for slot in slots):
        raise HTTPException(400, "Activa al menos un horario del día")
    if schedule_type != "daily_slots":
        slots = []
    last_scheduled_for = payload.get("last_scheduled_for")
    if last_scheduled_for not in (None, "") and not _parse_datetime(last_scheduled_for):
        raise HTTPException(400, "La última franja programada no es válida")
    key = _medication_regimen_key(child_id, name)
    before = MEDICATION_REGIMENS.get(key)
    regimen = {
        "child_id": child_id,
        "name": name,
        "dosage": dosage,
        "dosage_unit": unit,
        "schedule_type": schedule_type,
        "next_dose_interval": interval,
        "slots": slots,
        "last_scheduled_for": last_scheduled_for or None,
        "active": bool(payload.get("active", True)),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    MEDICATION_REGIMENS[key] = regimen
    try:
        _save_app_settings({
            "medication_alerts": MEDICATION_ALERT_SETTINGS,
            "medication_regimens": MEDICATION_REGIMENS,
        })
    except OSError as exc:
        raise HTTPException(500, f"No se pudo guardar la pauta: {exc}")
    _record_audit(request, "update", "medication_regimen", key, before=before, after=regimen, child_id=child_id)
    return regimen


@app.delete("/api/medication-regimens/{child_id}")
async def delete_medication_regimen(child_id: int, request: Request):
    await _child_raw(child_id)
    payload = await request.json()
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Falta el nombre del medicamento")
    key = _medication_regimen_key(child_id, name)
    before = MEDICATION_REGIMENS.pop(key, None)
    try:
        _save_app_settings({
            "medication_alerts": MEDICATION_ALERT_SETTINGS,
            "medication_regimens": MEDICATION_REGIMENS,
        })
    except OSError as exc:
        raise HTTPException(500, f"No se pudo finalizar la pauta: {exc}")
    _record_audit(request, "delete", "medication_regimen", key, before=before, after=None, child_id=child_id)
    return {"deleted": True, "name": name}


@app.put("/api/dashboard-settings/children/{child_id}/enabled")
async def set_dashboard_child_enabled(child_id: int, request: Request):
    global DISABLED_CHILD_IDS
    await _child_raw(child_id)
    payload = await request.json()
    enabled = bool(payload.get("enabled", True))

    if not enabled:
        children = await _all_children_raw()
        enabled_ids = [
            _coerce_child_id(child)
            for child in children
            if _child_enabled(_coerce_child_id(child)) and _coerce_child_id(child) != child_id
        ]
        if not enabled_ids:
            raise HTTPException(409, "Debe quedar al menos un bebé activo en la aplicación")
        DISABLED_CHILD_IDS.add(child_id)
    else:
        DISABLED_CHILD_IDS.discard(child_id)

    try:
        _save_app_settings()
    except OSError as exc:
        raise HTTPException(500, f"No se pudo guardar el ajuste: {exc}")

    # Si se oculta un bebé, retiramos inmediatamente sus avisos ya presentes.
    if not enabled:
        for key in list(active_alerts):
            if f":{child_id}:" in key or key.endswith(f":{child_id}"):
                await _dismiss_alert(key)
                active_alerts.pop(key, None)

    _record_audit(
        request,
        "settings",
        "child_visibility",
        child_id,
        before={"enabled": not enabled},
        after={"enabled": enabled},
        child_id=child_id,
    )
    return {"child_id": child_id, "enabled": enabled, "disabled_child_ids": sorted(DISABLED_CHILD_IDS)}


@app.patch("/api/dashboard-settings/children/{child_id}")
async def update_dashboard_child(child_id: int, request: Request):
    child = await _child_raw(child_id)
    payload = await request.json()
    allowed = {}
    for field in ("first_name", "last_name", "birth_date", "birth_time"):
        if field in payload:
            value = payload.get(field)
            if isinstance(value, str):
                value = value.strip()
            if field == "birth_date" and value == "":
                value = None
            allowed[field] = value
    if not allowed:
        raise HTTPException(400, "No hay datos del bebé para modificar")
    if "first_name" in allowed and not allowed["first_name"]:
        raise HTTPException(400, "El nombre no puede quedar vacío")
    if "birth_date" in allowed and not allowed["birth_date"]:
        raise HTTPException(400, "La fecha de nacimiento no puede quedar vacía")

    lookup = str(child.get("slug") or child_id)
    response = await http_client.patch(f"/api/children/{lookup}/", json=allowed)
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    updated = response.json()
    child_name_cache.pop(child_id, None)
    _record_audit(request, "update", "children", child_id, before=child, after=updated, child_id=child_id)
    return updated


async def _delete_child_resource_entries(resource: str, child_id: int) -> tuple[int, str | None]:
    deleted = 0
    # Repetimos siempre la primera página. Al borrar los resultados, la siguiente
    # tanda pasa a ocupar esa primera página, evitando problemas de offset.
    for _ in range(10000):
        response = await http_client.get(
            f"/api/{resource}/",
            params={"child": child_id, "limit": 100},
        )
        if response.status_code in (404, 405):
            return deleted, "endpoint no disponible"
        if response.status_code >= 400:
            return deleted, f"HTTP {response.status_code}: {response.text[:180]}"
        payload = response.json()
        entries = payload.get("results", []) if isinstance(payload, dict) else []
        entries = [entry for entry in entries if isinstance(entry, dict) and entry.get("id") not in (None, "")]
        if not entries:
            return deleted, None
        wrong_child = [entry for entry in entries if _coerce_child_id(entry.get("child")) != child_id]
        if wrong_child:
            # Protección crítica: nunca continuar si Baby Buddy ignorase el filtro
            # child=..., porque podríamos borrar datos de otro bebé.
            return deleted, "Baby Buddy no respetó el filtro por bebé; borrado detenido por seguridad"
        for entry in entries:
            entry_id = entry.get("id")
            delete_response = await http_client.delete(f"/api/{resource}/{entry_id}/")
            if delete_response.status_code not in (200, 202, 204, 404):
                return deleted, f"No se pudo borrar ID {entry_id}: HTTP {delete_response.status_code}"
            if delete_response.status_code != 404:
                deleted += 1
    return deleted, "límite de seguridad alcanzado"


@app.post("/api/dashboard-settings/children/{child_id}/clear-history")
async def clear_dashboard_child_history(child_id: int, request: Request):
    child = await _child_raw(child_id)
    payload = await request.json()
    first_name = str(child.get("first_name") or "Bebé").strip() or "Bebé"
    expected = f"BORRAR {first_name}"
    if str(payload.get("confirmation") or "").strip() != expected:
        raise HTTPException(400, f"Escribe exactamente: {expected}")

    include_audit = bool(payload.get("include_audit", True))
    result: dict[str, dict] = {}
    total = 0
    errors = []
    for resource in CHILD_HISTORY_RESOURCES:
        count, error = await _delete_child_resource_entries(resource, child_id)
        result[resource] = {"deleted": count, "error": error}
        total += count
        if error and error != "endpoint no disponible":
            errors.append(f"{resource}: {error}")

    audit_deleted = 0
    if include_audit:
        with sqlite3.connect(AUDIT_DB_PATH) as connection:
            cursor = connection.execute("DELETE FROM audit_log WHERE child_id = ?", (child_id,))
            audit_deleted = max(0, cursor.rowcount or 0)
            connection.commit()

    # Las pautas futuras pertenecen también al historial de pruebas de este bebé.
    # Las eliminamos para que un reinicio de pruebas no deje recordatorios activos.
    regimen_keys = [
        key for key, value in MEDICATION_REGIMENS.items()
        if isinstance(value, dict) and int(value.get("child_id") or 0) == child_id
    ]
    for key in regimen_keys:
        MEDICATION_REGIMENS.pop(key, None)
    if regimen_keys:
        try:
            _save_app_settings({
                "medication_alerts": MEDICATION_ALERT_SETTINGS,
                "medication_regimens": MEDICATION_REGIMENS,
            })
        except OSError:
            errors.append("pautas de medicación: no se pudieron limpiar los ajustes")

    # Retiramos avisos activos del bebé. No modificamos existencias de Grocy: este
    # proceso limpia el historial de Baby Buddy, no el inventario físico.
    for key in list(active_alerts):
        if f":{child_id}:" in key or key.endswith(f":{child_id}"):
            await _dismiss_alert(key)
            active_alerts.pop(key, None)

    if not include_audit:
        _record_audit(
            request, "clear_history", "children", child_id,
            before={"child": child, "deleted": result}, after=None, child_id=child_id
        )

    return {
        "ok": not errors,
        "child_id": child_id,
        "child_name": first_name,
        "total_deleted": total,
        "audit_deleted": audit_deleted,
        "resources": result,
        "errors": errors,
        "grocy_stock_changed": False,
    }


def _handoff_row(row) -> dict:
    return {
        "id": row[0],
        "timestamp": row[1],
        "child_id": row[2],
        "from_user_id": row[3] or "",
        "from_user_name": row[4] or "",
        "to_user_id": row[5] or "",
        "to_user_name": row[6] or "Acceso directo",
        "note": row[7] or "",
    }


def _handoff_history(child_id: int, limit: int = 12) -> list[dict]:
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        rows = connection.execute(
            """SELECT id, timestamp, child_id, from_user_id, from_user_name, to_user_id, to_user_name, note
               FROM handoff_events WHERE child_id = ? ORDER BY id DESC LIMIT ?""",
            (child_id, max(1, min(100, limit))),
        ).fetchall()
    return [_handoff_row(row) for row in rows]


def _duration_hours(value) -> float:
    if not value:
        return 0.0
    try:
        parts = [float(part) for part in str(value).split(":")]
    except (TypeError, ValueError):
        return 0.0
    if len(parts) == 3:
        return parts[0] + parts[1] / 60 + parts[2] / 3600
    if len(parts) == 2:
        return parts[0] + parts[1] / 60
    return parts[0] if parts else 0.0


async def _next_medication_summary(child_id: int) -> dict | None:
    now = datetime.now(timezone.utc)
    medications = await _baby_buddy_results("medication", {"child": child_id, "limit": 100, "ordering": "-time"})
    latest_by_name: dict[str, dict] = {}
    for medication in medications:
        key = str(medication.get("name") or "").strip().casefold()
        if key and key not in latest_by_name:
            latest_by_name[key] = medication
    candidates = []
    for raw in latest_by_name.values():
        medication = _effective_medication(child_id, raw)
        regimen = _medication_regimen_for(child_id, medication.get("name", ""))
        if not regimen:
            legacy_interval = str(raw.get("next_dose_interval") or "").strip()
            if not legacy_interval:
                continue
            regimen = {"name": medication.get("name"), "schedule_type": "interval", "next_dose_interval": legacy_interval, "slots": [], "active": True}
        schedule_type = _normalize_medication_schedule_type(regimen.get("schedule_type"), str(regimen.get("next_dose_interval") or raw.get("next_dose_interval") or "").strip(), regimen.get("slots"))
        if schedule_type == "prn":
            continue
        administered = _parse_datetime(raw.get("time"))
        if not administered:
            continue
        slot = None
        if schedule_type == "daily_slots":
            next_slot = _next_daily_medication_slot(regimen, administered, now, 0)
            if not next_slot:
                continue
            next_at, slot = next_slot
        else:
            seconds = _interval_seconds(regimen.get("next_dose_interval") or raw.get("next_dose_interval"))
            if seconds <= 0:
                continue
            next_at = administered + timedelta(seconds=seconds)
        candidates.append((next_at, medication, slot))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    next_at, medication, slot = candidates[0]
    return {
        "name": str(medication.get("name") or "Medicamento"),
        "dosage": medication.get("dosage"),
        "dosage_unit": str(medication.get("dosage_unit") or ""),
        "time": next_at.isoformat(),
        "slot": slot.get("label") if isinstance(slot, dict) else None,
        "due": next_at.astimezone(timezone.utc) <= now,
    }


async def _handoff_summary(child_id: int, since: str | None) -> dict:
    if not since:
        return {"feedings": 0, "feeding_amount": 0, "diapers": 0, "wet": 0, "solid": 0, "both": 0, "sleep_hours": 0, "medications": 0, "temperature_max": None}
    queries = await asyncio.gather(
        _baby_buddy_results("feedings", {"child": child_id, "start_min": since, "limit": 300, "ordering": "-start"}),
        _baby_buddy_results("changes", {"child": child_id, "date_min": since, "limit": 300, "ordering": "-time"}),
        _baby_buddy_results("sleep", {"child": child_id, "start_min": since, "limit": 300, "ordering": "-start"}),
        _baby_buddy_results("medication", {"child": child_id, "time_min": since, "limit": 300, "ordering": "-time"}),
        _baby_buddy_results("temperature", {"child": child_id, "time_min": since, "limit": 300, "ordering": "-time"}),
        return_exceptions=True,
    )
    feedings, changes, sleeps, medications, temperatures = [value if isinstance(value, list) else [] for value in queries]
    wet = sum(1 for item in changes if item.get("wet") and not item.get("solid"))
    solid = sum(1 for item in changes if item.get("solid") and not item.get("wet"))
    both = sum(1 for item in changes if item.get("wet") and item.get("solid"))
    temperature_values = []
    for item in temperatures:
        try:
            temperature_values.append(float(item.get("temperature")))
        except (TypeError, ValueError):
            pass
    return {
        "feedings": len(feedings),
        "feeding_amount": round(sum(float(item.get("amount") or 0) for item in feedings), 1),
        "diapers": len(changes),
        "wet": wet,
        "solid": solid,
        "both": both,
        "sleep_hours": round(sum(_duration_hours(item.get("duration")) for item in sleeps), 2),
        "medications": len(medications),
        "temperature_max": max(temperature_values) if temperature_values else None,
    }


@app.get("/api/handoff/{child_id}")
async def get_handoff(child_id: int):
    await _child_raw(child_id)
    history = _handoff_history(child_id, 12)
    enabled = _handoff_enabled(child_id)
    started_at = str((HANDOFF_SETTINGS.get("started_at") or {}).get(str(child_id)) or "")
    current = history[0] if history else None
    if current and started_at:
        try:
            if _parse_datetime(current.get("timestamp")) < _parse_datetime(started_at):
                current = None
        except TypeError:
            current = None
    if not enabled:
        current = None
    summary, next_medication = await asyncio.gather(
        _handoff_summary(child_id, current.get("timestamp") if current else None),
        _next_medication_summary(child_id),
    )
    return {"enabled": enabled, "current": current, "history": history, "summary": summary, "next_medication": next_medication}


@app.patch("/api/handoff/{child_id}/current-note")
async def update_handoff_note(child_id: int, request: Request):
    await _child_raw(child_id)
    if not _handoff_enabled(child_id):
        raise HTTPException(409, "El modo relevo está desactivado")
    history = _handoff_history(child_id, 1)
    current = history[0] if history else None
    started_at = str((HANDOFF_SETTINGS.get("started_at") or {}).get(str(child_id)) or "")
    if current and started_at:
        try:
            if _parse_datetime(current.get("timestamp")) < _parse_datetime(started_at):
                current = None
        except TypeError:
            current = None
    if not current:
        raise HTTPException(404, "No hay un relevo activo al que añadir una nota")
    payload = await request.json()
    note = str(payload.get("note") or "").strip()[:500]
    before = dict(current)
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        connection.execute("UPDATE handoff_events SET note = ? WHERE id = ?", (note, current["id"]))
        connection.commit()
    _record_audit(request, "update", "handoff", current["id"], before=before, after={**before, "note": note}, child_id=child_id)
    return {"ok": True, "note": note}


@app.post("/api/handoff/{child_id}/take-over")
async def take_over_handoff(child_id: int, request: Request):
    await _child_raw(child_id)
    if not _handoff_enabled(child_id):
        raise HTTPException(409, "El modo relevo está desactivado para este bebé")
    payload = await request.json()
    note = str(payload.get("note") or "").strip()[:500]
    user = _request_user(request)
    history = _handoff_history(child_id, 1)
    previous = history[0] if history else None
    started_at = str((HANDOFF_SETTINGS.get("started_at") or {}).get(str(child_id)) or "")
    if previous and started_at:
        try:
            if _parse_datetime(previous.get("timestamp")) < _parse_datetime(started_at):
                previous = None
        except TypeError:
            previous = None
    now = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        cursor = connection.execute(
            """INSERT INTO handoff_events(timestamp, child_id, from_user_id, from_user_name, to_user_id, to_user_name, note)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                now, child_id,
                previous.get("to_user_id", "") if previous else "",
                previous.get("to_user_name", "") if previous else "",
                user.get("id", ""), user.get("display_name", "Acceso directo"), note,
            ),
        )
        connection.commit()
        event_id = cursor.lastrowid
    _record_audit(request, "create", "handoff", event_id, after={"timestamp": now, "note": note}, child_id=child_id)
    history = _handoff_history(child_id, 12)
    summary, next_medication = await asyncio.gather(_handoff_summary(child_id, now), _next_medication_summary(child_id))
    return {"enabled": True, "current": history[0], "history": history, "summary": summary, "next_medication": next_medication}


@app.get("/api/current-user")
async def get_current_user(request: Request):
    return _request_user(request)


@app.get("/api/audit")
async def get_audit(child_id: int | None = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 1000))
    query = """
        SELECT id, timestamp, user_id, user_name, user_display_name,
               action, resource, entry_id, child_id, before_json, after_json
        FROM audit_log
    """
    params: list = []
    if child_id:
        query += " WHERE child_id = ?"
        params.append(child_id)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with sqlite3.connect(AUDIT_DB_PATH) as connection:
        rows = connection.execute(query, params).fetchall()
    return {"results": [_audit_row_to_dict(row) for row in rows]}


@app.get("/api/diaper-sizes")
async def get_diaper_sizes():
    sizes: dict[str, dict] = {}
    for child_id, entity_id in DIAPER_SIZE_ENTITIES.items():
        if not _child_enabled(child_id):
            continue
        try:
            state = await _get_ha_state(entity_id)
            attrs = state.get("attributes", {})
            sizes[str(child_id)] = {
                "configured": True,
                "available": state.get("state") not in ("unknown", "unavailable"),
                "entity_id": entity_id,
                "state": state.get("state", "unknown"),
                "options": attrs.get("options", []),
                "friendly_name": attrs.get("friendly_name", entity_id),
            }
        except HTTPException as exc:
            sizes[str(child_id)] = {
                "configured": True,
                "available": False,
                "entity_id": entity_id,
                "state": "unavailable",
                "options": [],
                "error": exc.detail,
            }
    return {"available": bool(SUPERVISOR_TOKEN), "sizes": sizes}


@app.post("/api/diaper-sizes/{child_id}")
async def set_diaper_size(child_id: int, request: Request):
    if not _child_enabled(child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")
    entity_id = DIAPER_SIZE_ENTITIES.get(child_id)
    if not entity_id:
        raise HTTPException(404, f"No diaper-size helper configured for child {child_id}")
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    option = str(payload.get("option", "")).strip()
    if not option:
        raise HTTPException(400, "Missing diaper-size option")
    current = await _get_ha_state(entity_id)
    allowed = current.get("attributes", {}).get("options", [])
    if allowed and option not in allowed:
        raise HTTPException(400, f"Invalid option '{option}' for {entity_id}")
    await _call_ha_service(
        "input_select.select_option",
        {"entity_id": entity_id, "option": option},
    )
    updated = await _get_ha_state(entity_id)
    attrs = updated.get("attributes", {})
    return {
        "configured": True,
        "available": updated.get("state") not in ("unknown", "unavailable"),
        "entity_id": entity_id,
        "state": updated.get("state", option),
        "options": attrs.get("options", allowed),
        "friendly_name": attrs.get("friendly_name", entity_id),
    }




@app.get("/api/diaper-stock")
async def get_diaper_stock():
    return await _all_diaper_stocks()


@app.post("/api/diaper-stock/{product_id}/adjust")
async def adjust_diaper_stock(product_id: int, request: Request):
    size = next((name for name, pid in DIAPER_PRODUCT_IDS.items() if int(pid) == int(product_id)), None)
    if not size:
        raise HTTPException(404, "Ese producto no está configurado como talla de pañal")

    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "JSON no válido")

    try:
        delta = int(payload.get("delta"))
    except (TypeError, ValueError):
        raise HTTPException(400, "La cantidad debe ser un número entero")
    if delta == 0:
        return await _all_diaper_stocks()
    if abs(delta) > 5000:
        raise HTTPException(400, "La cantidad es demasiado grande")

    current_payload = await _all_diaper_stocks()
    current_item = next((item for item in current_payload.get("items", []) if int(item.get("product_id") or 0) == product_id), None)
    current_stock = _number_or_none((current_item or {}).get("stock"))
    if current_stock is not None and current_stock + delta < 0:
        raise HTTPException(400, f"No puedes dejar el stock de {size} por debajo de 0")

    service = GROCY_RESTORE_SERVICE if delta > 0 else GROCY_CONSUME_SERVICE
    if not service:
        action = "reponer" if delta > 0 else "consumir"
        raise HTTPException(409, f"No está configurada la acción de Grocy para {action} pañales")

    response = await _call_ha_service_response(service, {"product_id": product_id, "amount": abs(delta)})
    status = _grocy_response_status(response)
    if status is not None and status not in (200, 201, 204):
        raise HTTPException(502, f"Grocy devolvió HTTP {status}: {response.get('content', '')}")

    if str(payload.get("kind") or "").strip().lower() == "purchase" and delta > 0:
        _save_diaper_purchase_event(request, product_id, delta)

    if GROCY_STOCK_ENTITY:
        try:
            await _call_ha_service("homeassistant.update_entity", {"entity_id": GROCY_STOCK_ENTITY})
        except HTTPException:
            pass
        # Dejamos un instante para que el sensor REST refresque sus atributos.
        await asyncio.sleep(0.25)

    updated = await _all_diaper_stocks()
    # Si el sensor aún no ha refrescado, damos al frontal el valor esperado para
    # que el cambio se vea al instante; el refresco general lo reconciliará.
    if current_stock is not None:
        for item in updated.get("items", []):
            if int(item.get("product_id") or 0) == product_id:
                new_stock = _number_or_none(item.get("stock"))
                if new_stock == current_stock:
                    item["stock"] = max(0, current_stock + delta)
                    item["optimistic"] = True
                break

    _record_audit(
        request,
        "stock_adjust",
        "grocy_diaper_stock",
        product_id,
        before={"size": size, "stock": current_stock},
        after={"size": size, "delta": delta, "stock": None if current_stock is None else max(0, current_stock + delta)},
        child_id=None,
    )
    return updated



@app.get("/api/diaper-purchases")
async def get_diaper_purchases(limit: int = 40):
    return await _diaper_purchase_history(limit)


@app.post("/api/diaper-purchases/correct")
async def correct_diaper_purchase(request: Request):
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "JSON no válido")
    purchase_key = str(payload.get("key") or "").strip()
    if not purchase_key:
        raise HTTPException(400, "Falta la compra a corregir")
    history = await _diaper_purchase_history(200)
    current = next((item for item in history.get("items", []) if str(item.get("key")) == purchase_key), None)
    if not current:
        raise HTTPException(404, "No se encontró esa compra en el historial")
    try:
        new_product_id = int(payload.get("product_id"))
        new_amount = int(payload.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Talla o cantidad no válidas")
    if new_amount <= 0:
        raise HTTPException(400, "La compra debe tener al menos 1 pañal")
    new_size = _size_for_product(new_product_id)
    if not new_size:
        raise HTTPException(404, "La talla seleccionada no está configurada")
    old_product_id = int(current.get("product_id"))
    old_amount = int(round(float(current.get("amount") or 0)))

    if current.get("source") == "grocy" and current.get("booking_id"):
        await _undo_grocy_booking(int(current["booking_id"]))
        try:
            await _apply_stock_delta(new_product_id, new_amount)
        except Exception:
            # Si falla el alta corregida, intentamos restaurar la compra original.
            try:
                await _apply_stock_delta(old_product_id, old_amount)
            except Exception:
                logger.exception("No se pudo restaurar la compra original tras fallar la corrección")
            raise
        # El booking original seguirá en el diario histórico de Grocy aunque esté deshecho;
        # lo ocultamos en nuestra vista y la nueva compra aparecerá como booking nuevo.
        _set_purchase_override(purchase_key, hidden=True, product_id=old_product_id, size=current.get("size"), amount=old_amount)
    else:
        if old_product_id == new_product_id:
            await _apply_stock_delta(old_product_id, new_amount - old_amount)
        else:
            await _apply_stock_delta(old_product_id, -old_amount)
            try:
                await _apply_stock_delta(new_product_id, new_amount)
            except Exception:
                try:
                    await _apply_stock_delta(old_product_id, old_amount)
                except Exception:
                    logger.exception("No se pudo revertir una corrección de compra de pañales")
                raise
        _set_purchase_override(purchase_key, hidden=False, product_id=new_product_id, size=new_size, amount=new_amount)
    _record_audit(request, "update", "diaper_purchase", purchase_key, before=current, after={**current, "product_id": new_product_id, "size": new_size, "amount": new_amount})
    if GROCY_STOCK_ENTITY:
        try:
            await _call_ha_service("homeassistant.update_entity", {"entity_id": GROCY_STOCK_ENTITY})
        except HTTPException:
            pass
    return await _diaper_purchase_history(40)


@app.post("/api/diaper-purchases/delete")
async def delete_diaper_purchase(request: Request):
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "JSON no válido")
    purchase_key = str(payload.get("key") or "").strip()
    history = await _diaper_purchase_history(200)
    current = next((item for item in history.get("items", []) if str(item.get("key")) == purchase_key), None)
    if not current:
        raise HTTPException(404, "No se encontró esa compra en el historial")
    product_id = int(current.get("product_id"))
    amount = int(round(float(current.get("amount") or 0)))
    if current.get("source") == "grocy" and current.get("booking_id"):
        await _undo_grocy_booking(int(current["booking_id"]))
    else:
        await _apply_stock_delta(product_id, -amount)
    _set_purchase_override(purchase_key, hidden=True, product_id=product_id, size=current.get("size"), amount=amount)
    _record_audit(request, "delete", "diaper_purchase", purchase_key, before=current, after=None)
    if GROCY_STOCK_ENTITY:
        try:
            await _call_ha_service("homeassistant.update_entity", {"entity_id": GROCY_STOCK_ENTITY})
        except HTTPException:
            pass
    return await _diaper_purchase_history(40)


@app.get("/api/room-status")
async def get_room_statuses():
    rooms: dict[str, dict] = {}
    child_ids = set(ROOM_ENTITIES) | set(DIAPER_SIZE_ENTITIES) | set(CALENDAR_ENTITIES) | set(CHILD_NAMES)
    for child_id in child_ids:
        if not _child_enabled(child_id):
            continue
        config = _room_config_for_child(child_id)
        temp, humidity, light, window, diaper_stock = await asyncio.gather(
            _safe_state(config.get("temperature_entity", "")),
            _safe_state(config.get("humidity_entity", "")),
            _safe_state(config.get("light_entity", "")),
            _safe_state(config.get("window_entity", "")),
            _active_diaper_stock(child_id),
        )
        rooms[str(child_id)] = {
            "configured": bool(config),
            "temperature": temp.get("state") if temp else None,
            "humidity": humidity.get("state") if humidity else None,
            "light": light.get("state") if light else None,
            "window": window.get("state") if window else None,
            "diaper_stock": diaper_stock.get("stock"),
            "diaper_stock_available": diaper_stock.get("available", False),
            "diaper_size": diaper_stock.get("size", ""),
            "diaper_product_id": diaper_stock.get("product_id"),
            "has_light": bool(config.get("light_entity")),
            "has_camera": bool(config.get("camera_entity")),
            "camera_url": f"./api/room-camera/{child_id}" if config.get("camera_entity") else None,
        }
    return {"available": bool(SUPERVISOR_TOKEN), "rooms": rooms}


@app.get("/api/calendar-events")
async def get_calendar_events():
    calendars: dict[str, dict] = {}
    for child_id, entity_id in CALENDAR_ENTITIES.items():
        if not _child_enabled(child_id):
            continue
        try:
            raw_events = await _get_calendar_events(entity_id)
            normalized_events = []
            for raw in raw_events[:CALENDAR_FULL_MAX_EVENTS]:
                start, all_day = _calendar_start(raw)
                end, _ = _calendar_end(raw)
                if not start:
                    continue
                normalized_events.append({
                    "uid": str(raw.get("uid") or "").strip(),
                    "recurrence_id": str(raw.get("recurrence_id") or "").strip(),
                    "rrule": str(raw.get("rrule") or "").strip(),
                    "summary": str(raw.get("summary") or "Cita"),
                    "start": start,
                    "end": end or start,
                    "all_day": all_day,
                    "location": str(raw.get("location") or "").strip(),
                    "description": str(raw.get("description") or "").strip(),
                })
            capability = await _calendar_write_capability(entity_id)
            calendars[str(child_id)] = {
                "configured": True,
                "available": True,
                "entity_id": entity_id,
                "events": normalized_events[:CALENDAR_MAX_EVENTS],
                "all_events": normalized_events,
                **capability,
            }
        except HTTPException as exc:
            calendars[str(child_id)] = {
                "configured": True,
                "available": False,
                "entity_id": entity_id,
                "events": [],
                "all_events": [],
                "error": exc.detail,
            }
    return {"available": bool(SUPERVISOR_TOKEN), "calendars": calendars}


async def _create_calendar_event_in_ha(entity_id: str, event: dict) -> str:
    """Create an event and return the Home Assistant path used."""
    used_method = "websocket"
    try:
        await _ha_ws_command({
            "type": "calendar/event/create",
            "entity_id": entity_id,
            "event": event,
        })
    except HTTPException as ws_exc:
        # Keep service fallback for older Home Assistant versions.
        service_data = {
            "entity_id": entity_id,
            "summary": event["summary"],
            "start_date_time": event["dtstart"],
            "end_date_time": event["dtend"],
        }
        if event.get("location"):
            service_data["location"] = event["location"]
        if event.get("description"):
            service_data["description"] = event["description"]
        failures = [f"websocket: {ws_exc.detail}"]
        used_method = ""
        for action in ("calendar.create_event", "google.create_event"):
            try:
                await _call_ha_service(action, service_data)
                used_method = action
                break
            except HTTPException as exc:
                failures.append(f"{action}: {exc.detail}")
        if not used_method:
            raise HTTPException(502, " | ".join(failures))
    return used_method


async def _delete_calendar_event_in_ha(
    entity_id: str,
    uid: str,
    recurrence_id: str = "",
    recurrence_range: str = "",
):
    command = {
        "type": "calendar/event/delete",
        "entity_id": entity_id,
        "uid": uid,
    }
    if recurrence_id:
        command["recurrence_id"] = recurrence_id
    if recurrence_range:
        command["recurrence_range"] = recurrence_range
    await _ha_ws_command(command)


def _calendar_wall_minute(value) -> str:
    """Normalize an event datetime to its displayed wall-clock minute."""
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text[:16].replace("T", " ")
    # The form sends local wall time without an offset and Home Assistant returns
    # that same wall time with an offset. Comparing the wall components avoids a
    # false mismatch caused by attaching UTC to the form value.
    return parsed.replace(tzinfo=None, second=0, microsecond=0).isoformat(timespec="minutes")


def _calendar_event_matches(raw: dict, event: dict, excluded_uid: str = "") -> bool:
    raw_uid = str(raw.get("uid") or "").strip()
    if excluded_uid and raw_uid == excluded_uid:
        return False
    raw_start, _ = _calendar_start(raw)
    raw_end, _ = _calendar_end(raw)
    return (
        str(raw.get("summary") or "").strip() == event["summary"]
        and _calendar_wall_minute(raw_start) == _calendar_wall_minute(event["dtstart"])
        and _calendar_wall_minute(raw_end) == _calendar_wall_minute(event["dtend"])
    )


async def _confirm_created_calendar_event(
    entity_id: str,
    event: dict,
    excluded_uid: str = "",
) -> dict | None:
    """Wait briefly for Google/HA calendar propagation and return the new event."""
    for delay in (0.25, 0.55, 1.0, 1.7):
        await asyncio.sleep(delay)
        try:
            events = await _get_calendar_events(entity_id)
        except HTTPException:
            continue
        match = next(
            (item for item in events if _calendar_event_matches(item, event, excluded_uid)),
            None,
        )
        if match:
            return match
        try:
            await _call_ha_service("homeassistant.update_entity", {"entity_id": entity_id})
        except HTTPException:
            pass
    return None


@app.post("/api/calendar-events/{child_id}")
async def create_calendar_event(child_id: int, request: Request):
    if not _child_enabled(child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")
    entity_id = CALENDAR_ENTITIES.get(child_id)
    if not entity_id:
        raise HTTPException(404, f"No calendar configured for child {child_id}")
    capability = await _calendar_write_capability(entity_id)
    if not capability.get("can_create"):
        raise HTTPException(409, capability.get("write_error") or "Calendar is read-only")
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    event = _calendar_event_payload(payload)
    used_method = await _create_calendar_event_in_ha(entity_id, event)
    await _refresh_calendar_entity(entity_id)
    return {"created": True, "verified": True, "service": used_method, "entity_id": entity_id, **event}


def _calendar_event_payload(payload: dict) -> dict:
    summary = str(payload.get("summary") or "").strip()
    start_date_time = str(payload.get("start_date_time") or payload.get("dtstart") or "").strip()
    end_date_time = str(payload.get("end_date_time") or payload.get("dtend") or "").strip()
    location = str(payload.get("location") or "").strip()
    description = str(payload.get("description") or "").strip()
    if not summary:
        raise HTTPException(400, "Falta el título de la cita")
    if not start_date_time or not end_date_time:
        raise HTTPException(400, "Falta la fecha de inicio o de fin")
    try:
        start_value = datetime.fromisoformat(start_date_time.replace("Z", "+00:00"))
        end_value = datetime.fromisoformat(end_date_time.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "La fecha o la hora no son válidas")
    if end_value <= start_value:
        raise HTTPException(400, "La hora final debe ser posterior a la inicial")
    event = {"summary": summary, "dtstart": start_date_time, "dtend": end_date_time}
    if location:
        event["location"] = location
    if description:
        event["description"] = description
    return event


async def _refresh_calendar_entity(entity_id: str):
    try:
        await _call_ha_service("homeassistant.update_entity", {"entity_id": entity_id})
    except HTTPException:
        pass
    await asyncio.sleep(0.35)


@app.put("/api/calendar-events/{child_id}")
async def update_calendar_event(child_id: int, request: Request):
    if not _child_enabled(child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")
    entity_id = CALENDAR_ENTITIES.get(child_id)
    if not entity_id:
        raise HTTPException(404, f"No calendar configured for child {child_id}")
    capability = await _calendar_write_capability(entity_id)
    if not capability.get("can_update"):
        raise HTTPException(409, "Este calendario no permite editar citas desde Home Assistant")
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    uid = str(payload.get("uid") or "").strip()
    if not uid:
        raise HTTPException(400, "La cita no incluye un identificador editable")
    event = _calendar_event_payload(payload)
    recurrence_id = str(payload.get("recurrence_id") or "").strip()
    recurrence_range = str(payload.get("recurrence_range") or "").strip()

    if capability.get("can_update_native"):
        command = {
            "type": "calendar/event/update",
            "entity_id": entity_id,
            "uid": uid,
            "event": event,
        }
        if recurrence_id:
            command["recurrence_id"] = recurrence_id
        if recurrence_range:
            command["recurrence_range"] = recurrence_range
        await _ha_ws_command(command)
        await _refresh_calendar_entity(entity_id)
        return {"updated": True, "update_mode": "native", "entity_id": entity_id, "uid": uid, **event}

    # Google Calendar exposes CREATE_EVENT + DELETE_EVENT but not UPDATE_EVENT.
    # Create and confirm the revised event first so a failed creation never
    # destroys the original. Then remove the original event.
    used_method = await _create_calendar_event_in_ha(entity_id, event)
    created = await _confirm_created_calendar_event(entity_id, event, excluded_uid=uid)
    if not created:
        raise HTTPException(
            502,
            "La cita modificada se envió, pero Google Calendar todavía no la ha confirmado. "
            "La cita original se ha conservado; revisa el calendario antes de repetir la edición.",
        )
    new_uid = str(created.get("uid") or "").strip()
    try:
        await _delete_calendar_event_in_ha(entity_id, uid, recurrence_id, recurrence_range)
    except HTTPException as delete_exc:
        rollback_ok = False
        if new_uid:
            try:
                await _delete_calendar_event_in_ha(entity_id, new_uid)
                rollback_ok = True
            except HTTPException:
                pass
        if rollback_ok:
            detail = "No se pudo sustituir la cita. Se eliminó la copia nueva y se conservó la original."
        else:
            detail = (
                "La cita nueva se creó, pero no se pudo borrar la anterior. Puede haber un duplicado. "
                "Revisa el calendario antes de volver a intentarlo."
            )
        raise HTTPException(502, f"{detail} Detalle: {delete_exc.detail}")

    await _refresh_calendar_entity(entity_id)
    return {
        "updated": True,
        "update_mode": "replace",
        "service": used_method,
        "entity_id": entity_id,
        "uid": new_uid or uid,
        **event,
    }


@app.delete("/api/calendar-events/{child_id}")
async def delete_calendar_event(child_id: int, request: Request):
    if not _child_enabled(child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")
    entity_id = CALENDAR_ENTITIES.get(child_id)
    if not entity_id:
        raise HTTPException(404, f"No calendar configured for child {child_id}")
    capability = await _calendar_write_capability(entity_id)
    if not capability.get("can_delete"):
        raise HTTPException(409, "Este calendario no permite borrar citas desde Home Assistant")
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    uid = str(payload.get("uid") or "").strip()
    if not uid:
        raise HTTPException(400, "La cita no incluye un identificador borrable")
    recurrence_id = str(payload.get("recurrence_id") or "").strip()
    recurrence_range = str(payload.get("recurrence_range") or "").strip()
    await _delete_calendar_event_in_ha(entity_id, uid, recurrence_id, recurrence_range)
    await _refresh_calendar_entity(entity_id)
    return {"deleted": True, "entity_id": entity_id, "uid": uid}


@app.post("/api/room-light/{child_id}/toggle")
async def toggle_room_light(child_id: int):
    if not _child_enabled(child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")
    entity_id = _room_config_for_child(child_id).get("light_entity", "")
    if not entity_id:
        raise HTTPException(404, f"No light configured for child {child_id}")
    current = await _get_ha_state(entity_id)
    target_state = "off" if current.get("state") == "on" else "on"
    service = "homeassistant.turn_off" if target_state == "off" else "homeassistant.turn_on"
    await _call_ha_service(service, {"entity_id": entity_id})
    observed = target_state
    for delay in (0.08, 0.18, 0.35, 0.6):
        await asyncio.sleep(delay)
        updated = await _get_ha_state(entity_id)
        observed = updated.get("state")
        if observed == target_state:
            break
    return {"state": target_state if observed not in ("on", "off") else observed, "entity_id": entity_id}


@app.get("/api/room-camera/{child_id}")
async def room_camera(child_id: int):
    if not _child_enabled(child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")
    entity_id = _room_config_for_child(child_id).get("camera_entity", "")
    if not entity_id:
        raise HTTPException(404, f"No camera configured for child {child_id}")
    _require_home_assistant_api()
    try:
        response = await ha_client.get(
            f"camera_proxy/{entity_id}",
            headers={"Accept": "image/jpeg,image/png,image/*"},
        )
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Home Assistant")
    except httpx.TimeoutException:
        raise HTTPException(504, "Camera request timed out")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    return Response(
        content=response.content,
        media_type=response.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "no-store"},
    )


@app.put("/api/feeding-session/{entry_id}")
async def set_feeding_session(entry_id: int, request: Request):
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    try:
        active_seconds = max(0, int(payload.get("active_seconds", 0) or 0))
        segments = max(1, int(payload.get("segments", 1) or 1))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid feeding session values")
    paused = bool(payload.get("paused", False))
    details = _normalize_feeding_segment_details(payload.get("details"))
    last_breast = _normalize_last_breast(payload.get("last_breast"))
    _set_feeding_session_meta(
        entry_id,
        active_seconds,
        segments,
        paused,
        details=details,
        last_breast=last_breast,
    )
    return {
        "entry_id": entry_id,
        "active_seconds": active_seconds,
        "segments": segments,
        "paused": paused,
        "details": details,
        "last_breast": last_breast,
    }


@app.delete("/api/feeding-session/{entry_id}")
async def delete_feeding_session(entry_id: int):
    _delete_feeding_session_meta(entry_id)
    return {"deleted": True, "entry_id": entry_id}


UNDO_ENDPOINTS = {
    "feeding": "feedings",
    "sleep": "sleep",
    "diaper": "changes",
    "tummy": "tummy-times",
    "temp": "temperature",
    "weight": "weight",
    "height": "height",
    "note": "notes",
    "medication": "medication",
}

RESTORE_FIELDS = {
    "feeding": ("child", "start", "end", "type", "method", "amount", "notes", "tags"),
    "sleep": ("child", "start", "end", "nap", "notes", "tags"),
    "diaper": ("child", "time", "wet", "solid", "color", "amount", "notes", "tags"),
    "tummy": ("child", "start", "end", "milestone", "tags"),
    "temp": ("child", "temperature", "time", "notes", "tags"),
    "weight": ("child", "weight", "date", "notes", "tags"),
    "height": ("child", "height", "date", "notes", "tags"),
    "note": ("child", "note", "time", "tags"),
    "medication": ("child", "name", "dosage", "dosage_unit", "time", "next_dose_interval", "notes", "tags"),
}


def _clean_restore_payload(entry_type: str, snapshot: dict) -> dict:
    fields = RESTORE_FIELDS.get(entry_type, ())
    payload = {}
    for field in fields:
        if field not in snapshot:
            continue
        value = snapshot.get(field)
        if field == "child" and isinstance(value, dict):
            value = value.get("id")
        payload[field] = value
    return payload


async def _restore_one_diaper_to_grocy(size: str) -> tuple[bool, str | None]:
    size = str(size or "").strip()
    product_id = DIAPER_PRODUCT_IDS.get(size)
    if not GROCY_RESTORE_SERVICE:
        return False, "No hay un servicio configurado para devolver el pañal a Grocy."
    if not product_id:
        return False, f"La talla '{size or 'sin definir'}' no tiene producto de Grocy asociado."
    try:
        await _call_ha_service(
            GROCY_RESTORE_SERVICE,
            {"product_id": product_id, "amount": 1},
        )
        if GROCY_STOCK_ENTITY:
            try:
                await _call_ha_service("homeassistant.update_entity", {"entity_id": GROCY_STOCK_ENTITY})
            except HTTPException:
                pass
        return True, None
    except HTTPException as exc:
        return False, f"Grocy no pudo recuperar el pañal: {exc.detail}"


@app.post("/api/delete-entry")
async def delete_existing_entry(request: Request):
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")

    entry_type = str(payload.get("type", "")).strip()
    resource = UNDO_ENDPOINTS.get(entry_type)
    if not resource:
        raise HTTPException(400, "Unsupported entry type")
    try:
        entry_id = int(payload.get("id"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid entry id")

    try:
        before_response = await http_client.get(f"/api/{resource}/{entry_id}/")
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Baby Buddy")
    except httpx.TimeoutException:
        raise HTTPException(504, "Baby Buddy request timed out")
    if before_response.status_code >= 400:
        raise HTTPException(before_response.status_code, before_response.text)
    try:
        snapshot = before_response.json()
    except json.JSONDecodeError:
        raise HTTPException(502, "Baby Buddy returned invalid JSON")

    session = None
    if entry_type == "feeding":
        session = _feeding_session_meta([str(entry_id)]).get(str(entry_id))

    try:
        delete_response = await http_client.delete(f"/api/{resource}/{entry_id}/")
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Baby Buddy")
    except httpx.TimeoutException:
        raise HTTPException(504, "Baby Buddy request timed out")
    if delete_response.status_code >= 400:
        raise HTTPException(delete_response.status_code, delete_response.text)

    _record_audit(request, "delete", resource, entry_id, before=snapshot, after=None)
    if entry_type == "feeding":
        _delete_feeding_session_meta(entry_id)

    warning = None
    diaper_stock_restored = False
    diaper_size = str(payload.get("diaper_size", "") or "").strip()
    if entry_type == "diaper" and bool(payload.get("restore_diaper_stock", False)):
        diaper_stock_restored, warning = await _restore_one_diaper_to_grocy(diaper_size)

    return {
        "type": entry_type,
        "resource": resource,
        "old_id": entry_id,
        "snapshot": snapshot,
        "session": session,
        "diaper_size": diaper_size,
        "diaper_stock_restored": diaper_stock_restored,
        "warning": warning,
    }


@app.post("/api/restore-entry")
async def restore_deleted_entry(request: Request):
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")

    entry_type = str(payload.get("type", "")).strip()
    resource = UNDO_ENDPOINTS.get(entry_type)
    snapshot = payload.get("snapshot")
    if not resource or not isinstance(snapshot, dict):
        raise HTTPException(400, "Invalid deleted-entry snapshot")

    restore_payload = _clean_restore_payload(entry_type, snapshot)
    if not restore_payload:
        raise HTTPException(400, "Nothing to restore")

    try:
        response = await http_client.post(f"/api/{resource}/", json=restore_payload)
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Baby Buddy")
    except httpx.TimeoutException:
        raise HTTPException(504, "Baby Buddy request timed out")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    try:
        restored = response.json()
    except json.JSONDecodeError:
        raise HTTPException(502, "Baby Buddy returned invalid JSON")

    new_id = restored.get("id")
    if entry_type == "feeding" and new_id not in (None, "") and isinstance(payload.get("session"), dict):
        session = payload["session"]
        _set_feeding_session_meta(
            new_id,
            max(0, int(session.get("active_seconds", 0) or 0)),
            max(1, int(session.get("segments", 1) or 1)),
            bool(session.get("paused", False)),
            details=session.get("details"),
            last_breast=session.get("last_breast"),
        )

    warning = None
    if entry_type == "diaper" and bool(payload.get("diaper_stock_restored", False)):
        consume_payload = dict(restore_payload)
        consume_payload["_dashboard_diaper_size"] = str(payload.get("diaper_size", "") or "")
        grocy_result = await _consume_diaper_for_entry(consume_payload, restored)
        if not grocy_result.get("consumed"):
            warning = f"El pañal se recuperó en Baby Buddy, pero no se pudo volver a descontar en Grocy: {grocy_result.get('reason', 'error desconocido')}."

    _record_audit(
        request,
        "create",
        resource,
        new_id,
        before=None,
        after=restored,
        child_id=_child_id_from_entry(restored),
    )
    return {"restored": True, "id": new_id, "warning": warning}


@app.post("/api/undo-entry")
async def undo_entry(request: Request):
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    entry_type = str(payload.get("type", "")).strip()
    entry_id = payload.get("id")
    resource = UNDO_ENDPOINTS.get(entry_type)
    if not resource or entry_id in (None, ""):
        raise HTTPException(400, "Invalid entry type or id")

    try:
        numeric_entry_id = int(entry_id)
        before_response = await http_client.get(f"/api/{resource}/{numeric_entry_id}/")
        before_payload = before_response.json() if before_response.status_code < 400 else None
        delete_response = await http_client.delete(f"/api/{resource}/{numeric_entry_id}/")
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid entry id")
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Baby Buddy")
    except httpx.TimeoutException:
        raise HTTPException(504, "Baby Buddy request timed out")
    if delete_response.status_code >= 400:
        raise HTTPException(delete_response.status_code, delete_response.text)

    _record_audit(request, "undo", resource, entry_id, before=before_payload, after=None)
    if entry_type == "feeding":
        _delete_feeding_session_meta(entry_id)
    result = {"deleted": True, "stock_restored": None, "warning": None}
    if entry_type == "diaper":
        diaper_size = str(payload.get("diaper_size", "") or "").strip()
        product_id = DIAPER_PRODUCT_IDS.get(diaper_size)
        try:
            child_id = int(payload.get("childId", payload.get("child_id", 0)) or 0)
        except (TypeError, ValueError):
            child_id = 0
        processed_entity = DIAPER_LAST_PROCESSED_ENTITIES.get(child_id, "")
        processed_state = await _safe_state(processed_entity) if processed_entity else None
        was_consumed = bool(processed_state and str(processed_state.get("state", "")).strip() == str(entry_id).strip())

        if not was_consumed:
            # Mark the deleted ID as handled before Home Assistant can process a
            # delayed last_change update. This prevents a late Grocy decrement.
            if processed_entity:
                try:
                    current_value = int(str((processed_state or {}).get("state", "0")).strip() or 0)
                except (TypeError, ValueError):
                    current_value = 0
                try:
                    deleted_value = int(entry_id)
                except (TypeError, ValueError):
                    deleted_value = 0
                if deleted_value > current_value:
                    try:
                        await _call_ha_service(
                            "input_text.set_value",
                            {"entity_id": processed_entity, "value": str(entry_id)},
                        )
                    except HTTPException as exc:
                        result["warning"] = (
                            "El registro se borró antes de descontarse, pero no se pudo marcar "
                            f"como ignorado en Home Assistant: {exc.detail}"
                        )
            result["stock_restored"] = None
            if not result["warning"]:
                result["warning"] = "El registro se borró antes de descontarse en Grocy; no se añadió ni se quitó ninguna unidad."
        elif not GROCY_RESTORE_SERVICE:
            result["stock_restored"] = False
            result["warning"] = "El registro se borró, pero no hay un servicio configurado para devolver el pañal a Grocy."
        elif not product_id:
            result["stock_restored"] = False
            result["warning"] = f"El registro se borró, pero no existe un producto de Grocy para la talla '{diaper_size}'."
        else:
            try:
                await _call_ha_service(
                    GROCY_RESTORE_SERVICE,
                    {"product_id": product_id, "amount": 1},
                )
                result["stock_restored"] = True
            except HTTPException as exc:
                result["stock_restored"] = False
                result["warning"] = f"El registro se borró, pero Grocy no pudo recuperar el pañal: {exc.detail}"
    return result


@app.api_route(
    "/api/baby-buddy/{path:path}",
    methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
)
async def proxy_baby_buddy(path: str, request: Request):
    target_url = f"/api/{path}"
    params = dict(request.query_params)
    body = None
    request_payload: dict = {}
    content_type = request.headers.get("content-type", "")
    resource, entry_id = _path_resource_and_id(path)
    before_payload = None

    if request.method in ("POST", "PATCH", "PUT"):
        body = await request.body()
        if body and "application/json" in content_type:
            try:
                decoded = json.loads(body)
                if isinstance(decoded, dict):
                    request_payload = decoded
            except (json.JSONDecodeError, UnicodeDecodeError):
                request_payload = {}

    # Metadata local del dashboard: permite usar una talla distinta solo para
    # un cambio de pañal sin modificar la talla habitual de Home Assistant.
    # Baby Buddy no conoce este campo, así que se elimina únicamente del body
    # que se reenvía, conservándolo en request_payload para el descuento Grocy.
    if request.method == "POST" and resource == "changes" and request_payload.get("_dashboard_diaper_size"):
        forwarded_payload = dict(request_payload)
        forwarded_payload.pop("_dashboard_diaper_size", None)
        body = json.dumps(forwarded_payload).encode("utf-8")

    if request.method in ("PATCH", "PUT", "DELETE") and entry_id:
        try:
            before_response = await http_client.get(f"/api/{resource}/{entry_id}/")
            if before_response.status_code < 400:
                before_payload = before_response.json()
        except (httpx.HTTPError, json.JSONDecodeError):
            before_payload = None

    mutation_child_id = 0
    if request.method == "POST":
        mutation_child_id = _entry_child_id(request_payload, {})
    elif request.method in ("PATCH", "PUT", "DELETE") and isinstance(before_payload, dict):
        mutation_child_id = _entry_child_id(before_payload, {})
    if mutation_child_id > 0 and not _child_enabled(mutation_child_id):
        raise HTTPException(409, "Este bebé está deshabilitado en Baby Buddy Dashboard")

    try:
        headers = {}
        if body and "application/json" in content_type:
            headers["Content-Type"] = "application/json"
        response = await http_client.request(
            method=request.method,
            url=target_url,
            params=params,
            content=body,
            headers=headers,
        )
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Baby Buddy")
    except httpx.TimeoutException:
        raise HTTPException(504, "Baby Buddy request timed out")

    response_payload = None
    if response.content and "application/json" in response.headers.get("content-type", ""):
        try:
            response_payload = response.json()
        except json.JSONDecodeError:
            response_payload = None

    if (
        request.method == "GET"
        and resource == "children"
        and not entry_id
        and isinstance(response_payload, dict)
        and isinstance(response_payload.get("results"), list)
    ):
        _reconcile_child_visibility(response_payload["results"])
        response_payload["results"] = [
            child for child in response_payload["results"]
            if _child_enabled(_coerce_child_id(child))
        ]
        if isinstance(response_payload.get("count"), int):
            response_payload["count"] = len(response_payload["results"])

    if 200 <= response.status_code < 300:
        if request.method == "POST" and isinstance(response_payload, dict):
            created_id = response_payload.get("id")
            _record_audit(request, "create", resource, created_id, before=None, after=response_payload)
            if resource == "changes":
                grocy_result = await _consume_diaper_for_entry(request_payload, response_payload)
                response_payload["_grocy"] = grocy_result
            if TELEGRAM_ACTIVITY_NOTIFICATIONS and TELEGRAM_CHAT_ID not in ("", 0):
                asyncio.create_task(_notify_created_entry(path, request_payload, response_payload))
        elif request.method in ("PATCH", "PUT"):
            after_payload = response_payload if isinstance(response_payload, dict) else {**(before_payload or {}), **request_payload}
            _record_audit(request, "update", resource, entry_id, before=before_payload, after=after_payload)
        elif request.method == "DELETE":
            _record_audit(request, "delete", resource, entry_id, before=before_payload, after=None)
            if resource == "feedings" and entry_id:
                _delete_feeding_session_meta(entry_id)

        if request.method == "GET" and isinstance(response_payload, dict):
            response_payload = _attach_audit(resource, response_payload)
            if resource == "feedings":
                response_payload = _attach_feeding_session_meta(response_payload)
        elif isinstance(response_payload, dict) and response_payload.get("id") not in (None, ""):
            response_payload = _attach_audit(resource, response_payload)
            if resource == "feedings":
                response_payload = _attach_feeding_session_meta(response_payload)

    excluded_headers = {"transfer-encoding", "content-encoding", "content-length", "connection", "server"}
    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in excluded_headers}
    if response_payload is not None:
        return JSONResponse(content=response_payload, status_code=response.status_code, headers=response_headers)
    return Response(content=response.content, status_code=response.status_code, headers=response_headers)


@app.get("/api/media/{path:path}")
async def proxy_media(path: str):
    try:
        response = await http_client.get(f"/{path}", headers={"Accept": "*/*"})
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Baby Buddy")
    except httpx.TimeoutException:
        raise HTTPException(504, "Baby Buddy request timed out")
    if response.status_code != 200:
        raise HTTPException(response.status_code, "Media not found")
    return Response(
        content=response.content,
        headers={"Content-Type": response.headers.get("content-type", "application/octet-stream")},
    )


if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{path:path}")
    async def serve_spa(path: str, request: Request):
        file_path = STATIC_DIR / path
        if file_path.is_file() and ".." not in path:
            return FileResponse(file_path)
        ingress_path = request.headers.get("X-Ingress-Path", "")
        index_html = (STATIC_DIR / "index.html").read_text()
        if ingress_path:
            base_href = ingress_path.rstrip("/") + "/"
            index_html = index_html.replace("<head>", f'<head><base href="{base_href}">', 1)
        return Response(content=index_html, media_type="text/html", headers={"Cache-Control": "no-cache"})
