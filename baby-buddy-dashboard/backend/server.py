import os
import json
import asyncio
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx

# --- Configuration ---

BABY_BUDDY_URL = os.environ.get("BABY_BUDDY_URL", "").rstrip("/")
BABY_BUDDY_API_KEY = os.environ.get("BABY_BUDDY_API_KEY", "")
REFRESH_INTERVAL = int(os.environ.get("REFRESH_INTERVAL", "30"))
DEMO_MODE = os.environ.get("DEMO_MODE", "").lower() in ("true", "1", "yes")
UNIT_SYSTEM = os.environ.get("UNIT_SYSTEM", "metric").lower()
DEFAULT_CHILD_ID = int(os.environ.get("DEFAULT_CHILD_ID", "0") or 0)
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")

logger = logging.getLogger("baby_buddy_dashboard")


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
        result[2] = "input_select.bebe_2_talla_panal"
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
try:
    SHARED_ROOM_CHILD_ID = int(OPTIONS.get("shared_room_child_id", 0) or 0)
except (TypeError, ValueError):
    SHARED_ROOM_CHILD_ID = 0
CALENDAR_DAYS_AHEAD = max(1, int(OPTIONS.get("calendar_days_ahead", 90) or 90))
CALENDAR_MAX_EVENTS = max(1, int(OPTIONS.get("calendar_max_events", 4) or 4))
GROCY_RESTORE_SERVICE = str(OPTIONS.get("grocy_restore_service", "") or "").strip()
GROCY_STOCK_ENTITY = str(OPTIONS.get("grocy_stock_entity", "sensor.grocy_stock_por_ubicacion") or "").strip()
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
            "timer,feeding,sleep,diaper,tummy,temperature,weight,height,note,pumping",
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

STATIC_DIR = Path(__file__).parent.parent / "static"

# --- App lifecycle ---

http_client: httpx.AsyncClient | None = None
ha_client: httpx.AsyncClient | None = None
active_alerts: dict[str, dict] = {}
child_name_cache: dict[int, str] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, ha_client
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
    # CalendarEntityFeature.CREATE_EVENT = 1.
    writable = bool(supported_features & 1)
    services: set[str] = set()
    try:
        services = await _get_ha_services()
    except HTTPException:
        # The entity feature remains the best source of truth.
        pass
    available_actions = [
        action for action in ("calendar.create_event", "google.create_event")
        if action in services
    ]
    error = ""
    if not writable:
        error = (
            f"{entity_id} está en solo lectura. En Ajustes → Dispositivos y servicios → "
            "Google Calendar → Configurar, activa el acceso de lectura y escritura y vuelve "
            "a autorizar la cuenta."
        )
    elif services and not available_actions:
        writable = False
        error = "Home Assistant no expone ninguna acción para crear eventos de calendario."
    return {
        "writable": writable,
        "write_error": error,
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


def _room_config_for_child(child_id: int) -> dict[str, str]:
    config = ROOM_ENTITIES.get(child_id)
    if config:
        return config
    if SHARED_ROOM_CHILD_ID > 0:
        return ROOM_ENTITIES.get(SHARED_ROOM_CHILD_ID, {})
    return {}


async def _child_name(child_id: int) -> str:
    if child_id <= 0:
        return CHILD_NAMES.get(DEFAULT_CHILD_ID, "Bollito")
    configured_name = CHILD_NAMES.get(child_id)
    if configured_name:
        child_name_cache[child_id] = configured_name
        return configured_name
    if child_id in child_name_cache:
        return child_name_cache[child_id]
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
    }
    notification_type = type_map.get(resource)
    if not notification_type or notification_type not in TELEGRAM_ACTIVITY_TYPES:
        return

    child_id = _entry_child_id(payload, result)
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

    if message:
        await _send_telegram_activity(message)


async def _send_alert(alert: dict):
    notification_id = _notification_id(alert["key"])
    title = alert.get("title", "Aviso de Baby Buddy")
    message = alert.get("message", "")

    if HOME_ASSISTANT_ALERT_NOTIFICATIONS:
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
    timers = await _baby_buddy_results("timers", {"limit": 100})
    alerts: list[dict] = []

    for child in children:
        try:
            child_id = int(child.get("id"))
        except (TypeError, ValueError):
            continue
        child_name = await _child_name(child_id)

        feedings = await _baby_buddy_results(
            "feedings",
            {"child": child_id, "limit": 1, "ordering": "-start"},
        )
        if feedings:
            feeding = feedings[0]
            feeding_time = _parse_datetime(feeding.get("end") or feeding.get("start"))
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

        for timer in timers:
            timer_child = _timer_child_id(timer)
            if timer_child not in (0, child_id):
                continue
            started = _parse_datetime(timer.get("start"))
            if not started:
                continue
            elapsed_minutes = max(0, int((now - started.astimezone(timezone.utc)).total_seconds() // 60))
            if elapsed_minutes >= ALERTS_CONFIG["active_timer_minutes"]:
                timer_name = str(timer.get("name") or "Actividad")
                alerts.append({
                    "key": f"active_timer:{child_id}:{timer.get('id', timer_name)}",
                    "type": "active_timer",
                    "title": f"Actividad larga · {child_name}",
                    "message": f"El temporizador «{timer_name}» lleva {elapsed_minutes} minutos activo.",
                    "alexa_message": f"Aviso. La actividad {timer_name} de {child_name} lleva {elapsed_minutes} minutos activa.",
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
        "alerts": ALERTS_CONFIG,
        "calendar_days_ahead": CALENDAR_DAYS_AHEAD,
        "calendar_max_events": CALENDAR_MAX_EVENTS,
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


@app.get("/api/diaper-sizes")
async def get_diaper_sizes():
    sizes: dict[str, dict] = {}
    for child_id, entity_id in DIAPER_SIZE_ENTITIES.items():
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


@app.get("/api/room-status")
async def get_room_statuses():
    rooms: dict[str, dict] = {}
    child_ids = set(ROOM_ENTITIES) | set(DIAPER_SIZE_ENTITIES) | set(CALENDAR_ENTITIES) | set(CHILD_NAMES)
    for child_id in child_ids:
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
        try:
            raw_events = await _get_calendar_events(entity_id)
            events = []
            for raw in raw_events[:CALENDAR_MAX_EVENTS]:
                start, all_day = _calendar_start(raw)
                if not start:
                    continue
                events.append({
                    "summary": str(raw.get("summary") or "Cita"),
                    "start": start,
                    "all_day": all_day,
                    "location": str(raw.get("location") or "").strip(),
                    "description": str(raw.get("description") or "").strip(),
                })
            capability = await _calendar_write_capability(entity_id)
            calendars[str(child_id)] = {
                "configured": True,
                "available": True,
                "entity_id": entity_id,
                "events": events,
                **capability,
            }
        except HTTPException as exc:
            calendars[str(child_id)] = {
                "configured": True,
                "available": False,
                "entity_id": entity_id,
                "events": [],
                "error": exc.detail,
            }
    return {"available": bool(SUPERVISOR_TOKEN), "calendars": calendars}


@app.post("/api/calendar-events/{child_id}")
async def create_calendar_event(child_id: int, request: Request):
    entity_id = CALENDAR_ENTITIES.get(child_id)
    if not entity_id:
        raise HTTPException(404, f"No calendar configured for child {child_id}")

    capability = await _calendar_write_capability(entity_id)
    if not capability.get("writable"):
        raise HTTPException(409, capability.get("write_error") or "Calendar is read-only")

    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")

    summary = str(payload.get("summary") or "").strip()
    start_date_time = str(payload.get("start_date_time") or "").strip()
    end_date_time = str(payload.get("end_date_time") or "").strip()
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

    service_data = {
        "entity_id": entity_id,
        "summary": summary,
        "start_date_time": start_date_time,
        "end_date_time": end_date_time,
    }
    if location:
        service_data["location"] = location
    if description:
        service_data["description"] = description

    available_actions = capability.get("available_actions") or []
    action_order = [
        action for action in ("calendar.create_event", "google.create_event")
        if action in available_actions
    ]
    # Older Home Assistant versions may not expose service metadata reliably.
    if not action_order:
        action_order = ["calendar.create_event", "google.create_event"]

    failures: list[str] = []
    used_action = ""
    for action in action_order:
        try:
            await _call_ha_service(action, service_data)
            used_action = action
            break
        except HTTPException as exc:
            failures.append(f"{action}: {exc.detail}")

    if not used_action:
        detail = " | ".join(failures) or "Home Assistant rejected the calendar event"
        raise HTTPException(502, detail)

    # Ask Home Assistant to refresh the calendar and verify the new item. Google can
    # take a few seconds to expose a just-created event, so retry briefly.
    try:
        await _call_ha_service("homeassistant.update_entity", {"entity_id": entity_id})
    except HTTPException:
        pass

    verified = False
    normalized_start = start_value.replace(tzinfo=None).isoformat(timespec="seconds")
    for delay in (0.4, 1.0, 1.8):
        await asyncio.sleep(delay)
        try:
            events = await _get_calendar_events(entity_id)
        except HTTPException:
            continue
        for event in events:
            event_start, _ = _calendar_start(event)
            if not event_start:
                continue
            try:
                event_start_value = datetime.fromisoformat(str(event_start).replace("Z", "+00:00"))
                event_start_normalized = event_start_value.replace(tzinfo=None).isoformat(timespec="seconds")
            except ValueError:
                event_start_normalized = str(event_start)
            if str(event.get("summary") or "").strip() == summary and event_start_normalized == normalized_start:
                verified = True
                break
        if verified:
            break

    return {
        "created": True,
        "verified": verified,
        "pending_sync": not verified,
        "service": used_action,
        "entity_id": entity_id,
        "summary": summary,
        "start": start_date_time,
        "end": end_date_time,
        "location": location,
    }


@app.post("/api/room-light/{child_id}/toggle")
async def toggle_room_light(child_id: int):
    entity_id = _room_config_for_child(child_id).get("light_entity", "")
    if not entity_id:
        raise HTTPException(404, f"No light configured for child {child_id}")
    await _call_ha_service("homeassistant.toggle", {"entity_id": entity_id})
    updated = await _get_ha_state(entity_id)
    return {"state": updated.get("state"), "entity_id": entity_id}


@app.get("/api/room-camera/{child_id}")
async def room_camera(child_id: int):
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


UNDO_ENDPOINTS = {
    "feeding": "feedings",
    "sleep": "sleep",
    "diaper": "changes",
    "tummy": "tummy-times",
    "temp": "temperature",
    "weight": "weight",
    "height": "height",
    "note": "notes",
}


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
        delete_response = await http_client.delete(f"/api/{resource}/{int(entry_id)}/")
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid entry id")
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Baby Buddy")
    except httpx.TimeoutException:
        raise HTTPException(504, "Baby Buddy request timed out")
    if delete_response.status_code >= 400:
        raise HTTPException(delete_response.status_code, delete_response.text)

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
    if request.method in ("POST", "PATCH", "PUT"):
        body = await request.body()
        if body and "application/json" in content_type:
            try:
                decoded = json.loads(body)
                if isinstance(decoded, dict):
                    request_payload = decoded
            except (json.JSONDecodeError, UnicodeDecodeError):
                request_payload = {}
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
    if (
        request.method == "POST"
        and 200 <= response.status_code < 300
        and TELEGRAM_ACTIVITY_NOTIFICATIONS
        and TELEGRAM_CHAT_ID not in ("", 0)
    ):
        try:
            response_payload = response.json()
        except json.JSONDecodeError:
            response_payload = {}
        if isinstance(response_payload, dict):
            asyncio.create_task(
                _notify_created_entry(path, request_payload, response_payload)
            )

    excluded_headers = {"transfer-encoding", "content-encoding", "content-length", "connection", "server"}
    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in excluded_headers}
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
