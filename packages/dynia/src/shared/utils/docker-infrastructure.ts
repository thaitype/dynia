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

    // Copy Docker installation script
    const scriptPath = resolve(__dirname, '../scripts/install-docker.sh');
    const scriptContent = await readFile(scriptPath, 'utf-8');
    
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
   * Load template file content
   */
  private async loadTemplate(templateName: string): Promise<string> {
    const templatePath = resolve(__dirname, '../templates', templateName);
    return await readFile(templatePath, 'utf-8');
  }

  /**
   * Load Docker file content
   */
  private async loadDockerFile(fileName: string): Promise<string> {
    const dockerPath = resolve(__dirname, '../docker', fileName);
    return await readFile(dockerPath, 'utf-8');
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