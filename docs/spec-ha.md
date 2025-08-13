# Dynia CLI – Single-Node by Default, Elastic HA via Add/Remove

**with Reserved IP + Host-Based Routing (Caddy/HAProxy)**

Start small with **one node per cluster** (lowest cost/ops).
Scale to HA by **adding nodes on demand**. Public traffic always enters via **one Reserved IP**; host-based routing sends requests to the right app by hostname (e.g., `web.mydomain.com`, `api.mydomain.com`).

* **Default**: `create-ha` provisions **1 node** + **Reserved IP** (attached to that node)
* **Grow**: `cluster node add` to join nodes; **exactly one active** node holds the Reserved IP
* **Ingress**: Caddy (default) or HAProxy for host-based routing + HTTPS

---

## ✨ Capabilities

* **Single-node baseline** with automatic HTTPS and health checks
* **Elastic HA**: add/remove nodes without DNS changes
* **One Stable IP**: a single **Reserved IP** fronts the cluster
* **Host-based routing**: map many hostnames to services behind the same IP
* **Two-word node IDs** (`misty-owl`) for human-friendly ops
* **Uniform app deploy** via `docker compose` bundles

---

## 🔤 Two-Word Node Identifier

* Format: `<adjective>-<animal>` (e.g., `misty-owl`, `brave-panda`)
* Stored in cluster state; used in commands, hostnames, logs
* Example VM hostname: `myapp-misty-owl`

---

## 🚀 CLI (Revised)

### Create Cluster (default 1 node)

```bash
dynia cluster create-ha \
  --name myapp \
  --region sgp1 \
  --size s-1vcpu-1gb
# => creates 1 node (e.g., myapp-misty-owl) + assigns a Reserved IP
```

### Add/Remove/List Nodes

```bash
# Add one node (generate two-word ID)
dynia cluster node add --name myapp

# Add multiple
dynia cluster node add --name myapp --count 2

# Remove a node by ID
dynia cluster node remove --name myapp --node brave-panda --confirm

# List nodes
dynia cluster node list --name myapp
```

### Make a node active (move Reserved IP)

```bash
dynia cluster node activate --name myapp --node misty-owl
```

* Adjusts keepalived priority or directly reassigns RIP via DO API
* Ensures target node is healthy before switching (or fails fast with guidance)

### Deploy an App (host-based routing + Cloudflare DNS)

```bash
# Deploy from docker compose, bind hostname, and configure DNS at Cloudflare
dynia cluster deploy \
  --name myapp \
  --compose ./app.yml \
  --domain api.mydomain.com
```

* Provisions/updates:

  * **Ingress route** for `api.mydomain.com` (Caddy default; HAProxy supported)
  * **Cloudflare DNS A record** → Reserved IP
  * **Auto-HTTPS** (Let’s Encrypt via Caddy; HAProxy ACME optional)
* Validates public reachability (DNS → TLS → 200 OK on `/healthz` or configured path)

### Deploy a Placeholder (for testing smoke paths)

```bash
dynia cluster deploy --name myapp --placeholder
```

* Creates a temp site with hostname:

  * `dynia-placeholder.myapp.<domain>`
* Sets DNS → Reserved IP, boots a minimal responder (e.g., whoami/static) with HTTPS
* Useful for end-to-end validation before real app cut-over

> **Domain source**: Cluster has a configured **base domain** (e.g., `example.com`).
> `--domain` must be a **FQDN** (e.g., `api.example.com`).
> `--placeholder` ignores `--domain` and uses `dynia-placeholder.myapp.<base-domain>`.

### Repairs

```bash
dynia cluster repair-ha --name myapp --check-only
dynia cluster repair-ha --name myapp --force
```

---

## 🏗️ Infrastructure

**Per node**

* **Caddy (default)** or **HAProxy** at `:80/:443`
* **Docker** for app workloads
* **keepalived** with priority (single node = MASTER-alone)
* **Primary Public IP** (SSH) + **Private IP** (VPC east-west)

**Reserved IP**

* Always attached to the **active node**
* Free while attached; never changes across scale/repairs
* Cloudflare DNS A records for each hostname → this Reserved IP

**Routing (Method 1)**

* Host header decides backend:

  * `web.mydomain.com` → Web service
  * `api.mydomain.com` → API service
* Active node’s ingress can reach:

  * **Local** service (127.0.0.1)
  * **Peer** services over **VPC** (10.x.x.x)

---

## 🧩 `dynia cluster deploy` Behavior

* **Inputs**:

  * `--compose`: path to a Docker Compose file
  * `--domain`: FQDN to bind (required unless `--placeholder`)
  * `--health-path` (optional): default `/healthz`
  * `--proxied` (optional): set Cloudflare record proxied/on (default: on)
* **Assumptions**:

  * The compose file exposes a **stable port** (e.g., 8080) and a **health endpoint**
  * Stateless or externalized state is recommended
* **Effects**:

  1. Upload/render compose to all nodes; start/update service
  2. Configure **Caddy** route:

     * `host == <domain>` → reverse proxy to service (`localhost:PORT` or service name on Docker network)
     * Automatic **Let’s Encrypt** cert per host
  3. Create/Update **Cloudflare DNS A** record → Reserved IP
  4. Validate: DNS resolution, TLS issuance, health path 200
* **Idempotency**:

  * Repeated deploy updates in place
  * Conflicting hostnames are detected and require `--force` or a different FQDN

**Placeholder mode (`--placeholder`)**

* Deploys a minimal app + route at

  * `dynia-placeholder-myapp.<base-domain>`
* Useful for testing **RIP + DNS + TLS** end-to-end without touching real domains

---

## 🔒 Security / Networking

* Cloud Firewall:

  * Allow `22/tcp` from admin IPs
  * Allow `80/443/tcp` to nodes (or just the active node if you prefer)
  * Allow VPC CIDR for app/health ports
* TLS:

  * **Caddy default** (zero-config ACME).
  * HAProxy ACME supported via companion/ACME backend if selected.
* Secrets:

  * DO token, CF token stored securely; least-privilege scopes (CF Zone\:Edit)

---

## 🧠 Health & Failover

* Ingress health-checks services via `/healthz` (configurable)
* **keepalived** monitors node/ingress:

  * Single node: no failover (MASTER only)
  * Multi-node: next highest priority becomes MASTER; **RIP reassigns automatically**

---

## 💰 Cost Model (rule-of-thumb)

* **1 node**: ≈ **\$4/mo** (s-1vcpu-1gb) + **\$0** RIP (attached)
* **Add nodes**: linear per node
* VPC traffic: free; public egress billed post-quota

---

## 🗺️ Mermaid (Host-based Routing; default 1 → 2 nodes)

```mermaid
flowchart LR
  Internet((Internet)) --> RIP[Reserved IP (Floating)]

  subgraph VPC["DO VPC (Private Network)"]
    subgraph N1["myapp-misty-owl (MASTER)"]
      C1[Caddy/HAProxy]
      W1[Web Service]
      A1[API Service]
    end
    subgraph N2["myapp-brave-panda (BACKUP)"]
      C2[Caddy/HAProxy]
      W2[Web Service]
      A2[API Service]
    end
  end

  RIP --> C1
  RIP -. failover .-> C2

  %% Host-based routing on the active node
  C1 -->|web.mydomain.com| W1
  C1 -->|api.mydomain.com| A1
  C1 -->|VPC (fallback)| W2
  C1 -->|VPC (fallback)| A2

  Internet -. SSH .-> PUB1[(Public IP N1)]
  Internet -. SSH .-> PUB2[(Public IP N2)]
  PUB1 --- N1
  PUB2 --- N2
```

---

## 🧭 Implementation Notes (Dynia internals)

* **Cluster state**:

  * `{ name, baseDomain, reservedIp, region, size, dnsProvider }`
  * `nodes[]`: `{ id(twoWord), dropletId, publicIp, privateIp, priority, role }`
  * `routes[]`: `{ host, serviceRef, port, healthPath, proxied }`
* **Name generator**: two-word unique per cluster
* **Templates**:

  * **Caddy**: one server block per host; upstream → service/port
  * **HAProxy** (optional mode): `acl host_api hdr(host) -i api.domain` → `use_backend be_api`
* **Ops safeguards**:

  * `activate`: pre-check target health, then reassign RIP
  * `deploy`: verify port/health; rollback on failure; `--force` to override conflicts
  * `placeholder`: always safe; uses isolated route/host

---

Note: this design is not support stateful apps directly. For stateful workloads, consider externalizing state (e.g., using a managed database or object storage).


