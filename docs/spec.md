# **Dynia v0 – Design Specification (Revised)**

## 1) Introduction

Dynia is a lightweight, CLI-driven orchestrator for small clusters: it provisions nodes, runs a per-node HTTPS proxy (**Caddy**), deploys user apps behind it, tracks minimal state in a **local JSON**, and syncs healthy node origins into a Cloudflare Workers–based SLB.
This revision makes the **health check path configurable per node** at creation time, **defaulting to `/`**.

---

## 2) Goals & Scope (v0)

* Provision nodes with Caddy + placeholder on a shared Docker network.
* Deploy user docker-compose apps and swap routing safely.
* Track node/deploy state in local JSON (no external DB).
* Sync healthy node FQDNs to SLB.
  **New:** Health path is **per node**, set during `node:create`, default `/`.

Out of scope: UI, multi-pool routing, advanced rollout strategies.

---

## 3) Actions

### A) `node:create`

* Creates a DigitalOcean droplet.
* Creates/updates a Cloudflare **DNS A** record `<node>.example.com → IP`; **waits for propagation**.
* Brings up:

  * Docker network `edge`
  * **Caddy** (compose A)
  * **Placeholder** backend (compose B)
* Writes/updates local JSON state.
* **Health path setting**: `--health-path` optional; default `/`. Stored per node and used by later checks (deploy & SLB).

### B) `app:deploy`

* Uploads & starts user compose on the node (joining `edge`).
* Infers **entry service/port/domain** from compose (conventions/labels).
* Runs **internal health** against `http://<service>:<port><node.healthPath>` (default `/`).
* Rewrites Caddyfile to route `<domain>` → `http://<service>:<port>`, reloads Caddy.
* Runs **external health** against `https://<domain><node.healthPath>` (default `/`).
* Updates local JSON state; rolls back to placeholder on failure.

### C) `slb:sync`

* Builds origins as `https://<node.fqdn>`.
* Optional health-gated filtering by probing `https://<node.fqdn><node.healthPath>` through Caddy.
* Publishes `ORIGINS` to the Cloudflare Worker and deploys.

---

## 4) Local State (JSON)

Stored at `.dynia/state.json`. Key fields (per project):

```json
{
  "nodes": [
    {
      "name": "web-1",
      "ip": "203.0.113.10",
      "fqdn": "web-1.example.com",
      "createdAt": "2025-08-11T10:00:00Z",
      "status": "active",
      "healthPath": "/",                 // <— NEW: per-node health path
      "caddy": {
        "domain": "web-1.example.com",
        "target": { "service": "placeholder", "port": 8080 }
      }
    }
  ],
  "deployments": [
    {
      "node": "web-1",
      "composeHash": "sha256:abcd1234",
      "entryService": "web",
      "entryPort": 8080,
      "domain": "web-1.example.com",
      "status": "active",
      "updatedAt": "2025-08-11T11:00:00Z"
    }
  ]
}
```

**Purpose:** idempotency, audit, quick rollback hints, and health-path source of truth.

---

## 5) Caddy as HTTPS Proxy

* Runs in its own compose, attached to `edge`.
* Automatic HTTPS (ACME HTTP-01). Keep CF DNS **DNS-only** until cert issuance completes; flip to proxied later if desired.
* Caddyfile is **managed by Dynia**:

  * One server block per bound domain.
  * `reverse_proxy http://<service>:<port>`.
  * **Health path is not hardcoded** in Caddy; Dynia uses it for validation probes.
    (Optionally you may add a `handle_path <healthPath> { respond 200 }` for placeholder convenience.)

---

## 6) DNS Creation & Propagation Handling

* After droplet activation, create/update CF DNS A record (`TTL 60–300s`, **proxied=false** for ACME).
* **Propagation wait:** poll public resolvers (1.1.1.1, 8.8.8.8) until both resolve to the node IP or a timeout (e.g., 120s).
* Start Caddy + placeholder once propagated; Caddy auto-issues certs.

---

## 7) Deployment Flow (`app:deploy`)

1. **Preflight:** SSH, ensure `edge` network; `docker compose config` pass.
2. **Start app:** upload compose → `pull && up -d`.
3. **Internal health:** poll `http://<service>:<port><node.healthPath>` (default `/`) until 2xx/3xx or timeout.
4. **Swap routing:** update Caddyfile domain → app; `caddy reload`.
5. **External health:** probe `https://<domain><node.healthPath>` (default `/`).
6. **Finalize:** update state; on failure, rebind to **placeholder** and log.

**Compose inference rules (unchanged):**

* Entry service: `web` or label `dynia.entry=true`.
* Entry port: first exposed port or label `dynia.port=8080`.
* Domain: node FQDN by default or label `dynia.domain=...`.
* Ensure all services join `edge` (apply override at deploy time if missing).

---

## 8) SLB Synchronization

* Build `https://<node.fqdn>` list from state.
* Optional health filtering via `https://<fqdn><node.healthPath>` through Caddy.
* Update Worker env (`ORIGINS`) and deploy.

---

## 9) Operational Workflow

1. **Create Node**

   ```
   dynia node:create --name web-1 [--health-path /]
   ```

   → DO droplet, CF DNS A, **propagation wait**, Caddy + placeholder running, state saved.

2. **Deploy App**

   ```
   dynia app:deploy --node web-1 --compose ./app.yml
   ```

   → App starts on `edge`, **internal health** on `<healthPath>` OK, Caddy swap, **external health** OK, state updated.

3. **Sync SLB**

   ```
   dynia slb:sync
   ```

   → SLB `ORIGINS` reflects healthy nodes.

---

## 10) Guardrails

* **DNS-first**: don’t attempt TLS until DNS propagates.
* **Health path per node**: defaults to `/`; use `--health-path` at `node:create` to override when your app exposes a different probe path. Dynia consistently uses this value for both internal and external checks.
* **Caddy reload tolerance**: brief reload blips accepted in v0.
* **Local JSON**: can be rebuilt if lost by rediscovering nodes/DNS and re-probing health.

---

