// import { dirname } from 'path';
// import { fileURLToPath } from 'url';

import type { ILogger } from '@thaitype/core-utils';

import { Helpers } from './helpers.js';
import { SSHExecutor } from './ssh.js';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

/**
 * Docker infrastructure management utilities
 */
export class DockerInfrastructure {
  private readonly ssh: SSHExecutor;

  constructor(
    private readonly nodeIp: string,
    private readonly nodeName: string,
    private readonly domain: string,
    private readonly logger: ILogger
  ) {
    this.ssh = new SSHExecutor(nodeIp, logger);
  }

  /**
   * Execute a command on the remote node via SSH
   * Public method to allow external access to SSH execution
   */
  async executeCommand(command: string): Promise<string> {
    return await this.ssh.executeCommand(command);
  }

  /**
   * Complete infrastructure setup on the remote node with retry logic
   */
  async setupInfrastructure(): Promise<void> {
    this.logger.info('Setting up Docker infrastructure...');

    // Step 1: Wait for SSH connection (with retry)
    await Helpers.retry(() => this.ssh.waitForConnection(), {
      maxAttempts: 3,
      baseDelay: 5000, // 5 seconds
      maxDelay: 30000, // 30 seconds max
      description: 'SSH connection establishment',
    });

    // Step 2: Install Docker (with retry for transient package manager issues)
    await Helpers.retry(() => this.installDocker(), {
      maxAttempts: 2,
      baseDelay: 5000, // 5 seconds
      maxDelay: 10000, // 10 seconds max
      description: 'Docker installation',
    });

    // Step 3: Deploy Caddy (with retry for Docker service startup delays)
    await Helpers.retry(() => this.deployCaddy(), {
      maxAttempts: 2,
      baseDelay: 5000, // 5 seconds
      maxDelay: 15000, // 15 seconds max
      description: 'Caddy deployment',
    });

    // Step 4: Infrastructure setup complete
    // Note: Placeholder service should be deployed via 'dynia cluster deployment create --placeholder'
    // not as part of infrastructure setup

    this.logger.info('✅ Docker infrastructure setup complete');
  }

  /**
   * Install Docker on the remote server
   */
  async installDocker(): Promise<void> {
    this.logger.info('Installing Docker...');

    // Docker installation script embedded directly
    const scriptContent = `#!/bin/bash

# Docker installation script for Ubuntu 22.04
# This script installs Docker and Docker Compose on a fresh Ubuntu server

set -euo pipefail

echo "🐳 Installing Docker on Ubuntu..."

# Update package index
apt-get update

# Install prerequisites
apt-get install -y \\
    ca-certificates \\
    curl \\
    gnupg \\
    lsb-release

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
# Fix GPG in non-interactive environments
export GPG_TTY=$(tty || echo "/dev/null")
export GNUPGHOME=$(mktemp -d)
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
# Clean up temporary GPG home
rm -rf "$GNUPGHOME"

# Set up Docker repository
echo \\
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \\
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \\
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update package index again
apt-get update

# Install Docker Engine, containerd, and Docker Compose
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker service
systemctl start docker
systemctl enable docker

# Create dynia directory structure
mkdir -p /opt/dynia/{caddy,placeholder,compose}

# Create edge network
docker network create edge || true

echo "✅ Docker installation completed successfully"
echo "   Docker version: $(docker --version)"
echo "   Docker Compose version: $(docker compose version)"
`;

    await this.ssh.copyContent(scriptContent, '/tmp/install-docker.sh');
    await this.ssh.executeCommand('chmod +x /tmp/install-docker.sh');
    await this.ssh.executeCommand('/tmp/install-docker.sh');

    this.logger.info('✅ Docker installed successfully');
  }

  /**
   * Create Docker edge network
   */
  async createEdgeNetwork(): Promise<void> {
    this.logger.info('Creating Docker edge network...');

    try {
      await this.ssh.executeCommand('docker network create edge');
      this.logger.info('✅ Edge network created successfully');
    } catch (error) {
      // Network might already exist
      if (error instanceof Error && error.message.includes('already exists')) {
        this.logger.info('✅ Edge network already exists');
      } else {
        throw error;
      }
    }
  }

  /**
   * Deploy Caddy proxy service
   */
  async deployCaddy(): Promise<void> {
    this.logger.info('Deploying Caddy...');

    // Stop and remove any existing containers to avoid port conflicts
    await this.ssh.executeCommand('cd /opt/dynia/caddy && docker compose down || true');
    await this.ssh.executeCommand('docker stop dynia-placeholder dynia-caddy || true');
    await this.ssh.executeCommand('docker rm dynia-placeholder dynia-caddy || true');

    // Create Caddy directories and files
    await this.ssh.executeCommand('mkdir -p /opt/dynia/caddy /var/log/caddy');

    // Generate Caddyfile from template
    const caddyfileTemplate = await this.loadTemplate('Caddyfile.template');
    const caddyfile = caddyfileTemplate
      .replace(/{{DOMAIN}}/g, `${this.nodeName}.${this.domain}`)
      .replace(/{{TARGET_SERVICE}}/g, 'dynia-placeholder')  // Use container name
      .replace(/{{TARGET_PORT}}/g, '80')  // Internal container port
      .replace(/{{NODE_NAME}}/g, this.nodeName);

    await this.ssh.copyContent(caddyfile, '/opt/dynia/caddy/Caddyfile');

    // Copy Caddy docker-compose file
    const caddyCompose = await this.loadDockerFile('caddy-compose.yml');
    await this.ssh.copyContent(caddyCompose, '/opt/dynia/caddy/docker-compose.yml');

    // Start Caddy service
    await this.ssh.executeCommand('cd /opt/dynia/caddy && docker compose up -d');

    this.logger.info('✅ Caddy deployed successfully');
  }

  /**
   * Deploy HAProxy for cluster load balancing
   */
  async deployHAProxy(clusterNodes: Array<{twoWordId: string; privateIp: string; publicIp: string; role?: string}>, clusterName: string): Promise<void> {
    this.logger.info('Deploying HAProxy load balancer...');

    // Stop and remove any existing HAProxy container to avoid conflicts
    await this.ssh.executeCommand('cd /opt/dynia/haproxy && docker compose down || true');
    await this.ssh.executeCommand('docker stop dynia-haproxy || true');
    await this.ssh.executeCommand('docker rm dynia-haproxy || true');

    // Create HAProxy directories
    await this.ssh.executeCommand('mkdir -p /opt/dynia/haproxy/certs');

    // Generate HAProxy configuration from template
    const activeNode = clusterNodes.find(n => n.role === 'active') || clusterNodes[0];
    const haproxyTemplate = await this.loadTemplate('haproxy.cfg');
    
    // Generate host ACLs (placeholder for now, will be enhanced for specific domains)
    const hostAcls = `    # Host-based routing will be configured per deployment
    # Example: acl host_api hdr(host) -i api.example.com
    # Example: use_backend api_backends if host_api`;

    // Generate backend servers for all cluster nodes (pointing to Caddy internal ports)
    const backendServers = clusterNodes.map((node, index) => {
      const serverId = `node${index + 1}`;
      // Use private IP for VPC communication, fallback to public IP
      const serverIp = node.privateIp || node.publicIp;
      return `    server ${serverId} ${serverIp}:8080 check inter 5s fall 3 rise 2`;
    }).join('\n');

    // Generate dynamic backends (placeholder for now)
    const backends = `# Dynamic backends will be added per service deployment
# Each service deployment will add its own backend pool`;

    const haproxyConfig = haproxyTemplate
      .replace(/{{CLUSTER_NAME}}/g, clusterName)
      .replace(/{{ACTIVE_NODE}}/g, activeNode.twoWordId)
      .replace(/{{TOTAL_NODES}}/g, clusterNodes.length.toString())
      .replace(/{{HOST_ACLS}}/g, hostAcls)
      .replace(/{{BACKENDS}}/g, backends)
      .replace(/{{BACKEND_SERVERS}}/g, backendServers);

    await this.ssh.copyContent(haproxyConfig, '/opt/dynia/haproxy/haproxy.cfg');

    // Generate self-signed certificate for now (will be enhanced with real certs)
    await this.ssh.executeCommand(`
      mkdir -p /opt/dynia/haproxy/certs && 
      cd /opt/dynia/haproxy/certs && 
      openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
        -keyout default.key -out default.crt \\
        -subj "/C=US/ST=State/L=City/O=Dynia/CN=*.${this.domain}" && 
      cat default.crt default.key > default.pem
    `);

    // Copy HAProxy docker-compose file
    const haproxyCompose = await this.loadDockerFile('haproxy-compose.yml');
    await this.ssh.copyContent(haproxyCompose, '/opt/dynia/haproxy/docker-compose.yml');

    // Start HAProxy service
    await this.ssh.executeCommand('cd /opt/dynia/haproxy && docker compose up -d');

    this.logger.info('✅ HAProxy deployed successfully');
  }

  /**
   * Install and configure HAProxy as system service (non-Docker) 
   * Implements tlsMode 1: haproxy-origin with SSL termination at HAProxy
   */
  async installSystemHAProxy(clusterNodes: Array<{twoWordId: string; privateIp: string; publicIp: string; role?: string}>, clusterName: string, reservedIp?: string): Promise<void> {
    this.logger.info('Installing HAProxy as system service...');
    
    try {
      // Stop and remove any existing Docker HAProxy first
      await this.ssh.executeCommand('cd /opt/dynia/haproxy && docker compose down || true');
      await this.ssh.executeCommand('docker stop dynia-haproxy || true');
      await this.ssh.executeCommand('docker rm dynia-haproxy || true');
      
      // Create backup directory
      await this.ssh.executeCommand('mkdir -p /etc/haproxy/backup');
      
      // Install HAProxy system package with explicit error checking
      this.logger.info('📦 Installing HAProxy package...');
      const installResult = await this.ssh.executeCommand('apt update -qq && apt install -y haproxy');
      this.logger.debug(`Package installation output: ${installResult}`);
      
      // Verify HAProxy binary was installed
      const haproxyCheck = await this.ssh.executeCommand('which haproxy || echo "NOT_FOUND"');
      if (haproxyCheck.trim() === 'NOT_FOUND') {
        throw new Error('HAProxy package installation failed - binary not found');
      }
      this.logger.info(`✅ HAProxy binary installed at: ${haproxyCheck.trim()}`);
      
      // Generate HAProxy configuration from template
      const activeNode = clusterNodes.find(n => n.role === 'active') || clusterNodes[0];
      const haproxyTemplate = await this.loadTemplate('system-haproxy.cfg');
      
      // Generate backend servers for all cluster nodes (pointing to Caddy internal ports)
      const backendServers = clusterNodes.map((node, index) => {
        const serverId = `node${index + 1}`;
        // Use private IP for VPC communication, fallback to public IP
        const serverIp = node.privateIp || node.publicIp;
        this.logger.info(`🔍 DEBUG: Node ${node.twoWordId} - privateIp: ${node.privateIp}, publicIp: ${node.publicIp}, using: ${serverIp}`);
        return `    server ${serverId} ${serverIp}:8080 check inter 5s fall 3 rise 2`;
      }).join('\n');
      
      // For single-node setups, bind to all interfaces; Reserved IP routing handled by network
      const bindIp = '*'; // Bind to all interfaces
      
      this.logger.info(`🔧 Configuring HAProxy with ${clusterNodes.length} backend servers...`);
      this.logger.debug(`Backend servers: ${backendServers}`);
      
      // Replace template placeholders
      const haproxyConfig = haproxyTemplate
        .replace(/{{CLUSTER_NAME}}/g, clusterName)
        .replace(/{{ACTIVE_NODE}}/g, activeNode.twoWordId)
        .replace(/{{TOTAL_NODES}}/g, clusterNodes.length.toString())
        .replace(/{{RESERVED_IP}}/g, bindIp)
        .replace(/{{BACKEND_SERVERS}}/g, backendServers)
        .replace(/{{HOST_ACLS}}/g, '    # Host-based routing will be configured per deployment')
        .replace(/{{BACKENDS}}/g, '# Dynamic backends will be added per service deployment');
      
      // Backup existing config if it exists
      const timestamp = new Date().toISOString().replace(/[:-]/g, '').replace(/\..+/, '').replace('T', '-');
      await this.ssh.executeCommand(`cp /etc/haproxy/haproxy.cfg /etc/haproxy/backup/haproxy.cfg.${timestamp} 2>/dev/null || true`);
      
      // Create SSL certificate directory
      await this.ssh.executeCommand('mkdir -p /etc/haproxy/certs');
      
      // Deploy HAProxy configuration
      this.logger.info('📝 Writing HAProxy configuration...');
      await this.ssh.copyContent(haproxyConfig, '/etc/haproxy/haproxy.cfg');
      
      // Verify config file was written
      const configCheck = await this.ssh.executeCommand('test -f /etc/haproxy/haproxy.cfg && echo "EXISTS" || echo "MISSING"');
      if (configCheck.trim() === 'MISSING') {
        throw new Error('Failed to write HAProxy configuration file');
      }
      
      // Test configuration before restarting
      this.logger.info('🔍 Validating HAProxy configuration...');
      const configTest = await this.ssh.executeCommand('haproxy -c -f /etc/haproxy/haproxy.cfg');
      this.logger.debug(`Config validation output: ${configTest}`);
      
      // Enable and start HAProxy service with explicit error checking
      this.logger.info('🚀 Starting HAProxy service...');
      await this.ssh.executeCommand('systemctl enable haproxy');
      await this.ssh.executeCommand('systemctl restart haproxy');
      
      // Verify service is actually active
      const serviceStatus = await this.ssh.executeCommand('systemctl is-active haproxy || echo "FAILED"');
      if (serviceStatus.trim() !== 'active') {
        // Get detailed error information
        const serviceError = await this.ssh.executeCommand('systemctl status haproxy --no-pager -l');
        throw new Error(`HAProxy service failed to start. Status: ${serviceStatus.trim()}\nDetails: ${serviceError}`);
      }
      this.logger.info('✅ HAProxy service is active');
      
      // Verify HAProxy is listening on expected ports
      this.logger.info('🔍 Verifying port bindings...');
      const portCheck = await this.ssh.executeCommand('sleep 3 && ss -tlnp | grep -E ":(80|443|8404)" | head -5');
      this.logger.debug(`Port bindings: ${portCheck}`);
      
      // Final verification: test HAProxy stats endpoint
      const statsCheck = await this.ssh.executeCommand('curl -s --connect-timeout 5 http://localhost:8404/stats | head -1 || echo "STATS_FAILED"');
      if (statsCheck.includes('STATS_FAILED')) {
        this.logger.warn('⚠️ HAProxy stats endpoint not accessible, but service is running');
      } else {
        this.logger.info('✅ HAProxy stats endpoint accessible');
      }
      
      this.logger.info('✅ System HAProxy installed and configured successfully');
      
    } catch (error) {
      this.logger.error(`❌ HAProxy installation failed: ${error}`);
      
      // Attempt to get more diagnostic information
      try {
        const diagnostics = await this.ssh.executeCommand(`
          echo "=== HAProxy Installation Diagnostics ===" &&
          echo "HAProxy binary:" && (which haproxy || echo "NOT FOUND") &&
          echo "Service status:" && (systemctl is-active haproxy || echo "INACTIVE") &&
          echo "Config file:" && (test -f /etc/haproxy/haproxy.cfg && echo "EXISTS" || echo "MISSING") &&
          echo "Last journal entries:" && journalctl -u haproxy --no-pager -l -n 10 || echo "No journal entries"
        `);
        this.logger.error(`Diagnostics: ${diagnostics}`);
      } catch (diagError) {
        this.logger.error(`Failed to get diagnostics: ${diagError}`);
      }
      
      throw new Error(`HAProxy installation failed: ${error}`);
    }
  }

  /**
   * Deploy placeholder service
   */
  async deployPlaceholder(): Promise<void> {
    this.logger.info('Deploying placeholder service...');

    // Create placeholder directories
    await this.ssh.executeCommand('mkdir -p /opt/dynia/placeholder /var/log/nginx');

    // Generate placeholder HTML from template
    const indexTemplate = await this.loadTemplate('placeholder-index.html');
    const indexHtml = indexTemplate
      .replace(/{{NODE_NAME}}/g, this.nodeName)
      .replace(/{{DOMAIN}}/g, this.domain)
      .replace(/{{CREATED_AT}}/g, new Date().toISOString());

    await this.ssh.copyContent(indexHtml, '/opt/dynia/placeholder/index.html');

    // Copy nginx configuration
    const nginxConfig = await this.loadTemplate('placeholder-nginx.conf');
    await this.ssh.copyContent(nginxConfig, '/opt/dynia/placeholder/nginx.conf');

    // Copy placeholder docker-compose file
    const placeholderCompose = await this.loadDockerFile('placeholder-compose.yml');
    await this.ssh.copyContent(placeholderCompose, '/opt/dynia/placeholder/docker-compose.yml');

    // Start placeholder service
    await this.ssh.executeCommand('cd /opt/dynia/placeholder && docker compose up -d');

    this.logger.info('✅ Placeholder service deployed successfully');
  }

  /**
   * Load template content (embedded)
   */
  private async loadTemplate(templateName: string): Promise<string> {
    const templates: Record<string, string> = {
      'Caddyfile.template': `# Dynia Caddyfile - HTTP-only mode (tlsMode 1: haproxy-origin)
# HAProxy handles SSL termination, Caddy serves HTTP only
# This file is automatically generated and updated by Dynia

{
    auto_https off
    admin off
}

:80 {
    # Health check endpoint for HAProxy
    handle_path /dynia-health {
        respond "Dynia Node: {{NODE_NAME}} - OK" 200
    }
    
    # Default reverse proxy to target service
    reverse_proxy http://{{TARGET_SERVICE}}:{{TARGET_PORT}}
    
    # Logging
    log {
        output file /var/log/caddy/access.log
        format json
    }
}`,

      'placeholder-index.html': `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dynia Placeholder</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            margin-top: 50px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
            font-size: 2rem;
        }
        .node-info {
            color: #666;
            font-size: 1.2rem;
            font-weight: bold;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <h1>No applications deployed. Ready for cluster deployments.</h1>
    <p class="node-info">(Served from node: {{NODE_NAME}})</p>
</body>
</html>`,

      'placeholder-nginx.conf': `events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    
    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    
    access_log /var/log/nginx/access.log main;
    error_log  /var/log/nginx/error.log warn;
    
    # Basic settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    
    server {
        listen 80;
        server_name _;
        
        root /usr/share/nginx/html;
        index index.html;
        
        # Health check endpoint
        location / {
            try_files $uri $uri/ =404;
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }
        
        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        
        # Gzip compression
        gzip on;
        gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    }
}`,

      'haproxy.cfg': `# Dynia HAProxy Configuration - HA Load Balancer
# Generated by Dynia CLI for cluster: {{CLUSTER_NAME}}
# Active Node: {{ACTIVE_NODE}} | Total Nodes: {{TOTAL_NODES}}

global
    daemon
    log stdout local0 info
    maxconn 4096
    stats timeout 2m
    
    # TLS Configuration
    ssl-default-bind-ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384
    ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets

defaults
    mode http
    log global
    option httplog
    option dontlognull
    option log-health-checks
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms
    retries 3

# HAProxy Stats Interface
listen stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 30s
    stats admin if TRUE
    stats show-legends
    stats show-node

# Frontend - Public Traffic Entry Point
frontend public_http
    bind *:80
    mode http
    
    # Redirect HTTP to HTTPS
    redirect scheme https code 301

frontend public_https  
    bind *:443 ssl crt /etc/ssl/certs/default.pem
    mode http
    
    # Host-based routing ACLs
{{HOST_ACLS}}
    
    # Default backend (fallback)
    default_backend cluster_backends

{{BACKENDS}}

# Default backend pool - all cluster nodes
backend cluster_backends
    mode http
    balance roundrobin
    option httpchk GET /healthz
    http-check expect status 200
    
{{BACKEND_SERVERS}}`,

      'system-haproxy.cfg': `# Dynia HAProxy Configuration - System Service
# Generated by Dynia CLI for cluster: {{CLUSTER_NAME}}
# Active Node: {{ACTIVE_NODE}} | Total Nodes: {{TOTAL_NODES}}

global
    daemon
    log 127.0.0.1:514 local0 info
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    maxconn 4096
    
    # TLS Configuration
    ssl-default-bind-ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384
    ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets
    

defaults
    mode http
    log global
    option httplog
    option dontlognull
    option log-health-checks
    option forwardfor
    option http-server-close
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms
    retries 3

# HAProxy Stats Interface (HTTP)
listen stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 30s
    stats admin if TRUE
    stats show-legends
    stats show-node
    stats auth admin:dynia-admin

# Frontend - Public HTTP Traffic (redirects to HTTPS)
frontend public_http
    bind {{RESERVED_IP}}:80
    mode http
    
    # Redirect HTTP to HTTPS 
    redirect scheme https code 301

# Frontend - Public HTTPS Traffic (SSL termination at HAProxy)
frontend public_https
    bind {{RESERVED_IP}}:443 ssl crt /etc/haproxy/certs/
    mode http
    
    # Security headers
    http-response set-header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    http-response set-header X-Frame-Options DENY
    http-response set-header X-Content-Type-Options nosniff
    http-response set-header X-XSS-Protection "1; mode=block"
    
    # Forward headers for backend services
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Forwarded-For %[src]
    
    # Host-based routing ACLs
{{HOST_ACLS}}
    
    # Default backend (load balance across cluster via VPC)
    default_backend cluster_backends

{{BACKENDS}}

# HTTP backend - forward to Caddy HTTP port after SSL termination
backend caddy_http_backend
    mode http
    balance roundrobin
    option httpchk GET /dynia-health
    http-check expect status 200
    
    # Enable compression
    compression algo gzip
    compression type text/html text/plain text/css text/javascript application/javascript application/json
    
    # Forward to local Caddy HTTP port
    server caddy-http 127.0.0.1:8080 check inter 5s fall 3 rise 2

# Legacy backend pool - all cluster nodes (for multi-node HA)
backend cluster_backends
    mode http
    balance roundrobin
    option httpchk GET /dynia-health
    http-check expect status 200
    
    # Enable compression
    compression algo gzip
    compression type text/html text/plain text/css text/javascript application/javascript application/json
    
{{BACKEND_SERVERS}}`,
    };

    const template = templates[templateName];
    if (!template) {
      throw new Error(`Template ${templateName} not found`);
    }

    return template;
  }

  /**
   * Load Docker file content (embedded)
   */
  private async loadDockerFile(fileName: string): Promise<string> {
    const dockerFiles: Record<string, string> = {
      'caddy-compose.yml': `version: '3.8'

services:
  caddy:
    image: caddy:2.7-alpine
    container_name: dynia-caddy
    ports:
      - "8080:80"      # HTTP port for HAProxy backends (HTTP-only mode)
      - "2019:2019"    # Caddy admin interface
    volumes:
      - /opt/dynia/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - edge
    restart: unless-stopped
    environment:
      - CADDY_ADMIN=0.0.0.0:2019
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/dynia-health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  caddy-data:
  caddy-config:

networks:
  edge:
    external: true`,

      'placeholder-compose.yml': `version: '3.8'

services:
  placeholder:
    image: nginx:alpine
    container_name: dynia-placeholder
    ports:
      - "8081:80"  # Use internal port 8081, nginx listens on 80 internally
    volumes:
      - /opt/dynia/placeholder/index.html:/usr/share/nginx/html/index.html:ro
      - /opt/dynia/placeholder/nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - edge
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  edge:
    external: true`,

      'haproxy-compose.yml': `version: '3.8'

services:
  haproxy:
    image: haproxy:2.8-alpine
    container_name: dynia-haproxy
    ports:
      - "80:80"
      - "443:443"
      - "8404:8404"  # HAProxy stats page
    volumes:
      - /opt/dynia/haproxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
      - /opt/dynia/haproxy/certs:/etc/ssl/certs:ro
    networks:
      - edge
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8404/stats"]
      interval: 30s
      timeout: 10s
      retries: 3
    sysctls:
      - net.ipv4.ip_unprivileged_port_start=0

networks:
  edge:
    external: true`,
    };

    const dockerFile = dockerFiles[fileName];
    if (!dockerFile) {
      throw new Error(`Docker file ${fileName} not found`);
    }

    return dockerFile;
  }

  /**
   * Test infrastructure health - two-sided validation (internal + public)
   */
  async testInfrastructure(): Promise<boolean> {
    try {
      this.logger.info('🔍 Starting comprehensive infrastructure health check...');

      // Phase 1: Internal Health Check
      const internalHealthy = await this.testInternalHealth();
      if (!internalHealthy) {
        this.logger.error('❌ Internal health check failed');
        return false;
      }

      // Phase 2: Public Health Check
      const publicHealthy = await this.testPublicHealth();
      if (!publicHealthy) {
        this.logger.error('❌ Public health check failed');
        return false;
      }

      this.logger.info('✅ Complete infrastructure health check passed (internal + public)');
      return true;
    } catch (error) {
      this.logger.error(`Infrastructure health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Test internal infrastructure health (containers, networking, services)
   */
  async testInternalHealth(): Promise<boolean> {
    try {
      this.logger.info('🔧 Phase 1: Testing internal infrastructure health...');

      // Step 1: Wait for containers to initialize
      this.logger.info('⏳ Waiting for containers to initialize (15 seconds)...');
      await Helpers.sleep(15000);

      // Step 2: Check container states and health with retry
      await Helpers.retry(
        async () => {
          // Check if directories exist and have docker-compose files
          try {
            await this.ssh.executeCommand('test -f /opt/dynia/caddy/docker-compose.yml || test -f /opt/dynia/caddy/compose.yml');
          } catch {
            throw new Error('Caddy docker compose file not found in /opt/dynia/caddy/');
          }

          try {
            await this.ssh.executeCommand('test -f /opt/dynia/placeholder/docker-compose.yml || test -f /opt/dynia/placeholder/compose.yml');
          } catch {
            throw new Error('Placeholder docker compose file not found in /opt/dynia/placeholder/');
          }

          // Get container status with better error handling
          let caddyStatus: string;
          let placeholderStatus: string;

          try {
            caddyStatus = await this.ssh.executeCommand('cd /opt/dynia/caddy && docker compose ps --format json');
          } catch (error) {
            throw new Error(`Failed to get Caddy container status: ${error}`);
          }

          try {
            placeholderStatus = await this.ssh.executeCommand('cd /opt/dynia/placeholder && docker compose ps --format json');
          } catch (error) {
            throw new Error(`Failed to get Placeholder container status: ${error}`);
          }

          this.logger.debug(`Caddy status: ${caddyStatus}`);
          this.logger.debug(`Placeholder status: ${placeholderStatus}`);

          // Parse container status with safer JSON parsing
          let caddyInfo: any = {};
          let placeholderInfo: any = {};

          try {
            const caddyTrimmed = caddyStatus.trim();
            if (caddyTrimmed && caddyTrimmed !== '') {
              caddyInfo = JSON.parse(caddyTrimmed);
            } else {
              throw new Error('Empty Caddy container status response');
            }
          } catch (error) {
            throw new Error(`Failed to parse Caddy container status: ${error}. Raw output: "${caddyStatus}"`);
          }

          try {
            const placeholderTrimmed = placeholderStatus.trim();
            if (placeholderTrimmed && placeholderTrimmed !== '') {
              placeholderInfo = JSON.parse(placeholderTrimmed);
            } else {
              throw new Error('Empty Placeholder container status response');
            }
          } catch (error) {
            throw new Error(`Failed to parse Placeholder container status: ${error}. Raw output: "${placeholderStatus}"`);
          }

          // Verify containers are running
          if (caddyInfo.State !== 'running') {
            throw new Error(`Caddy container not running: ${caddyInfo.State || 'unknown'}`);
          }

          if (placeholderInfo.State !== 'running') {
            throw new Error(`Placeholder container not running: ${placeholderInfo.State || 'unknown'}`);
          }

          // Check health status progression
          if (caddyInfo.Health === 'starting') {
            throw new Error('Caddy container still starting up');
          }

          if (placeholderInfo.Health === 'starting') {
            throw new Error('Placeholder container still starting up');
          }
        },
        {
          maxAttempts: 4,
          baseDelay: 3000, // 3 seconds
          maxDelay: 8000, // max 8 seconds
          description: 'Container readiness verification',
        }
      );

      // Step 3: Test internal service connectivity
      await Helpers.retry(
        async () => {
          // Test placeholder service directly
          await this.ssh.executeCommand('curl -f --connect-timeout 5 --max-time 10 http://localhost:80/ >/dev/null');
          this.logger.info('✅ Placeholder service responding on port 8080');

          // Test Caddy HTTP service
          await this.ssh.executeCommand(
            'curl -f --connect-timeout 5 --max-time 10 http://localhost:8080/dynia-health >/dev/null'
          );
          this.logger.info('✅ Caddy HTTP service responding');
        },
        {
          maxAttempts: 3,
          baseDelay: 2000, // 2 seconds
          maxDelay: 5000, // max 5 seconds
          description: 'Internal service connectivity test',
        }
      );

      this.logger.info('✅ Internal infrastructure health check passed');
      return true;
    } catch (error) {
      this.logger.error(`Internal health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Test public accessibility (DNS, HTTPS, end-to-end)
   */
  private async testPublicHealth(): Promise<boolean> {
    try {
      this.logger.info('🌐 Phase 2: Testing public accessibility...');

      const publicUrl = `https://${this.nodeName}.${this.domain}/`;

      // Step 1: Test DNS resolution from multiple resolvers
      this.logger.info('📡 Testing DNS resolution...');
      const resolvers = ['8.8.8.8', '1.1.1.1'];

      for (const resolver of resolvers) {
        await Helpers.retry(
          async () => {
            const result = await this.ssh.executeCommand(
              `nslookup ${this.nodeName}.${this.domain} ${resolver} | grep "Address:" | tail -1 | awk '{print $2}'`
            );
            const resolvedIp = result.trim();
            if (!resolvedIp || resolvedIp.includes('NXDOMAIN')) {
              throw new Error(`DNS resolution failed on ${resolver}`);
            }
            this.logger.info(`✅ DNS resolves correctly on ${resolver} → ${resolvedIp}`);
          },
          {
            maxAttempts: 3,
            baseDelay: 5000,
            maxDelay: 15000,
            description: `DNS resolution test (${resolver})`,
          }
        );
      }

      // Step 2: Test HTTPS endpoint with extensive retry (certificates take time)
      await Helpers.retry(
        async () => {
          // Test from the server itself (most reliable)
          await this.ssh.executeCommand(`curl -f --connect-timeout 15 --max-time 45 "${publicUrl}" >/dev/null`);
          this.logger.info('✅ HTTPS endpoint accessible from server');
        },
        {
          maxAttempts: 4, // Up to 4 attempts for cert generation
          baseDelay: 5000, // 5 seconds
          maxDelay: 15000, // max 15 seconds between attempts
          description: 'HTTPS endpoint accessibility test',
        }
      );

      // Step 3: Validate HTTPS certificate
      await Helpers.retry(
        async () => {
          const certCheck = await this.ssh.executeCommand(
            `openssl s_client -connect ${this.nodeName}.${this.domain}:443 -servername ${this.nodeName}.${this.domain} </dev/null 2>/dev/null | openssl x509 -noout -dates`
          );
          if (!certCheck.includes('notBefore') || !certCheck.includes('notAfter')) {
            throw new Error('Invalid SSL certificate');
          }
          this.logger.info('✅ SSL certificate is valid');
        },
        {
          maxAttempts: 3,
          baseDelay: 3000,
          maxDelay: 8000,
          description: 'SSL certificate validation',
        }
      );

      // Step 4: Test complete request/response cycle
      await this.ssh.executeCommand(`curl -f --connect-timeout 10 --max-time 30 "${publicUrl}" | grep -q "Dynia Node"`);
      this.logger.info('✅ Complete request/response cycle working with correct content');

      this.logger.info('✅ Public accessibility health check passed');
      return true;
    } catch (error) {
      this.logger.error(`Public health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Deploy placeholder service for testing (enhanced for cluster deploy)
   */
  async deployPlaceholderService(domain: string, healthPath: string = '/healthz'): Promise<void> {
    this.logger.info(`Deploying placeholder service for domain: ${domain}`);

    // Create placeholder directories
    await this.ssh.executeCommand('mkdir -p /opt/dynia/services/placeholder');

    // Generate simple placeholder HTML with node identification
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dynia Placeholder</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            margin-top: 50px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
            font-size: 2rem;
        }
        .node-info {
            color: #666;
            font-size: 1.2rem;
            font-weight: bold;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <h1>No applications deployed. Ready for cluster deployments.</h1>
    <p class="node-info">(Served from node: ${this.nodeName})</p>
</body>
</html>`;

    await this.ssh.copyContent(indexHtml, '/opt/dynia/services/placeholder/index.html');

    // Generate health endpoint
    const healthJson = JSON.stringify({
      status: 'healthy',
      service: 'dynia-placeholder',
      domain: domain,
      node: this.nodeName,
      timestamp: new Date().toISOString(),
      checks: {
        dns: 'ok',
        tls: 'ok',
        routing: 'ok',
        docker: 'ok'
      }
    }, null, 2);

    await this.ssh.copyContent(healthJson, '/opt/dynia/services/placeholder/health.json');

    // Create enhanced nginx config for placeholder
    const nginxConfig = `server {
    listen 80;
    server_name _;
    
    location / {
        root /usr/share/nginx/html;
        index index.html;
    }
    
    location ${healthPath} {
        alias /usr/share/nginx/html/health.json;
        add_header Content-Type application/json;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
    
    location /dynia-health {
        return 200 "{\\"status\\": \\"healthy\\", \\"nodeId\\": \\"${this.nodeName}\\", \\"service\\": \\"placeholder\\", \\"timestamp\\": \\"$time_iso8601\\", \\"loadBalancer\\": \\"HAProxy\\"}";
        add_header Content-Type application/json;
    }
}`;

    await this.ssh.copyContent(nginxConfig, '/opt/dynia/services/placeholder/nginx.conf');

    // Create docker-compose.yml for placeholder
    const dockerCompose = `version: '3.8'
services:
  placeholder:
    image: nginx:alpine
    container_name: dynia-placeholder
    restart: unless-stopped
    ports:
      - "8081:80"
    volumes:
      - ./index.html:/usr/share/nginx/html/index.html:ro
      - ./health.json:/usr/share/nginx/html/health.json:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost${healthPath}"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - edge

networks:
  edge:
    external: true`;

    await this.ssh.copyContent(dockerCompose, '/opt/dynia/services/placeholder/docker-compose.yml');

    // Start placeholder service
    await this.ssh.executeCommand('cd /opt/dynia/services/placeholder && docker compose up -d');

    // Update Caddy configuration to route to placeholder
    await this.updateCaddyConfig(domain, 'localhost:8081', healthPath);

    this.logger.info('✅ Placeholder service deployed and configured');
  }

  /**
   * Deploy custom service from docker-compose file
   */
  async deployCustomService(composePath: string, domain: string, healthPath: string = '/healthz'): Promise<void> {
    this.logger.info(`Deploying custom service for domain: ${domain}`);

    // Create service directory
    const serviceName = domain.replace(/\./g, '-');
    const serviceDir = `/opt/dynia/services/${serviceName}`;
    
    await this.ssh.executeCommand(`mkdir -p ${serviceDir}`);

    // Copy compose file to remote server
    await this.ssh.copyFile(composePath, `${serviceDir}/docker-compose.yml`);

    // Start custom service
    await this.ssh.executeCommand(`cd ${serviceDir} && docker compose up -d`);

    // TODO: Parse compose file to detect service port (for now assume 8080)
    // This would need compose file parsing to detect the exposed port
    const servicePort = '8080';
    
    // Update Caddy configuration to route to custom service
    await this.updateCaddyConfig(domain, `localhost:${servicePort}`, healthPath);

    this.logger.info('✅ Custom service deployed and configured');
  }

  /**
   * Generate complete Caddyfile configuration based on cluster routes
   */
  async generateCompleteCaddyfile(clusterRoutes: Array<{host: string; healthPath?: string}>): Promise<void> {
    this.logger.info('Generating complete Caddyfile configuration from cluster routes...');

    // Generate Caddy blocks for all cluster routes
    const routeBlocks = clusterRoutes.map(route => {
      const healthPath = route.healthPath || '/healthz';
      return `${route.host} {
    reverse_proxy dynia-placeholder:80
    
    # Health check endpoint
    handle_path /dynia-health {
        header Content-Type application/json
        respond "{\\"status\\": \\"healthy\\", \\"domain\\": \\"${route.host}\\", \\"node\\": \\"${this.nodeName}\\"}" 200
    }
    
    # Security headers
    header {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        X-XSS-Protection "1; mode=block"
    }
    
    # Enable compression
    encode zstd gzip
    
    # Logging
    log {
        output file /var/log/caddy/access.log
        format json
    }
}`;
    }).join('\n\n');

    // Generate complete Caddyfile with HTTP-only mode (tlsMode 1: haproxy-origin)
    const completeCaddyfile = `# Dynia Caddyfile - HTTP-only mode (tlsMode 1: haproxy-origin)  
# HAProxy handles SSL termination, Caddy serves HTTP only
# This file is automatically generated and updated by Dynia

{
    auto_https off
    admin off
}

:80 {
    # Health check endpoint for HAProxy
    handle_path /dynia-health {
        header Content-Type application/json
        respond "{\\"status\\": \\"healthy\\", \\"node\\": \\"${this.nodeName}\\"}" 200
    }
    
${clusterRoutes.map(route => {
  return `    # Route for ${route.host}
    @host_${route.host.replace(/\./g, '_dot_').replace(/-/g, '_dash_')} host ${route.host}
    handle @host_${route.host.replace(/\./g, '_dot_').replace(/-/g, '_dash_')} {
        reverse_proxy dynia-placeholder:80
        header {
            X-Frame-Options DENY
            X-Content-Type-Options nosniff
        }
    }`;
}).join('\n\n')}
    
    # Default response for unmatched hosts
    respond 404
    
    # Logging  
    log {
        output file /var/log/caddy/access.log
        format json
    }
}

`;

    const caddyfilePath = '/opt/dynia/caddy/Caddyfile';
    
    try {
      // Write complete Caddyfile (replacing any existing configuration)
      await this.ssh.copyContent(completeCaddyfile, caddyfilePath);
      
      // Use enhanced container restart with fallback and validation
      await this.attemptContainerRestart();
      await this.validateReverseProxy(clusterRoutes);
      
      this.logger.info(`✅ Complete Caddyfile generated and verified with ${clusterRoutes.length} route(s)`);
      
    } catch (error) {
      this.logger.error(`❌ Container restart/validation failed: ${error}`);
      throw error; // Propagate the error instead of silent failure
    }
  }

  /**
   * Update Caddy configuration to route domain to target service (legacy method)
   * @deprecated Use generateCompleteCaddyfile for better state management
   */
  private async updateCaddyConfig(domain: string, targetService: string, healthPath: string): Promise<void> {
    this.logger.info(`Updating Caddy config: ${domain} → ${targetService}`);

    // For backward compatibility, generate a single-route Caddyfile
    await this.generateCompleteCaddyfile([{host: domain, healthPath}]);
  }

  /**
   * Generate Cloudflare Origin Certificate automatically via API
   * Implements tlsMode 1: haproxy-origin certificate management
   */
  private async generateCloudflareOriginCertificate(domain: string): Promise<void> {
    this.logger.info(`Generating Cloudflare Origin Certificate for *.${domain}...`);

    const keyPath = `/etc/haproxy/certs/${domain}.key`;
    const csrPath = `/etc/haproxy/certs/${domain}.csr`;
    const certPath = `/etc/haproxy/certs/${domain}.crt`;
    const pemPath = `/etc/haproxy/certs/${domain}.pem`;

    // Step 1: Generate private key and CSR on the target node
    await this.ssh.executeCommand(`
      openssl req -new -newkey rsa:2048 -nodes \\
        -keyout ${keyPath} \\
        -out ${csrPath} \\
        -subj "/CN=*.${domain}"
    `);

    // Step 2: Read CSR content and prepare for API
    const csrContent = await this.ssh.executeCommand(`cat ${csrPath}`);
    
    // Step 3: Call Cloudflare Origin CA API
    const certificateContent = await this.callCloudflareOriginAPI(domain, csrContent.trim());
    
    // Step 4: Write certificate to file
    await this.ssh.copyContent(certificateContent, certPath);
    
    // Step 5: Create HAProxy-format PEM file (cert + key)
    await this.ssh.executeCommand(`
      cat ${certPath} ${keyPath} > ${pemPath} &&
      chmod 600 ${pemPath} ${keyPath} ${certPath} &&
      chown root:root ${pemPath} ${keyPath} ${certPath}
    `);

    // Step 6: Verify certificate was created successfully
    await this.ssh.executeCommand(`openssl x509 -in ${certPath} -text -noout | head -10`);
    
    // Step 7: Clean up intermediate files to avoid HAProxy conflicts
    await this.ssh.executeCommand(`rm -f ${csrPath}`);
    this.logger.info('Cleaned up intermediate certificate files');
    
    this.logger.info(`✅ Origin Certificate installed: ${pemPath}`);
  }

  /**
   * Call Cloudflare Origin CA API to generate certificate from CSR
   */
  private async callCloudflareOriginAPI(domain: string, csrContent: string): Promise<string> {
    this.logger.info('Calling Cloudflare Origin CA API...');

    // Get the Cloudflare User Service Key from environment
    const cfApiKey = process.env.DYNIA_CF_API_KEY;
    
    if (!cfApiKey) {
      throw new Error('DYNIA_CF_API_KEY environment variable is required for Origin Certificate generation');
    }

    // Create the JSON payload - CSR content will be properly escaped by JSON.stringify
    const jsonPayload = {
      hostnames: [`*.${domain}`],
      request_type: 'origin-rsa',
      requested_validity: '5475', // ~15 years (must be string per Cloudflare API docs)
      csr: csrContent.trim()  // JSON.stringify will handle \n escaping automatically
    };

    // Write JSON payload to a temporary file using printf for better reliability
    const tempFile = `/tmp/cf-api-payload-${Date.now()}.json`;
    const jsonString = JSON.stringify(jsonPayload);
    await this.ssh.executeCommand(`printf '%s' '${jsonString.replace(/'/g, "'\\''")}' > ${tempFile}`);

    // Use correct Cloudflare Origin CA API authentication (User Service Key)
    const apiCall = `curl -sX POST https://api.cloudflare.com/client/v4/certificates \\
      -H "Content-Type: application/json" \\
      -H "X-Auth-User-Service-Key: ${cfApiKey}" \\
      -d @${tempFile}`;

    const response = await this.ssh.executeCommand(apiCall);

    // Clean up temporary file
    await this.ssh.executeCommand(`rm -f ${tempFile}`);
    
    // Debug: Log the actual API response
    this.logger.debug(`Cloudflare API raw response: ${response}`);
    
    let apiResponse;
    try {
      apiResponse = JSON.parse(response);
    } catch (error) {
      throw new Error(`Invalid API response: ${response}`);
    }

    // Debug: Log parsed response
    this.logger.debug(`Cloudflare API parsed response: ${JSON.stringify(apiResponse, null, 2)}`);

    if (!apiResponse.success) {
      const errors = apiResponse.errors?.map((e: any) => e.message).join(', ') || 'Unknown error';
      throw new Error(`Cloudflare API error: ${errors}`);
    }

    if (!apiResponse.result?.certificate) {
      throw new Error('No certificate returned from Cloudflare API');
    }

    this.logger.info('✅ Certificate received from Cloudflare Origin CA');
    return apiResponse.result.certificate;
  }

  /**
   * Ensure certificate directories exist with proper permissions
   */
  async ensureCertificateDirectories(): Promise<void> {
    this.logger.info('Setting up certificate directories...');
    
    // Create directories for certificates and backups
    await this.ssh.executeCommand('mkdir -p /etc/haproxy/certs /etc/haproxy/backup /etc/ssl/private');

    // Set up certificate directory with proper permissions
    await this.ssh.executeCommand('chmod 700 /etc/haproxy/certs');
    
    this.logger.info('✅ Certificate directories configured');
  }

  /**
   * Provision Cloudflare Origin Certificate for the domain
   * This is independent of HAProxy installation
   */
  async provisionCloudflareOriginCertificate(domain: string): Promise<void> {
    this.logger.info(`Provisioning Cloudflare Origin Certificate for *.${domain}...`);
    
    try {
      await this.generateCloudflareOriginCertificate(domain);
      this.logger.info('✅ Cloudflare Origin Certificate provisioned successfully');
    } catch (error) {
      this.logger.warn(`⚠️ Cloudflare Origin Certificate generation failed: ${error}`);
      this.logger.info('Falling back to self-signed certificate');
      await this.generateFallbackCertificate(domain);
    }
  }

  /**
   * Generate self-signed certificate as fallback
   */
  async generateFallbackCertificate(domain: string): Promise<void> {
    this.logger.info(`Generating fallback self-signed certificate for *.${domain}...`);
    
    await this.ssh.executeCommand(`
      cd /etc/haproxy/certs &&
      openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
        -keyout ${domain}.key -out ${domain}.crt \\
        -subj "/C=US/ST=State/L=City/O=Dynia/CN=*.${domain}" && 
      cat ${domain}.crt ${domain}.key > ${domain}.pem &&
      chmod 600 ${domain}.pem &&
      rm -f ${domain}.key ${domain}.crt ${domain}.csr &&
      ls -la ${domain}.pem
    `);
    
    this.logger.info('✅ Fallback self-signed certificate generated');
  }

  /**
   * Validate that certificates are properly installed
   */
  async validateCertificateInstallation(domain: string): Promise<{ isValid: boolean; isCloudflare: boolean; expiryDays: number }> {
    const certPath = `/etc/haproxy/certs/${domain}.crt`;
    const pemPath = `/etc/haproxy/certs/${domain}.pem`;
    
    try {
      // Check if certificate files exist
      await this.ssh.executeCommand(`test -f ${certPath} && test -f ${pemPath}`);
      
      // Get certificate info
      const certInfo = await this.ssh.executeCommand(`openssl x509 -in ${certPath} -noout -subject -issuer -dates`);
      
      // Check if it's a Cloudflare certificate (issuer contains "Cloudflare")
      const isCloudflare = certInfo.includes('Cloudflare');
      const isSelfSigned = certInfo.includes('issuer=C = US, ST = State, L = City, O = Dynia');
      
      // Calculate days until expiry
      const expiryMatch = certInfo.match(/notAfter=(.+)/);
      let expiryDays = 0;
      
      if (expiryMatch) {
        const expiryDate = new Date(expiryMatch[1]);
        const now = new Date();
        expiryDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      return {
        isValid: true,
        isCloudflare: isCloudflare,
        expiryDays: expiryDays
      };
      
    } catch (error) {
      this.logger.warn(`Certificate validation failed: ${error}`);
      return {
        isValid: false,
        isCloudflare: false,
        expiryDays: 0
      };
    }
  }

  /**
   * Enhanced container restart with fallback recreation and validation
   */
  private async attemptContainerRestart(): Promise<void> {
    // Try 1: Simple restart (what we had before)
    try {
      await this.ssh.executeCommand('cd /opt/dynia/caddy && docker compose restart caddy');
      await this.waitForContainerHealth();
      this.logger.info('✅ Container restarted successfully');
      return;
    } catch (error) {
      this.logger.warn(`Container restart failed: ${error}, attempting recreation...`);
    }

    // Try 2: Force recreation (what fixed the issue manually)
    try {
      await this.ssh.executeCommand('docker stop dynia-caddy && docker rm dynia-caddy');
      await this.ssh.executeCommand('cd /opt/dynia/caddy && docker compose up -d');
      await this.waitForContainerHealth();
      this.logger.info('✅ Container recreated successfully');
      return;
    } catch (error) {
      throw new Error(`Both restart and recreation failed: ${error}`);
    }
  }

  /**
   * Wait for container to become healthy and running
   */
  private async waitForContainerHealth(): Promise<void> {
    await Helpers.retry(
      async () => {
        const statusResult = await this.ssh.executeCommand('docker ps --filter name=dynia-caddy --format json');
        const statusTrimmed = statusResult.trim();
        
        if (!statusTrimmed) {
          throw new Error('Container not found');
        }
        
        const container = JSON.parse(statusTrimmed);
        if (container.State !== 'running') {
          throw new Error(`Container not running: ${container.State || 'unknown'}`);
        }
        
        // Additional check: ensure container is actually responding
        await this.ssh.executeCommand('docker exec dynia-caddy echo "health check"');
      },
      {
        maxAttempts: 3,
        baseDelay: 2000,
        maxDelay: 5000,
        description: 'Container health validation',
      }
    );
  }

  /**
   * Validate that reverse proxy is actually working for the configured routes
   */
  private async validateReverseProxy(clusterRoutes: Array<{host: string; healthPath?: string}>): Promise<void> {
    // Test the health endpoint first (should always work)
    try {
      await this.ssh.executeCommand(
        'curl -f --connect-timeout 5 --max-time 10 http://localhost:8080/dynia-health'
      );
    } catch (error) {
      throw new Error(`Caddy health endpoint not responding: ${error}`);
    }

    // Test each configured route
    for (const route of clusterRoutes) {
      try {
        const testResult = await this.ssh.executeCommand(
          `curl -f --connect-timeout 5 --max-time 10 -H 'Host: ${route.host}' http://localhost:8080/ | head -1`
        );
        
        // Verify we get HTML content, not just plain text
        if (!testResult.includes('DOCTYPE html') && !testResult.includes('<html')) {
          throw new Error(`Route ${route.host} not serving HTML content: ${testResult.substring(0, 100)}`);
        }
        
      } catch (error) {
        throw new Error(`Reverse proxy test failed for ${route.host}: ${error}`);
      }
    }
    
    this.logger.info(`✅ Reverse proxy validated for ${clusterRoutes.length} route(s)`);
  }

  /**
   * Ensure certificates are provisioned for the domain
   * This method is idempotent and can be called multiple times safely
   */
  async ensureCertificates(domain: string): Promise<void> {
    this.logger.info(`Ensuring certificates are provisioned for *.${domain}...`);
    
    // Step 1: Ensure directories exist
    await this.ensureCertificateDirectories();
    
    // Step 2: Check existing certificates
    const certStatus = await this.validateCertificateInstallation(domain);
    
    if (certStatus.isValid) {
      if (certStatus.isCloudflare) {
        this.logger.info(`✅ Valid Cloudflare Origin Certificate found (expires in ${certStatus.expiryDays} days)`);
      } else {
        this.logger.warn(`⚠️ Self-signed certificate found (expires in ${certStatus.expiryDays} days)`);
        this.logger.info('Attempting to upgrade to Cloudflare Origin Certificate...');
        await this.provisionCloudflareOriginCertificate(domain);
      }
    } else {
      this.logger.info('No valid certificates found, provisioning new certificates...');
      await this.provisionCloudflareOriginCertificate(domain);
    }
    
    // Step 3: Final validation
    const finalStatus = await this.validateCertificateInstallation(domain);
    if (finalStatus.isValid) {
      const certType = finalStatus.isCloudflare ? 'Cloudflare Origin' : 'Self-signed';
      this.logger.info(`✅ Certificate provisioning complete: ${certType} certificate installed`);
    } else {
      throw new Error('Certificate provisioning failed - no valid certificates found');
    }
  }
}
