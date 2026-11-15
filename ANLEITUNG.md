# Day-Trader einrichten

Drei Teile: **1. App** (GitHub Pages), **2. Bot auf GitHub** (Backup, läuft immer), **3. Bot auf dem Handy** (Hauptbot, am schnellsten).
Teil 1 und 2 machst du einmal am Handy oder PC im Browser. Teil 3 später, wenn du das alte Android-Handy bereit hast.

---

## Teil 1 – App einschalten (2 Minuten)

1. Öffne **https://github.com/timaxGg/Day-dr72818/settings/pages**
2. Bei **Source**: „Deploy from a branch“
3. Bei **Branch**: `main` und Ordner `/ (root)` → **Save**
4. Nach 1–2 Minuten läuft die App unter **https://timaxgg.github.io/Day-dr72818/**
5. Auf dem Handy öffnen → Browser-Menü → **Zum Startbildschirm hinzufügen**

In der App unter ⚙️ siehst du ganz unten **„Verbindung App ↔ Bot“** mit Knopf **„Verbindung testen“** – dort steht, was noch fehlt.

Die App nimmt GitHub-Token, Sync-Passwort und Finnhub-Schlüssel automatisch aus deinem Aktien Helfer (gleiche Adresse timaxgg.github.io).
Falls dein GitHub-Token nur für den Aktien Helfer freigegeben ist: In der App ⚙️ → „Verbindung“ einen Token eintragen, der auch **Day-dr72818** darf (Rechte: *Contents: Read and write*, *Actions: Read and write*).

---

## Teil 2 – Bot auf GitHub (Backup) (5 Minuten)

### Schlüssel eintragen
Öffne **https://github.com/timaxGg/Day-dr72818/settings/secrets/actions** → **New repository secret**. Lege diese an:

| Name | Was |
|---|---|
| `TELEGRAM_TOKEN` | Token deines **neuen** Bots von @BotFather |
| `TELEGRAM_CHAT` | erst leer lassen, siehe unten |
| `FINNHUB_KEY` | derselbe wie beim Aktien Helfer |
| `SYNC_PASSWORD` | dasselbe Sync-Passwort wie in der App |
| `ANTHROPIC_API_KEY` | optional, für bessere Nachrichten-Auswertung |

### Chat-ID holen
1. Öffne **https://github.com/timaxGg/Day-dr72818/actions** → links **Wache** → **Run workflow**.
2. Schreib deinem neuen Bot in Telegram **Hallo**.
3. Nach 1–2 Minuten antwortet er mit deiner **Chat-ID**. Trag sie als Secret `TELEGRAM_CHAT` ein.
4. Noch einmal **Run workflow**. Ab jetzt schreibt der Bot dir.

Der Bot rechnet beim ersten Lauf die Statistik der letzten 60 Handelstage (dauert 1–3 Minuten). Danach startet er alle 5 Minuten von selbst, während der Börsenzeit bleibt er durchgehend wach.

---

## Teil 3 – Bot auf dem alten Android-Handy (15 Minuten)

Das Handy wird der **Hauptbot**: läuft rund um die Uhr ohne GitHub-Verzögerungen. GitHub springt nur ein, wenn das Handy ausfällt.

### 3.1 Vorbereitung
- Handy ans Ladekabel, WLAN an.
- **Termux** installieren von **https://f-droid.org/packages/com.termux/** (nicht aus dem Play Store – die Version dort ist veraltet).
- Android-Einstellungen → Apps → Termux → **Akku: Nicht einschränken / Keine Optimierung**.

### 3.2 GitHub-Token fürs Handy
1. **https://github.com/settings/personal-access-tokens/new**
2. Name `Day-Trader Handy`, Ablauf z. B. 1 Jahr
3. Repository access: **Only select repositories** → `Day-dr72818`
4. Permissions → Repository → **Contents: Read and write**
5. **Generate token** → kopieren (nur einmal sichtbar)

### 3.3 In Termux eingeben (Zeile für Zeile)
```
pkg update -y && pkg install -y nodejs git
git clone https://github.com/timaxGg/Day-dr72818 daytrader
cd daytrader
nano .env
```
In die Datei `.env` schreibst du (Werte ersetzen):
```
GH_TOKEN=dein_github_token_vom_handy
TELEGRAM_TOKEN=token_vom_botfather
TELEGRAM_CHAT=deine_chat_id
FINNHUB_KEY=dein_finnhub_schluessel
SYNC_PASSWORD=dein_sync_passwort
WER=handy
```
Speichern: **Strg+O**, Enter, **Strg+X** (Strg = Taste „CTRL“ in der Termux-Leiste).

Dann starten:
```
sh start.sh
```
Termux offen lassen (darf im Hintergrund sein). Im Status (`/status` an den Bot) steht dann „Läuft auf: handy“.

**Nach einem Neustart des Handys:** Termux öffnen, `cd daytrader && sh start.sh`.

---

## Später: Raspberry Pi oder kostenloser Oracle-Server
Gleiche Schritte wie 3.3, nur mit `sudo apt install -y nodejs git` statt `pkg …` und `WER=server` in der `.env`. Node.js muss Version 20 oder neuer sein (`node -v`).

---

## So arbeitet der Bot
- **Aktien:** 150 – 80 aus den USA, 40 aus dem DAX, 30 große europäische Werte.
- **Kurse:** Yahoo (5-Minuten-Kerzen, Europa ca. 15 Min. verzögert), Finnhub live für US-Aktien in deinen Trades.
- **Produkte:** Knock-out (Standard), Faktor-Zertifikat oder Aktie. Beim Knock-out die Schwelle aus dem Namen in Trade Republic eintragen („Long 174,43 $“ → 174,43) – die App rechnet Hebel und Abstand zum Knock-out live.
- **Muster:** 10 feste Regeln (5 Long, 5 Short), jede an den letzten 60 Handelstagen nachgerechnet: Was kam zuerst, Ziel oder Stop? Kommen beide in derselben 5-Minuten-Kerze, zählt es als Stop.
- **Keine Signale** in den ersten 15 und letzten 45 Minuten, bei schlechten Nachrichten und an Tagen mit Quartalszahlen.
- **Selbstkontrolle:** Jedes Signal wird nach Ablauf mit dem echten Verlauf verglichen (App → Bilanz). Fehler und Ausfälle stehen in `/status` und in der App.

Keine Anlageberatung. Mit Hebel kann der Einsatz schnell verloren sein.
