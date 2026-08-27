#!/usr/bin/env bash
#
# teliman-suspension.sh — Couper / restaurer le backend de Teliman Tracking Fleet
# à la demande. Quand la suspension est active, la plateforme affiche
# « impossible de joindre le serveur » à l'écran (sans casser les données ni
# toucher aux secrets). Le flag fonctionne à la volée : aucun restart PM2 requis.
#
# Usage:
#   teliman-suspension.sh            # afficher l'état actuel (suspended ou non)
#   teliman-suspension.sh on         # COUPER le backend (erreur à l'écran)
#   teliman-suspension.sh off        # RESTAURER le service (plateforme OK)
#   teliman-suspension.sh status     # alias de l'état
#
set -euo pipefail

# --- Configuration -----------------------------------------------------------
# Le chemin du lock est dérivé de TELIMAN_DATA_DIR (voir server.js l.96).
# En production il vaut : /home/pi/teliman-data
APP_DIR="${TELIMAN_APP_DIR:-/home/pi/teliman-tracking-fleeti}"
DATA_DIR="${TELIMAN_DATA_DIR:-/home/pi/teliman-data}"
LOCK_FILE="${TELIMAN_SERVICE_SUSPENSION_FILE:-$DATA_DIR/service-suspended.lock}"
STATUS_URL="http://127.0.0.1:8787/api/service-status"

# --- Helper ------------------------------------------------------------------
requested="${1:-status}"

current_state() {
  if [ -f "$LOCK_FILE" ]; then
    echo "SUSPENDU"
  else
    echo "ACTIF"
  fi
}

live_state() {
  local live
  live="$(curl -s --max-time 3 "$STATUS_URL" 2>/dev/null || echo '{}')"
  # Extrait champ « suspended » : true/false
  if printf '%s' "$live" | grep -q '"suspended":true'; then
    echo "SUSPENDU"
  elif printf '%s' "$live" | grep -q '"suspended":false'; then
    echo "ACTIF"
  else
    echo "INJOIGNABLE"
  fi
}

show_status() {
  local lock live
  lock="$(current_state)"
  live="$(live_state)"
  echo "📦 Teliman Tracking Fleet — état de la suspension"
  echo "   Fichier lock : $LOCK_FILE"
  echo "   État (lock)  : $lock"
  echo "   État (API)   : $live"
  case "$live" in
    SUSPENDU) echo "   → La plateforme affiche « impossible de joindre le serveur »." ;;
    ACTIF)    echo "   → Service opérationnel." ;;
    *)        echo "   → ⚠️ API injoignable (serveur éteint ou autre souci) ?" ;;
  esac
}

# --- Actions -----------------------------------------------------------------
case "$requested" in
  on)
    mkdir -p "$(dirname "$LOCK_FILE")"
    touch "$LOCK_FILE"
    echo "✅ Backend COUPÉ — la plateforme affiche « impossible de joindre le serveur »."
    echo "   Pour restaurer: teliman-suspension.sh off"
    echo ""
    show_status
    ;;
  off)
    if [ -f "$LOCK_FILE" ]; then
      rm -f "$LOCK_FILE"
      echo "✅ Service RESTAURÉ — les données opérationnelles sont de nouveau visibles."
    else
      echo "ℹ️  Aucun lock actif — le service était déjà opérationnel."
    fi
    echo ""
    show_status
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {on|off|status}"
    echo "  on      → couper le backend (erreur « impossible de joindre le serveur »)"
    echo "  off     → restaurer le service"
    echo "  (rien)  → afficher l'état actuel"
    exit 1
    ;;
esac
