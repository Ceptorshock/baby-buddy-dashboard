import os
import json
import asyncio
from contextlib import asynccontextmanager
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
GROCY_RESTORE_SERVICE = str(OPTIONS.get("grocy_restore_service", "") or "").strip()
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
    yield
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


async def _safe_state(entity_id: str) -> dict | None:
    if not entity_id:
        return None
    try:
        return await _get_ha_state(entity_id)
    except HTTPException:
        return None


# --- API routes ---


@app.get("/api/config")
async def get_config():
    return {
        "refresh_interval": REFRESH_INTERVAL,
        "demo_mode": DEMO_MODE,
        "unit_system": UNIT_SYSTEM,
        "default_child_id": DEFAULT_CHILD_ID,
        "alerts": ALERTS_CONFIG,
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
    for child_id, config in ROOM_ENTITIES.items():
        temp, humidity, light, window, stock = await asyncio.gather(
            _safe_state(config.get("temperature_entity", "")),
            _safe_state(config.get("humidity_entity", "")),
            _safe_state(config.get("light_entity", "")),
            _safe_state(config.get("window_entity", "")),
            _safe_state(config.get("diaper_stock_entity", "")),
        )
        rooms[str(child_id)] = {
            "configured": True,
            "temperature": temp.get("state") if temp else None,
            "humidity": humidity.get("state") if humidity else None,
            "light": light.get("state") if light else None,
            "window": window.get("state") if window else None,
            "diaper_stock": stock.get("state") if stock else None,
            "has_light": bool(config.get("light_entity")),
            "has_camera": bool(config.get("camera_entity")),
            "camera_url": f"./api/room-camera/{child_id}" if config.get("camera_entity") else None,
        }
    return {"available": bool(SUPERVISOR_TOKEN), "rooms": rooms}


@app.post("/api/room-light/{child_id}/toggle")
async def toggle_room_light(child_id: int):
    entity_id = ROOM_ENTITIES.get(child_id, {}).get("light_entity", "")
    if not entity_id:
        raise HTTPException(404, f"No light configured for child {child_id}")
    await _call_ha_service("homeassistant.toggle", {"entity_id": entity_id})
    updated = await _get_ha_state(entity_id)
    return {"state": updated.get("state"), "entity_id": entity_id}


@app.get("/api/room-camera/{child_id}")
async def room_camera(child_id: int):
    entity_id = ROOM_ENTITIES.get(child_id, {}).get("camera_entity", "")
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
    content_type = request.headers.get("content-type", "")
    if request.method in ("POST", "PATCH", "PUT"):
        body = await request.body()
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
