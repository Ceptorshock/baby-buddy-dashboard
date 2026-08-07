#!/usr/bin/with-contenv bashio

# ES18.3: estos dos ajustes se gestionan ahora desde el engranaje de la app.
# Eliminamos las claves antiguas de Supervisor para que no queden opciones
# huérfanas al desaparecer del schema de config.yaml.
_options="$(bashio::addon.options)"
for _legacy_key in bollito2_enabled disabled_child_ids; do
    if bashio::jq.exists "${_options}" ".${_legacy_key}"; then
        bashio::log.info "Migrating legacy option ${_legacy_key} to in-app settings"
        bashio::addon.option "${_legacy_key}"
    fi
done


# Read configuration from HA add-on options
export BABY_BUDDY_URL=$(bashio::config 'baby_buddy_url')
export BABY_BUDDY_API_KEY=$(bashio::config 'baby_buddy_api_key')
export REFRESH_INTERVAL=$(bashio::config 'refresh_interval')
export DEMO_MODE=$(bashio::config 'demo_mode')
export UNIT_SYSTEM=$(bashio::config 'unit_system')

bashio::log.info "Starting Baby Buddy Dashboard..."
bashio::log.info "Connecting to Baby Buddy at: ${BABY_BUDDY_URL}"

cd /app
exec python3 -m uvicorn backend.server:app \
    --host 0.0.0.0 \
    --port 8099 \
    --log-level info \
    --no-server-header
