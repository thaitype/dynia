# High-level verdict

* **Big win**: v2 fixes a lot of operational pain from v1 by introducing a single local source of truth, template→render→sync discipline, rolling updates, drift detection, and provider interfaces. These are the right foundations.
* **Main gaps**: lifecycle sequencing (exactly when infra is rendered vs applied), DNS coupling to deploy (good idea but needs edge cases covered), certificate workflow under the “DNS only on first deploy” rule, and operational safety rails (preflight checks, rollback, and SLOs) are underspecified.
* **Risk**: “full mirror” keeps HA simple but can explode resource usage on tiny nodes; v2 should explicitly guard against this at render/sync time and offer a minimal placement knob (even if you don’t expose full scheduling).

---

# What v2 improves over v1 (keep it!)

1. **Single Source of Truth (local state + deploy-config)**
   v1 had config sprawl per node; v2’s local-first model with hashes and drift detection is a huge simplifier. Keep this as the **only** path to mutation.

2. **Deterministic lifecycle**
   Template → render → sync (rolling) eliminates “snowflake nodes.” This is the right mental model for small HA.

3. **Provider abstraction (NodeProvider/DnsProvider/SshProvider)**
   v2 decouples orchestration logic from providers—excellent for testing and future portability.

4. **CLI context (`currentCluster`)**
   Cuts UX friction vs v1’s constant `--name`. Good default; still allow override flags.

5. **DNS mapping only on first deploy**
   This avoids early DNS pointing to an “empty” origin (a common v1 footgun). Right call.

---

# Where v2 regresses or is underspecified (and how to fix)

## 1) **Create vs Prepare sequencing**

* **Issue**: v2 says “cluster create → render infra → sync infra,” but the steps/guards are fuzzy (what must exist in state before render? when is Reserved IP attached? what if a node is unreachable during first sync?).
* **Fix**:

  * Make **`cluster create`** do *only* provider provisioning + state write + allocate Reserved IP (no SSH yet).
  * Add **`infra render`** (produces deploy-config for HAProxy/Caddy/keepalived only).
  * Add **`infra sync`** (rolling; attaches RIP to MASTER only after all nodes healthy).
  * Alternatively: keep `dynia create` but internally phase: `provision → render → sync → attach RIP → verify`; print phase gates and stop at first unsafe failure with resume tokens.

## 2) **Certificates under “DNS at first deploy”**

* **Issue**: v1 provisions CF Origin certs early. In v2, DNS happens later; cert flow needs to match:

  * If Cloudflare is proxying, HAProxy needs a valid origin cert chain *without* a public FQDN yet.
* **Fix**:

  * Keep **Cloudflare Origin Certificates** (wildcard or per-host) provisionable **before DNS**.
  * Document two modes:

    * **Origin-only**: Use CF Origin certs always (default).
    * **LE mode**: Only if user opts out of CF proxy.
  * Block deploy if certs cannot be loaded; provide `cert provision` preflight with dry-run.

## 3) **Health-gated rolling sync + rollback**

* **Issue**: v2 describes rolling update, but not rollback behavior if a node fails post-restart.
* **Fix**:

  * After pushing to a node: **health gate** with backoff (n tries, m seconds).
  * If gate fails, **auto-rollback** that node’s changed files (restore previous config from a timestamped backup dir), mark node `degraded`, and **stop the roll**.
  * Provide `--continue-on-error` for power users.

## 4) **Full mirror resource guardrails**

* **Issue**: tiny VMs (1 vCPU/1GB) can’t run many mirrored services; v2 needs built-in sanity checks.
* **Fix**:

  * During **render**, compute a **node resource plan** (sum of service limits + infra budgets).
  * Warn or hard-fail if predicted usage exceeds a threshold (e.g., >80% RAM).
  * Offer a minimalist **placement hint** per service: `"placement": "all" | "active-only" | "standby-only"`—still “mirror” by default, but gives an escape hatch without full scheduler.

## 5) **Routing and pathing drift**

* **Issue**: In full mirror, Caddy routes must be identical on all nodes. v2 has drift detection, but what about live “hotfix” drift (manual edits)?
* **Fix**:

  * Enforce **read-only** permissions on managed paths.
  * `drift-check` should include **file mode/owner** and **service versions** (images digests) in addition to contents.
  * Add **`--lockdown`** toggle that sets immutable attributes (chattr +i where safe) on critical configs; `infra sync` temporarily lifts lock.

## 6) **Observability parity**

* **Issue**: v1 docs detail HAProxy stats, keepalived logs, etc. v2 must keep parity and add one consolidated view.
* **Fix**:

  * Add `dynia status` to summarize:

    * Cluster HA state (MASTER, BACKUP priorities, RIP holder)
    * HAProxy backend up/down per node
    * Caddy health endpoint
    * Per-service health (HTTP codes over the last N seconds)
  * Optional: ship a small **/opt/dynia/metrics** collector and expose a single `dynia-metrics` endpoint.

## 7) **Error taxonomy & user messaging**

* **Issue**: v2 specs list many commands but not a consistent error model.
* **Fix**:

  * Normalize errors by **provider**, **network**, **state**, **render**, **sync**, **health**, **dns**.
  * CLI prints a short actionable hint + a `--debug` path to the full trace + “resume with: …”.

## 8) **State mutation discipline**

* **Issue**: v2 says “state first, then render, then sync,” which is good—but ensure *every* command follows it.
* **Fix**:

  * All commands mutate state via a single **StateService** (atomic writes, schema versioning, migrations).
  * For safety, include **`state snapshot`** before any destructive op and store last 5 snapshots for quick local revert.

## 9) **Provider boundary tests and fallbacks**

* **Issue**: v2 adds interfaces but not fallback/compat notes (e.g., SSH file copy failures).
* **Fix**:

  * SshProvider must support **dry-run**, **checksum mode**, and **parallelism caps**,
  * For NodeProvider, specify **rate limits** and **retry policies** (exponential backoff, idempotent create with dedupe keys).

---

# Smaller but sharp critiques

* **Command taxonomy**: Consider grouping related ops:

  * `infra render` / `infra sync` / `infra verify`
  * `service deploy` / `service update` / `service remove`
  * `route bind` / `route unbind` / `route plan`
* **Config versioning**: Add a **config version** tag into `cluster-metadata.json` and stamp each node with the last applied version. `status` can show “Node B at v42; desired v44”.
* **Hash coverage**: Ensure hashes include **normalized whitespace**, **line endings**, and **permissions** so you don’t miss sneaky drift.
* **Security**: v2 keeps HSTS, XFO, etc.—good. Add default **rate-limit** ACLs per route template with conservative defaults; expose per-route overrides later.
* **Docs**: v2 should explicitly call out “**no manual edits on nodes**” and show how to recover if someone does (drift→repair flow).

---

# Concrete “change/keep/add” table

| Area                 | Keep                     | Change                          | Add                                                |
| -------------------- | ------------------------ | ------------------------------- | -------------------------------------------------- |
| Local state & render | ✅ Single source of truth | –                               | `state snapshot` before destructive ops            |
| Rolling sync         | ✅ Health-gated           | Define rollback on node failure | Show per-node plan & impact summary                |
| Provider abstraction | ✅ DO + CF first          | –                               | Retry/backoff policy, dry-run modes                |
| DNS timing           | ✅ Bind only on deploy    | Document cert interplay         | `route plan` + apex/ALIAS guard                    |
| Certs                | ✅ CF Origin default      | Decouple from DNS timing        | `cert provision --domain *.base` pre-deploy        |
| Full mirror          | ✅ Default mode           | –                               | Resource planner + “active-only/standby-only” hint |
| Observability        | ✅ HAProxy stats          | –                               | `dynia status` unified view + minimal metrics      |
| CLI context          | ✅ `currentCluster`       | –                               | `context doctor` (validates state vs providers)    |
| Drift                | ✅ Hash compare           | Include perms/owner/mode        | Optional “lockdown” immutable files                |

---

# Minimal test plan (what to automate early)

1. **Create → infra render → infra sync** with one node unreachable → expect partial success, clear error, and resumption works.
2. **Drift injection** (edit Caddyfile on one node) → `drift-check` detects → `sync` heals → hashes match.
3. **Rolling failure** (break service health on node #2) → `sync` rolls node #1 ok, fails node #2, rolls back node #2, stops.
4. **First deploy w/ DNS** → DNS created → cert loaded → `/health` 200.
5. **Failover** (stop keepalived on MASTER) → RIP moves → `status` shows new MASTER; traffic OK.
6. **Resource guard** (compose with big memory) → render warns/fails based on threshold.
7. **State snapshot & revert** → deliberate bad config → revert snapshot → render/sync OK.

---

# Suggested CLI refinements (small, high impact)

```bash
# Infra phases made explicit (you can still keep create-all-in-one)
dynia infra render
dynia infra sync --rolling
dynia infra verify

# Safer deploys with a diff
dynia deploy --name api --compose ./api.yml --domain api.example.com --plan
dynia route plan
dynia route bind --apply

# Health-first status
dynia status        # one-line per node + per service
dynia status --json # machine readable
```

---

## Bottom line

v2 is a strong step forward: simpler operations, clear ownership of config, provider decoupling, and safer deploys. To make it “production calm” without losing simplicity, tighten the **infra lifecycle**, **rollback rules**, **cert/DNS interplay**, and **resource guardrails**—and give operators a **single truthful status view**. That’ll preserve the small-cluster feel while avoiding the classic HA potholes v1 teams hit in practice.
