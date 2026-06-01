-- Migration 021: Zentrale Abwesenheitsverwaltung fuer verknuepfte Mitarbeiter
-- Diese Tabelle lebt in der MASTER-Datenbank und speichert Abwesenheiten fuer
-- Mitarbeiter mit zentraler Verknuepfung tenantuebergreifend.
-- Die Pflege bleibt im Tenant-Frontend, nur der Speicherort ist zentral.

CREATE TABLE IF NOT EXISTS CentralAbsenceEntry (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    date DATE NOT NULL,
    position VARCHAR(255) NOT NULL,
    note TEXT,
    start_time TIME DEFAULT NULL,
    end_time TIME DEFAULT NULL,
    break_minutes INT DEFAULT NULL,
    timeslot_id VARCHAR(36) DEFAULT NULL,
    `order` INT DEFAULT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by VARCHAR(255) DEFAULT NULL,
    source_tenant_id VARCHAR(36) DEFAULT NULL,
    source_tenant_doctor_id VARCHAR(255) DEFAULT NULL,
    UNIQUE KEY uk_central_absence_employee_date (employee_id, date),
    INDEX idx_central_absence_employee (employee_id),
    INDEX idx_central_absence_date (date)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;