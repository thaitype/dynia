
# **Dynia v2 – Full Design Spec**

## **1. Overview**

Dynia v2 is a **multi-node, high-availability container orchestration system** for small clusters, designed to be simpler than Kubernetes while retaining controlled infrastructure and deployment flow.

Key changes from v1:

* **Cluster context** — CLI uses `currentCluster` from local state by default
* **Providers** — abstract Node & DNS providers via interfaces
* **No direct DNS→node mapping** — DNS binding happens only when deploying a service with a domain
* **Config rendering from local state** → Sync across nodes with drift detection
* **Full mirror replica mode** — all nodes run the same service set

---

## **2. Core Principles**

1. **Immutable Infrastructure Layer** — Nodes run identical HA configs, generated from templates.
2. **Single Source of Truth** — Local state holds the canonical cluster definition; nodes never become the source of truth.
3. **Provider Abstraction** — Infrastructure and DNS operations are provider-agnostic.
4. **Command-Driven Architecture** — CLI commands pass through service layer, never touching low-level details directly.
5. **Full-Mirror Replication** — Every node runs the same deployments for simple HA.

---

## **3. Structure & Design Rules**

Use clean code principles to separate concerns, write testable code, keep test only logic without side effects (avoid using mocks)

```
/commands     # Each CLI command (parse args → call service)
/services     # Core orchestration logic, state mgmt, config render, sync
/providers    # Provider interfaces + implementations (Node, DNS, SSH, etc.)
/interfaces   # CLI entrypoints, shared DTOs
/state        # Local state management
/templates    # Config templates for render
```

---

### **2. Key Concepts**

* **Command** → Parses CLI input, validates, passes to Service.
* **Service** → Core orchestration logic, uses Providers, updates state, renders config.
* **Provider** → Abstraction for infrastructure operations (DigitalOcean, Cloudflare, SSH, Local FS, etc.).
* **State** → JSON store of clusters, nodes, deployments, routes.
* **Template Rendering** → From `/templates` + `state` → `deploy-config/`. template use handlebars for dynamic values, e.g. node IPs, service names. (Also support list or object iteration in templates for dynamic configs.)

Note: also use state version, and use zod schema for validation for state and deploy-config metadata.

---

## **4. Providers**

### **4.1 NodeProvider**

```ts
interface NodeProvider {
  createNode(cluster: Cluster, spec: NodeSpec): Promise<NodeMetadata>;
  deleteNode(nodeId: string): Promise<void>;
  attachReservedIp(nodeId: string): Promise<void>;
  detachReservedIp(nodeId: string): Promise<void>;
}
```

* **Current Implementation**: DigitalOcean Droplet

### **4.2 DnsProvider**

```ts
interface DnsProvider {
  createRecord(domain: string, type: 'A' | 'CNAME', value: string): Promise<void>;
  deleteRecord(domain: string): Promise<void>;
}
```

* **Current Implementation**: Cloudflare API

---

## **5. Local State**

Stored in `state.json`:

```json
{
  "currentCluster": "testdynia5",
  "clusters": [...],
  "nodes": [...],
  "deployments": [...],
  "routes": [...]
}
```

* **currentCluster**: active cluster for CLI commands
* **clusters**: cluster metadata (provider info, reserved IP, etc.)
* **nodes**: per-node metadata (role, priority, IPs)
* **deployments**: deployed services
* **routes**: domain → service mapping

---

## **6. Config Rendering**

### **6.1 Process**

1. **Render from Templates** → `deploy-config/`

   ```
   deploy-config/
     cluster-metadata.json
     haproxy/
       haproxy.cfg
       metadata.json
     caddy/
       Caddyfile
       metadata.json
     keepalived/
       keepalived.conf
       metadata.json
     services/
       <service-name>/
         docker-compose.yml
         metadata.json
   ```
2. **Metadata file** stores:

```json
{
  "targetPath": "/opt/dynia/haproxy/haproxy.cfg",
  "permissions": "644",
  "hash": "sha256:..."
}
```

3. **Sync to Nodes** via SSH (rolling update)
4. **Drift Check** — compare hash on node with local metadata

---

## **7. Workflow**

### **7.1 Create Cluster**

```
dynia cluster create mycluster --nodes 2 --size s-1vcpu-1gb
```

Steps:

1. Provision nodes via `NodeProvider`
2. Allocate reserved IP
3. Assign node roles (MASTER/BACKUP)
4. Render **infra layer** config from local state
5. Sync to all nodes
6. Attach reserved IP to MASTER node
7. Save cluster to local state & set as `currentCluster`

---

### **7.2 Deploy Service**

```
dynia deploy --name myapp --compose ./myapp.yml --domain api.example.com
```

Steps:

1. Add service to local state
2. Render **application layer** configs (docker-compose, caddy routes)
3. Sync to all nodes
4. Update HAProxy backend routing
5. Map DNS via `DnsProvider` to reserved IP
6. Health-check service across all nodes

---

### **7.3 Update Config**

```
dynia sync
```

* Renders configs again
* Detects drift via hash
* Updates changed files only
* Rolling restart if required

---

### **7.4 Context Management**

```
dynia context current       # Show currentCluster
dynia context use prod      # Switch cluster
dynia context clear         # Clear current cluster
```

---

## **8. Command Flow**

### Example: `dynia deploy`

```
CLI (interfaces layer)
    ↓ parse args
Service Layer (application)
    ↓ validate inputs
    ↓ update local state
    ↓ render configs
    ↓ call sync service
Infrastructure
    ↓ ssh copy files
    ↓ restart containers
Providers
    ↓ call NodeProvider (if infra change)
    ↓ call DnsProvider (if domain change)
```

---

## **9. Code Design Rules**

1. **No provider-specific code** in application layer.
2. **No direct CLI arg usage** inside services — always pass DTO.
3. **Immutable render output** — all configs re-rendered each time from state.
4. **State-first changes** — modify local state, then render, then sync.
5. **No manual edits** to generated configs on nodes.

---

## **10. HA Model**

* **Full mirror replication**: every node runs the same services.
* HAProxy does load balancing across all healthy nodes.
* Keepalived handles failover of reserved IP.

---

This design keeps:

* Node provisioning and DNS mapping independent
* Config management central & consistent
* Codebase clean and testable via provider mocks
