# CuraFlow – Entwicklerdokumentation

> **Zielgruppe:** Externe Entwickler, die CuraFlow weiterentwickeln, anpassen oder in ihre Infrastruktur integrieren möchten.

---

## Inhaltsverzeichnis

| Dokument | Beschreibung |
|---|---|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution workflow, required checks, and testing expectations |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Systemarchitektur, Tech-Stack, Datenfluss |
| [SETUP.md](./SETUP.md) | Lokale Entwicklungsumgebung einrichten |
| [DATABASE.md](./DATABASE.md) | Datenbankschema aller Tabellen |
| [API.md](./API.md) | REST-API Endpunkte (Backend) |
| [TESTING.md](./TESTING.md) | Test-Strategie, Szenarien, Automatisierung |
| **Features** | |
| [features/SCHEDULE.md](./features/SCHEDULE.md) | Dienstplan – Kernfeature mit Drag-and-Drop |
| [features/AUTH.md](./features/AUTH.md) | Authentifizierung & Multi-Tenant |
| [features/WISHLIST.md](./features/WISHLIST.md) | Wunschliste |
| [features/VACATION.md](./features/VACATION.md) | Urlaubs- & Weiterbildungsplanung |
| [features/TRAINING.md](./features/TRAINING.md) | Weiterbildungsplanung (Kurzreferenz) |
| [features/STATISTICS.md](./features/STATISTICS.md) | Statistiken & Adminbereich |
| [features/ADMIN.md](./features/ADMIN.md) | Adminbereich (Kurzreferenz) |
| [features/VOICE_CONTROL.md](./features/VOICE_CONTROL.md) | KI-Sprachsteuerung (ElevenLabs) |
| **Bestehend** | |
| [FEATURE_AFFECTS_AVAILABILITY.md](./FEATURE_AFFECTS_AVAILABILITY.md) | Feature: Verfügbarkeitsbeeinflussung |
| [FEATURE_TIMESLOTS_PLANNING.md](./FEATURE_TIMESLOTS_PLANNING.md) | Feature: Zeitfensterplanung |

---

## Kurzübersicht

CuraFlow ist ein webbasiertes Dienstplanungs- und Personalverwaltungssystem, das ursprünglich für radiologische Abteilungen entwickelt wurde, sich aber generisch für medizinische Fachabteilungen einsetzen lässt.

### Kern-Features im Überblick

```
┌─────────────────────────────────────────────────────────────┐
│                        CuraFlow                             │
├─────────────┬──────────────┬──────────────┬─────────────────┤
│ Dienstplan  │  Wunschliste │  Urlaubsplan │   Statistiken   │
│ (Drag&Drop) │  (self-svc)  │  (Jahresview)│   (Charts+CSV)  │
├─────────────┴──────────────┴──────────────┴─────────────────┤
│         Weiterbildungsplan │ Dashboard │ Admin-Bereich       │
├────────────────────────────────────────────────────────────-─┤
│              KI-Sprachsteuerung (ElevenLabs)                 │
├──────────────────────────────────────────────────────────────┤
│   JWT-Auth │ Rollenmodell │ Multi-Tenant │ E-Mail │ SSE       │
└──────────────────────────────────────────────────────────────┘
```

### Tech-Stack

| Schicht | Technologie |
|---|---|
| Frontend | React 18 + Vite, React Router, TanStack Query |
| UI | Radix UI + Tailwind CSS (shadcn/ui Preset) |
| Backend | Node.js 18+, Express 4 |
| Datenbank | MySQL 8 |
| Auth | JWT (jsonwebtoken), bcryptjs |
| E-Mail | Nodemailer |
| KI | ElevenLabs ConversationalAI |
| Deployment | Railway (PaaS), Docker-kompatibel |

---

## Verzeichnisstruktur

```
CuraFlow/
├── src/                    # Frontend-Quellcode (React)
│   ├── api/                # API-Client + Datenbankabstraktion
│   ├── components/         # Wiederverwendbare UI-Komponenten
│   │   ├── admin/          # Admin-spezifische Komponenten
│   │   ├── schedule/       # Dienstplan-Komponenten
│   │   ├── staff/          # Mitarbeiterverwaltung
│   │   ├── settings/       # Einstellungs-Dialoge
│   │   ├── statistics/     # Statistik-Komponenten
│   │   ├── training/       # Weiterbildungs-Komponenten
│   │   ├── vacation/       # Urlaubs-Komponenten
│   │   ├── wishlist/       # Wunschlisten-Komponenten
│   │   ├── validation/     # Schicht-Validierungslogik
│   │   └── ui/             # shadcn/ui Basiskomponenten
│   ├── pages/              # Seiten-Komponenten (Routes)
│   ├── contexts/           # React Contexts
│   ├── hooks/              # Custom React Hooks
│   └── utils/              # Hilfsfunktionen
├── server/                 # Backend-Quellcode (Express)
│   ├── routes/             # API-Routen
│   ├── utils/              # Server-Hilfsfunktionen
│   ├── migrations/         # SQL-Migrationsdateien
│   └── scripts/            # Deployment-/Migrations-Skripte
├── docs/                   # Diese Dokumentation
└── functions/              # Cloud Functions (Legacy, nicht aktiv genutzt)
```
