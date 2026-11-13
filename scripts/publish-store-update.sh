#!/usr/bin/env zsh
# Publish a JavaScript/assets-only OTA update to the GOOGLE PLAY build only.
#
# This wrapper exists to make three release-critical details impossible to forget:
#   1. APP_VARIANT=store, so app.config.js resolves com.anupam.lifepilot's native
#      configuration rather than the legacy com.anupam.lp variant.
#   2. store-production, an OTA channel isolated from LP LAB and legacy binaries.
#   3. .env is exported before bundling. Without it, Expo can inline an undefined
#      Supabase URL and publish an update that opens to a grey screen.
#
# Native changes (plugins, dependencies, permissions, widgets, app.config.js) must
# go through Google Play as a new AAB; this script cannot deliver them.
#
# Usage:
#   npm run update:store -- "Short description of the fix"

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
cd "$PROJECT_ROOT"

if [[ ! -f .env ]]; then
  print -u2 "Refusing to publish: $PROJECT_ROOT/.env is missing."
  exit 1
fi

MESSAGE="${*:-}"
if [[ -z "${MESSAGE// /}" ]]; then
  print -u2 'Usage: npm run update:store -- "Short description of the fix"'
  exit 1
fi

set -a
source ./.env
set +a
export APP_VARIANT=store
# These are store invariants, not developer-machine preferences. The EAS build
# profile sets the same values; exporting them here ensures app.config.js is
# resolved safely before the remote environment is merged by the update command.
export EXPO_PUBLIC_REQUIRE_AI_PROXY=true
export EXPO_PUBLIC_ALARMS_ENABLED=false
export EXPO_PUBLIC_PLAYSTORE_MODE="${EXPO_PUBLIC_PLAYSTORE_MODE:-false}"

required=(
  EXPO_PUBLIC_SUPABASE_URL
  EXPO_PUBLIC_SUPABASE_ANON_KEY
  EXPO_PUBLIC_AI_PROXY_URL
  EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID
)
for name in "${required[@]}"; do
  if [[ -z "${(P)name:-}" ]]; then
    print -u2 "Refusing to publish: $name is empty."
    exit 1
  fi
done

if [[ "${EXPO_PUBLIC_REQUIRE_AI_PROXY:-}" != "true" && "${EXPO_PUBLIC_REQUIRE_AI_PROXY:-}" != "1" ]]; then
  print -u2 'Refusing to publish: EXPO_PUBLIC_REQUIRE_AI_PROXY must be true.'
  exit 1
fi

print "Publishing Android OTA to channel store-production..."
exec eas update \
  --channel store-production \
  --environment production \
  --platform android \
  --message "$MESSAGE" \
  --non-interactive
