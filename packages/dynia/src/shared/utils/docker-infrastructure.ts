import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ILogger } from '@thaitype/core-utils';

import { SSHExecutor } from './ssh.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
   * Complete infrastructure setup on the remote node
   */
  async setupInfrastructure(): Promise<void> {
    this.logger.info('Setting up Docker infrastructure...');

    // Step 1: Wait for SSH connection
    await this.ssh.waitForConnection();

    // Step 2: Install Docker
    await this.installDocker();

    // Step 3: Deploy Caddy
    await this.deployCaddy();

    // Step 4: Deploy placeholder service
    await this.deployPlaceholder();

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
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

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

    // Create Caddy directories and files
    await this.ssh.executeCommand('mkdir -p /opt/dynia/caddy /var/log/caddy');

    // Generate Caddyfile from template
    const caddyfileTemplate = await this.loadTemplate('Caddyfile.template');
    const caddyfile = caddyfileTemplate
      .replace(/{{DOMAIN}}/g, `${this.nodeName}.${this.domain}`)
      .replace(/{{TARGET_SERVICE}}/g, 'placeholder')
      .replace(/{{TARGET_PORT}}/g, '8080')
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
      'Caddyfile.template': `# Dynia Caddyfile - managed by Dynia CLI
# This file is automatically generated and updated by Dynia

{{DOMAIN}} {
    reverse_proxy http://{{TARGET_SERVICE}}:{{TARGET_PORT}}
    
    # Health check endpoint (optional)
    handle_path /dynia-health {
        respond "Dynia Node: {{NODE_NAME}} - OK" 200
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
}

# Admin API (localhost only)
:2019 {
    respond /config/* 200
    respond 404
}`,

      'placeholder-index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dynia Node - {{NODE_NAME}}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            margin: 0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 3rem;
            max-width: 500px;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            font-weight: 300;
        }
        .node-name {
            font-size: 1.2rem;
            opacity: 0.8;
            margin-bottom: 2rem;
        }
        .status {
            background: rgba(34, 197, 94, 0.2);
            border: 1px solid rgba(34, 197, 94, 0.4);
            border-radius: 10px;
            padding: 1rem;
            margin: 1rem 0;
        }
        .timestamp {
            font-size: 0.9rem;
            opacity: 0.7;
            margin-top: 2rem;
        }
        .logo {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🚀</div>
        <h1>Dynia Node</h1>
        <div class="node-name">{{NODE_NAME}}.{{DOMAIN}}</div>
        <div class="status">
            ✅ Node is ready and waiting for deployment
        </div>
        <div class="timestamp">
            Node created: {{CREATED_AT}}
        </div>
    </div>
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
        listen 8080;
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
}`
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
      - "80:80"
      - "443:443"
      - "443:443/udp"  # For HTTP/3
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
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:2019/config/"]
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
    volumes:
      - /opt/dynia/placeholder/index.html:/usr/share/nginx/html/index.html:ro
      - /opt/dynia/placeholder/nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - edge
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  edge:
    external: true`
    };

    const dockerFile = dockerFiles[fileName];
    if (!dockerFile) {
      throw new Error(`Docker file ${fileName} not found`);
    }
    
    return dockerFile;
  }

  /**
   * Test infrastructure health
   */
  async testInfrastructure(): Promise<boolean> {
    try {
      this.logger.info('Testing infrastructure health...');

      // Check if services are running
      const caddyStatus = await this.ssh.executeCommand('cd /opt/dynia/caddy && docker compose ps --format json');
      const placeholderStatus = await this.ssh.executeCommand('cd /opt/dynia/placeholder && docker compose ps --format json');

      this.logger.debug(`Caddy status: ${caddyStatus}`);
      this.logger.debug(`Placeholder status: ${placeholderStatus}`);

      // Test placeholder service locally
      await this.ssh.executeCommand('curl -f http://localhost:8080/ >/dev/null');

      this.logger.info('✅ Infrastructure health check passed');
      return true;
    } catch (error) {
      this.logger.error(`Infrastructure health check failed: ${error}`);
      return false;
    }
  }
}