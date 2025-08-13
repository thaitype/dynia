# 🏗️ Dynia Architecture & Design

This document provides a comprehensive overview of Dynia's architecture, from high-level system design to detailed component interactions.

## 📊 High-Level Architecture

### System Overview

```mermaid
graph TB
    subgraph "User Interface"
        CLI[Dynia CLI]
        ENV[Environment Config]
    end
    
    subgraph "Core System"
        SM[State Manager<br/>JSON Persistence]
        CP[Cloud Providers<br/>DigitalOcean]
        DP[DNS Providers<br/>Cloudflare]
    end
    
    subgraph "Cloud Infrastructure"
        subgraph "HA Cluster"
            RIP[Reserved IP]
            N1[Node 1<br/>brave-panda]
            N2[Node 2<br/>misty-owl]
            N3[Node 3<br/>swift-fox]
        end
    end
    
    subgraph "Services on Each Node"
        HAP[HAProxy<br/>SSL Termination]
        CAD[Caddy<br/>HTTP Proxy]
        DOC[Docker<br/>Application Containers]
        KAL[keepalived<br/>Failover Manager]
    end
    
    CLI --> SM
    CLI --> CP
    CLI --> DP
    CP --> RIP
    DP --> RIP
    RIP --> N1
    N1 --> HAP
    HAP --> CAD
    CAD --> DOC
    N1 --> KAL
    
    style CLI fill:#2196F3,color:#fff
    style SM fill:#4CAF50,color:#fff
    style CP fill:#FF9800,color:#fff
    style DP fill:#f96,color:#fff
    style HAP fill:#9C27B0,color:#fff
    style CAD fill:#00BCD4,color:#fff
    style DOC fill:#3F51B5,color:#fff
    style KAL fill:#795548,color:#fff
```

## 🔄 Request Flow Architecture

### Complete Request Journey

```mermaid
sequenceDiagram
    participant User
    participant Cloudflare
    participant ReservedIP
    participant HAProxy
    participant Caddy
    participant Service
    participant keepalived

    User->>Cloudflare: HTTPS Request
    Cloudflare->>ReservedIP: Forward to Origin
    ReservedIP->>HAProxy: Route to Active Node
    HAProxy->>HAProxy: SSL Termination
    HAProxy->>Caddy: HTTP Request (decrypted)
    Caddy->>Service: Proxy to Container
    Service->>Caddy: HTTP Response
    Caddy->>HAProxy: Response
    HAProxy->>ReservedIP: HTTPS Response (encrypted)
    ReservedIP->>Cloudflare: Return to CDN
    Cloudflare->>User: Final Response
    
    Note over keepalived: Continuous health monitoring
    keepalived->>keepalived: Health check all nodes
    alt Node failure detected
        keepalived->>ReservedIP: Move IP to backup node
    end
```

### Traffic Flow Levels

```mermaid
graph LR
    subgraph "Level 1: Edge CDN"
        CF[Cloudflare CDN<br/>Global Edge Locations]
    end
    
    subgraph "Level 2: Origin Infrastructure"
        RIP[Reserved IP<br/>Single Entry Point]
    end
    
    subgraph "Level 3: Load Balancer"
        HAP[HAProxy<br/>SSL Termination<br/>Port 443 → 8080]
    end
    
    subgraph "Level 4: HTTP Proxy"
        CAD[Caddy<br/>Host-based Routing<br/>Port 8080 → 8081+]
    end
    
    subgraph "Level 5: Application"
        APP[Docker Services<br/>Your Applications<br/>Port 8081, 8082, ...]
    end
    
    CF --> RIP
    RIP --> HAP
    HAP --> CAD
    CAD --> APP
    
    style CF fill:#f96,color:#fff
    style RIP fill:#9C27B0,color:#fff
    style HAP fill:#4CAF50,color:#fff
    style CAD fill:#00BCD4,color:#fff
    style APP fill:#FF9800,color:#fff
```

## 🧩 Core Components

### CLI System Architecture

```mermaid
graph TB
    subgraph "CLI Layer"
        Entry[cli.ts<br/>Entry Point]
        Yargs[yargs<br/>Command Parser]
        MW[Middleware<br/>Config & Validation]
    end
    
    subgraph "Command Layer"
        CC[Cluster Commands]
        NC[Node Commands]  
        SC[SSH Commands]
        CertC[Certificate Commands]
    end
    
    subgraph "Service Layer"
        NPS[Node Preparation<br/>Service]
        CPS[Certificate<br/>Provisioning Service]
        RIS[Reserved IP<br/>Service]
    end
    
    subgraph "Infrastructure Layer"
        DI[Docker Infrastructure<br/>Setup]
        SSH[SSH Executor<br/>Remote Commands]
        HC[Health Checker<br/>Validation]
    end
    
    subgraph "Provider Layer"
        DO[DigitalOcean<br/>Provider]
        CF[Cloudflare<br/>Provider]
        HP[Health<br/>Provider]
    end
    
    Entry --> Yargs
    Yargs --> MW
    MW --> CC
    MW --> NC
    MW --> SC
    MW --> CertC
    
    CC --> NPS
    CC --> CPS
    CC --> RIS
    
    NPS --> DI
    CPS --> SSH
    RIS --> HC
    
    DI --> DO
    SSH --> CF
    HC --> HP
    
    style Entry fill:#2196F3,color:#fff
    style CC fill:#4CAF50,color:#fff
    style NPS fill:#FF9800,color:#fff
    style DO fill:#f96,color:#fff
```

### State Management System

```mermaid
graph LR
    subgraph "State Operations"
        Load[loadState()]
        Save[saveState()]
        Validate[Schema Validation]
        Cache[Memory Cache]
    end
    
    subgraph "Data Models"
        Cluster[Clusters]
        Node[Cluster Nodes]
        Deploy[Deployments]
        Route[Routes]
        Legacy[Legacy Nodes]
    end
    
    subgraph "Persistence"
        JSON[state.json<br/>.dynia/state.json]
        Atomic[Atomic Writes]
        Security[Secret Validation]
    end
    
    Load --> Validate
    Validate --> Cache
    Cache --> Cluster
    Cache --> Node
    Cache --> Deploy
    Cache --> Route
    Cache --> Legacy
    
    Cluster --> Save
    Node --> Save
    Deploy --> Save
    Route --> Save
    Legacy --> Save
    
    Save --> Security
    Security --> Atomic
    Atomic --> JSON
    
    style Load fill:#4CAF50,color:#fff
    style Save fill:#2196F3,color:#fff
    style JSON fill:#FF9800,color:#fff
    style Security fill:#f44336,color:#fff
```

## ⚡ High Availability Implementation

### keepalived Failover Mechanism

```mermaid
stateDiagram-v2
    [*] --> Initializing
    Initializing --> Master : Priority highest + Health OK
    Initializing --> Backup : Priority lower OR Health issues
    
    Master --> CheckingHealth : Health check interval
    CheckingHealth --> Master : All checks pass
    CheckingHealth --> Fault : Health check fails
    
    Fault --> Backup : Stop VRRP advertisements
    Backup --> Master : No master advertisements + Health OK
    
    Backup --> CheckingBackup : Monitor master
    CheckingBackup --> Backup : Master still alive
    CheckingBackup --> Master : Master failed + take over
    
    Master --> [*] : Node shutdown
    Backup --> [*] : Node shutdown
    Fault --> [*] : Node shutdown
```

### Node States and Transitions

```mermaid
stateDiagram-v2
    [*] --> provisioning : dynia cluster create-ha
    provisioning --> droplet_created : DigitalOcean VM ready
    droplet_created --> dns_configured : DNS A record created
    dns_configured --> dns_ready : DNS propagation verified
    dns_ready --> infrastructure_ready : Docker + Services deployed
    infrastructure_ready --> active : All health checks pass
    
    active --> infrastructure_ready : Health check failure
    infrastructure_ready --> dns_ready : Infrastructure issue
    dns_ready --> dns_configured : DNS propagation lost
    
    active --> [*] : dynia cluster destroy
    infrastructure_ready --> [*] : Node removal
    
    note right of active
        Node is fully operational:
        - keepalived running
        - HAProxy serving HTTPS
        - Caddy routing HTTP
        - Services healthy
    end note
```

### Reserved IP Management

```mermaid
graph TB
    subgraph "DigitalOcean"
        RIP[Reserved IP<br/>138.197.55.84]
        N1[Node 1<br/>104.236.16.27]
        N2[Node 2<br/>159.223.45.12]
        N3[Node 3<br/>178.128.92.55]
    end
    
    subgraph "keepalived Process"
        K1[keepalived-1<br/>MASTER Priority: 100]
        K2[keepalived-2<br/>BACKUP Priority: 90]
        K3[keepalived-3<br/>BACKUP Priority: 80]
    end
    
    RIP -.-> N1
    N1 --> K1
    N2 --> K2
    N3 --> K3
    
    K1 -.->|VRRP Advertisements| K2
    K1 -.->|Health Checks| K3
    K2 -.->|Monitor Master| K1
    K3 -.->|Monitor Master| K1
    
    style K1 fill:#4CAF50,color:#fff
    style K2 fill:#FFC107,color:#000
    style K3 fill:#FFC107,color:#000
    style N1 fill:#4CAF50,color:#fff
```

## 🔒 SSL/TLS Architecture

### Certificate Provisioning Flow

```mermaid
sequenceDiagram
    participant CLI
    participant Node
    participant CSR
    participant CloudflareAPI
    participant HAProxy
    
    CLI->>Node: Generate certificate request
    Node->>CSR: Create CSR for *.domain.com
    Node->>Node: Generate private key
    CSR->>CloudflareAPI: Request Origin Certificate
    Note over CloudflareAPI: Validates CSR<br/>Issues 15-year certificate
    CloudflareAPI->>CSR: Return signed certificate
    CSR->>Node: Save certificate + key
    Node->>HAProxy: Create PEM file (cert+key)
    HAProxy->>HAProxy: Load certificate
    Note over HAProxy: Now serving HTTPS<br/>with valid Origin Certificate
```

### SSL Termination Architecture

```mermaid
graph LR
    subgraph "Internet"
        User[👤 User Browser]
        CDN[☁️ Cloudflare CDN]
    end
    
    subgraph "Your Infrastructure"
        subgraph "Node (VM)"
            HAP[⚖️ HAProxy<br/>SSL Termination<br/>Port 443]
            CAD[🔄 Caddy<br/>HTTP Proxy<br/>Port 8080]
            APP[🐳 Docker Services<br/>Port 8081+]
        end
        
        subgraph "Certificates"
            OC[Cloudflare Origin Certificate<br/>15-year validity]
            PK[Private Key<br/>Generated on node]
            PEM[Combined PEM File<br/>cert + key]
        end
    end
    
    User -->|HTTPS Request<br/>TLS 1.2/1.3| CDN
    CDN -->|HTTPS Request<br/>Origin Certificate| HAP
    HAP -->|HTTP Request<br/>Decrypted| CAD
    CAD -->|HTTP Request<br/>Host-based routing| APP
    
    OC --> PEM
    PK --> PEM
    PEM --> HAP
    
    style HAP fill:#9C27B0,color:#fff
    style CDN fill:#f96,color:#fff
    style OC fill:#4CAF50,color:#fff
```

### TLS Modes Comparison

```mermaid
graph TB
    subgraph "tlsMode 0: Caddy Full Stack"
        U1[User] --> CF1[Cloudflare]
        CF1 --> C1[Caddy HTTPS:443]
        C1 --> A1[App:8081]
        Note1[Caddy handles both<br/>SSL termination and<br/>HTTP proxy]
    end
    
    subgraph "tlsMode 1: HAProxy Origin (Default)"
        U2[User] --> CF2[Cloudflare]  
        CF2 --> H2[HAProxy HTTPS:443]
        H2 --> C2[Caddy HTTP:8080]
        C2 --> A2[App:8081]
        Note2[HAProxy handles SSL<br/>Caddy handles HTTP proxy<br/>Better for HA clusters]
    end
    
    style H2 fill:#9C27B0,color:#fff
    style C1 fill:#00BCD4,color:#fff
    style C2 fill:#00BCD4,color:#fff
    style CF1 fill:#f96,color:#fff
    style CF2 fill:#f96,color:#fff
```

## 🌐 Routing and Host Management

### Host-based Routing Architecture

```mermaid
graph TB
    subgraph "Incoming Requests"
        R1[api.yourdomain.com]
        R2[webapp.yourdomain.com] 
        R3[admin.yourdomain.com]
    end
    
    subgraph "HAProxy (SSL Termination)"
        HAP[HAProxy :443<br/>SSL Termination<br/>All requests → :8080]
    end
    
    subgraph "Caddy (HTTP Routing)"
        CAD[Caddy :8080<br/>Host-based Routing]
    end
    
    subgraph "Docker Services"
        S1[API Service :8081<br/>FastAPI/Node.js]
        S2[WebApp Service :8082<br/>React/Vue SPA]
        S3[Admin Service :8083<br/>Admin Dashboard]
    end
    
    R1 --> HAP
    R2 --> HAP
    R3 --> HAP
    
    HAP --> CAD
    
    CAD -->|Host: api.yourdomain.com| S1
    CAD -->|Host: webapp.yourdomain.com| S2
    CAD -->|Host: admin.yourdomain.com| S3
    
    style HAP fill:#9C27B0,color:#fff
    style CAD fill:#00BCD4,color:#fff
    style S1 fill:#4CAF50,color:#fff
    style S2 fill:#2196F3,color:#fff
    style S3 fill:#FF9800,color:#fff
```

### Caddyfile Configuration Pattern

```caddyfile
# Dynia Caddyfile - HTTP-only mode (tlsMode 1)
{
    auto_https off
    admin off
}

:80 {
    # Health check endpoint for HAProxy
    handle_path /dynia-health {
        respond "Dynia Node: {$NODE_NAME} - OK" 200
    }
    
    # Host-based routing
    @api host api.yourdomain.com
    handle @api {
        reverse_proxy http://api-service:8081
    }
    
    @webapp host webapp.yourdomain.com  
    handle @webapp {
        reverse_proxy http://webapp-service:8082
    }
    
    # Default handler for placeholder or catch-all
    handle {
        reverse_proxy http://placeholder-service:8081
    }
}
```

## 🔧 Infrastructure Provisioning

### Node Preparation Process

```mermaid
graph TD
    Start[Start Node Preparation] --> SSH[Wait for SSH Connection]
    SSH --> Docker[Install Docker & Docker Compose]
    Docker --> Network[Create Docker Networks]
    Network --> TLS{TLS Mode?}
    
    TLS -->|tlsMode 1| HAProxy[Deploy HAProxy Container]
    TLS -->|tlsMode 0| Caddy[Deploy Caddy Container]
    
    HAProxy --> CaddyHTTP[Deploy Caddy HTTP Container]
    CaddyHTTP --> Certs[Provision SSL Certificates]
    Caddy --> CertsLE[Generate Let's Encrypt Certs]
    
    Certs --> KA[Install keepalived]
    CertsLE --> KA
    KA --> HC[Configure Health Checks]
    HC --> Placeholder[Deploy Placeholder Service]
    Placeholder --> Verify[Verify All Services]
    Verify --> Complete[Node Ready]
    
    style Start fill:#4CAF50,color:#fff
    style Complete fill:#2196F3,color:#fff
    style HAProxy fill:#9C27B0,color:#fff
    style Caddy fill:#00BCD4,color:#fff
    style KA fill:#795548,color:#fff
```

### Service Dependencies

```mermaid
graph LR
    subgraph "System Dependencies"
        OS[Ubuntu 22.04 LTS]
        SSH[SSH Server]
        Firewall[UFW Firewall]
    end
    
    subgraph "Container Runtime"
        Docker[Docker Engine]
        Compose[Docker Compose]
        Networks[Docker Networks<br/>edge, bridge]
    end
    
    subgraph "Core Services"
        HAProxy[HAProxy Container<br/>SSL Termination]
        Caddy[Caddy Container<br/>HTTP Proxy]
        KA[keepalived<br/>System Service]
    end
    
    subgraph "Application Services"
        App1[Service 1<br/>Your Apps]
        App2[Service 2<br/>More Apps]
        Placeholder[Placeholder<br/>Test Service]
    end
    
    OS --> SSH
    SSH --> Docker
    Docker --> Compose
    Compose --> Networks
    Networks --> HAProxy
    Networks --> Caddy
    HAProxy --> Caddy
    Caddy --> App1
    Caddy --> App2
    Caddy --> Placeholder
    OS --> KA
    KA -.-> HAProxy
    
    style OS fill:#E91E63,color:#fff
    style Docker fill:#2196F3,color:#fff
    style HAProxy fill:#9C27B0,color:#fff
    style Caddy fill:#00BCD4,color:#fff
    style KA fill:#795548,color:#fff
```

## 📈 Scalability Architecture

### Horizontal Scaling Pattern

```mermaid
graph TB
    subgraph "Single Node (Start Here)"
        S1[1 Node Cluster<br/>All traffic here]
    end
    
    subgraph "High Availability (2+ Nodes)"
        M1[Master Node<br/>Active, has Reserved IP]
        B1[Backup Node 1<br/>Standby, ready to take over]
        B2[Backup Node 2<br/>Standby, ready to take over]
        
        M1 -.->|VRRP Health| B1
        M1 -.->|VRRP Health| B2
        B1 -.->|Monitor| M1
        B2 -.->|Monitor| M1
    end
    
    subgraph "Scale Operations"
        Scale[Add Nodes<br/>dynia cluster node add]
        Prepare[Prepare Infrastructure<br/>dynia cluster prepare]
        Activate[Manual Failover<br/>dynia cluster node activate]
    end
    
    S1 --> M1
    Scale --> B1
    Scale --> B2
    Prepare --> B1
    Prepare --> B2
    Activate -.-> B1
    
    style M1 fill:#4CAF50,color:#fff
    style B1 fill:#FFC107,color:#000
    style B2 fill:#FFC107,color:#000
```

### Resource Allocation Strategy

```mermaid
graph LR
    subgraph "Node Resources"
        CPU[1-2 vCPU<br/>Per Node]
        RAM[1-4 GB RAM<br/>Per Node] 
        Disk[25-50 GB SSD<br/>Per Node]
        Network[1-2 GB Transfer<br/>Per Node]
    end
    
    subgraph "Service Allocation"
        System[System Services<br/>~200MB RAM]
        HAProxy[HAProxy<br/>~50MB RAM]
        Caddy[Caddy<br/>~30MB RAM]
        KA[keepalived<br/>~10MB RAM]
        Apps[Your Applications<br/>Remaining RAM]
    end
    
    CPU --> System
    RAM --> System
    RAM --> HAProxy
    RAM --> Caddy
    RAM --> KA
    RAM --> Apps
    Disk --> Apps
    Network --> Apps
    
    style System fill:#795548,color:#fff
    style HAProxy fill:#9C27B0,color:#fff
    style Caddy fill:#00BCD4,color:#fff
    style Apps fill:#4CAF50,color:#fff
```

## 🔍 Health Check Architecture

### Multi-Level Health Monitoring

```mermaid
graph TB
    subgraph "Level 1: Container Health"
        C1[Docker Health Checks<br/>wget/curl to service]
        C2[Process Monitoring<br/>Service running?]
        C3[Port Availability<br/>Listening on correct port?]
    end
    
    subgraph "Level 2: Service Health"
        S1[HAProxy Admin API<br/>Backend status]
        S2[Caddy Admin API<br/>Disabled for security]
        S3[Application Endpoints<br/>/health, /ready, /live]
    end
    
    subgraph "Level 3: Infrastructure Health"
        I1[keepalived VRRP<br/>Node availability]
        I2[SSH Connectivity<br/>Remote access]
        I3[DNS Resolution<br/>Domain → IP mapping]
    end
    
    subgraph "Level 4: External Health"
        E1[Public HTTPS Access<br/>End-to-end verification]
        E2[CDN Status<br/>Cloudflare health]
        E3[Certificate Validity<br/>SSL expiry monitoring]
    end
    
    C1 --> S1
    C2 --> S2
    C3 --> S3
    S1 --> I1
    S2 --> I2
    S3 --> I3
    I1 --> E1
    I2 --> E2
    I3 --> E3
    
    style C1 fill:#4CAF50,color:#fff
    style S1 fill:#2196F3,color:#fff
    style I1 fill:#FF9800,color:#fff
    style E1 fill:#9C27B0,color:#fff
```

## 🏗️ Development Architecture

### Monorepo Structure

```mermaid
graph TB
    subgraph "Root"
        Root[dynia/<br/>Monorepo root]
    end
    
    subgraph "Core Package"
        Core[packages/dynia/<br/>Main CLI package]
    end
    
    subgraph "Configuration Packages"
        ESLint[configs/eslint/]
        TS[configs/typescript/]
        Vitest[configs/vitest/]
    end
    
    subgraph "Tooling"
        Mono[tools/mono/<br/>Build scripts]
        Template[tools/template/<br/>Package template]
    end
    
    subgraph "Examples"
        Basic[examples/basic/<br/>Getting started]
    end
    
    Root --> Core
    Root --> ESLint
    Root --> TS  
    Root --> Vitest
    Root --> Mono
    Root --> Template
    Root --> Basic
    
    Core -.->|uses| ESLint
    Core -.->|uses| TS
    Core -.->|uses| Vitest
    
    style Root fill:#2196F3,color:#fff
    style Core fill:#4CAF50,color:#fff
    style Mono fill:#FF9800,color:#fff
```

### Build Pipeline

```mermaid
graph LR
    subgraph "Source"
        TS[TypeScript<br/>Source Code]
        Tests[Vitest<br/>Unit Tests]
    end
    
    subgraph "Build Process"
        ESM[build-esm<br/>TypeScript → ESM]
        CJS[build-cjs<br/>Babel → CommonJS]
        Annotate[build-annotate<br/>Pure call annotations]
    end
    
    subgraph "Output"
        DistESM[dist/esm/<br/>ES Modules]
        DistCJS[dist/cjs/<br/>CommonJS]
        DistDTS[dist/dts/<br/>Type Definitions]
    end
    
    subgraph "Quality Gates"
        Lint[ESLint<br/>Code quality]
        TypeCheck[Type Checking<br/>tsc --noEmit]
        TestRun[Test Execution<br/>vitest run]
    end
    
    TS --> ESM
    ESM --> CJS
    CJS --> Annotate
    
    ESM --> DistESM
    CJS --> DistCJS
    ESM --> DistDTS
    
    TS --> Lint
    TS --> TypeCheck
    Tests --> TestRun
    
    style TS fill:#3178C6,color:#fff
    style ESM fill:#4CAF50,color:#fff
    style CJS fill:#FF9800,color:#fff
    style Lint fill:#8A2BE2,color:#fff
```

This comprehensive architecture overview should give you a complete understanding of how Dynia works at every level, from high-level system design to detailed component interactions. Each section builds upon the previous ones to create a complete picture of the system.

---

**Next**: [Infrastructure Deep Dive](infrastructure.md) - Learn about server setup and configuration details.