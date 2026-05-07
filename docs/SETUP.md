# Entwicklungsumgebung einrichten

## Voraussetzungen

| Tool | Mindestversion | Prüfen mit |
|---|---|---|
| Node.js | 18.x | `node --version` |
| npm | 9.x | `npm --version` |
| MySQL | 8.0 | `mysql --version` |
| Git | 2.x | `git --version` |

---

## 1. Repository klonen

```bash
git clone https://github.com/andreasknopke/CuraFlow.git
cd CuraFlow
```

---

## 2. MySQL-Datenbank einrichten

### Datenbank und Benutzer anlegen

```sql
CREATE DATABASE curaflow_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'curaflow'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON curaflow_dev.* TO 'curaflow'@'localhost';
FLUSH PRIVILEGES;
```

### Schema initialisieren

CuraFlow erstellt Tabellen automatisch beim ersten Start (Auto-Migration in `server/index.js`). Alternativ können die SQL-Dateien aus `server/migrations/` manuell eingespielt werden:

```bash
# Basis-Schema (falls kein Auto-Migrate)
mysql -u curaflow -p curaflow_dev < server/migrations/004_create_workplace_timeslot_table.sql
mysql -u curaflow -p curaflow_dev < server/migrations/005_create_timeslot_template_table.sql
# ... weitere Migrations-Dateien in aufsteigender Reihenfolge
```

### Admin-Benutzer anlegen

```bash
cd server
node scripts/set-default-password.js
```

Oder direkt in MySQL:

```sql
INSERT INTO app_users (email, password_hash, role, full_name, is_active)
VALUES (
  'admin@example.com',
  '$2a$10$...bcrypt-hash...',  -- bcryptjs mit 10 rounds
  'admin',
  'System Administrator',
  1
);
```

---

## 3. Backend konfigurieren

```bash
cd server
cp .env.example .env   # Falls vorhanden, sonst manuell anlegen
```

`.env` für die lokale Entwicklung:

```env
# Datenbank
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=curaflow
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=curaflow_dev

# Auth
JWT_SECRET=ein-sehr-langer-zufaelliger-string-min-32-zeichen

# Server
PORT=3000
NODE_ENV=development

# Optional: E-Mail (für Benachrichtigungen)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=smtp_password
SMTP_FROM=CuraFlow <noreply@example.com>

# Optional: ElevenLabs (für Sprachsteuerung)
ELEVENLABS_API_KEY=your_elevenlabs_key

# Optional: Vision-LLM zur Prüfung von Qualifikations-Zertifikaten
# (vLLM, OpenAI-kompatible API, ohne Auth – z.B. lokal gehostet)
LLM_VISION_BASE_URL=http://localhost:8000/v1
LLM_VISION_MODEL=Qwen2.5-VL-7B-Instruct
```

### Backend starten

```bash
cd server
npm install
npm run dev   # Startet mit --watch (auto-reload)
```

Der Server läuft auf `http://localhost:3000`.

---

## 4. Frontend konfigurieren

```bash
# Im Root-Verzeichnis
cp .env.example .env.local  # Falls vorhanden
```

`.env.local` für die lokale Entwicklung:

```env
VITE_API_URL=http://localhost:3000
VITE_JITSI_BASE_URL=https://meet.jit.si
```

### Frontend starten

```bash
# Im Root-Verzeichnis
npm install
npm run dev   # Vite Dev-Server auf http://localhost:5173
```

---

## 5. Beide Services parallel starten

Empfohlen: Zwei Terminal-Fenster öffnen.

```bash
# Terminal 1: Backend
cd server && npm run dev

# Terminal 2: Frontend
cd /workspaces/CuraFlow && npm run dev
```

Zur Vereinfachung kann auch ein Tool wie `concurrently` genutzt werden:

```bash
npm install -g concurrently
concurrently "cd server && npm run dev" "npm run dev"
```

---

## 6. Erster Login

Nach dem Start:

1. Browser öffnen: `http://localhost:5173`
2. Login mit dem angelegten Admin-Account
3. Im Admin-Bereich (`/Admin`) weitere Benutzer und Mitarbeitende anlegen

---

## Projekt-Skripte

### Frontend (`package.json` im Root)

| Skript | Beschreibung |
|---|---|
| `npm run dev` | Vite Dev-Server starten |
| `npm run build` | Produktions-Build erstellen (`dist/`) |
| `npm run preview` | Produktions-Build lokal vorschauen |
| `npm run lint` | ESLint ausführen |
| `npm run lint:fix` | ESLint mit Auto-Fix |

### Backend (`server/package.json`)

| Skript | Beschreibung |
|---|---|
| `npm start` | Produktionsstart |
| `npm run dev` | Entwicklung mit Auto-Reload |
| `npm run migrate` | Datenmigration von Base44 ausführen |

---

## Umgebungsvariablen Referenz

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `MYSQL_HOST` | ✅ | MySQL-Host (z.B. `localhost`) |
| `MYSQL_PORT` | ☐ | MySQL-Port (Standard: `3306`) |
| `MYSQL_USER` | ✅ | Datenbankbenutzer |
| `MYSQL_PASSWORD` | ✅ | Datenbankpasswort |
| `MYSQL_DATABASE` | ✅ | Datenbankname |
| `JWT_SECRET` | ✅ | Geheimer Schlüssel für JWT (min. 32 Zeichen) |
| `PORT` | ☐ | Server-Port (Standard: `3000`) |
| `NODE_ENV` | ☐ | `development` oder `production` |
| `VITE_API_URL` | ✅ (FE) | URL des Backends (für Frontend-Build) |
| `VITE_JITSI_BASE_URL` | ☐ (FE) | Basis-URL für CoWork (Jitsi), z.B. `https://meet.jit.si` oder `https://jitsi.eure-domain.tld` |
| `COWORK_INVITE_EXPIRY_MINUTES` | ☐ | Gültigkeit einer CoWork-Einladung in Minuten (Standard: `10`) |
| `COWORK_ONLINE_WINDOW_SECONDS` | ☐ | Ab wann ein Benutzer in CoWork als offline gilt (Standard: `120`) |
| `SMTP_HOST` | ☐ | SMTP-Server für E-Mails |
| `SMTP_PORT` | ☐ | SMTP-Port |
| `SMTP_USER` | ☐ | SMTP-Benutzername |
| `SMTP_PASS` | ☐ | SMTP-Passwort |
| `SMTP_FROM` | ☐ | Absenderadresse für E-Mails |
| `ELEVENLABS_API_KEY` | ☐ | API-Key für ElevenLabs (Sprachsteuerung) |
| `ALLOWED_ORIGINS` | ☐ | Kommaseparierte CORS-Origins |
| `LLM_VISION_BASE_URL` | ☐ | OpenAI-kompatible Basis-URL eines lokalen Vision-LLM (z.B. vLLM `http://localhost:8000/v1`). Aktiviert die automatische Prüfung hochgeladener Qualifikations-Zertifikate. |
| `LLM_VISION_MODEL` | ☐ | Modellname, der dem Endpoint übergeben wird (z.B. `Qwen2.5-VL-7B-Instruct`). |

---

## CoWork (Jitsi) – kostenloses MVP

Standardmäßig nutzt CuraFlow `https://meet.jit.si`. Das ist kostenlos, aber ohne SLA/Verfügbarkeitsgarantie.

Für die spätere Produktiv-Installation mit eigener Instanz siehe Runbook: `docs/COWORK_JITSI_RUNBOOK.md`.

Für produktive Nutzung ohne JaaS-Demo-Limits:

1. Eigene Jitsi-Instanz bereitstellen (z.B. auf Ubuntu-VM, eigene Subdomain mit TLS)
2. Frontend-Variable setzen:

```env
VITE_JITSI_BASE_URL=https://jitsi.eure-domain.tld
```

3. Frontend neu bauen/deployen (`npm run build`)

Hinweis: `VITE_JITSI_BASE_URL` ohne Slash am Ende angeben (ein trailing Slash wird zur Laufzeit automatisch entfernt).

Mit dem aktuellen CoWork-MVP gilt zusaetzlich:

1. Nach Backend-Deployment Server einmal neu starten oder im Adminbereich die Migrationen ausfuehren.
2. Admins koennen im CoWork-Widget online Admins direkt einladen.
3. Eingeladene Admins sehen die Einladung in CuraFlow automatisch und treten ohne Link-Kopieren bei.

---

## Code-Konventionen

- **Sprache:** JavaScript (ES Modules), JSX für React-Komponenten, kein TypeScript im Frontend
- **Einrückung:** 2 Spaces
- **Imports:** Pfad-Alias `@/` zeigt auf `src/` (konfiguriert in `vite.config.js` und `jsconfig.json`)
- **UI-Komponenten:** shadcn/ui aus `src/components/ui/` – nie direkt Radix-UI importieren
- **API-Calls:** Immer über `db.*` oder `api.*` aus `@/api/client` – nie direkte `fetch()`-Calls in Komponenten
- **Datenbankabfragen:** Ausschließlich über `req.db.execute()` im Backend (nie direkter Import von `db`)

---

## Typische Erweiterungspunkte

### Neue Seite hinzufügen

1. Komponente in `src/pages/MyNewPage.jsx` erstellen
2. In `src/pages.config.js` registrieren
3. Route wird automatisch als `/<ComponentName>` verfügbar

### Neue Entität/Tabelle hinzufügen

1. SQL-Migration in `server/migrations/XXX_describe.sql` anlegen
2. Tabelle im CRUD-Proxy `server/routes/dbProxy.js` registrieren
3. Im Frontend `db.MyEntity.list()` / `.create()` etc. nutzen

### Neue API-Route hinzufügen

1. Router-Datei in `server/routes/myFeature.js` erstellen
2. In `server/index.js` importieren und mounten: `app.use('/api/myfeature', myRouter)`
