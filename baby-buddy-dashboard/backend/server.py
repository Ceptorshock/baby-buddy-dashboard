import os
import json
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


def _load_diaper_size_entities(options: dict) -> dict[int, str]:
    raw = options.get("diaper_size_entities", [])
    result: dict[int, str] = {}

    # Current format: a list of {child_id, entity_id} entries.
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                child_id = int(item.get("child_id"))
            except (TypeError, ValueError):
                continue
            entity_id = str(item.get("entity_id", "")).strip()
            if entity_id:
                result[child_id] = entity_id

    # Also accept a simple dictionary for backwards/manual compatibility.
    elif isinstance(raw, dict):
        for key, value in raw.items():
            try:
                child_id = int(key)
            except (TypeError, ValueError):
                continue
            entity_id = str(value or "").strip()
            if entity_id:
                result[child_id] = entity_id

    # Preserve the helper already used by this installation when upgrading.
    if not result:
        result[1] = "input_select.bollito_talla_panal"
        result[2] = "input_select.bebe_2_talla_panal"

    return result

# Read Home Assistant app options. Environment variables still take precedence
# for the original Baby Buddy settings.
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


# --- API routes ---


@app.get("/api/config")
async def get_config():
    return {
        "refresh_interval": REFRESH_INTERVAL,
        "demo_mode": DEMO_MODE,
        "unit_system": UNIT_SYSTEM,
        "default_child_id": DEFAULT_CHILD_ID,
    }


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


@app.get("/api/diaper-sizes")
async def get_diaper_sizes():
    """Return the active diaper-size helper for every configured child."""
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
    """Change the Home Assistant input_select mapped to a Baby Buddy child."""
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

    try:
        response = await ha_client.post(
            "services/input_select/select_option",
            json={"entity_id": entity_id, "option": option},
        )
    except httpx.ConnectError:
        raise HTTPException(502, "Cannot connect to Home Assistant")
    except httpx.TimeoutException:
        raise HTTPException(504, "Home Assistant request timed out")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)

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


@app.api_route(
    "/api/baby-buddy/{path:path}",
    methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
)
async def proxy_baby_buddy(path: str, request: Request):
    """Proxy requests to the remote Baby Buddy API."""
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
    response_headers = {
        k: v
        for k, v in response.headers.items()
        if k.lower() not in excluded_headers
    }

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=response_headers,
    )


@app.get("/api/media/{path:path}")
async def proxy_media(path: str):
    """Proxy media files (e.g. child photos) from Baby Buddy."""
    try:
        response = await http_client.get(
            f"/{path}",
            headers={"Accept": "*/*"},
        )
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


# --- Static files (React SPA) ---

if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount(
            "/assets", StaticFiles(directory=str(assets_dir)), name="assets"
        )

    @app.get("/{path:path}")
    async def serve_spa(path: str, request: Request):
        file_path = STATIC_DIR / path
        if file_path.is_file() and ".." not in path:
            return FileResponse(file_path)

        # Inject <base> tag with ingress path so relative URLs resolve correctly
        ingress_path = request.headers.get("X-Ingress-Path", "")
        index_html = (STATIC_DIR / "index.html").read_text()
        if ingress_path:
            base_href = ingress_path.rstrip("/") + "/"
            index_html = index_html.replace("<head>", f'<head><base href="{base_href}">', 1)

        return Response(
            content=index_html,
            media_type="text/html",
            headers={"Cache-Control": "no-cache"},
        )
