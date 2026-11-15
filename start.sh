#!/usr/bin/env sh
# Startet den Bot dauerhaft auf Handy (Termux), Raspberry Pi oder Server.
# Stürzt er ab oder ist ein 6-Stunden-Lauf vorbei, holt er Updates und startet nach 10 Sekunden neu.
cd "$(dirname "$0")" || exit 1
if [ ! -f .env ]; then echo "Die Datei .env fehlt. Siehe ANLEITUNG.md, Teil 3."; exit 1; fi
set -a; . ./.env; set +a
export WER="${WER:-handy}"
REPO="${REPO:-timaxGg/Day-dr72818}"
git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
while true; do
  git pull -q --rebase origin main 2>/dev/null || git fetch -q origin main
  node bot/daytrader.mjs
  echo "Neustart in 10 Sekunden …"; sleep 10
done
