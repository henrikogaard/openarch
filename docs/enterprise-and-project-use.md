# Enterprise and project use — opportunity assessment

**Date:** 2026-11-17
**Question:** what else would make OpenArch genuinely useful in enterprises and in projects that
model infrastructure or architecture?

---

## 1. Executive summary

There are **two different buyers** behind that question, and they need different things:

- **Project / solution architecture** — a platform or solution architect modelling a real system:
  its infrastructure, integrations, environments, and decisions. They value *speed, fidelity to
  the real system, and developer workflow* (Git, CI, docs).
- **Enterprise architecture** — an EA team governing a portfolio: landscape, capabilities,
  lifecycle, standards, approvals. They value *scale, identity, governance, and connectors*.

OpenArch is already a strong **authoring tool** for the first group and a plausible **companion
tool** for the second (AOEF in/out of the governed repository). It is not yet a portfolio platform,
and it should not try to become one feature-for-feature.

**The wedge:** *the architecture model is a file in your repository, and an agent can operate it.*
Every idea below should strengthen that wedge rather than dilute it.

**Highest-value additions, in order:**

1. **Infrastructure import** (Terraform plan JSON, Kubernetes manifests, docker-compose) — turns a
   blank canvas into a real topology in minutes.
2. **Environment overlays** (dev/staging/prod) — model once, compare and filter.
3. **ADR log linked to elements** — cheap, and the single most requested project artefact.
4. **CI architecture check** — run the CLI in a pull request; makes architecture part of delivery.
5. **OIDC/SSO** — the gate that lets an enterprise actually deploy it.

---

## 2. Where OpenArch fits today

| Strength | Why it matters for these buyers |
|---|---|
| Full ArchiMate 3.2 editor with magic connector | Correct notation without a per-seat licence; usable by solution architects, not just EA |
| Local-first, file-based, Git-friendly | Works in a project repo; no procurement or server needed to start |
| AOEF export validated against the XSD | Can hand models to Archi, BiZZdesign, or a governed repository |
| MCP server + AI panel | Agents can draft or extend a model from a description or a repo scan |
| Analysis views, traceability, matrices | Enough to answer "what depends on this?" in a project review |
| Self-hosted server with RBAC, locking, audit | A team can share a workspace without a SaaS contract |

| Gap | Consequence |
|---|---|
| No infrastructure/IaC import | Infrastructure modelling starts from a blank page — the main reason architects stay in draw.io |
| No environment concept | Dev/staging/prod become duplicated models or ad-hoc name suffixes |
| No portfolio fields (lifecycle, cost, owner, criticality) | Cannot answer portfolio questions; EA teams keep using LeanIX/ServiceNow |
| No approval/governance workflow | Baselines exist, but no review-and-sign-off process |
| Static tokens / HS256 only, no OIDC | Enterprise identity integration is a blocker |
| No Confluence/Jira/ServiceNow connectors | Models live outside the tools stakeholders actually read |
| No ADR artefact | Decisions are not captured next to the architecture |

---

## 3. Project and infrastructure modelling

These ideas target the architect who has a real system to document this quarter.

| # | Idea | Value | Effort | Verdict |
|---|---|---|---|---|
| P1 | **IaC import** — Terraform plan JSON, Kubernetes YAML, docker-compose, CloudFormation | Very high | M | **Build** (extends the enrichment package) |
| P2 | **Environment overlays** — tag elements by environment; filter and diff | High | S–M | **Build** |
| P3 | **ADR log** linked to elements, exported to Markdown | High | S | **Build first** |
| P4 | **CI architecture check** — validate/diff in a PR, fail on rule violations | High | S | **Build** (CLI exists) |
| P5 | **Interface & integration catalogue** — protocol, sync/async, owner, SLA | High | M | **Build** |
| P6 | **C4 bridge** — import/export Structurizr DSL, map C4 levels to ArchiMate | High | M | **Build later** |
| P7 | **Deployment/runtime view** — artifact → node → device → network zone | Medium | M | **Build** |
| P8 | **Starter templates** — landing zone, three-tier app, event-driven, data platform | Medium | S | **Build** |
| P9 | **Cost/risk annotations** — cost centre, criticality, data classification | Medium | S | **Build** |
| P10 | **Diagram-as-code export** — D2, Mermaid, Structurizr | Medium | M | **Later** |

### P1 — Infrastructure import (the biggest lever)

A two-stage pipeline already exists in `packages/enrichment`: raw resource → proposal → ArchiMate
element. Extend it with real parsers:

| Source | Mapping |
|---|---|
| Terraform `plan -json` / `show -json` | `aws_instance` → Node · `aws_lambda_function` → SystemSoftware · `aws_db_instance` → Node + Artifact · `aws_s3_bucket` → Artifact · VPC/subnet → CommunicationNetwork / Grouping · security group → property on the node |
| Kubernetes manifests | Deployment/StatefulSet → Node + SystemSoftware · Service → TechnologyService · Ingress → TechnologyInterface · ConfigMap/Secret → Artifact · Namespace → Grouping |
| docker-compose | service → SystemSoftware · volume → Artifact · network → CommunicationNetwork |
| CloudFormation / ARM | same shape as Terraform |

Why it matters: architects already have the truth in IaC. Importing it produces a topology that is
*actually current*, and re-importing shows drift. This is the single feature most likely to move a
platform team from draw.io to OpenArch.

Design constraints: deterministic (no LLM), preview-before-apply, idempotent by resource address,
and every imported element carries a `source` property so re-import can update rather than duplicate.

### P2 — Environment overlays

Add an `environment` property (`dev`, `staging`, `prod`, or custom). Provide:

- a filter in the editor and analysis views,
- a side-by-side diff of two environments,
- a validation rule for elements missing an environment.

This avoids the common failure mode of three near-duplicate diagrams that drift apart.

### P3 — ADR log

An ADR is a short Markdown record: context, decision, consequences. Store them in the model (or as
`docs/adr/*.md` in the repo) and link them to elements and relationships.

- In-app list and editor, with status (`proposed`, `accepted`, `superseded`).
- Render into the model's Markdown context for AI agents.
- Export as a folder of `.md` files for the repo.

Cheap to build, high perceived value, and it differentiates against pure diagramming tools.

### P4 — CI architecture check

The CLI already validates, lists, converts, and diffs. Add:

```bash
openarch check --rules architecture-rules.yaml model.xml
openarch diff --fail-on breaking before.xml after.xml
```

Rules could cover: no production application without an owner, no direct access from a business
actor to a data object, every capability must be realized, no element without documentation.
Run it in GitHub Actions and post the result as a PR comment.

### P5 — Interface and integration catalogue

A first-class table derived from interfaces and flows: name, provider, consumer, protocol
(REST/gRPC/event/file), sync/async, data classification, owner, SLA. This is what integration-heavy
projects actually need to review, and ArchiMate already models the underlying elements.

### P6 — C4 bridge

Development teams think in C4; EA teams think in ArchiMate. A mapping makes OpenArch usable by both:

| C4 | ArchiMate |
|---|---|
| Person | BusinessActor |
| Software System | ApplicationComponent (or Grouping) |
| Container | ApplicationComponent / Node |
| Component | ApplicationComponent |
| Deployment node | Node / Device |
| Relationship | Serving / Flow / Realization |

Import Structurizr DSL, export it back, and generate Context/Container/Component/Deployment views.
This is a genuine differentiator: no open-source tool does both well.

### P7–P10 (brief)

- **Deployment view**: generate artifact → node → device → network-zone diagrams from properties.
- **Templates**: opinionated starting models; the fastest way to make the tool feel useful on day one.
- **Cost/risk annotations**: properties plus roll-up dashboards (cost by capability, criticality by app).
- **Diagram-as-code export**: D2 and Structurizr export for teams that keep diagrams in Git.

---

## 4. Enterprise adoption

These ideas target the EA team and the platform owner who has to approve a deployment.

| # | Idea | Value | Effort | Verdict |
|---|---|---|---|---|
| E1 | **OIDC/SSO** with group→role mapping | Critical | M | **Build** |
| E2 | **Governance workflow** — draft → review → approved baseline, sign-off | High | M–L | **Build** |
| E3 | **Portfolio fields & lifecycle** — owner, criticality, cost, dates, TIME | High | M | **Build** |
| E4 | **Reporting** — DOCX/PPTX/PDF, scheduled Confluence publish | High | M | **Build** |
| E5 | **Jira / Confluence connectors** | High | M | **Build** |
| E6 | **Standards packs** — TOGAF artefacts, NIST CSF, ISO 27001, DORA, GDPR | Medium–High | M | **Later** |
| E7 | **ServiceNow CMDB connector** | High | L | **Integrate, don't replace** |
| E8 | **SCIM provisioning** | Medium | M | **Later** |
| E9 | **SIEM/audit export** (webhook, syslog) | Medium | S | **Build** |

### E1 — OIDC/SSO

Replace static tokens with Authorization Code + PKCE for the web app and client credentials for
MCP. Map an IdP group claim to `owner`/`editor`/`viewer`. Support Entra ID, Okta, Keycloak, and
Google. Keep static tokens for local development.

This is the difference between "a demo a team can run" and "something security will approve".

### E2 — Governance workflow

Baselines and audit already exist. Add:

- draft vs approved state per workspace,
- a review request with reviewers and comments,
- approval records with actor and timestamp,
- a rule that approved baselines are immutable,
- a diff between the approved baseline and current work.

Keep it lightweight: this is a review gate, not a BPM engine.

### E3 — Portfolio fields and lifecycle

Add structured properties (or a small schema) for owner, business criticality, lifecycle dates,
cost, and vendor. Then generate:

- an application portfolio table with TIME (tolerate/invest/migrate/eliminate),
- a capability heatmap,
- an obsolescence report,
- a roadmap/plateau timeline using the Implementation & Migration elements already in the model.

This is where LeanIX and ServiceNow win today; a focused subset is enough for many mid-size
organisations.

### E4 — Reporting

Stakeholders do not open modelling tools. Generate:

- a DOCX/PPTX architecture description from a viewpoint,
- a PDF pack with diagrams and element tables,
- a Confluence page that updates on publish.

### E5–E9 (brief)

- **Jira**: link elements to epics/components; show delivery status on the canvas.
- **Confluence**: publish views and tables; keep a stable page per workspace.
- **Standards packs**: validation rules and requirement templates per framework.
- **ServiceNow CMDB**: read CIs to enrich, write back a link. Do **not** attempt to replace the CMDB.
- **SCIM**: automated user/group provisioning once OIDC is in place.
- **SIEM export**: stream the existing audit log to Splunk/Sentinel.

---

## 5. Deliberate non-goals

| Do not build | Why |
|---|---|
| A CMDB or ITSM system | ServiceNow owns this; integrate instead |
| A full TOGAF process engine | Heavy, low differentiation; provide artefacts and templates |
| Real-time multi-cursor editing (CRDT) | High complexity; async collaboration plus locking covers most teams |
| Cloud-provider icon sets as the core notation | Maintenance burden and lock-in; map to ArchiMate instead |
| A hosted SaaS as the primary product | Contradicts the local-first, no-lock-in positioning; keep it optional |
| Feature parity with Gartner-MQ suites | A small team cannot win that race; win the project-architect workflow |

---

## 6. Recommended sequence

| Phase | Scope | Why now |
|---|---|---|
| **A. Finish the foundation** (1–2 weeks) | Workspace landing page and purpose badges, ADR log, starter templates, `openarch check` in CI | Makes the product feel complete and immediately useful on a real project |
| **B. Infrastructure** (4–6 weeks) | Terraform/K8s/docker-compose import, environment overlays, interface catalogue, deployment view | The main reason architects do not adopt modelling tools |
| **C. Team & enterprise** (4–6 weeks) | OIDC/SSO, governance workflow, reporting (DOCX/PDF/Confluence) | Unblocks enterprise deployment |
| **D. Ecosystem** (ongoing) | C4 import/export, portfolio fields and TIME, Jira/Confluence, standards packs, CMDB read-only | Broadens reach without changing the core |

---

## 7. How to validate

| Signal | Target |
|---|---|
| Time to first useful diagram | < 10 minutes, ideally from an IaC import |
| Models seeded from IaC | > 30% of new workspaces |
| CI check adoption | > 20% of active repos run `openarch check` |
| Weekly active workspaces | Growth after each phase |
| AOEF exports per workspace | Indicates models leave the tool into governed repositories |
| Review cycle time | Shorter after governance workflow ships |
| Enterprise deployments with OIDC | At least 3 design partners |

Talk to five solution architects and two EA leads before Phase B. Ask them to bring a real
Terraform plan or a real integration diagram and watch where they get stuck. That is worth more
than any feature list.

---

## 8. Sources

- Gartner Magic Quadrant for Enterprise Architecture Tools, 2026 (SAP LeanIX positioning)
- LeanIX EA tool selection guide — portfolio, integrations, governance expectations
- ServiceNow Enterprise Architecture — CMDB-connected architecture
- C4 model — https://c4model.com/
- Strata — IaC import/export and typed infrastructure graphs
- ArchFlow / Structurizr — C4 as a versioned model
- OpenArch internal: `docs/comparison-and-usefulness.md`, `docs/code-review.md`

*ArchiMate® is a registered trademark of The Open Group. OpenArch is not affiliated with,
endorsed by, or certified by The Open Group.*
