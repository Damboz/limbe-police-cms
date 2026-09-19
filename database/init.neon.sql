-- ============================================================
-- Limbe Police CMS - Neon (PostgreSQL) Schema + Seed (SQL Editor safe)
-- Runs entirely inside the target database (limbe_police_cms):
--   - no CREATE DATABASE (already connected)
--   - no psql meta-commands (\connect / \set ON_ERROR_STOP)
-- Usage: open Neon SQL Editor for the limbe_police_cms database
--        and paste the whole file. Drops + recreates tables.
-- ============================================================

-- Reset the public schema for a clean slate
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- ============================================================
-- 1. SEED / LOOKUP TABLES
-- ============================================================

-- Roles
DROP TABLE IF EXISTS roles CASCADE;
CREATE TABLE roles (
  id           SERIAL PRIMARY KEY,
  name         varchar(50)  NOT NULL,
  description  varchar(255) DEFAULT NULL,
  created_at   timestamptz  NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (name)
);

INSERT INTO roles (id, name, description) VALUES
(1, 'Admin',                  'System Administration & User Access Management'),
(2, 'Station Commander',      'Full Station Oversight, Analytics, and Final Case Approvals'),
(3, 'Investigating Officer',  'Assigned Case Investigation, Suspect Linking, and Evidence Logging'),
(4, 'Counter/Intake Officer', 'First Contact Complaint Intake and Occurrence Book (OB) Registration');

SELECT setval(pg_get_serial_sequence('roles', 'id'), (SELECT MAX(id) FROM roles));

-- Station Units
DROP TABLE IF EXISTS station_units CASCADE;
CREATE TABLE station_units (
  id           SERIAL PRIMARY KEY,
  code         varchar(20)  NOT NULL,
  name         varchar(100) NOT NULL,
  description  text,
  created_at   timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (code)
);

INSERT INTO station_units (id, code, name, description) VALUES
(1, 'CID',     'Criminal Investigation Department',         'Handles serious crimes, homicide, armed robbery, and complex inquiries'),
(2, 'GPD',     'General Duty & Counter Operations',         'Front-desk OB logging, routine patrols, and public assistance'),
(3, 'TRAFFIC', 'Traffic Management Unit',                   'Highway enforcement, road safety, and accident investigations'),
(4, 'CPU',     'Community Policing Unit',                   'Crime prevention, neighborhood watchdog programs, and public relations');

SELECT setval(pg_get_serial_sequence('station_units', 'id'), (SELECT MAX(id) FROM station_units));

-- Crime Categories
DROP TABLE IF EXISTS crime_categories CASCADE;
CREATE TABLE crime_categories (
  id             SERIAL PRIMARY KEY,
  name           varchar(100) NOT NULL,
  severity_level varchar(20)  DEFAULT 'Moderate',
  created_at     timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (name),
  CONSTRAINT chk_crime_categories_severity CHECK (severity_level IN ('Minor', 'Moderate', 'Severe', 'Critical'))
);

INSERT INTO crime_categories (id, name, severity_level) VALUES
(1, 'Theft / Larceny',           'Minor'),
(2, 'Burglary / Housebreaking',  'Moderate'),
(3, 'Robbery with Violence',     'Severe'),
(4, 'Assault / ABH',            'Moderate'),
(5, 'Homicide',                  'Critical'),
(6, 'Fraud & Financial Crimes',  'Moderate'),
(7, 'Cybercrime',                'Moderate'),
(8, 'Traffic Offense',           'Minor');

SELECT setval(pg_get_serial_sequence('crime_categories', 'id'), (SELECT MAX(id) FROM crime_categories));

-- ============================================================
-- 2. CORE TABLES
-- ============================================================

-- Users
DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  badge_number  varchar(50)  NOT NULL,
  rank_title    varchar(50)  NOT NULL,
  first_name    varchar(50)  NOT NULL,
  last_name     varchar(50)  NOT NULL,
  email         varchar(100) NOT NULL,
  phone_number  varchar(20)  DEFAULT NULL,
  password_hash varchar(255) NOT NULL,
  role          varchar(50)  NOT NULL DEFAULT 'Counter/Intake Officer',
  role_id       int DEFAULT NULL,
  unit_id       int DEFAULT NULL,
  is_active     smallint     NOT NULL DEFAULT 1,
  created_at    timestamptz  NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamptz  NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (badge_number),
  UNIQUE (email),
  CONSTRAINT users_ibfk_1 FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE SET NULL,
  CONSTRAINT users_ibfk_2 FOREIGN KEY (unit_id) REFERENCES station_units (id) ON DELETE SET NULL,
  CONSTRAINT chk_users_role CHECK (role IN (
      'Admin', 'admin', 'Station Commander', 'supervisor',
      'Investigating Officer', 'investigator',
      'Counter/Intake Officer', 'officer'
  ))
);

CREATE INDEX idx_users_badge ON users (badge_number);
CREATE INDEX idx_users_email ON users (email);

-- NOTE: Passwords below are bcrypt hashes of their default password.
-- Admin default password: Admin@12345
-- Other accounts may have different passwords set through the UI.
INSERT INTO users (id, badge_number, rank_title, first_name, last_name, email, phone_number, password_hash, role, role_id, unit_id, is_active) VALUES
(2,  'LIM-001',   'Inspector',         'Station',    'Administrator', 'admin@limbe.police.mw',        '+265999000000', '$2b$10$EBMaLazalQcIxcMvkk2Mbe8MV3YhJ59Ursv4W7WSeiJPMAJyu..iW', 'Admin',                  1, 1, 1),
(4,  'LIM-002',   'Station Commander', 'George',     'Dambo',         'dambogeorge992@gmail.com',     '+265996697165', '$2b$10$e0MYzXyjpJS7Pd0RVvHwHe1152Hz.52v.D77yq42n8v3/W65O.0S6', 'Station Commander',      2, 1, 1),
(5,  'Huka',      'Station Commander', 'Rexious',    'Huka',          'rexioushuka@gmail.com',        '099793884938',  '$2b$10$e0MYzXyjpJS7Pd0RVvHwHe1152Hz.52v.D77yq42n8v3/W65O.0S6', 'Station Commander',      2, NULL, 1),
(6,  'Esterk',    'Station Commander', 'Esther',     'Kondowe',       'esterk@gmail.com',             '+265996697165', '$2b$10$wGeHDNRtRsrFHGfFEAQ6Gewzj9..IlqsVzxxn3zdoLAQi.WIH8sKe', 'Station Commander',      2, NULL, 1),
(7,  'Phady',     'Constable',         'Patrick',    'Magule',        'patrick@gmail.com',            '+265996697165', '$2b$10$ft8gJNabUp9Q8HnveDBrEO0Va5NM5vn2xlv3BZnMvYogPSqLFiz76', 'Counter/Intake Officer', 4, NULL, 1),
(8,  'Dambo',     'Constable',         'George',     'Dambo',         'bit21-gdambo@mubas.ac.mw',     '0996697165',    '$2b$10$IWJtRc7XRt9De/1sEn8j9u8IhN44Gr/raOmeVIXX8NiVcWIX.CxXy', 'Counter/Intake Officer', 4, NULL, 1),
(9,  'George',    'Constable',         'George',     'Dambo',         'georgebanda@gmail.com',        '+265899540451', '$2b$10$PfAmAz5R4wxNNLTF2H4.kuTCE3cUkFTk4b4zLBpP5qo1Wjp4F4WtW', 'Counter/Intake Officer', 4, NULL, 1),
(10, 'Surgent',   'Superintendent',    'Surgent',    'Ngwira',        'surgentngwira@gmail.com',      '0887728238',    '$2b$10$lXgH84EC/Khyz6L7Kahm3e84dBCwJIL59mOWUrMUhCM8iNhA6E2z6', 'Counter/Intake Officer', 4, NULL, 1),
(11, 'Mirrium',   'Station Commander', 'Mirrium',    'Kathabwa',      'mirrium@police.gov.mw',        '0997884578',    '$2b$10$gx8O2Mp51lqixUuROTmN8eM57adjWAcsIBgcOgFyYc2lMEKb4qWmq', 'Station Commander',      2, NULL, 1),
(12, 'Gloria',    'Constable',         'Gloria',     'Kachapira',     'kachapira@police.gov',         NULL,            '$2b$10$Qmk2160.0GF/CpnxkPTVnuXFcD7bNm4yInW5Mg9u3cTEfVIOuiaRm', 'Station Commander',      2, NULL, 1),
(26, 'Alex',      'Sergeant',          'Alex',       'Kathabwa',      'alexkathawa@police.gov',       '09987878979',   '$2b$10$SEKStVJ7wtJMZSpp0SXz8.YBzYgGP5Wc5H3uMDq8hqpGU7eELC45S', 'Investigating Officer',  3, NULL, 1);

SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users));

-- Cases
DROP TABLE IF EXISTS cases CASCADE;
CREATE TABLE cases (
  id                     SERIAL PRIMARY KEY,
  ob_number              varchar(50) NOT NULL,
  complainant_name       varchar(100) NOT NULL,
  complainant_id_number  varchar(50) DEFAULT NULL,
  complainant_phone      varchar(20) NOT NULL,
  complainant_address    text,
  complainant_gender     varchar(10) DEFAULT 'Other',
  category_id            int NOT NULL,
  unit_id                int NOT NULL,
  priority               varchar(10) DEFAULT 'Medium',
  incident_datetime      timestamp DEFAULT NULL,
  incident_location      varchar(255) NOT NULL,
  incident_details       text NOT NULL,
  intake_officer_id      int NOT NULL,
  status                 varchar(30) DEFAULT 'Reported',
  requested_status       varchar(30) DEFAULT NULL,
  status_request_notes   text,
  status_requested_by    int DEFAULT NULL,
  status_requested_at    timestamp NULL DEFAULT NULL,
  created_at             timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ob_number),
  CONSTRAINT cases_ibfk_1 FOREIGN KEY (category_id) REFERENCES crime_categories (id),
  CONSTRAINT cases_ibfk_2 FOREIGN KEY (unit_id) REFERENCES station_units (id),
  CONSTRAINT cases_ibfk_3 FOREIGN KEY (intake_officer_id) REFERENCES users (id),
  CONSTRAINT fk_case_status_requested_by FOREIGN KEY (status_requested_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_cases_gender CHECK (complainant_gender IN ('Male', 'Female', 'Other')),
  CONSTRAINT chk_cases_priority CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
  CONSTRAINT chk_cases_status CHECK (status IN ('Reported', 'Under Investigation', 'Court Pending', 'Closed', 'Archived')),
  CONSTRAINT chk_cases_requested_status CHECK (requested_status IN ('Closed', 'Court Pending'))
);

CREATE INDEX idx_cases_ob_number ON cases (ob_number);
CREATE INDEX idx_cases_status ON cases (status);
CREATE INDEX idx_cases_requested_status ON cases (requested_status);
CREATE INDEX idx_cases_status_requested_by ON cases (status_requested_by);

INSERT INTO cases (id, ob_number, complainant_name, complainant_id_number, complainant_phone, complainant_address, complainant_gender, category_id, unit_id, priority, incident_datetime, incident_location, incident_details, intake_officer_id, status, requested_status, status_request_notes, status_requested_by, status_requested_at, created_at, updated_at) VALUES
(1, 'OB-20260816-0001', 'George Dambo',    NULL,       '0996697165', 'Lumbadzi, Lilongwe Malawi', 'Male', 5, 3, 'Medium', '2025-03-21 12:00:00', 'Chichiri',            'mdjmsmskakamd',                          6,  'Under Investigation', NULL, NULL, NULL, NULL, '2026-08-16 14:30:27', '2026-08-19 09:33:04'),
(2, 'OB-20260905-0001', 'Patrick Magule',  '004939939', '08840399483', 'Lumbadzi, Lilongwe Malawi', 'Male', 6, 2, 'High',   '2026-09-05 11:45:00', 'Zingwangwa Market',   'fjjkfkdjsKLKAJGJDKSKFHSJKSKKKSHFHFH',   9,  'Reported',           NULL, NULL, NULL, NULL, '2026-09-05 09:45:58', '2026-09-16 16:02:53'),
(3, 'OB-20260905-0002', 'George Dambo',    'pfoodld',  '0996697165', 'Lumbadzi, Lilongwe Malawi', 'Male', 7, 3, 'Medium', '2026-09-03 12:42:00', 'oflsllsld',           'kqalL;;dlszmmdk',                        2,  'Under Investigation', 'Closed', 'gdjjs', 26, '2026-09-16 16:40:50', '2026-09-05 10:43:05', '2026-09-16 16:40:50');

SELECT setval(pg_get_serial_sequence('cases', 'id'), (SELECT MAX(id) FROM cases));
-- Case <> Investigators (many-to-many)
DROP TABLE IF EXISTS case_investigators CASCADE;
CREATE TABLE case_investigators (
  id              SERIAL PRIMARY KEY,
  case_id         int NOT NULL,
  investigator_id int NOT NULL,
  assigned_by     int DEFAULT NULL,
  assigned_at     timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  is_lead         smallint NOT NULL DEFAULT 0,
  UNIQUE (case_id, investigator_id),
  CONSTRAINT ci_ibfk_1 FOREIGN KEY (case_id)         REFERENCES cases (id)  ON DELETE CASCADE,
  CONSTRAINT ci_ibfk_2 FOREIGN KEY (investigator_id) REFERENCES users (id)  ON DELETE CASCADE,
  CONSTRAINT ci_ibfk_3 FOREIGN KEY (assigned_by)     REFERENCES users (id)  ON DELETE SET NULL
);

INSERT INTO case_investigators (id, case_id, investigator_id, assigned_by, assigned_at, is_lead) VALUES
(1, 1, 8,  6,  '2026-08-19 09:33:04', 1),
(2, 3, 26, 12, '2026-09-16 16:36:55', 1);

SELECT setval(pg_get_serial_sequence('case_investigators', 'id'), (SELECT MAX(id) FROM case_investigators));

-- Suspects
DROP TABLE IF EXISTS suspects CASCADE;
CREATE TABLE suspects (
  id            SERIAL PRIMARY KEY,
  first_name    varchar(50) NOT NULL,
  last_name     varchar(50) NOT NULL,
  alias         varchar(50) DEFAULT NULL,
  national_id   varchar(50) DEFAULT NULL,
  date_of_birth date DEFAULT NULL,
  gender        varchar(10) NOT NULL,
  phone_number  varchar(20) DEFAULT NULL,
  address       text,
  photo_url     varchar(255) DEFAULT NULL,
  notes         text,
  created_at    timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_suspects_gender CHECK (gender IN ('Male', 'Female', 'Other'))
);

CREATE INDEX idx_suspect_name ON suspects (last_name, first_name);

-- Case <-> Suspects junction
DROP TABLE IF EXISTS case_suspects CASCADE;
CREATE TABLE case_suspects (
  id          SERIAL PRIMARY KEY,
  case_id     int NOT NULL,
  suspect_id  int NOT NULL,
  status      varchar(30) DEFAULT 'Under Investigation',
  arrest_date date DEFAULT NULL,
  created_at  timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_id, suspect_id),
  CONSTRAINT case_suspects_ibfk_1 FOREIGN KEY (case_id)    REFERENCES cases (id)    ON DELETE CASCADE,
  CONSTRAINT case_suspects_ibfk_2 FOREIGN KEY (suspect_id) REFERENCES suspects (id)  ON DELETE CASCADE,
  CONSTRAINT chk_case_suspects_status CHECK (status IN ('Under Investigation', 'In Custody', 'Released on Bail', 'At Large / Wanted'))
);

-- Victims
DROP TABLE IF EXISTS victims CASCADE;
CREATE TABLE victims (
  id           SERIAL PRIMARY KEY,
  case_id      int NOT NULL,
  full_name    varchar(100) NOT NULL,
  phone_number varchar(20) DEFAULT NULL,
  email        varchar(100) DEFAULT NULL,
  national_id  varchar(30) DEFAULT NULL,
  address      text,
  statement    text,
  created_at   timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_victims_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
);

CREATE INDEX idx_victims_case_id ON victims (case_id);

-- Evidence
DROP TABLE IF EXISTS evidence CASCADE;
CREATE TABLE evidence (
  id                      SERIAL PRIMARY KEY,
  case_id                 int NOT NULL,
  item_number             varchar(50) NOT NULL,
  description             text NOT NULL,
  category                varchar(20) NOT NULL DEFAULT 'Physical',
  storage_location        varchar(150) NOT NULL,
  collected_by_officer_id int NOT NULL,
  collected_at            timestamp NOT NULL,
  status                  varchar(30) NOT NULL DEFAULT 'In Locker',
  created_at              timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_evidence_case         FOREIGN KEY (case_id)                REFERENCES cases (id)  ON DELETE CASCADE,
  CONSTRAINT fk_evidence_collected_by FOREIGN KEY (collected_by_officer_id) REFERENCES users (id)  ON DELETE RESTRICT,
  CONSTRAINT chk_evidence_category CHECK (category IN ('Physical', 'Documentary', 'Digital', 'Forensic', 'Weapon', 'Other')),
  CONSTRAINT chk_evidence_status CHECK (status IN ('In Locker', 'Transferred to Lab', 'Presented in Court', 'Returned', 'Disposed'))
);

CREATE INDEX idx_evidence_case_id ON evidence (case_id);
CREATE INDEX idx_evidence_item_number ON evidence (item_number);

-- Case Notes
DROP TABLE IF EXISTS case_notes CASCADE;
CREATE TABLE case_notes (
  id         SERIAL PRIMARY KEY,
  case_id    int NOT NULL,
  officer_id int NOT NULL,
  note       text NOT NULL,
  created_at timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notes_case    FOREIGN KEY (case_id)   REFERENCES cases (id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_officer FOREIGN KEY (officer_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX idx_notes_case_id ON case_notes (case_id);

INSERT INTO case_notes (id, case_id, officer_id, note, created_at) VALUES
(1, 1, 8, 'we have now find the evidence', '2026-08-21 17:43:07');

SELECT setval(pg_get_serial_sequence('case_notes', 'id'), (SELECT MAX(id) FROM case_notes));

-- Audit Logs
DROP TABLE IF EXISTS audit_logs CASCADE;
CREATE TABLE audit_logs (
  id         SERIAL PRIMARY KEY,
  user_id    int DEFAULT NULL,
  action     varchar(50) NOT NULL,
  details    text NOT NULL,
  ip_address varchar(45) DEFAULT NULL,
  created_at timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_action ON audit_logs (action);
CREATE INDEX idx_audit_created ON audit_logs (created_at);

INSERT INTO audit_logs (id, user_id, action, details, ip_address, created_at) VALUES
(1,  2,  'USER_LOGIN',              'Officer LIM-001 logged into web portal.',                                                           NULL, '2026-08-15 09:37:45'),
(2,  2,  'USER_CREATED',            'Created user Esterk with role Station Commander (Role ID: 2)',                                      NULL, '2026-08-15 09:40:59'),
(3,  2,  'STATUS_CHANGE',           'Toggled status for Huka to Inactive',                                                              NULL, '2026-08-15 09:41:04'),
(4,  2,  'STATUS_CHANGE',           'Toggled status for Huka to Active',                                                                NULL, '2026-08-15 09:41:07'),
(5,  2,  'STATUS_CHANGE',           'Toggled status for Huka to Inactive',                                                              NULL, '2026-08-15 09:41:11'),
(6,  2,  'STATUS_CHANGE',           'Toggled status for LIM-002 to Inactive',                                                           NULL, '2026-08-15 09:41:13'),
(7,  2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-08-15 09:41:33'),
(8,  6,  'USER_LOGIN',              'Officer Esterk logged into web portal.',                                                            NULL, '2026-08-15 09:41:44'),
(9,  6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-15 09:59:48'),
(10, 6,  'USER_LOGOUT',             'Officer Esterk logged out.',                                                                        NULL, '2026-08-15 10:05:11'),
(11, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-15 10:05:24'),
(12, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-15 10:14:44'),
(13, 6,  'USER_LOGIN',              'Officer Esterk logged into web portal.',                                                            NULL, '2026-08-15 10:16:14'),
(14, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-15 10:17:52'),
(15, 6,  'USER_LOGOUT',             'Officer Esterk logged out.',                                                                        NULL, '2026-08-15 10:36:22'),
(16, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-08-15 10:36:36'),
(17, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-08-15 10:54:38'),
(18, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-15 10:54:48'),
(19, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-16 13:15:07'),
(20, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-16 13:50:55'),
(21, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-16 14:27:39'),
(22, 6,  'CASE_REGISTERED',         'Registered new Case OB OB-20260816-0001 for complainant George Dambo.',                              NULL, '2026-08-16 14:30:27'),
(23, 6,  'USER_LOGOUT',             'Officer Esterk logged out.',                                                                        NULL, '2026-08-16 14:36:48'),
(24, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-08-16 14:37:07'),
(25, 2,  'USER_CREATED',            'Created user Phady with role Counter/Intake Officer (Role ID: 4)',                                 NULL, '2026-08-16 14:43:19'),
(26, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-08-16 14:43:26'),
(27, 7,  'USER_LOGIN',              'Officer Phady logged in successfully.',                                                             NULL, '2026-08-16 14:43:37'),
(28, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-17 18:09:23'),
(29, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-19 08:50:52'),
(30, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-19 09:26:57'),
(31, 6,  'USER_LOGOUT',             'Officer Esterk logged out.',                                                                        NULL, '2026-08-19 09:27:12'),
(32, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-08-19 09:27:29'),
(33, 2,  'USER_CREATED',            'Created user Dambo with role Investigating Officer (Role ID: 3)',                                  NULL, '2026-08-19 09:28:24'),
(34, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-08-19 09:28:48'),
(35, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-19 09:29:05'),
(36, 8,  'USER_LOGOUT',             'Officer Dambo logged out.',                                                                        NULL, '2026-08-19 09:30:52'),
(37, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-19 09:31:28'),
(38, 8,  'USER_LOGOUT',             'Officer Dambo logged out.',                                                                        NULL, '2026-08-19 09:32:13'),
(39, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-19 09:32:23'),
(40, 6,  'CASE_ASSIGNED',           'Assigned Case ID 1 to Investigator Constable Dambo (Dambo). ',                                     NULL, '2026-08-19 09:33:04'),
(41, 6,  'USER_LOGOUT',             'Officer Esterk logged out.',                                                                        NULL, '2026-08-19 09:33:10'),
(42, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-19 09:33:35'),
(43, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-08-19 09:38:48'),
(44, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-19 09:40:33'),
(45, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-19 09:41:24'),
(46, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-19 09:45:16'),
(47, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-19 09:49:50'),
(48, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             NULL, '2026-08-21 17:24:45'),
(49, 8,  'CASE_NOTE_ADDED',         'Added investigation note to Case ID 1.',                                                           NULL, '2026-08-21 17:43:07'),
(50, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-08-21 17:53:37'),
(51, 2,  'PASSWORD_CHANGED',        'Officer LIM-001 updated their password.',                                                          NULL, '2026-08-21 17:54:19'),
(52, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-08-21 17:54:33'),
(53, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-08-21 17:56:23'),
(54, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-08-21 18:09:25'),
(55, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-08-21 18:10:05'),
(56, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-08-21 18:15:08'),
(57, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-21 18:18:37'),
(58, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-08-28 19:49:56'),
(59, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-09-05 09:11:12'),
(60, 6,  'USER_LOGOUT',             'Officer Esterk logged out.',                                                                        NULL, '2026-09-05 09:12:50'),
(61, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-05 09:13:33'),
(62, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-09-05 09:19:09'),
(63, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-05 09:38:37'),
(64, 2,  'USER_CREATED',            'Created user George with role Counter/Intake Officer (Role ID: 4)',                                NULL, '2026-09-05 09:40:16'),
(65, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-09-05 09:40:38'),
(66, 9,  'USER_LOGIN',              'Officer George logged in successfully.',                                                            NULL, '2026-09-05 09:41:01'),
(67, 9,  'CASE_REGISTERED',         'Registered new Case OB OB-20260905-0001 for complainant Patrick Magule.',                           NULL, '2026-09-05 09:45:58'),
(68, 9,  'USER_LOGOUT',             'Officer George logged out.',                                                                        NULL, '2026-09-05 10:02:14'),
(69, 6,  'USER_LOGIN',              'Officer Esterk logged in successfully.',                                                            NULL, '2026-09-05 10:02:26'),
(70, 6,  'USER_LOGOUT',             'Officer Esterk logged out.',                                                                        NULL, '2026-09-05 10:03:27'),
(71, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-05 10:03:39'),
(72, 2,  'USER_CREATED',            'Created user Surgent with role Investigating Officer (Role ID: 3)',                                NULL, '2026-09-05 10:06:28'),
(73, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-09-05 10:06:47'),
(74, 10, 'USER_LOGIN',              'Officer Surgent logged in successfully.',                                                           NULL, '2026-09-05 10:07:18'),
(75, 10, 'USER_LOGOUT',             'Officer Surgent logged out.',                                                                       NULL, '2026-09-05 10:07:39'),
(76, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-05 10:07:50'),
(77, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-05 10:26:11'),
(78, 2,  'STATUS_CHANGE',           'Toggled status for Surgent to Inactive',                                                            NULL, '2026-09-05 10:28:34'),
(79, 2,  'STATUS_CHANGE',           'Toggled status for Surgent to Active',                                                              NULL, '2026-09-05 10:28:57'),
(80, 2,  'CASE_REGISTERED',         'Registered new Case OB OB-20260905-0002 for complainant George Dambo.',                             NULL, '2026-09-05 10:43:05'),
(81, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-08 13:37:26'),
(82, 2,  'USER_CREATED',            'Created user Mirrium with role Station Commander (Role ID: 2)',                                    NULL, '2026-09-08 13:40:52'),
(83, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-09-08 13:41:09'),
(84, 11, 'USER_LOGIN',              'Officer Mirrium logged in successfully.',                                                           NULL, '2026-09-08 13:41:22'),
(85, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-14 18:18:56'),
(86, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           NULL, '2026-09-14 18:58:14'),
(87, 2,  'USER_CREATED',            'Created user Gloria with role Station Commander (Role ID: 2)',                                     NULL, '2026-09-14 18:59:23'),
(88, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      NULL, '2026-09-14 18:59:28'),
(89, 12, 'USER_LOGIN',              'Officer Gloria logged in successfully.',                                                            NULL, '2026-09-14 18:59:50'),
(90, 12, 'USER_LOGIN',              'Officer Gloria logged in successfully.',                                                            NULL, '2026-09-14 19:16:40'),
(118, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           '::1', '2026-09-16 16:09:03'),
(119, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      '::1', '2026-09-16 16:10:40'),
(120, 12, 'USER_LOGIN',              'Officer Gloria logged in successfully.',                                                            '::1', '2026-09-16 16:11:07'),
(121, 12, 'USER_LOGOUT',             'Officer Gloria logged out.',                                                                        '::1', '2026-09-16 16:18:52'),
(122, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           '::1', '2026-09-16 16:19:37'),
(123, 2,  'PASSWORD_RESET',          'Admin reset password for User ID 8',                                                                '::1', '2026-09-16 16:20:35'),
(124, 2,  'USER_UPDATED',            'Updated details for User ID 8 (George Dambo). Assigned Role: Counter/Intake Officer',               '::1', '2026-09-16 16:21:03'),
(125, 2,  'STATUS_CHANGE',           'Toggled status for LIM-002 to Active',                                                              '::1', '2026-09-16 16:21:13'),
(126, 2,  'STATUS_CHANGE',           'Toggled status for Huka to Active',                                                                '::1', '2026-09-16 16:21:16'),
(127, 2,  'PASSWORD_RESET',          'Admin reset password for User ID 10',                                                               '::1', '2026-09-16 16:22:05'),
(128, 2,  'USER_UPDATED',            'Updated details for User ID 10 (Surgent Ngwira). Assigned Role: Counter/Intake Officer',           '::1', '2026-09-16 16:22:20'),
(129, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      '::1', '2026-09-16 16:22:52'),
(130, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           '::1', '2026-09-16 16:23:02'),
(131, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      '::1', '2026-09-16 16:23:40'),
(132, 10, 'USER_LOGIN',              'Officer Surgent logged in successfully.',                                                           '::1', '2026-09-16 16:23:53'),
(133, 10, 'USER_LOGOUT',             'Officer Surgent logged out.',                                                                       '::1', '2026-09-16 16:27:49'),
(134, 8,  'USER_LOGIN',              'Officer Dambo logged in successfully.',                                                             '::1', '2026-09-16 16:28:06'),
(135, 8,  'USER_LOGOUT',             'Officer Dambo logged out.',                                                                        '::1', '2026-09-16 16:28:15'),
(136, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           '::1', '2026-09-16 16:28:37'),
(137, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      '::1', '2026-09-16 16:30:01'),
(138, 12, 'USER_LOGIN',              'Officer Gloria logged in successfully.',                                                            '::1', '2026-09-16 16:30:12'),
(139, 12, 'USER_LOGOUT',             'Officer Gloria logged out.',                                                                        '::1', '2026-09-16 16:31:42'),
(140, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           '::1', '2026-09-16 16:32:06'),
(141, 2,  'USER_CREATED',            'Created user Alex with role Investigating Officer (Role ID: 3)',                                   '::1', '2026-09-16 16:33:25'),
(142, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      '::1', '2026-09-16 16:33:31'),
(143, 26, 'USER_LOGIN',              'Officer Alex logged in successfully.',                                                              '::1', '2026-09-16 16:33:43'),
(144, 26, 'USER_LOGOUT',             'Officer Alex logged out.',                                                                          '::1', '2026-09-16 16:34:03'),
(145, 2,  'USER_LOGIN',              'Officer LIM-001 logged in successfully.',                                                           '::1', '2026-09-16 16:34:24'),
(146, 2,  'USER_LOGOUT',             'Officer LIM-001 logged out.',                                                                      '::1', '2026-09-16 16:34:35'),
(147, 12, 'USER_LOGIN',              'Officer Gloria logged in successfully.',                                                            '::1', '2026-09-16 16:34:53'),
(148, 12, 'CASE_ASSIGNED',           'Assigned Case ID 3 to Investigator Sergeant Kathabwa (Alex). Note: do this within a month',        '::1', '2026-09-16 16:36:55'),
(149, 12, 'USER_LOGOUT',             'Officer Gloria logged out.',                                                                        '::1', '2026-09-16 16:37:28'),
(150, 26, 'USER_LOGIN',              'Officer Alex logged in successfully.',                                                              '::1', '2026-09-16 16:37:40'),
(151, 26, 'STATUS_CHANGE_REQUESTED', 'Requested status change to "Closed" for Case ID 3.',                                             '::1', '2026-09-16 16:40:50');

SELECT setval(pg_get_serial_sequence('audit_logs', 'id'), (SELECT MAX(id) FROM audit_logs));

-- Session store (kept for compatibility; app uses in-memory sessions by default)
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  session_id varchar(128) NOT NULL,
  expires    integer NOT NULL,
  data       text,
  PRIMARY KEY (session_id)
);

-- SMS Messages (invitation delivery log)
DROP TABLE IF EXISTS sms_messages CASCADE;
CREATE TABLE sms_messages (
  id              SERIAL PRIMARY KEY,
  recipient_phone varchar(30)  NOT NULL,
  message         text         NOT NULL,
  status          varchar(10)  NOT NULL DEFAULT 'QUEUED',
  provider        varchar(50)  DEFAULT NULL,
  message_length  integer      DEFAULT NULL,
  response_body   text,
  created_at      timestamptz  NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_sms_status CHECK (status IN ('SENT', 'FAILED', 'QUEUED'))
);

CREATE INDEX idx_sms_status ON sms_messages (status);
CREATE INDEX idx_sms_created ON sms_messages (created_at);

-- ============================================================
-- 3. TRIGGERS (emulate MySQL ON UPDATE CURRENT_TIMESTAMP)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_cases_updated_at
    BEFORE UPDATE ON cases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Default Admin login credentials:
--   Badge Number : LIM-001
--   Password     : Admin@12345  (change on first login)
-- ============================================================
