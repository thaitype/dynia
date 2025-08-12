# Dynia CLI – Single-Node by Default, Elastic HA via Add/Remove

Start small with **one node per cluster** (lowest cost/ops).
Scale to HA by **adding nodes on demand**. Each node gets a human-readable **two-word ID** (e.g., `misty-owl`) similar to Docker container names.

* **Default**: `create-ha` provisions **1 node** + **Reserved IP** (already attached to the node).
* **Grow**: `node add` to join more nodes into the cluster.
* **Shrink**: `node remove` to safely drain and detach a node.

The architecture remains HAProxy + keepalived + Reserved IP; with 1 node, keepalived is idle (no failover) but the node structure is identical—so promoting to multi-node later is seamless.

---

## ✨ Capabilities

* **Single-node baseline**: one command, production-ready ingress (HAProxy/Caddy), HTTPS, health checks.
* **Elastic HA**: add/remove nodes without recreating the cluster.
* **Predictable public endpoint**: one **Reserved IP** (and optional DNS A record) that never changes.
* **Two-word node IDs**: user-friendly names like `silver-otter`, used in logs, hostnames, labels, and commands.
* **Uniform app deploy**: identical Docker stack per node (stateless or externalized state).

---

## 🔤 Two-Word Node Identifier

* Format: `<adjective>-<animal>` (lowercase, hyphenated), e.g., `misty-owl`, `brave-panda`.
* Deterministic per node at creation (stored in cluster state).
* Displayed in `dynia node list`, used as the **node handle** in CLI commands.

> Example hostnames: `myapp-misty-owl`, `myapp-brave-panda`.

---

## 🚀 CLI (Revised)

### Create Cluster (default 1 node)

```bash
pnpm dynia node create-ha \
  --name myapp \
  --region sgp1 \
  --size s-1vcpu-1gb
# => creates 1 node (e.g., myapp-misty-owl) + Reserved IP attached to it
```

### Add Node(s)

```bash
# Add 1 node
pnpm dynia node add --name myapp

# Add 2 nodes at once
pnpm dynia node add --name myapp --count 2
```

What happens:

* New droplet(s) join cluster VPC.
* Docker, HAProxy, keepalived installed.
* HAProxy backends auto-expand to include all nodes.
* keepalived priorities assigned (existing active keeps highest priority by default).

### Remove Node

```bash
# Remove a specific node by two-word ID
pnpm dynia node remove --name myapp --node brave-panda --confirm
```

Process:

* Drain traffic from the node (mark backend `DRAIN` in HAProxy).
* If node is **active**, reassign Reserved IP to next priority node first.
* Update keepalived/HAProxy cluster configs → destroy droplet.

### List Nodes

```bash
pnpm dynia node list --name myapp
```

Sample:

| Node ID     | Role    | Priority | Public IP  | Private IP | Status |
| ----------- | ------- | -------- | ---------- | ---------- | ------ |
| misty-owl   | active  | 150      | 203.x.x.10 | 10.10.0.11 | up     |
| brave-panda | standby | 140      | 203.x.x.11 | 10.10.0.12 | up     |

### Make Node Active (Optional)

```bash
# Gracefully promote a standby to active
pnpm dynia node make-active --name myapp --node brave-panda
```

* Adjust keepalived priority (or trigger reassign) → Reserved IP moves → new node becomes active.

### Repair (as before)

```bash
pnpm dynia node repair-ha --name myapp --check-only
pnpm dynia node repair-ha --name myapp --force
```

---

## 🏗️ Infrastructure (unchanged core, elastic edges)

**Per node**

* HAProxy (:80/:443) + app containers (:8080 default).
* keepalived (priority set; with 1 node it’s effectively MASTER-alone).
* Primary Public IP (SSH/ops) + Private IP (east-west traffic).

**Reserved IP**

* Always attached to **exactly one** node (the “active node”).
* Free while attached; never changes across add/remove operations.
* Optional Cloudflare DNS A record points to this RIP.

**Add Node**

* Install stack, join VPC, inject into HAProxy backends everywhere.
* keepalived priorities: highest remains active unless `make-active` is called (preemption configurable).

**Remove Node**

* Drain → update configs → destroy → shrink backends and keepalived peers.

---

## 🔒 Security / Networking

* Cloud Firewall:

  * Allow 22/tcp from your admin IPs to all nodes.
  * Allow 80/443/tcp to all nodes **or** restrict to the current active node’s Public IP (if not terminating TLS on every node).
  * Allow VPC CIDR for app ports (e.g., 8080) and health checks.
* TLS:

  * Terminate at HAProxy (Let’s Encrypt via HAProxy or Caddy sidecar).
  * Or pass-through to app if you prefer app-side TLS.

---

## 🧠 Health & Failover

* HAProxy health checks `/healthz` on every node; unhealthy backends are excluded from routing.
* keepalived monitors node/HAProxy health:

  * Single node: MASTER only (no failover).
  * Multi-node: next highest priority becomes MASTER and reassigns Reserved IP via DO API.

---

## 💰 Cost Model

* **1 node**: \~\$4/mo (s-1vcpu-1gb) + \$0 Reserved IP (attached) → **cheapest baseline**.
* **Add node(s)**: linear compute cost per node.
* VPC traffic: free; public egress billed after monthly quota.

---

## 🗺️ Diagrams (Mermaid)

### A) Default: Single-Node Cluster

```mermaid
flowchart LR
  Internet((Internet)) --> RIP[Reserved IP (Floating)]
  subgraph VPC["DO VPC (Private Network)"]
    subgraph N1["myapp-misty-owl (MASTER)"]
      HA1[HAProxy]
      APP1[App Container]
    end
  end
  RIP --> HA1

  Internet -. SSH .-> PUB1[(Public IP of misty-owl)]
  PUB1 --- N1
```

### B) After `node add` (Two Nodes)

```mermaid
flowchart LR
  Internet((Internet)) --> RIP[Reserved IP (Floating)]

  subgraph VPC["DO VPC (Private Network)"]
    subgraph N1["myapp-misty-owl (MASTER, P150)"]
      HA1[HAProxy]
      APP1[App Container]
    end
    subgraph N2["myapp-brave-panda (BACKUP, P140)"]
      HA2[HAProxy]
      APP2[App Container]
    end
  end

  RIP --> HA1
  RIP -. failover .-> HA2

  HA1 --> APP1
  HA1 -->|VPC| APP2
  HA2 -->|VPC| APP1
  HA2 --> APP2

  Internet -. SSH .-> PUB1[(misty-owl Public IP)]
  Internet -. SSH .-> PUB2[(brave-panda Public IP)]
  PUB1 --- N1
  PUB2 --- N2
```

---

## 🧩 Implementation Notes (for Dynia)

* **State file / cluster registry** stores:

  * Cluster name, Reserved IP, region, size, DNS record.
  * Node table: `{ id: "misty-owl", dropletId, publicIp, privateIp, priority, role }`.
* **Name generator**: two-word nouns/adjectives (ensure collision-free per cluster).
* **Templates**:

  * HAProxy: backend list rendered from node table (local + peers).
  * keepalived: per-node priority; `notify` script uses `doctl reserved-ip-action assign <RIP> <DROPLET_ID>`.
* **Idempotency**:

  * `create-ha` reuses existing RIP/records if found.
  * `node add/remove` reconcile desired vs. actual.

---

Note: this design is not support stateful apps directly. For stateful workloads, consider externalizing state (e.g., using a managed database or object storage).