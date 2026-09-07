# SE-IoT Product Backlog

This document provides a Jira-ready backlog for the SE-IoT project. Work is assigned to one primary epic to reduce duplication. References to another epic are dependencies, not duplicated implementation tasks.

Story points use the Fibonacci scale (`1, 2, 3, 5, 8, 13`) and represent relative complexity, uncertainty, integration effort, and testing. They are planning estimates, not elapsed time.

## Subtask Prefixes

- `[FE]` — Frontend implementation
- `[BE]` — Backend implementation
- `[QA]` — Testing and quality assurance
- `[DEVOPS]` — Infrastructure, deployment, and operations
- `[SEC]` — Security work
- `[DOCS]` — Documentation
- `[UX]` — User experience and design research
- `[PM]` — Product and requirements work
- `[HW]` — Physical hardware work
- `[FW]` — Embedded firmware work
- `[NET]` — Network configuration and remote access

## Product Backlog

This ordered backlog is based on `main` plus the fetched remote branch `origin/feature/backend-mqtt-broker` at commit `66ef375` (`feat(mqtt): add backend MQTT broker`), reviewed on 2026-08-19. The feature branch was inspected without switching or merging it.

### Status Definitions

- **To Do** — No implementation evidence was found in the repository, or work has not started.
- **In Progress** — Some implementation exists, but one or more acceptance criteria or tests remain incomplete.
- **Done** — All acceptance criteria are met, tests pass, and the work is merged into the target branch.

No item from `feature/backend-mqtt-broker` is marked Done because the branch is not merged into `main`, automated coverage is absent, and several acceptance criteria remain open.

| Rank | Priority | Backlog item | Points | Status | Current evidence or next outcome |
| ---: | :---: | --- | ---: | --- | --- |
| 1 | P0 | P01-38-S02 — Define Environmental Monitoring Requirements | 5 | To Do | Confirm metrics, thresholds, sampling, freshness, and retention with stakeholders. |
| 2 | P0 | P01-10-S01 — Select the Sensor Hardware Platform | 5 | To Do | Confirm the physical sensor/controller choice against validated requirements. |
| 3 | P0 | P01-16-S01 — Ingest Sensor Readings from MQTT | 5 | In Progress | Branch configures local Mosquitto, authenticated access, MQTT subscription, payload validation, and reconnect support; tests remain. |
| 4 | P0 | P01-16-S02 — Persist Sensor Readings | 8 | In Progress | Branch adds SQLite, a Docker volume, UTC timestamps, retention, and cleanup; device indexing, duplicate policy, failure handling, and tests remain. |
| 5 | P0 | P01-10-S02 — Read and Validate Environmental Measurements | 5 | To Do | Firmware implementation is not present in this repository. |
| 6 | P0 | P01-10-S03 — Calibrate and Verify Sensor Accuracy | 8 | To Do | Calibration evidence and device-level results are not present. |
| 7 | P0 | P01-10-S04 — Connect Devices and Publish MQTT Data | 8 | To Do | Backend contract exists, but device firmware and recovery tests are not present. |
| 8 | P0 | P01-16-S03 — Provide Sensor Reading APIs | 8 | In Progress | Branch persists and returns up to 1,000 readings; device/date filters, pagination, per-device latest data, aggregation, and tests remain. |
| 9 | P0 | P01-16-S05 — Deploy Raspberry Pi 3 Host and Docker MQTT Broker | 13 | In Progress | Pi network access is proven with DHCP, NetworkManager, same-subnet mDNS, and Tailscale; branch adds Dockerized Mosquitto, backend, frontend, and SQLite. MQTT persistence, per-device ACLs, clean deployment, and ESP32 end-to-end tests remain. |
| 10 | P0 | P01-2-S01 — Display Live Sensor Overview | 5 | In Progress | Five-second polling exists, but only device IDs `001` and `002` map to live data and remaining devices are mock data. |
| 11 | P0 | P01-2-S03 — Analyze Historical Sensor Trends | 8 | In Progress | Chart and filters exist, but `generateRangeComparison()` still creates synthetic history instead of consuming stored readings. |
| 12 | P0 | P01-25-S02 — Sign In and Maintain a Session | 8 | In Progress | Sign-in UI and local session behavior exist; secure backend sessions and tests remain. |
| 13 | P0 | P01-25-S05 — Enforce Role-Based Access Control | 8 | In Progress | Frontend mock roles exist; authenticated roles and backend authorization remain. |
| 14 | P0 | P01-39-S01 — Configure Alert Rules | 5 | To Do | Threshold fields exist in frontend-only sensor records, but persistent alert rules do not. |
| 15 | P0 | P01-39-S02 — Detect Abnormal Sensor Conditions | 8 | To Do | No server-side rule evaluation, deduplication, duration, or recovery service exists. |
| 16 | P1 | P01-2-S02 — Display Environmental Summary Metrics | 3 | In Progress | Online count and average cards exist; API-derived warning, offline, stale, and no-data behavior remain. |
| 17 | P1 | P01-2-S04 — Display Sensors on the Laboratory Floor Plan | 5 | In Progress | Static floor plan and mock coordinates exist; persistent positions and complete state handling remain. |
| 18 | P1 | P01-2-S06 — Provide Reliable Responsive and Accessible Dashboard States | 5 | In Progress | Responsive UI and branch storage warning exist; complete loading, error, stale, retry, mobile navigation, and accessibility states remain. |
| 19 | P1 | P01-16-S04 — Manage the Sensor Registry | 5 | To Do | Persistent sensor registry and CRUD APIs are not implemented. |
| 20 | P1 | P01-16-S06 — Protect and Observe Backend Services | 5 | In Progress | Branch adds retention and storage warnings; structured errors, metrics, rate limiting, and regression tests remain. |
| 21 | P1 | P01-25-S01 — Register a User Account | 5 | In Progress | Signup UI exists; persistent accounts, secure password storage, activation, and API tests remain. |
| 22 | P1 | P01-25-S03 — Sign Out and Revoke Sessions | 3 | In Progress | Local logout exists; server-side session revocation and reuse tests remain. |
| 23 | P1 | P01-25-S04 — Manage User Profile and Password | 5 | In Progress | Profile and password forms exist; backend persistence, secure password change, and image storage remain. |
| 24 | P1 | P01-2-S05 — Manage Sensor Configuration in the UI | 5 | In Progress | Sensor table and frontend-only CRUD forms exist; API integration and persistent coordinates remain. |
| 25 | P1 | P01-39-S03 — Manage the Incident Lifecycle | 8 | To Do | Incident models, state transitions, APIs, and UI are not present. |
| 26 | P1 | P01-39-S04 — Deliver Alert Notifications | 8 | To Do | Notification events, channels, retries, and delivery tracking are not present. |
| 27 | P1 | P01-10-S05 — Install and Identify Laboratory Sensors | 5 | To Do | Physical installation must be confirmed outside the repository. |
| 28 | P1 | P01-10-S06 — Verify Device Reliability and Maintainability | 8 | To Do | Soak tests, watchdog telemetry, update, replacement, and troubleshooting evidence are not present. |
| 29 | P1 | P01-38-S01 — Understand Users and Current Workflows | 5 | To Do | User research evidence is not present in the repository. |
| 30 | P1 | P01-38-S03 — Evaluate Technical Feasibility and Risks | 5 | In Progress | The MQTT/SQLite/Raspberry Pi branch demonstrates feasibility; comparison, threat assessment, and documented decisions remain. |
| 31 | P2 | P01-38-S04 — Validate Dashboard and Alert Concepts | 5 | To Do | No usability-test plan or findings are present. |
| 32 | P2 | P01-38-S05 — Finalize the Validated Problem Statement | 3 | To Do | A signed-off problem statement and success measures are not present. |
| 33 | P2 | P01-39-S05 — Manage Preferences and Escalation | 8 | To Do | Notification preferences and escalation processing are not present. |
| 34 | P2 | P01-39-S06 — Review Alert and Incident History | 5 | To Do | Incident history, response metrics, filters, and export are not present. |

### Feature Branch Review Summary

The branch advances P01-16 substantially but does not close a complete story yet. Its work should be reviewed and merged as an implementation increment, followed by the remaining acceptance criteria and automated tests.

Immediate follow-up priorities are:

1. Review the branch for credentials, per-device MQTT ACLs, broker persistence, SQLite cleanup, SD-card wear, and deployment safety.
2. Add backend tests for MQTT validation, persistence, retention, storage cleanup, and APIs.
3. Extend history APIs with device/date filtering and aggregation.
4. Replace the frontend hard-coded live-device map and synthetic trend history.
5. Merge only after the agreed acceptance criteria and regression checks pass.

---

# P01-2 — Monitoring Dashboard & Data Analytics UI

Build the frontend used to monitor current sensor readings, review summaries, locate devices, and analyze historical data. This epic consumes APIs from P01-16 and alert status from P01-39. Authentication belongs to P01-25.

## P01-2-S01 — Display Live Sensor Overview

**User story:** As a laboratory user, I want to see the latest reading and connection status of every sensor so that I can understand current laboratory conditions.

**Story points:** 5

### Acceptance Criteria

- [ ] The dashboard displays every sensor returned by the server.
- [ ] Each sensor displays its name, temperature, humidity, and connection status.
- [ ] Readings refresh automatically every five seconds without reloading the page.
- [ ] Selecting a sensor highlights it consistently across dashboard components.
- [ ] Production data is not replaced with mock values when the API is unavailable.

### Subtasks

- `[FE] Create reusable live sensor card component`
- `[FE] Integrate sensor list with latest-reading API`
- `[FE] Replace hard-coded sensor and device mappings`
- `[FE] Implement five-second sensor polling`
- `[FE] Add selected-sensor state and highlighting`
- `[QA] Test live overview with multiple sensors`

**Dependency:** P01-16 provides the sensor registry and latest-reading APIs.

## P01-2-S02 — Display Environmental Summary Metrics

**User story:** As a laboratory user, I want summary metrics so that I can quickly evaluate the overall environment.

**Story points:** 3

### Acceptance Criteria

- [ ] The dashboard shows online sensors compared with total sensors.
- [ ] Average temperature and humidity use online sensors with valid readings only.
- [ ] The summary displays counts for warning, offline, and stale sensors.
- [ ] Summary values update when new readings are received.
- [ ] A meaningful `No data` value appears when averages cannot be calculated.

### Subtasks

- `[FE] Build online sensor summary card`
- `[FE] Build average temperature summary card`
- `[FE] Build average humidity summary card`
- `[FE] Display warning offline and stale counts`
- `[FE] Add no-data handling to summary metrics`
- `[QA] Test environmental summary calculations`

**Boundary:** P01-39 determines alert conditions; this story only presents the resulting status.

## P01-2-S03 — Analyze Historical Sensor Trends

**User story:** As a laboratory user, I want to compare sensor readings over time so that I can identify changes and abnormal patterns.

**Story points:** 8

### Acceptance Criteria

- [ ] Users can switch between temperature and humidity charts.
- [ ] Users can select Today, 7 Days, 30 Days, or a custom date range.
- [ ] Historical values come from the server and are not generated by the frontend.
- [ ] Each sensor is represented by a clearly identified chart line.
- [ ] Tooltips show the sensor, timestamp, value, and unit.
- [ ] Missing readings appear as gaps and are not represented as invented values.

### Subtasks

- `[FE] Replace generated chart history with API data`
- `[FE] Transform historical readings into chart series`
- `[FE] Add temperature and humidity metric tabs`
- `[FE] Add preset and custom date-range filters`
- `[FE] Improve chart legend tooltip and selected-sensor emphasis`
- `[QA] Test chart metrics filters and missing readings`

**Dependency:** P01-16 provides date-filtered and aggregated historical readings.

## P01-2-S04 — Display Sensors on the Laboratory Floor Plan

**User story:** As a laboratory operator, I want to see sensor locations on a floor plan so that I can connect readings to physical areas.

**Story points:** 5

### Acceptance Criteria

- [ ] Each sensor with coordinates appears at the correct floor-plan position.
- [ ] Marker appearance communicates normal, warning, offline, or stale status.
- [ ] Selecting a marker selects the corresponding sensor in the list and chart.
- [ ] Sensor details are available from each marker.
- [ ] Sensors without coordinates display a location-not-configured state.

### Subtasks

- `[FE] Create responsive laboratory floor-plan component`
- `[FE] Load floor-plan coordinates from sensor data`
- `[FE] Render status-aware sensor markers`
- `[FE] Synchronize floor-plan and dashboard selection`
- `[FE] Add marker details and keyboard interaction`
- `[QA] Test missing and overlapping sensor locations`

**Dependency:** P01-16 stores and returns sensor location coordinates.

## P01-2-S05 — Manage Sensor Configuration in the UI

**User story:** As an administrator, I want to manage sensor information through the web UI so that dashboard devices and monitoring thresholds remain organized.

**Story points:** 5

### Acceptance Criteria

- [ ] The page lists registered sensors and their latest status.
- [ ] Administrators can submit add, edit, and delete operations through server APIs.
- [ ] The form validates required fields, device ID, location, and threshold ranges.
- [ ] Server validation errors appear next to the relevant fields.
- [ ] Saved changes remain visible after a page refresh.

### Subtasks

- `[FE] Connect registered sensor table to API`
- `[FE] Connect Add Sensor form to API`
- `[FE] Connect Edit Sensor form to API`
- `[FE] Connect Delete Sensor confirmation to API`
- `[FE] Validate threshold location and coordinate fields`
- `[FE] Display server validation and request errors`
- `[QA] Test sensor management UI workflows`

**Dependencies:** P01-16 owns CRUD APIs; P01-25 owns permissions; P01-10 owns physical provisioning.

## P01-2-S06 — Provide Reliable Responsive and Accessible Dashboard States

**User story:** As a user, I want clear feedback and a usable layout on different devices so that I can monitor sensors reliably.

**Story points:** 5

### Acceptance Criteria

- [ ] Loading, empty, error, stale, and retry states are clearly displayed.
- [ ] Last valid readings remain visible during a temporary failure and are marked stale.
- [ ] The dashboard provides usable navigation on desktop, tablet, and mobile.
- [ ] Interactive elements support keyboard navigation and accessible names.
- [ ] Status does not depend only on color.

### Subtasks

- `[FE] Add dashboard loading empty error and retry states`
- `[FE] Display last-updated and stale-data indicators`
- `[FE] Implement polling retry and backoff behavior`
- `[FE] Add responsive mobile dashboard navigation`
- `[FE] Improve keyboard and screen-reader support`
- `[QA] Run responsive accessibility and production-build checks`

---

# P01-16 — Server Ingestion, Storage & Networking

Receive sensor data, validate it, store it, and expose reliable APIs. This epic supplies data to P01-2 and P01-39.

## P01-16-S01 — Ingest Sensor Readings from MQTT

**User story:** As the monitoring system, I want to receive readings from MQTT devices so that sensor measurements enter the platform.

**Story points:** 5

### Acceptance Criteria

- [ ] The service connects to the configured MQTT broker and topics.
- [ ] Valid payloads require device ID, temperature, and humidity; pressure is optional.
- [ ] Device ID can be derived from the configured topic when absent from the payload.
- [ ] Invalid JSON and incomplete messages are rejected without stopping the subscriber.
- [ ] The client reconnects after a temporary disconnection.

### Subtasks

- `[BE] Configure MQTT client and topic subscription`
- `[BE] Validate and normalize MQTT payloads`
- `[BE] Extract device ID from supported topic formats`
- `[BE] Add subscriber reconnect handling`
- `[BE] Add structured ingestion error logging`
- `[QA] Test valid invalid and incomplete MQTT messages`

## P01-16-S02 — Persist Sensor Readings

**User story:** As the monitoring system, I want readings stored persistently so that historical data survives service restarts.

**Story points:** 8

### Acceptance Criteria

- [ ] Every accepted reading is saved with device ID, values, and a UTC timestamp.
- [ ] Stored readings remain available after a backend restart.
- [ ] Storage supports efficient device and date-range queries.
- [ ] Duplicate-message behavior is defined and tested.
- [ ] Database failures are logged without silently losing data.

### Subtasks

- `[BE] Design sensor-reading database schema`
- `[BE] Add database connection and migration setup`
- `[BE] Replace in-memory history with persistent storage`
- `[BE] Add indexes for device and timestamp queries`
- `[BE] Define duplicate-reading handling`
- `[QA] Test persistence restart and database failure behavior`

## P01-16-S03 — Provide Sensor Reading APIs

**User story:** As a system client, I want current and historical sensor APIs so that I can display and analyze measurements.

**Story points:** 8

### Acceptance Criteria

- [ ] The latest endpoint returns the newest valid reading per requested device.
- [ ] History supports device, start date, end date, limit, and pagination filters.
- [ ] Results are consistently ordered and include UTC timestamps.
- [ ] Invalid parameters return a clear `400` response.
- [ ] Response size is limited to protect performance.

### Subtasks

- `[BE] Define sensor API request and response contracts`
- `[BE] Implement latest reading per device endpoint`
- `[BE] Implement filtered historical readings endpoint`
- `[BE] Add pagination ordering and maximum limits`
- `[BE] Add hourly and daily aggregation options`
- `[QA] Test query filters validation and limits`
- `[DOCS] Document sensor API contracts and examples`

## P01-16-S04 — Manage the Sensor Registry

**User story:** As an authorized system client, I want persistent sensor configuration so that device metadata and monitoring settings are available to the platform.

**Story points:** 5

### Acceptance Criteria

- [ ] APIs support listing, creating, updating, and deleting sensor records.
- [ ] Device identifiers are required and unique.
- [ ] A sensor stores name, location, coordinates, and environmental thresholds.
- [ ] Minimum thresholds cannot exceed maximum thresholds.
- [ ] Deletion behavior for historical readings is explicitly defined.

### Subtasks

- `[BE] Design sensor registry data model`
- `[BE] Implement sensor list and detail endpoints`
- `[BE] Implement create update and delete endpoints`
- `[BE] Add device ID threshold and coordinate validation`
- `[BE] Define sensor deletion and history retention behavior`
- `[QA] Test sensor registry CRUD operations`

## P01-16-S05 — Deploy Raspberry Pi 3 Host and Docker MQTT Broker

**User story:** As a system operator, I want the web application, backend service, database, and MQTT broker deployed on a Raspberry Pi 3 so that the Pi can host the monitoring system and receive sensor readings published by ESP32 devices.

**Story points:** 13

### Deployment Context

The Raspberry Pi 3 hosts the Dockerized web application, backend, SQLite database, and MQTT broker. The Pi and ESP32 devices share the IoT subnet, where `tempse.local` works. Administrators on another routed subnet use Tailscale because mDNS does not cross the router. The Pi remains on DHCP and uses NetworkManager with its registered permanent Wi-Fi MAC.

### Acceptance Criteria

- [ ] The repository can deploy the broker, backend, frontend, and persistent SQLite storage to a Raspberry Pi 3 with Docker Compose.
- [ ] The Pi connects reliably using DHCP, its registered permanent Wi-Fi MAC, and NetworkManager-managed IoT and fallback profiles.
- [ ] ESP32 devices on the IoT subnet can publish the agreed sensor payload to `tempse.local:1883` without relying on a fixed IP address.
- [ ] Administrators have secure cross-subnet access through Tailscale, key-only SSH, and a tested recovery path.
- [ ] Mosquitto rejects anonymous access, applies per-device credentials and topic ACLs, and persists broker data across restarts.
- [ ] The backend stores ESP32 readings in SQLite and exposes them to the monitoring dashboard.
- [ ] The services recover after container or Pi restarts, while retention controls limit disk growth and microSD-card wear.
- [ ] End-to-end testing verifies ESP32, MQTT, backend, database, API, dashboard, network access, and recovery.

### Subtasks

- `[NET] Configure permanent Wi-Fi MAC DHCP and NetworkManager connection profiles`
- `[NET] Configure Tailscale key-only SSH and self-reverting network recovery`
- `[DEVOPS] Install Docker and deploy the Pi service stack with persistent volumes`
- `[DEVOPS] Configure Mosquitto authentication ACLs topic tree and persistence`
- `[SEC] Generate and rotate broker device network and remote-access credentials`
- `[FW] Configure each ESP32 broker address device ID topic and credential`
- `[BE] Configure MQTT ingestion health reporting retention and Pi storage limits`
- `[QA] Test ESP32-to-dashboard data delivery and MQTT access controls`
- `[QA] Test cross-subnet access service restart Pi reboot and network recovery`
- `[DOCS] Document Raspberry Pi deployment network verification backup and recovery`

## P01-16-S06 — Protect and Observe Backend Services

**User story:** As a system operator, I want secure and observable services so that failures and misuse can be detected and diagnosed.

**Story points:** 5

### Acceptance Criteria

- [ ] Logs include useful event context without sensitive values.
- [ ] API errors use consistent safe response formats.
- [ ] Retention controls prevent unbounded storage growth.
- [ ] Metrics expose ingestion, rejection, latency, and connection health.
- [ ] Automated tests cover ingestion, storage, and API flows.

### Subtasks

- `[BE] Add consistent API error handling`
- `[BE] Add structured logs and correlation context`
- `[BE] Add data-retention configuration and cleanup job`
- `[DEVOPS] Add backend metrics and monitoring`
- `[SEC] Add request validation and rate-limit controls`
- `[QA] Add backend integration and regression suite`

---

# P01-25 — User Authentication & Account Management

Manage identities, sessions, profiles, passwords, roles, and authorization. Other epics consume authenticated identity but do not reimplement it.

## P01-25-S01 — Register a User Account

**User story:** As a new user, I want to create an account so that I can access the monitoring platform.

**Story points:** 5

### Acceptance Criteria

- [ ] Registration requires a name, unique username, valid email, and password.
- [ ] Invalid or duplicate information produces clear errors.
- [ ] Passwords are never stored or logged as plain text.
- [ ] Successful registration follows the agreed activation flow.
- [ ] The form prevents duplicate submission.

### Subtasks

- `[BE] Create user account model and migration`
- `[BE] Implement secure registration endpoint`
- `[SEC] Add password hashing and password policy`
- `[FE] Connect signup form to registration API`
- `[FE] Display registration validation errors`
- `[QA] Test successful invalid and duplicate registration`

## P01-25-S02 — Sign In and Maintain a Session

**User story:** As a registered user, I want to sign in securely so that I can access authorized features.

**Story points:** 8

### Acceptance Criteria

- [ ] Valid credentials create a secure authenticated session.
- [ ] Invalid credentials do not reveal whether an account exists.
- [ ] Session state survives an allowed refresh and expires according to policy.
- [ ] Protected routes redirect unauthenticated users to sign in.
- [ ] Successful sign-in provides the user's profile and role.

### Subtasks

- `[BE] Implement authentication endpoint and session issuance`
- `[SEC] Configure secure token or cookie handling`
- `[FE] Connect sign-in form to authentication API`
- `[FE] Replace local mock-user session handling`
- `[FE] Add protected-route session checks`
- `[QA] Test valid invalid expired and missing sessions`

## P01-25-S03 — Sign Out and Revoke Sessions

**User story:** As an authenticated user, I want to sign out so that my account is no longer accessible from the current session.

**Story points:** 3

### Acceptance Criteria

- [ ] Signing out invalidates the current server session or refresh token.
- [ ] Local identity and protected cached data are cleared.
- [ ] The user returns to the sign-in page.
- [ ] A revoked session cannot access protected APIs.

### Subtasks

- `[BE] Implement session revocation endpoint`
- `[FE] Connect logout action to revocation endpoint`
- `[FE] Clear local session and protected cached data`
- `[SEC] Verify revoked credentials cannot be reused`
- `[QA] Test logout and session reuse attempts`

## P01-25-S04 — Manage User Profile and Password

**User story:** As an authenticated user, I want to update my profile and password so that my account remains current and secure.

**Story points:** 5

### Acceptance Criteria

- [ ] Users can update allowed profile fields and retrieve saved changes.
- [ ] Email and username uniqueness is enforced.
- [ ] Password changes require the current password and confirmation.
- [ ] Profile images follow configured type and size restrictions.
- [ ] Sensitive account changes are audited.

### Subtasks

- `[BE] Implement profile read and update endpoints`
- `[BE] Implement secure password-change endpoint`
- `[BE] Add profile image storage or remove unsupported upload UI`
- `[FE] Connect profile and password forms to APIs`
- `[QA] Test profile validation and password changes`

## P01-25-S05 — Enforce Role-Based Access Control

**User story:** As an administrator, I want permissions enforced by role so that users access only authorized functionality.

**Story points:** 8

### Acceptance Criteria

- [ ] The system supports agreed administrator, member, and viewer roles.
- [ ] Backend authorization protects every restricted operation.
- [ ] The frontend hides or disables unauthorized routes and actions.
- [ ] Direct requests cannot bypass frontend restrictions.
- [ ] Permission denials return `403` and are auditable.

### Subtasks

- `[BE] Define role and permission model`
- `[BE] Add authorization middleware to protected APIs`
- `[FE] Replace mock roles with authenticated-user permissions`
- `[FE] Apply permission checks to routes and actions`
- `[SEC] Review restricted operations for authorization gaps`
- `[QA] Test the permission matrix for every role`

---

# P01-38 — Research the Problem State

Understand laboratory users, monitoring problems, environmental requirements, and technical constraints. This epic produces evidence and decisions; implementation belongs to delivery epics.

## P01-38-S01 — Understand Users and Current Workflows

**User story:** As the product team, we want to understand laboratory users and their current workflow so that the system addresses real monitoring problems.

**Story points:** 5

### Acceptance Criteria

- [ ] Relevant stakeholder and user groups are identified.
- [ ] Current monitoring, escalation, and reporting workflows are documented.
- [ ] Major pain points and unmet needs are supported by evidence.
- [ ] Findings distinguish observed facts from assumptions.

### Subtasks

- `[PM] Identify stakeholders and research participants`
- `[UX] Prepare interview and observation guide`
- `[UX] Conduct user interviews or observations`
- `[UX] Map the current monitoring journey`
- `[PM] Document evidence assumptions and open questions`

## P01-38-S02 — Define Environmental Monitoring Requirements

**User story:** As the product team, we want monitoring requirements so that the system measures and presents meaningful laboratory conditions.

**Story points:** 5

### Acceptance Criteria

- [ ] Required metrics and units are documented.
- [ ] Accuracy, sampling, freshness, and retention needs are defined.
- [ ] Normal, warning, and critical ranges have an identified source or owner.
- [ ] Device placement and coverage requirements are recorded.
- [ ] Applicable regulatory or organizational constraints are identified.

### Subtasks

- `[PM] Gather environmental measurement requirements`
- `[PM] Define freshness sampling and retention expectations`
- `[PM] Identify threshold owners and approval process`
- `[UX] Document location and floor-plan information needs`
- `[DOCS] Record compliance privacy and audit constraints`

## P01-38-S03 — Evaluate Technical Feasibility and Risks

**User story:** As the engineering team, we want to evaluate technical options and risks so that architecture decisions are evidence-based.

**Story points:** 5

### Acceptance Criteria

- [ ] Sensor, connectivity, storage, and hosting options are compared.
- [ ] MQTT reliability and target-network constraints are evaluated.
- [ ] Security, privacy, scalability, and maintenance risks are documented.
- [ ] Recommendations include rationale, trade-offs, and open questions.

### Subtasks

- `[PM] Define technical evaluation criteria`
- `[HW] Compare sensor and connectivity options`
- `[BE] Prototype MQTT and storage feasibility`
- `[SEC] Perform initial threat and privacy assessment`
- `[DEVOPS] Assess deployment and network constraints`
- `[DOCS] Publish architecture recommendation and risk register`

## P01-38-S04 — Validate Dashboard and Alert Concepts

**User story:** As the product team, we want to validate dashboard and alert concepts so that implementation is understandable and useful.

**Story points:** 5

### Acceptance Criteria

- [ ] Representative users review core dashboard and alert workflows.
- [ ] Tests cover sensor status, charts, floor plan, and alert interpretation.
- [ ] Findings are prioritized by severity and frequency.
- [ ] Accepted findings update the appropriate delivery epic.

### Subtasks

- `[UX] Create dashboard and alert test scenarios`
- `[UX] Conduct concept or usability testing`
- `[UX] Analyze task success confusion and feedback`
- `[PM] Prioritize findings and recommended changes`
- `[PM] Update acceptance criteria in owning delivery epics`

## P01-38-S05 — Finalize the Validated Problem Statement

**User story:** As the project team, we want a validated problem statement and success measures so that all epics work toward the same outcome.

**Story points:** 3

### Acceptance Criteria

- [ ] The problem statement identifies users, needs, context, and consequences.
- [ ] Project goals and non-goals are explicit.
- [ ] Measurable product and operational success indicators are defined.
- [ ] Assumptions, risks, dependencies, and decisions are traceable.
- [ ] Stakeholders approve the research summary.

### Subtasks

- `[PM] Synthesize research into final problem statement`
- `[PM] Define goals non-goals and success measures`
- `[PM] Maintain decision dependency and risk log`
- `[DOCS] Publish research summary and evidence`
- `[PM] Facilitate stakeholder review and approval`

---

# P01-39 — Alert & Incident Notification System

Evaluate sensor conditions, create incidents, manage their lifecycle, and deliver notifications. P01-2 presents alert status but does not implement detection or delivery.

## P01-39-S01 — Configure Alert Rules

**User story:** As an administrator, I want to configure environmental alert rules so that abnormal conditions are evaluated consistently.

**Story points:** 5

### Acceptance Criteria

- [ ] Rules support temperature, humidity, offline, and stale conditions.
- [ ] Rules support warning and critical severity.
- [ ] Thresholds, evaluation duration, and recovery conditions are configurable.
- [ ] Invalid or conflicting values are rejected.
- [ ] Rule changes record actor and timestamp.

### Subtasks

- `[BE] Design alert-rule data model`
- `[BE] Implement alert-rule CRUD endpoints`
- `[BE] Add threshold duration and recovery validation`
- `[FE] Create alert-rule configuration UI`
- `[SEC] Add authorization and audit records`
- `[QA] Test alert-rule validation and updates`

## P01-39-S02 — Detect Abnormal Sensor Conditions

**User story:** As a laboratory operator, I want abnormal conditions detected automatically so that problems are identified promptly.

**Story points:** 8

### Acceptance Criteria

- [ ] New readings are evaluated against active rules.
- [ ] Duration rules are satisfied before triggering when configured.
- [ ] Repeated readings do not create duplicate active alerts.
- [ ] Offline and stale-device conditions can create alerts.
- [ ] Recovery is detected when readings return to the safe range.

### Subtasks

- `[BE] Implement reading-to-rule evaluation service`
- `[BE] Add warning and critical condition detection`
- `[BE] Add offline and stale-device detection`
- `[BE] Add alert deduplication and recovery logic`
- `[BE] Record evaluation and transition timestamps`
- `[QA] Test duration deduplication and recovery`

**Dependency:** P01-16 provides readings, device status, and timestamps.

## P01-39-S03 — Manage the Incident Lifecycle

**User story:** As a laboratory operator, I want to acknowledge and resolve incidents so that the team can coordinate its response.

**Story points:** 8

### Acceptance Criteria

- [ ] An alert opens an incident with device, severity, rule, and timestamps.
- [ ] Authorized users can acknowledge and resolve an incident.
- [ ] Every state change records actor, time, and optional note.
- [ ] States follow defined transition rules.
- [ ] Incident history remains available after resolution.

### Subtasks

- `[BE] Design incident and incident-event models`
- `[BE] Implement incident state-transition service`
- `[BE] Implement incident list detail and action APIs`
- `[FE] Create incident list and detail UI`
- `[FE] Add acknowledge resolve and note actions`
- `[QA] Test valid and invalid incident transitions`

## P01-39-S04 — Deliver Alert Notifications

**User story:** As a responsible team member, I want incident notifications so that I can respond without continuously watching the dashboard.

**Story points:** 8

### Acceptance Criteria

- [ ] Notifications use enabled channels and severity rules.
- [ ] Content identifies device, condition, severity, value, and time.
- [ ] Delivery attempts and outcomes are recorded.
- [ ] Temporary failures retry without duplicate messages.
- [ ] Secrets and recipient details are protected from logs.

### Subtasks

- `[BE] Define notification event and delivery models`
- `[BE] Implement in-application notification channel`
- `[BE] Integrate agreed external notification channel`
- `[BE] Add delivery retry and idempotency controls`
- `[SEC] Protect provider credentials and recipient data`
- `[QA] Test successful failed retried and duplicate delivery`

## P01-39-S05 — Manage Preferences and Escalation

**User story:** As a user, I want notification preferences and escalation so that the right people receive appropriate alerts.

**Story points:** 8

### Acceptance Criteria

- [ ] Users can configure supported channels and severity preferences.
- [ ] Critical alerts escalate when not acknowledged within the configured period.
- [ ] Invalid recipients or escalation configurations are rejected.
- [ ] Preference changes are authorized and auditable.
- [ ] Escalation stops after acknowledgement or resolution.

### Subtasks

- `[BE] Design preference and escalation models`
- `[BE] Implement preference and escalation APIs`
- `[BE] Implement timed escalation processing`
- `[FE] Create notification preference UI`
- `[SEC] Enforce access control for recipient configuration`
- `[QA] Test routing escalation and cancellation`

## P01-39-S06 — Review Alert and Incident History

**User story:** As a laboratory manager, I want searchable incident history so that I can review recurring problems and response performance.

**Story points:** 5

### Acceptance Criteria

- [ ] History can be filtered by date, device, severity, and status.
- [ ] Results show trigger, acknowledgement, resolution, and notification times.
- [ ] Active alerts are distinguishable from resolved incidents.
- [ ] Measures include alert count and response duration.
- [ ] Export respects permissions and privacy rules.

### Subtasks

- `[BE] Implement filtered alert and incident history API`
- `[BE] Calculate response and resolution metrics`
- `[FE] Create alert-history filters and results table`
- `[FE] Display incident timeline and delivery status`
- `[BE] Add authorized history export`
- `[QA] Test filters metrics permissions and export`

---

# P01-10 — IoT Sensor Hardware

Select, build, configure, calibrate, install, and maintain physical devices. P01-16 receives their data; this epic owns the devices that produce it.

## P01-10-S01 — Select the Sensor Hardware Platform

**User story:** As the engineering team, we want suitable sensor and controller hardware so that devices meet laboratory measurement and connectivity needs.

**Story points:** 5

### Acceptance Criteria

- [ ] Required range, accuracy, resolution, and sampling rate are documented.
- [ ] Candidate sensors and controllers are compared against agreed criteria.
- [ ] Connectivity, power, availability, cost, and enclosure are considered.
- [ ] The selected platform and trade-offs are approved.

### Subtasks

- `[HW] Define hardware evaluation criteria`
- `[HW] Compare environmental sensors`
- `[HW] Compare controller connectivity and power options`
- `[HW] Build bill of materials and cost estimate`
- `[DOCS] Record hardware selection and trade-offs`

**Dependency:** P01-38 supplies validated requirements.

## P01-10-S02 — Read and Validate Environmental Measurements

**User story:** As the monitoring system, I want each device to read sensors reliably so that published measurements are trustworthy.

**Story points:** 5

### Acceptance Criteria

- [ ] Firmware initializes sensors and samples at the configured interval.
- [ ] Measurements use agreed units and precision.
- [ ] Read failures and out-of-range values do not appear as valid data.
- [ ] Device and firmware version are available for diagnostics.
- [ ] Sampling remains stable over the agreed test period.

### Subtasks

- `[FW] Implement sensor initialization and sampling loop`
- `[FW] Convert readings to agreed units and precision`
- `[FW] Add invalid-reading and sensor-failure handling`
- `[FW] Add device and firmware diagnostic metadata`
- `[QA] Run measurement stability and failure tests`

## P01-10-S03 — Calibrate and Verify Sensor Accuracy

**User story:** As a laboratory operator, I want calibrated sensors so that dashboard measurements are accurate enough for decisions.

**Story points:** 8

### Acceptance Criteria

- [ ] Each device is compared with an agreed reference method.
- [ ] Accuracy is verified across the required operating range.
- [ ] Calibration values are recorded per device when needed.
- [ ] Devices outside tolerance are not deployed.
- [ ] Calibration date and result are traceable to device ID.

### Subtasks

- `[HW] Define calibration setup and tolerances`
- `[HW] Prepare reference equipment and environments`
- `[FW] Implement calibration coefficient support`
- `[QA] Execute multi-point calibration tests`
- `[DOCS] Record calibration results and dates`

## P01-10-S04 — Connect Devices and Publish MQTT Data

**User story:** As the monitoring system, I want devices to publish the agreed MQTT payload so that the backend can ingest measurements.

**Story points:** 8

### Acceptance Criteria

- [ ] Each device connects to the configured network and broker.
- [ ] Each device uses a unique stable identifier.
- [ ] MQTT topic and JSON payload match the server contract.
- [ ] Devices reconnect and resume after temporary failures.
- [ ] Credentials are not hard-coded in a public repository.

### Subtasks

- `[FW] Implement network connection and reconnection`
- `[FW] Implement MQTT connection and publishing`
- `[FW] Implement agreed topic and JSON payload contract`
- `[FW] Add unique device identity configuration`
- `[SEC] Implement safe device credential provisioning`
- `[QA] Test disconnect reconnect and publish recovery`

**Dependency:** P01-16 defines the MQTT ingestion contract.

## P01-10-S05 — Install and Identify Laboratory Sensors

**User story:** As a laboratory operator, I want devices installed and identified so that physical sensors correspond to dashboard locations.

**Story points:** 5

### Acceptance Criteria

- [ ] Every device has a visible identifier matching the registered device ID.
- [ ] Placement follows the approved coverage plan and avoids known bias.
- [ ] Power, enclosure, mounting, and cables meet safety requirements.
- [ ] Dashboard location and floor-plan coordinates are verified.
- [ ] Installation details and responsible person are recorded.

### Subtasks

- `[HW] Create physical placement and coverage plan`
- `[HW] Prepare labels enclosures and mounting`
- `[HW] Install sensors at approved locations`
- `[HW] Verify power network and environmental exposure`
- `[DOCS] Record device ID location and installation details`
- `[QA] Verify physical device to dashboard mapping`

## P01-10-S06 — Verify Device Reliability and Maintainability

**User story:** As the operations team, we want reliable and maintainable devices so that monitoring continues with minimal interruption.

**Story points:** 8

### Acceptance Criteria

- [ ] Devices operate continuously for the agreed soak-test period.
- [ ] Recovery from power and network loss is verified.
- [ ] Firmware update, replacement, and recalibration procedures are documented.
- [ ] Device health signals support offline or failure detection.
- [ ] Known failure modes and troubleshooting actions are documented.

### Subtasks

- `[QA] Run continuous device soak test`
- `[QA] Test power network broker and sensor failure recovery`
- `[FW] Add watchdog and device health telemetry`
- `[FW] Define safe firmware update procedure`
- `[HW] Define replacement and recalibration procedure`
- `[DOCS] Create hardware troubleshooting guide`

---

# Epic Ownership Summary

| Epic | Primary ownership | Stories | Total points | Key outputs |
| --- | --- | ---: | ---: | --- |
| P01-2 | Dashboard and analytics frontend | 6 | 31 | Live UI, charts, floor plan, sensor-management UI |
| P01-16 | MQTT, backend, database, APIs, networking | 6 | 44 | Raspberry Pi host, Docker MQTT broker, persistent data, APIs, service health |
| P01-25 | Authentication and authorization | 5 | 29 | Users, sessions, profiles, passwords, roles |
| P01-38 | Problem and technical research | 5 | 23 | Requirements, risks, findings, success measures |
| P01-39 | Alerts, incidents, and notifications | 6 | 42 | Rules, detection, lifecycle, delivery, history |
| P01-10 | Physical sensors and firmware | 6 | 39 | Hardware, calibration, MQTT devices, installation |
| **Project total** |  | **34** | **208** |  |

# Cross-Epic Dependency Flow

1. P01-38 validates user, environmental, and technical requirements.
2. P01-10 produces calibrated readings and publishes them through MQTT.
3. P01-16 ingests, stores, and exposes sensor data through APIs.
4. P01-39 evaluates readings and manages alerts, incidents, and notifications.
5. P01-25 supplies authenticated identity and permissions.
6. P01-2 consumes those services and presents monitoring and analytics.

# Shared Definition of Done

- [ ] All acceptance criteria pass.
- [ ] Required tests are implemented and passing.
- [ ] Error, empty, and boundary conditions are handled where applicable.
- [ ] Security and permission requirements are verified where applicable.
- [ ] Documentation and configuration are updated.
- [ ] No known critical or high-severity defect remains open.
- [ ] The work is reviewed and accepted by the appropriate owner.
