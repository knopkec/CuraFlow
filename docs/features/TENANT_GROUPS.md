# Cross-Department Scheduling – Tenant Groups & Shared Pools

> **Stand:** Mai 2026  
> **Status:** Entwurf (Option B aus der DP.xlsx-Analyse)  
> **Bezug:** [CENTRAL_EMPLOYEE_MANAGEMENT.md](CENTRAL_EMPLOYEE_MANAGEMENT.md), [SCHEDULE.md](SCHEDULE.md), [STATISTICS.md](STATISTICS.md), [AUTH.md](AUTH.md)

---

## 1. Ziel

Eine Klinik betreibt jede internistische Abteilung (INZ, IN II / Pneu, IN III / Kardio, IN IV / Gastro, IN V / Onko, Rheuma, Geriatrie, …) als **eigenen Mandanten**. Damit bleiben Dienstplan, Statistik und Sichtbarkeit pro Abteilung so übersichtlich wie heute.

Gleichzeitig existieren **abteilungsübergreifende Dienste**, die aus einem Pool aller beteiligten Abteilungen besetzt werden müssen (laut [DP.xlsx](../../artifacts/DP.xlsx)):

| Pool | Regel |
|---|---|
| **AD** – Aufnahmedienst Notaufnahme/Innere | täglich 2 Personen, „neu + erfahren“ am gleichen Tag |
| **KWE** – Kardiologie 24 h | täglich 1 Person aus IN3 / KWE / Echo / IN5 / IN4 |
| **OD** – Allgemein-Innere Rufbereitschaft | jedes Wochenende, 1 Oberarzt rotierend |
| **WE-F** – Wochenend-Frühdienst | Sa + So, 2 Personen aus dem Gesamtpool |
| optional **HD / HSD / Rheu / Neuro / Endo / NAD / BD** | je nach Subspezialität pool- oder abteilungsgebunden |

### Nicht-Ziele

- **Keine** Aufweichung der Mandantengrenzen für reguläre Stations-/Frühdienste. Standard-Admins planen weiterhin ausschließlich ihre eigene Abteilung.
- **Keine** Migration auf eine Single-DB-Architektur (vgl. Option C der Analyse).
- **Keine** automatische Synchronisation von Stammdaten zwischen Mandanten – das übernimmt das parallel laufende Konzept [Zentrale Mitarbeiterverwaltung](CENTRAL_EMPLOYEE_MANAGEMENT.md).

---

## 2. Rollen & Sichten

| Rolle | Was sehen sie? | Was dürfen sie? |
|---|---|---|
| **Doctor / Standard-User** | Nur ihre eigene Abteilung (= ein Mandant) | Wünsche, eigene Schichten, eigene Statistik. Pool-Dienste erscheinen lesend im Tagesraster ihrer Abteilung. |
| **Department-Admin** | Nur ihre eigene Abteilung | Plant Stationsdienste, Frühdienst, Konsile. Sieht Pool-Dienste **lesend** (wer ist aus der eigenen Abteilung im AD-Pool?). |
| **Cross-Department-Admin (neu)** | Ein zusätzlicher Modus „🌐 Verbund: <Name>“ neben den Mandantenkacheln im Tenant-Switcher | Plant ausschließlich Pool-Dienste über mehrere Mandanten hinweg. Sieht Pool-Statistik aggregiert + Fairness pro Person. |
| **Master-Admin / HR** | Alle Mandanten + alle Verbünde | Wartet Verbund-Definition, Pool-Workplaces, Constraints, Limits. |

**Wesentliche UX-Eigenschaft:** Cross-Department-Admins sehen **standardmäßig nicht** alle Schichten aller Mandanten – das wäre unübersichtlich. Sie sehen einen reduzierten Plan, der nur die geteilten Pool-Workplaces, deren Tages-Slots und die aus dem ganzen Verbund kombinierte Personenliste enthält.

---

## 3. Datenmodell

Aufbau additiv zur bestehenden Master-DB (analog zu `db_tokens`, `app_users`). Tenant-DBs bleiben strukturell unverändert; Pool-Schichten leben **nicht** in der Tenant-DB.

### 3.1 Master-DB: Verbund-Tabellen

```sql
CREATE TABLE IF NOT EXISTS tenant_group (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,                    -- z.B. "Innere Medizin Südstadt"
  description TEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS tenant_group_member (
  group_id INT NOT NULL,
  tenant_id INT NOT NULL,                        -- db_tokens.id
  role ENUM('member','observer') NOT NULL DEFAULT 'member',
  PRIMARY KEY (group_id, tenant_id),
  FOREIGN KEY (group_id) REFERENCES tenant_group(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE
);
```

### 3.2 Master-DB: Pool-Workplaces & Pool-Schichten

```sql
CREATE TABLE IF NOT EXISTS shared_workplace (
  id VARCHAR(36) PRIMARY KEY,
  group_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,                    -- "AD", "KWE", "OD", "WE-F" …
  category VARCHAR(100) DEFAULT NULL,
  start_time TIME DEFAULT NULL,
  end_time TIME DEFAULT NULL,
  min_staff INT NOT NULL DEFAULT 1,
  optimal_staff INT NOT NULL DEFAULT 1,
  affects_availability TINYINT(1) NOT NULL DEFAULT 1,
  consecutive_days_mode VARCHAR(20) DEFAULT 'allowed',
  -- Constraint-JSON: gruppenweite Regeln (siehe §5)
  constraints_json JSON DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (group_id) REFERENCES tenant_group(id) ON DELETE CASCADE,
  INDEX idx_shared_workplace_group (group_id, is_active)
);

CREATE TABLE IF NOT EXISTS shared_shift_entry (
  id VARCHAR(36) PRIMARY KEY,
  shared_workplace_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  -- Person: zentrale Identität aus Employee (siehe CENTRAL_EMPLOYEE_MANAGEMENT)
  employee_id VARCHAR(36) NOT NULL,
  -- Welcher Mandant trägt diese Schicht statistisch / abrechenbar:
  billing_tenant_id INT NOT NULL,
  start_time TIME DEFAULT NULL,
  end_time TIME DEFAULT NULL,
  note TEXT DEFAULT NULL,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by VARCHAR(255) DEFAULT NULL,
  FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE,
  FOREIGN KEY (billing_tenant_id) REFERENCES db_tokens(id),
  INDEX idx_shared_shift_date (date),
  INDEX idx_shared_shift_emp (employee_id, date),
  INDEX idx_shared_shift_billing (billing_tenant_id, date)
);
```

**Warum `billing_tenant_id`?**
- Für die Statistik „AD-Dienste pro Abteilung“ (Excel-Anforderung) braucht jede Schicht eine eindeutige Trägerabteilung.
- Default = primärer Mandant des Mitarbeiters (`EmployeeTenantAssignment.is_primary = TRUE`), kann manuell überschrieben werden (z.B. wenn Vergütungsregeln das verlangen).

### 3.3 Master-DB: Pool-Quotas & Fairness

```sql
CREATE TABLE IF NOT EXISTS shared_workplace_quota (
  shared_workplace_id VARCHAR(36) NOT NULL,
  scope ENUM('person','tenant','role') NOT NULL,
  scope_key VARCHAR(64) NOT NULL,                -- employee_id / tenant_id / role-name
  period ENUM('month','quarter','year') NOT NULL DEFAULT 'month',
  max_count INT DEFAULT NULL,                    -- Obergrenze pro Periode
  target_count INT DEFAULT NULL,                 -- Soll (Fairness-Ziel)
  weight DECIMAL(4,2) NOT NULL DEFAULT 1.00,     -- Gewichtung in der Fairness-Funktion
  PRIMARY KEY (shared_workplace_id, scope, scope_key, period),
  FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE
);
```

Beispieldatensätze für AD‑Pool:
- `scope=person, scope_key=<employee_id>, max_count=4, period=month` → niemand soll mehr als 4 AD/Monat machen
- `scope=tenant, scope_key=<tenant_id>, target_count=14, period=month` → IN4/Gastro soll ~14 AD/Monat tragen (entspricht Excel-Verteilung)
- `scope=role, scope_key='Assistenzarzt erfahren', target_count=3, period=month` → Pairing mit „neu“ wird gleichmäßig verteilt

### 3.4 Master-DB: Zugriffsrechte

Erweitere `app_users` additiv:

```sql
ALTER TABLE app_users
  ADD COLUMN allowed_groups JSON DEFAULT NULL,            -- z.B. [1,3]
  ADD COLUMN group_admin_groups JSON DEFAULT NULL;        -- Untermenge von allowed_groups: hier mit Schreibrecht
```

- `allowed_tenants` (bestehend) regelt Sicht auf Abteilungs-Mandanten – **bleibt unverändert**.
- `allowed_groups` regelt Sicht auf den Verbund-Modus.
- `group_admin_groups` markiert Cross-Department-Admins (sonst nur Lesezugriff).

---

## 4. Backend

### 4.1 Middleware

Neue Header neben dem bestehenden `x-db-token`:

| Header | Bedeutung |
|---|---|
| `x-tenant-group` | aktive Verbund-ID. Wird gesetzt, wenn der Nutzer im Tenant-Switcher den Verbund-Modus wählt. |

Pseudocode-Erweiterung in [server/index.js](../../server/index.js#L310-L340):

```js
app.use(async (req, _res, next) => {
  req.db = getTenantDb(req.headers['x-db-token']);   // bleibt
  const groupHeader = req.headers['x-tenant-group'];
  if (groupHeader) {
    const groupId = Number(groupHeader);
    req.groupId = groupId;
    req.groupTenantIds = await loadGroupMemberTenantIds(groupId);
    req.groupTenantDbs = req.groupTenantIds.map(tid => getTenantDbByTokenId(tid));
  }
  next();
});
```

Wichtig: `req.db` zeigt weiterhin auf einen einzelnen Mandanten (für lokale Daten, z.B. die eigene Abteilung des aktuell eingeloggten Admins). `req.groupTenantDbs` ist die zusätzliche Verbund-Sicht.

### 4.2 Neue Routes

Alle unter `/api/groups/:groupId/…`, geschützt per `authMiddleware` + Group-Membership-Check.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET`  | `/api/groups` | Verbünde, in denen der Nutzer Mitglied ist (für Tenant-Switcher) |
| `GET`  | `/api/groups/:id/workplaces` | Pool-Workplaces |
| `GET`  | `/api/groups/:id/schedule?from=&to=` | Pool-Schichten + (optional) lesende Aggregation lokaler Schichten aus allen Mitglieds-Mandanten (parallel via `Promise.all`) |
| `GET`  | `/api/groups/:id/staff` | Vereinigte Personenliste (über `Employee` + `EmployeeTenantAssignment`) inkl. Roll-Übersicht pro Mandant |
| `POST` | `/api/groups/:id/shifts` | Pool-Schicht anlegen (nur `group_admin_groups`) |
| `PATCH`/`DELETE` | `/api/groups/:id/shifts/:sid` | bearbeiten/löschen |
| `GET`  | `/api/groups/:id/stats?period=month&month=2026-01` | Pool-Statistik pro Person / Mandant / Rolle |
| `GET`  | `/api/groups/:id/fairness?period=month&month=2026-01` | aktueller Fairness-Score, Restkapazität pro Person |
| `POST` | `/api/groups/:id/autoplan` | Solver-Lauf gegen Constraints + Quotas |

Schreibvorgänge erfolgen **transaktional in der Master-DB**. Es gibt **keinen** Spiegel-Eintrag in der Tenant-DB – stattdessen liefert die jeweilige Tenant-Schedule-API zusätzlich die für diesen Tenant relevanten `shared_shift_entry`-Datensätze (per JOIN bzw. Cross-DB-Read im API-Layer), damit das Department-Frontend Pool-Dienste „lesend“ anzeigt.

### 4.3 Lese-Integration im Department-Schedule

Die bestehende Route `/api/schedule?from=&to=` ([server/routes/schedule.js](../../server/routes/schedule.js)) wird so erweitert, dass sie zusätzlich:
1. die `tenant_group`-Mitgliedschaft des aktiven Mandanten ermittelt,
2. aus der Master-DB alle `shared_shift_entry` lädt, deren `billing_tenant_id` = aktiver Tenant **oder** deren `employee_id` einer in diesem Tenant vertretenen Person entspricht,
3. diese als virtuelle, schreibgeschützte Schichten mit Quelle `pool:<group_id>:<workplace>` zurückliefert.

Damit bleibt das gewohnte Department-Schedule unverändert in seiner Bedienung, zeigt aber pool-relevante Belegung **transparent** im richtigen Tag.

### 4.4 Realtime

`buildRealtimeScope` ([server/routes/auth.js](../../server/routes/auth.js#L798-L824)) erhält einen optionalen Group-Scope. Der Realtime-Hub veröffentlicht `shared_shift_entry`-Events auf zwei Channels:
- `group:<id>` (für Cross-Department-Admins)
- `tenant:<billing_tenant_id>` und `tenant:<each_member_tenant>` für lesende Department-Plans

So sehen Department-Admins Live-Updates, ohne dass sie selbst Schreibrechte am Pool haben.

---

## 5. Constraints & Fairness

`shared_workplace.constraints_json` enthält deklarative Regeln, die der Solver versteht. Beispiel für `AD`:

```json
{
  "daily_required": 2,
  "pairing": [
    {"left": "Assistenzarzt neu",  "right": "Assistenzarzt erfahren", "scope": "same_day"},
    {"left": "Assistenzarzt neu",  "right": "Facharzt",               "scope": "same_day"}
  ],
  "rest_after": { "next_day_off": true },
  "max_per_person_month": 4,
  "max_consecutive": 1,
  "weekend_overrides": null
}
```

### 5.1 Fairness-Score

Pro Person und Periode berechnet das Backend:

$$
\text{score}(p) = \sum_{q \in Q(p)} w_q \cdot \left(\frac{\text{count}_p - \text{target}_q}{\max(\text{target}_q, 1)}\right)^2
$$

- $Q(p)$ = relevante Quota-Einträge (person, role, tenant) für Person $p$
- $w_q$ = Gewicht aus `shared_workplace_quota.weight`
- Niedriger Score = fairer. Der Solver minimiert die Gesamtsumme; das UI zeigt eine farbcodierte Restkapazität pro Person („3 / 4 AD im Mai“).

### 5.2 Constraint-Bibliothek

Implementiert in `server/utils/poolConstraints.js` (neu), wiederverwendet sowohl beim Auto-Plan als auch bei jeder manuellen Zuweisung als Pre-Save-Validation (analog zum bestehenden Overlap/Consecutive-Check). Verstöße liefern HTTP 422 mit strukturierter Begründung:

```json
{ "error": "constraint_violation",
  "details": [
    {"rule": "pairing", "message": "Assistenzarzt neu ohne erfahrenen Partner am 2026-02-14"},
    {"rule": "max_per_person_month", "message": "Borkert hat bereits 4 AD im Februar"}
  ]
}
```

---

## 6. Frontend

### 6.1 Tenant-Switcher

`AuthProvider` ([src/components/AuthProvider.jsx](../../src/components/AuthProvider.jsx#L14-L155)) erhält zusätzlich:

```js
const [allowedGroups, setAllowedGroups] = useState([]);
const [activeGroup, setActiveGroup]    = useState(null);
```

Im Dialog werden Mandanten und Verbünde in zwei Sektionen dargestellt:

```
─── Abteilungen ────────────────
  ◉ IN II – Pneumologie
  ◯ IN III – Kardiologie
  ◯ IN IV – Gastroenterologie

─── Verbünde ──────────────────
  ◯ 🌐 Innere Medizin (Pool)
```

Auswahl Mandant → `x-db-token` wie heute. Auswahl Verbund → `x-tenant-group`, `x-db-token` zeigt zusätzlich auf den primären Mandanten des Nutzers (für sein Profil, Wünsche etc.).

### 6.2 Pool-Schedule-Board

Ein eigener, schlanker View `src/pages/PoolSchedule/`:
- **Kopf:** Datumsleiste, Filter (Workplace = AD/KWE/OD/…), Periodenwechsel.
- **Zeilen:** Pool-Workplaces (statt Stationen).
- **Zellen:** Initialen + farblicher Pin pro Herkunfts-Mandant (IN II = Pneu-Farbe etc.).
- **Seitenpanel:** Personenliste mit Fairness-Stand, Restkapazität, Tooltip „aktuell 3/4 AD im Februar“.
- **Drag & Drop / Klick:** identisch zum bestehenden ScheduleBoard, schreibt aber gegen `/api/groups/:id/shifts`.
- **Konflikthinweise:** Pre-Save-Validator zeigt Constraint-Verstöße direkt in der Zelle.

Bewusst minimalistisch: kein Stationsplan, kein Frühdienst-Raster – das bleibt in den Department-Mandanten.

### 6.3 Department-Schedule (unverändert)

Pool-Schichten erscheinen als **schreibgeschützte Pille** im Tagesheader der betroffenen Person mit Tooltip „AD (Verbund Innere) – betrifft Verfügbarkeit am Folgetag“. Klick öffnet (für Cross-Department-Admins) den Pool-Editor, sonst nur eine Info-Card.

### 6.4 Statistik

`docs/features/STATISTICS.md` bekommt einen Abschnitt „Pool-Statistik“. Tabellen:
- **AD/KWE/OD pro Mandant × Monat** (rekonstruiert die Excel-Sicht).
- **Pro Person × Pool-Workplace × Monat** mit Soll/Ist/Max.
- **Pairing-Quote „neu mit erfahren“** als KPI.

---

## 7. Migrationspfad

1. **Schema additiv** – neue Master-Tabellen + `app_users.allowed_groups` (idempotente Migration `NNN_create_tenant_groups.sql`).  
2. **Feature-Flag** `enableTenantGroups` (env + Master-Settings). Bis Aktivierung ändert sich nichts am bestehenden Verhalten.
3. **Pilot Klinikum Südstadt:**
   - Pro Excel-Station ein Mandant anlegen.
   - `Employee`-Stammdaten zentral (Voraussetzung: [CENTRAL_EMPLOYEE_MANAGEMENT.md](CENTRAL_EMPLOYEE_MANAGEMENT.md) ist Live).
   - Verbund „Innere Medizin Südstadt“ anlegen, alle IN-Mandanten als `member`.
   - Pool-Workplaces AD, KWE, OD anlegen, Constraints + Quotas aus Excel ableiten.
4. **Historische Excel-Daten importieren:** `scripts/import-dp-xlsx.js` (neu) erzeugt für Jan–Mär 2026 `shared_shift_entry`-Datensätze + verifiziert per Reproduktion der Excel-Statistiken (Test-Goal).
5. **Cross-Department-Admin** anlegen, im Verbund testen, Solver gegen historische Belegung benchmarken.
6. Schrittweise weitere Pools (HD, HSD, Rheu, Neuro, Endo, NAD, BD) je nach Bedarf.

---

## 8. Sicherheit & Datenschutz

- `shared_shift_entry` enthält nur die zentrale `employee_id`, **keine** PHI. Anzeige-Name kommt aus `Employee` (Master) und ist nur authentifizierten, gruppen-berechtigten Nutzern sichtbar.
- Department-Admins ohne Group-Membership erhalten beim Versuch, Pool-Endpoints zu lesen, HTTP 403.
- Schreiboperationen prüfen zusätzlich, ob die Schicht-Person dem Verbund zugeordnet ist (`EmployeeTenantAssignment` ∋ `tenant_group_member`).
- Pool-Daten sind **nicht** Teil des regulären Tenant-Backups, sondern Teil der Master-DB → Backup-Strategie für die Master-DB muss entsprechend skaliert werden.

---

## 9. Offene Punkte

1. **Doppelt geführte „Aktive-Mandant“-Logik:** Heute setzt `activate-tenant` global `db_tokens.is_active`. Für Verbund-Modus braucht es einen session-/JWT-gebundenen Active-State, kein globaler DB-Flag. → Refactoring nötig, ohne bestehende Single-Tenant-Nutzer zu stören.
2. **Solver-Wahl:** Erweiterung des bestehenden Auto-Planers vs. Constraint-Programmierung (z.B. OR-Tools via separates Worker-Skript). Empfehlung: Schritt 1 deterministischer Greedy + Fairness-Score, Schritt 2 (optional) CP-SAT für komplexe Pairing-Regeln.
3. **Schichten, die im Pool **und** im Departmentplan „echte“ Arbeit erzeugen** (z.B. KWE 24 h löst BF am Folgetag aus): Der lesende Pool-Eintrag im Department-Plan muss auch die Verfügbarkeit beeinflussen. Vorgeschlagen: Bei Pool-Schichten mit `affects_availability=1` wird in jeder betroffenen Tenant-DB automatisch ein Read-Only-Verfügbarkeits-Block angelegt (analog `ScheduleBlock`, [016_create_schedule_block_table.sql](../../server/migrations/016_create_schedule_block_table.sql)).
4. **Soll-Stunden-Aufteilung:** Pool-Schichten erhöhen die Ist-Stunden. Frage: gehen sie zu 100 % auf `billing_tenant_id` oder anteilig nach `EmployeeTenantAssignment.fte_share`? Empfehlung: zu 100 % auf `billing_tenant`, weil die Schicht physisch dort gemacht wird.
5. **Subspezialitäten** (Rheu, Neuro, Endo, HD, HSD): per Workplace einzeln entscheiden, ob sie als Pool-Workplace im Verbund oder als lokaler Workplace in genau einem Mandanten geführt werden.

---

## 10. Implementierungs-Reihenfolge (vorgeschlagen)

| # | Schritt | Ergebnis |
|---|---|---|
| 1 | Migration `tenant_group*`, `shared_workplace`, `shared_shift_entry`, `shared_workplace_quota`, `app_users.allowed_groups` | Schema steht (idempotent) |
| 2 | Master-API `/api/groups` + CRUD für Verbund/Workplace/Quota | Admin-CLI/Master-UI bedient den Verbund |
| 3 | Read-API `/api/groups/:id/schedule` + Department-Read-Integration | Pool-Schichten lesbar in beiden Welten |
| 4 | Write-API + Constraint-Validator | Pool-Editor manuell bedienbar |
| 5 | Frontend `PoolSchedule`-View + Tenant-Switcher-Erweiterung | Cross-Department-Admin produktiv |
| 6 | Statistik + Fairness-Panel | Excel-Reports reproduzierbar |
| 7 | Auto-Planer (Greedy, später CP-SAT) | Vorschlagsbetrieb |
| 8 | Historischer Import DP.xlsx + Regression-Tests | Validierung gegen reale Daten |
