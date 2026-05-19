# Ticket #1669e11b-26d6-4a3e-80d1-638b019dc088 — Coding-Dossier

> Dieses Verzeichnis enthaelt die vollstaendige Analyse des Ticketsystem-Workflows
> fuer Ticket #1669e11b-26d6-4a3e-80d1-638b019dc088. Es ist als Briefing fuer einen externen Coding-Agenten
> (z. B. OpenCode, VS Code Copilot) gedacht. Der Agent arbeitet direkt im Repo —
> die Analyse hier dient als Eingabe, nicht als Code-Vorlage.

## Eckdaten

- Titel: **Symbol für halbe Tage**
- Typ: `feature`
- Dringlichkeit: `normal`
- System: CuraFlow (`andreasknopke/CuraFlow`)
- Workflow-Run: 138 (gestartet 2026-05-08 13:23:19)

## Inhalt

- [Triage Reviewer](./01_triage.md) — Status: `done`
- [Security & Redaction](./02_security.md) — Status: `done`
- [Solution Architect (Planning)](./03_planning.md) — Status: `done`
- [Integration Reviewer](./04_integration.md) — Status: `done`
- [Final Approver (Dispatch-Decision)](./05_approval.md) — Status: `waiting_human`
- [Manifest (JSON)](./manifest.json)

## Original-Beschreibung (unredacted)

> Hinweis: Der `02_security.md`-Bericht enthaelt die redaktierte Variante,
> die fuer KI-Aufrufe verwendet wurde.

```
Wenn User Spätdienst haben, kommen sie erst 11 Uhr an, sind also für die Hälfte des Tages nicht verfügbar. Sie werden aber im Wochenplan als komplett "verfügbar"  dargestellt. Besser wäre es, wenn die User im Spätdienst ein kleines Symbol hätten (zB. einen kleinen Mond).
```