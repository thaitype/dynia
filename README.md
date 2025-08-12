# Dynia CLI

A cloud infrastructure management CLI for automated deployment and High Availability (HA) cluster orchestration. Dynia simplifies cloud infrastructure provisioning with Docker-based services, automated DNS configuration, HTTPS certificates, and failover management. Currently supports DigitalOcean with extensible architecture for additional cloud providers.

## ✨ Features

### 🏗️ High Availability Clustering
- **🔗 Reserved IP Management**: Stable public IP address for cluster access
- **⚡ Elastic Scaling**: Start with 1 node, scale to N nodes seamlessly  
- **🔄 Automatic Failover**: keepalived-based failover with priority management
- **🎯 Host-Based Routing**: Multiple services behind a single IP using Caddy proxy
- **🏷️ Two-Word Node IDs**: Human-friendly node identification (e.g., `brave-panda`, `misty-owl`)

### ☁️ Cloud Infrastructure Management  
- **🔑 SSH Key Management**: Automated SSH key generation and cloud provider integration
- **🖥️ Cloud VM Provisioning**: One-command cloud VM creation (currently DigitalOcean Ubuntu 22.04)
- **🌐 DNS Automation**: Automatic DNS A record creation and propagation (currently Cloudflare)
- **🔒 HTTPS Certificates**: Automated SSL/TLS certificate generation via Caddy
- **🐳 Docker Infrastructure**: Containerized services with reverse proxy and health monitoring

### 🔧 Operations & Reliability
- **🔍 Two-Sided Health Checks**: Internal container validation + public accessibility testing
- **🔄 Intelligent Recovery**: Progressive state saving and automatic repair capabilities
- **⚡ Built-in Resilience**: Retry logic for transient failures and network issues
- **📊 Infrastructure Monitoring**: Comprehensive cluster and node status reporting

## 🚀 Quick Start

### Prerequisites

- **Cloud Provider Account**: Currently requires DigitalOcean for VM provisioning
- **DNS Provider Account**: Currently requires Cloudflare for DNS management  
- **Domain**: A domain registered and configured with your DNS provider
- **Node.js 22+**: For running the CLI tool

### Installation

```bash
# Clone the repository
git clone https://github.com/thaitype/dynia.git
cd dynia

# Install dependencies
pnpm install

# Build the project
pnpm build

# Navigate to example directory
cd examples/basic
```

### Environment Setup

Create a `.env` file in your project directory with provider configurations:

```bash
# Cloud Provider Configuration (DigitalOcean)
DYNIA_DO_TOKEN=dop_v1_your_digitalocean_token_here

# DNS Provider Configuration (Cloudflare)
DYNIA_CF_TOKEN=your_cloudflare_api_token_here
DYNIA_CF_ZONE_ID=your_cloudflare_zone_id_here

# SSH Key Configuration
DYNIA_SSH_KEY_ID=your_ssh_key_id_here
```

### Default Configuration

Current provider defaults (DigitalOcean):

- **Region**: `nyc3` (New York)
- **VM Size**: `s-1vcpu-1gb` (1 vCPU, 1GB RAM)
- **Image**: `ubuntu-22-04-x64` (Ubuntu 22.04 LTS)

## 📖 Commands Reference

### SSH Key Management

#### Create SSH Key
```bash
# Create SSH key with default name 'dynia'
pnpm dynia ssh create

# Create SSH key with custom name
pnpm dynia ssh create --key-name myproject

# Recreate existing SSH key
pnpm dynia ssh create --force

# Create key and display environment variable
pnpm dynia ssh create --output-env
```

#### List SSH Keys
```bash
# Show all SSH keys in your DigitalOcean account
pnpm dynia ssh list
```

## 🏗️ HA Cluster Management

### Cluster Operations

#### Create HA Cluster
```bash
# Create a new HA cluster (starts with 1 node)
pnpm dynia cluster create-ha --name myapp --base-domain example.com

# Create cluster in specific region
pnpm dynia cluster create-ha --name webapp --base-domain mydomain.com --region sgp1 --size s-2vcpu-2gb
```

#### List Clusters
```bash
# Show all clusters
pnpm dynia cluster list
```

#### Prepare Cluster Infrastructure
```bash
# Prepare all nodes in cluster
pnpm dynia cluster prepare myapp

# Force re-preparation of all nodes
pnpm dynia cluster prepare myapp --force

# Prepare nodes in parallel (faster)
pnpm dynia cluster prepare myapp --parallel
```

#### Repair Cluster
```bash
# Check cluster health only
pnpm dynia cluster repair-ha myapp --check-only

# Repair cluster infrastructure
pnpm dynia cluster repair-ha myapp --force
```

#### Destroy Cluster
```bash
# Destroy cluster with confirmation prompt
pnpm dynia cluster destroy myapp

# Force destroy without confirmation
pnpm dynia cluster destroy myapp --confirm
```

### Node Management

#### Add Nodes
```bash
# Add one node to cluster
pnpm dynia cluster node add --cluster myapp

# Add multiple nodes
pnpm dynia cluster node add --cluster myapp --count 3
```

#### List Nodes
```bash
# Show all nodes in a cluster
pnpm dynia cluster node list --cluster myapp
```

#### Prepare Individual Nodes
```bash
# Prepare specific node infrastructure
pnpm dynia cluster node prepare --cluster myapp --node brave-panda

# Force re-preparation of node
pnpm dynia cluster node prepare --cluster myapp --node brave-panda --force
```

#### Activate Node (Failover)
```bash
# Make a node active (move Reserved IP)
pnpm dynia cluster node activate --cluster myapp --node misty-owl
```

#### Remove Nodes
```bash
# Remove node with confirmation prompt
pnpm dynia cluster node remove --cluster myapp --node brave-panda

# Force remove without confirmation
pnpm dynia cluster node remove --cluster myapp --node brave-panda --confirm
```

### Reserved IP Management

#### List Reserved IPs
```bash
# Show all Reserved IPs and their assignment status
pnpm dynia cluster reserved-ip list

# Filter by region
pnpm dynia cluster reserved-ip list --region nyc3

# Show only unassigned IPs
pnpm dynia cluster reserved-ip list --status unassigned
```

#### Assign Reserved IP
```bash
# Assign Reserved IP to specific node
pnpm dynia cluster reserved-ip assign --cluster myapp --node brave-panda
```

### Service Deployment

#### Deploy Services
```bash
# Deploy placeholder service for testing
pnpm dynia cluster deploy --name myapp --placeholder

# Deploy custom application with domain
pnpm dynia cluster deploy --name myapp --compose ./app.yml --domain myapp-api.example.com

# Deploy with custom health check path
pnpm dynia cluster deploy --name myapp --compose ./app.yml --domain myapp-web.example.com --health-path /health
```

## 🏗️ Legacy Single Node Management

For backward compatibility, single-node commands are still available:

#### Create Single Node
```bash
# Create a single node (legacy mode)
pnpm dynia node create --name webserver

# Create numbered node
pnpm dynia node create --name api --number 1

# Create node with custom health check path
pnpm dynia node create --name app --health-path /health
```

#### List Single Nodes
```bash
# Show all single nodes and their status
pnpm dynia node list
```

#### Repair Single Node
```bash
# Check node status only
pnpm dynia node repair webserver --check-only

# Repair node with confirmation prompt
pnpm dynia node repair webserver

# Force repair without confirmation
pnpm dynia node repair webserver --force
```

## 🔧 Complete Workflows

### 1. HA Cluster Setup (Recommended)

```bash
# Step 1: Create and upload SSH key to DigitalOcean
pnpm dynia ssh create --output-env

# Step 2: Copy the DYNIA_SSH_KEY_ID to your .env file
echo "DYNIA_SSH_KEY_ID=12345678" >> .env

# Step 3: Create your first HA cluster
pnpm dynia cluster create-ha --name myapp --base-domain example.com

# Step 4: Verify cluster creation
pnpm dynia cluster list
pnpm dynia cluster node list --cluster myapp

# Your cluster is now accessible at the Reserved IP
# You can deploy services to: https://yourservice.example.com
```

### 2. Scaling to Multiple Nodes

```bash
# Add additional nodes for high availability
pnpm dynia cluster node add --cluster myapp --count 2

# Verify all nodes are healthy
pnpm dynia cluster node list --cluster myapp

# Test failover by activating a different node
pnpm dynia cluster node activate --cluster myapp --node misty-owl

# Deploy a test service across the cluster
pnpm dynia cluster deploy --name myapp --placeholder
```

### 3. Service Deployment

```bash
# Deploy your application to the cluster
pnpm dynia cluster deploy --name myapp --compose ./docker-compose.yml --domain myapp-api.example.com

# The service will be accessible at: https://myapp-api.example.com
# Traffic will be routed to the active node automatically
# Note: Use single-level subdomains for SSL compatibility
```

## ☁️ Cloud Provider Support

### Current Support
- **Cloud VMs**: DigitalOcean Droplets (Ubuntu 22.04 LTS)
- **DNS**: Cloudflare (A records, SSL certificates)
- **Deployment Model**: One cloud provider per cluster configuration

### Planned Support  
- ~~**AWS**: EC2 instances + Route 53 DNS~~
- ~~**Google Cloud**: Compute Engine + Cloud DNS~~
- **Azure**: Virtual Machines + Azure DNS

### Architecture
Dynia uses a pluggable provider architecture - you configure one cloud provider at a time for your deployments. Each cluster uses a single cloud provider, with the flexibility to choose different providers for different projects.

## 🏗️ Infrastructure Details

### What Gets Created

When you create an HA cluster, Dynia automatically provisions:

1. **Cloud Infrastructure** (DigitalOcean)
   - Multiple cloud VMs (Ubuntu 22.04 LTS droplets)
   - Reserved/Elastic IP address for cluster access
   - Private networking between nodes
   - SSH access configured

2. **DNS Configuration** (Cloudflare)
   - A records pointing to cluster IP
   - Automated domain routing configuration

3. **HA Services on Each Node**
   - **Docker & Docker Compose**: Container orchestration
   - **Caddy Proxy**: HTTPS certificates and host-based routing
   - **keepalived**: Automatic failover between nodes
   - **Health Monitoring**: Container and service health checks

4. **Security Configuration**
   - Automatic HTTPS/SSL certificates via Let's Encrypt
   - Security headers (HSTS, CSP, etc.)
   - Firewall-friendly configuration
   - Private networking between nodes

### Cluster Architecture

```
Internet → Cluster IP → Active Node (keepalived) → Caddy → Docker Services
                          ↕ Failover
                       Standby Nodes → keepalived monitors
```

### Node States

Nodes progress through these states:

- `provisioning`: Droplet is being created
- `droplet-created`: DigitalOcean VM is running
- `dns-configured`: DNS record created in Cloudflare  
- `dns-ready`: DNS propagation verified
- `infrastructure-ready`: Docker services deployed
- `active`: All health checks passed, fully operational

### Node Roles

- **Active**: Holds the Reserved IP, receives all traffic
- **Standby**: Ready to take over if active node fails

### Two-Word Node Identifiers

- **Format**: `<adjective>-<animal>` (e.g., `brave-panda`, `misty-owl`)
- **Usage**: Friendly identification in commands and logs
- **Hostname**: Becomes `clustername-nodeid` (e.g., `myapp-brave-panda`)

## 🔧 Advanced Usage

### Cluster Health Monitoring

```bash
# Check overall cluster health
pnpm dynia cluster repair-ha myapp --check-only

# Check individual node health
pnpm dynia cluster node list --cluster myapp

# View Reserved IP assignments
pnpm dynia cluster reserved-ip list
```

### Manual Failover Testing

```bash
# Test failover by switching active nodes
pnpm dynia cluster node activate --cluster myapp --node misty-owl

# Verify the Reserved IP moved to the new node
pnpm dynia cluster reserved-ip list
```

### Cluster Scaling

```bash
# Scale up: Add more nodes for redundancy
pnpm dynia cluster node add --cluster myapp --count 2

# Scale down: Remove unnecessary nodes
pnpm dynia cluster node remove --cluster myapp --node brave-panda --confirm

# Rebalance: Prepare all nodes after scaling
pnpm dynia cluster prepare myapp
```

### Custom Configuration

Environment variables for advanced configuration:

```bash
# Custom DigitalOcean region (default: nyc3)  
DYNIA_DO_REGION=sfo3

# Custom droplet size (default: s-1vcpu-1gb)
DYNIA_DO_SIZE=s-2vcpu-2gb
```

## 🐛 Troubleshooting

### Cluster Issues

1. **Reserved IP Not Assigned**
   ```bash
   # Check Reserved IP status
   pnpm dynia cluster reserved-ip list
   
   # Manually assign to node
   pnpm dynia cluster reserved-ip assign --cluster myapp --node brave-panda
   ```

2. **Node Not Responding**
   ```bash
   # Check cluster health
   pnpm dynia cluster repair-ha myapp --check-only
   
   # Repair specific node
   pnpm dynia cluster node prepare --cluster myapp --node brave-panda --force
   ```

3. **Failover Not Working**
   ```bash
   # Check keepalived status on nodes
   pnpm dynia cluster node list --cluster myapp
   
   # Force failover to different node
   pnpm dynia cluster node activate --cluster myapp --node misty-owl
   ```

4. **SSL Certificate Issues**
   ```bash
   # SSL "hostname not covered by certificate" error
   # Cause: Multi-level subdomains not supported by Cloudflare Universal SSL
   # Solution: Use single-level subdomains
   
   # ❌ Problematic: app.cluster.example.com (3 levels)
   # ✅ Correct: app-cluster.example.com (2 levels)
   
   # Check certificate coverage
   curl -vI https://your-domain.example.com
   ```

5. **Service Returns 502 Bad Gateway**
   ```bash
   # Check if Caddy can reach the container
   # Verify container networking and ports
   
   # Check Caddy configuration
   pnpm dynia cluster deploy --name myapp --placeholder
   
   # View Caddy logs on the node
   ssh user@node-ip "docker logs dynia-caddy"
   ```

### Single Node Issues

1. **SSH Connection Timeout**
   ```bash
   # Verify SSH key is properly configured
   pnpm dynia ssh list
   
   # Check droplet firewall settings in DigitalOcean console
   ```

2. **DNS Propagation Slow**
   ```bash
   # DNS can take time - repair will handle it
   pnpm dynia node repair mynode --force
   ```

3. **Certificate Generation Failed**
   ```bash
   # Usually resolves automatically with repair
   pnpm dynia node repair mynode --force
   ```

4. **Container Health Check Failed**
   ```bash
   # Check detailed status
   pnpm dynia node repair mynode --check-only
   ```

### Debug Mode

```bash
# Enable verbose logging for any command
pnpm dynia cluster create-ha --name debug-cluster --base-domain example.com --verbose

# Dry run mode (test without actual changes)
pnpm dynia cluster node add --cluster myapp --dry-run
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable  
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

- **Issues**: [GitHub Issues](https://github.com/thaitype/dynia/issues)
- **Documentation**: This README and command help (`pnpm dynia --help`)
- **Examples**: Check the `examples/` directory

---

**Made with ❤️ by the Dynia team**