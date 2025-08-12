import { BaseCommand } from '../../shared/base/base-command.js';
import { NodeNameSchema, HealthPathSchema, ValidationUtils } from '../../shared/utils/validation.js';
import { Helpers } from '../../shared/utils/helpers.js';
import { DockerInfrastructure } from '../../shared/utils/docker-infrastructure.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import { createCloudflareProvider } from '../../core/providers/cloudflare-provider.js';
import type { Node } from '../../shared/types/index.js';

/**
 * Options for node create command
 */
export interface NodeCreateOptions {
  name: string;
  number?: number;
  healthPath?: string;
}

/**
 * Command to create a new node
 * Implements the complete node creation flow from the specification
 */
export class NodeCreateCommand extends BaseCommand<NodeCreateOptions> {
  protected async run(): Promise<void> {
    const { name, number, healthPath = '/' } = this.argv;

    // Generate final node name
    const finalNodeName = number ? `${name}-${number}` : name;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name']);
    NodeNameSchema.parse(name); // Validate base name
    if (number !== undefined) {
      if (!Number.isInteger(number) || number < 1) {
        throw new Error('Node number must be a positive integer');
      }
    }
    NodeNameSchema.parse(finalNodeName); // Validate final node name
    HealthPathSchema.parse(healthPath);

    // Check if final node name is already in use
    const existingNodes = await this.stateManager.getNodes();
    ValidationUtils.validateNodeNameAvailable(finalNodeName, existingNodes.map(n => n.name));

    this.logger.info(`Creating node: ${finalNodeName}`);

    // Step 1: Create DigitalOcean droplet
    const dropletInfo = await this.createDroplet(finalNodeName);
    await this.saveProgressiveNodeState(finalNodeName, dropletInfo.ip, healthPath, 'droplet-created');
    
    // Step 2: Create/update Cloudflare DNS A record
    await this.createDnsRecord(finalNodeName, dropletInfo.ip);
    await this.saveProgressiveNodeState(finalNodeName, dropletInfo.ip, healthPath, 'dns-configured');
    
    // Step 3: Wait for DNS propagation
    await this.waitForDnsPropagation(finalNodeName, dropletInfo.ip);
    await this.saveProgressiveNodeState(finalNodeName, dropletInfo.ip, healthPath, 'dns-ready');
    
    // Step 4: Set up Docker infrastructure (Caddy + placeholder)
    await this.setupDockerInfrastructure(finalNodeName, dropletInfo.ip);
    await this.saveProgressiveNodeState(finalNodeName, dropletInfo.ip, healthPath, 'infrastructure-ready');
    
    // Step 5: Final state update
    await this.saveProgressiveNodeState(finalNodeName, dropletInfo.ip, healthPath, 'active');

    this.logger.info(`✅ Node ${finalNodeName} created successfully`);
    this.logger.info(`   IP: ${dropletInfo.ip}`);
    this.logger.info(`   FQDN: ${finalNodeName}.${this.config.public.cloudflare.domain}`);
    this.logger.info(`   Health Path: ${healthPath}`);
  }

  /**
   * Create DigitalOcean droplet
   */
  private async createDroplet(name: string): Promise<{ id: string; ip: string }> {
    this.logger.info('Creating DigitalOcean droplet...');
    
    if (this.dryRun) {
      this.logDryRun(`create DigitalOcean droplet named ${name}`);
      return { id: 'mock-id', ip: '203.0.113.10' };
    }

    // Create DigitalOcean provider with secret token
    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    // Create the droplet
    const droplet = await doProvider.createDroplet({
      name,
      region: this.config.public.digitalOcean.region,
      size: this.config.public.digitalOcean.size,
      image: 'ubuntu-22-04-x64', // Latest Ubuntu LTS
      sshKeys: [this.config.secrets.sshKeyId],
    });

    // Wait for it to become active
    const activeDroplet = await doProvider.waitForDropletActive(droplet.id);
    
    return {
      id: activeDroplet.id,
      ip: activeDroplet.ip,
    };
  }

  /**
   * Create/update Cloudflare DNS A record
   */
  private async createDnsRecord(name: string, ip: string): Promise<void> {
    const fqdn = `${name}.${this.config.public.cloudflare.domain}`;
    this.logger.info(`Creating DNS A record: ${fqdn} → ${ip}`);
    
    if (this.dryRun) {
      this.logDryRun(`create DNS A record ${fqdn} pointing to ${ip}`);
      return;
    }

    // Create Cloudflare provider with secret token
    const cfProvider = createCloudflareProvider(
      this.config.secrets.cloudflareToken,
      this.config.secrets.cloudflareZoneId,
      this.logger
    );

    // Create/update the A record
    await cfProvider.upsertARecord({
      name: fqdn,
      ip,
      ttl: 300, // 5 minutes
      proxied: false, // Keep DNS-only for ACME cert issuance
    });

    this.logger.info(`✅ DNS A record created: ${fqdn} → ${ip}`);
  }

  /**
   * Check DNS propagation (non-blocking)
   */
  private async waitForDnsPropagation(name: string, expectedIp: string): Promise<void> {
    const fqdn = `${name}.${this.config.public.cloudflare.domain}`;
    this.logger.info(`Checking DNS propagation: ${fqdn}`);
    
    if (this.dryRun) {
      this.logDryRun(`check DNS propagation of ${fqdn}`);
      return;
    }

    // Create Cloudflare provider to handle DNS propagation checking
    const cfProvider = createCloudflareProvider(
      this.config.secrets.cloudflareToken,
      this.config.secrets.cloudflareZoneId,
      this.logger
    );

    // Check DNS propagation but don't block on failure (like node repair does)
    try {
      await cfProvider.waitForDnsPropagation(fqdn, expectedIp, 30000); // Shorter timeout: 30 seconds
      this.logger.info(`✅ DNS propagation verified for ${fqdn}`);
    } catch (error) {
      this.logger.warn(`DNS propagation not yet complete for ${fqdn}: ${error}`);
      this.logger.info(`ℹ️  Continuing with infrastructure setup - Caddy will handle certificate generation`);
    }
  }

  /**
   * Set up Docker infrastructure (network, Caddy, placeholder)
   */
  private async setupDockerInfrastructure(name: string, ip: string): Promise<void> {
    this.logger.info('Setting up Docker infrastructure...');
    
    if (this.dryRun) {
      this.logDryRun('setup Docker network, Caddy, and placeholder containers');
      return;
    }

    const infrastructure = new DockerInfrastructure(
      ip,
      name,
      this.config.public.cloudflare.domain,
      this.logger
    );

    // Deploy complete infrastructure
    await infrastructure.setupInfrastructure();

    // Test that everything is working
    const healthCheck = await infrastructure.testInfrastructure();
    if (!healthCheck) {
      throw new Error('Infrastructure health check failed after deployment');
    }
    
    this.logger.info('✅ Infrastructure health check passed - node is fully operational');
  }

  /**
   * Save progressive node state during creation
   */
  private async saveProgressiveNodeState(
    name: string, 
    ip: string, 
    healthPath: string, 
    status: 'droplet-created' | 'dns-configured' | 'dns-ready' | 'infrastructure-ready' | 'active'
  ): Promise<void> {
    // Check if node already exists to preserve createdAt timestamp
    const existingNodes = await this.stateManager.getNodes();
    const existingNode = existingNodes.find(n => n.name === name);
    
    const node: Node = {
      name,
      ip,
      fqdn: `${name}.${this.config.public.cloudflare.domain}`,
      createdAt: existingNode?.createdAt || Helpers.generateTimestamp(),
      status,
      healthPath,
      caddy: {
        domain: `${name}.${this.config.public.cloudflare.domain}`,
        target: {
          service: 'placeholder',
          port: 8080,
        },
      },
    };

    await this.conditionalExecute(
      () => this.stateManager.upsertNode(node),
      `save node ${name} to state (status: ${status})`
    );
    
    this.logger.info(`💾 Node state saved: ${status}`);
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    // Additional validation for node creation
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required');
    }
    
    if (!this.config.secrets.cloudflareToken) {
      throw new Error('DYNIA_CF_TOKEN environment variable is required');
    }
    
    if (!this.config.secrets.cloudflareZoneId) {
      throw new Error('DYNIA_CF_ZONE_ID environment variable is required');
    }
    
    if (!this.config.secrets.sshKeyId) {
      throw new Error('DYNIA_SSH_KEY_ID environment variable is required');
    }
  }
}