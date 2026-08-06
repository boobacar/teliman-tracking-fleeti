#!/usr/bin/env bash
# Déploiement vérifié : tests → build → backup dist → restart PM2 → health check.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 Tests =="
npm test

echo "== 2/5 Build (commit injecté) =="
npm run build

echo "== 3/5 Backup dist précédent =="
if [ -d dist ]; then
  BACKUP="dist.backup.$(date +%Y%m%d-%H%M%S)"
  cp -r dist "$BACKUP"
  echo "  backup → $BACKUP"
  # ne garder que les 3 derniers backups
  ls -d dist.backup.* 2>/dev/null | head -n -3 | xargs -r rm -rf
fi

echo "== 4/5 Restart PM2 =="
pm2 restart teliman-tracking-fleeti --silent

echo "== 5/5 Health check =="
sleep 3
curl -fsS http://127.0.0.1:8787/api/health/live
echo ""
echo "== DÉPLOIEMENT TERMINÉ =="
