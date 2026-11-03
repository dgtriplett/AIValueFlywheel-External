# Security

## What the app can reach

- It runs as a **Databricks App** with its own service principal, inside your workspace.
- App state lives in **your** Lakebase project or **your** Unity Catalog schema. The
  service principal is granted DML on that storage only; schema changes are applied
  by the setup job running as the deployer.
- AI features call **your** Foundation Model serving endpoints. Prompts contain the
  catalog and the use-case text people enter; nothing is sent outside your workspace.
- The app makes **no calls outside your Databricks workspace** (no telemetry, no
  third-party APIs, no externally hosted fonts or scripts).
- Users are identified by the Databricks Apps forwarded identity. Only workspace
  users granted CAN_USE on the app can open it. Admins are set with the
  `admin_emails` bundle variable and in the app's Admin page.

## Reporting a vulnerability

Please report suspected vulnerabilities privately using GitHub's
"Report a vulnerability" (Security advisories) on this repository rather than a
public issue. This is a best-effort, unsupported project (see [SUPPORT.md](SUPPORT.md));
there is no guaranteed response time.

Do not include customer data, credentials, or tokens in reports.
