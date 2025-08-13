import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { Helpers } from '../../shared/utils/helpers.js';
import { TwoWordNameGenerator } from '../../shared/utils/two-word-generator.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import { createCloudflareProvider } from '../../core/providers/cloudflare-provider.js';
import { ReservedIpService } from '../../shared/services/reserved-ip-service.js';
import { NodePreparationService } from '../../shared/services/node-preparation-service.js';
import type { Cluster, ClusterNode } from '../../shared/types/index.js';

/**
 * Options for cluster create-ha command
 */
export interface ClusterCreateHaOptions {
  name: string;
  region?: string;
  size?: string;
  'base-domain': string; // Use kebab-case to match yargs
}

/**
 * Command to create a new HA cluster
 * Implements the complete cluster creation flow with Reserved IP and first node
 */
export class ClusterCreateHaCommand extends BaseCommand<ClusterCreateHaOptions> {
  protected async run(): Promise<void> {
    const { 
      name, 
      region = this.config.public.digitalOcean.region,
      size = this.config.public.digitalOcean.size,
      'base-domain': baseDomain 
    } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name', 'base-domain']);
    
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
      throw new Error('Cluster name must be lowercase, start with letter, and contain only letters, numbers, and hyphens');
    }

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(baseDomain)) {
      throw new Error('Base domain must be a valid domain name (e.g., example.com)');
    }

    // Check if cluster already exists
    const existingCluster = await this.stateManager.getCluster(name);
    if (existingCluster) {
      throw new Error(`Cluster '${name}' already exists. Use a different name or destroy the existing cluster first.`);
    }

    this.logger.info(`Creating HA cluster: ${name} with base domain ${baseDomain}`);

    // Step 1: Create VPC (for private networking)
    const vpcInfo = await this.createVpc(name, region);
    
    // Step 2: Generate first node ID
    const existingNodes = await this.stateManager.getAllClusterNodes();
    const existingNames = existingNodes.map(n => n.twoWordId);
    const firstNodeId = TwoWordNameGenerator.generate(existingNames);
    
    // Step 3: Create first droplet
    const dropletInfo = await this.createFirstNode(name, firstNodeId, region, size, vpcInfo.id);
    
    // Step 4: Assign Reserved IP to droplet using shared service
    const reservedIpInfo = await this.assignReservedIpToDroplet(dropletInfo.id, region);
    
    // Step 5: Prepare first node infrastructure (Docker + Caddy + keepalived)
    await this.prepareFirstNode(dropletInfo, baseDomain, name, region, reservedIpInfo);
    
    // Step 6: Save cluster state
    const cluster: Cluster = {
      name,
      baseDomain,
      reservedIp: reservedIpInfo.ip,
      reservedIpId: reservedIpInfo.id,
      region,
      vpcId: vpcInfo.id,
      size,
      activeNodeId: firstNodeId,
      createdAt: Helpers.generateTimestamp(),
    };

    await this.conditionalExecute(
      () => this.stateManager.upsertCluster(cluster),
      `save cluster ${name} to state`
    );
    
    // Step 6: Save first cluster node state
    const clusterNode: ClusterNode = {
      twoWordId: firstNodeId,
      clusterId: name,
      dropletId: dropletInfo.id,
      hostname: `${name}-${firstNodeId}`,
      publicIp: dropletInfo.ip,
      privateIp: undefined, // Will be populated when VPC networking is set up
      role: 'active',
      priority: 150, // High priority for first node
      status: 'provisioning',
      createdAt: Helpers.generateTimestamp(),
    };

    await this.conditionalExecute(
      () => this.stateManager.upsertClusterNode(clusterNode),
      `save cluster node ${firstNodeId} to state`
    );

    // Success summary
    this.logger.info(`✅ HA cluster ${name} created successfully`);
    this.logger.info(`   Reserved IP: ${reservedIpInfo.ip}`);
    this.logger.info(`   First node: ${firstNodeId} (${dropletInfo.ip})`);
    this.logger.info(`   Base domain: ${baseDomain}`);
    this.logger.info(`   Region: ${region}`);
    this.logger.info(`   VPC: ${vpcInfo.id}`);
    this.logger.info('');
    this.logger.info('Next steps:');
    this.logger.info(`   1. Configure DNS: Point your domain records to ${reservedIpInfo.ip}`);
    this.logger.info(`   2. Deploy services: dynia cluster deployment create --name ${name} --placeholder`);
    this.logger.info(`   3. Add more nodes: dynia cluster node add --name ${name}`);
  }

  /**
   * Create Reserved IP for cluster
   */
  private async createReservedIp(region: string): Promise<{ id: string; ip: string }> {
    this.logger.info('Creating Reserved IP...');
    
    if (this.dryRun) {
      this.logDryRun(`create Reserved IP in region ${region}`);
      return { id: 'mock-reserved-ip', ip: '203.0.113.100' };
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    const reservedIp = await doProvider.createReservedIp(region);
    this.logger.info(`✅ Reserved IP created: ${reservedIp.ip} (${reservedIp.id})`);
    
    return reservedIp;
  }

  /**
   * Assign Reserved IP to droplet using shared service logic
   */
  private async assignReservedIpToDroplet(dropletId: string, region: string): Promise<{ id: string; ip: string }> {
    this.logger.info('Assigning Reserved IP to first cluster node...');
    
    if (this.dryRun) {
      this.logDryRun(`assign Reserved IP to droplet ${dropletId} in region ${region}`);
      return { id: 'mock-reserved-ip', ip: '203.0.113.100' };
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    const reservedIpService = new ReservedIpService(doProvider, this.logger);
    const reservedIpInfo = await reservedIpService.assignReservedIpToDroplet(dropletId, region);
    
    return reservedIpInfo;
  }

  /**
   * Prepare first cluster node infrastructure
   */
  private async prepareFirstNode(
    dropletInfo: { id: string; name: string; ip: string },
    baseDomain: string,
    clusterName: string,
    region: string,
    reservedIpInfo: { id: string; ip: string }
  ): Promise<void> {
    this.logger.info('Preparing first node infrastructure...');
    
    if (this.dryRun) {
      this.logDryRun(`prepare first node ${dropletInfo.name} with Docker + Caddy + keepalived (single-node mode)`);
      return;
    }

    const preparationService = new NodePreparationService(this.logger);

    // Prepare node with single-node keepalived configuration
    await preparationService.prepareNode({
      nodeIp: dropletInfo.ip,
      nodeName: dropletInfo.name,
      baseDomain: baseDomain,
      cluster: {
        name: clusterName,
        region: region,
        reservedIp: reservedIpInfo.ip,
        reservedIpId: reservedIpInfo.id,
      },
      keepalived: {
        priority: 200, // Single node gets highest priority
        role: 'active',
        allNodes: [{ // Single node array
          twoWordId: dropletInfo.name,
          dropletId: dropletInfo.id,
          publicIp: dropletInfo.ip,
          role: 'active',
          status: 'active',
          priority: 200,
          clusterId: clusterName,
          hostname: dropletInfo.name,
          createdAt: Helpers.generateTimestamp(),
        }],
      },
    });

    // Test node readiness
    const isReady = await preparationService.testNodeReadiness(dropletInfo.ip, dropletInfo.name);
    if (!isReady) {
      throw new Error(`First node preparation completed but readiness tests failed`);
    }

    this.logger.info(`✅ First node ${dropletInfo.name} prepared successfully`);
  }

  /**
   * Create VPC for cluster private networking
   */
  private async createVpc(clusterName: string, region: string): Promise<{ id: string; name: string }> {
    this.logger.info('Creating VPC for cluster...');
    
    if (this.dryRun) {
      this.logDryRun(`create VPC ${clusterName}-vpc in region ${region}`);
      return { id: 'mock-vpc-id', name: `${clusterName}-vpc` };
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    const vpcName = `${clusterName}-vpc`;
    // Generate unique IP range based on cluster name hash to avoid conflicts
    const clusterHash = this.generateClusterHash(clusterName);
    const ipRange = `10.${clusterHash}.0.0/16`;
    
    const vpc = await doProvider.createVpc({
      name: vpcName,
      region,
      ipRange,
    });

    this.logger.info(`✅ VPC created: ${vpc.name} (${vpc.id})`);
    return vpc;
  }

  /**
   * Create first droplet for cluster
   */
  private async createFirstNode(
    clusterName: string,
    nodeId: string,
    region: string,
    size: string,
    vpcId: string
  ): Promise<{ id: string; name: string; ip: string }> {
    this.logger.info(`Creating first node: ${nodeId}`);
    
    if (this.dryRun) {
      this.logDryRun(`create droplet ${clusterName}-${nodeId} in region ${region}`);
      return { id: 'mock-droplet-id', name: `${clusterName}-${nodeId}`, ip: '203.0.113.10' };
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    // Create droplet with VPC networking
    const droplet = await doProvider.createDroplet({
      name: `${clusterName}-${nodeId}`,
      region,
      size,
      image: 'ubuntu-22-04-x64',
      sshKeys: [this.config.secrets.sshKeyId],
      // TODO: Add VPC configuration when DO provider supports it
    });

    // Wait for droplet to become active
    const activeDroplet = await doProvider.waitForDropletActive(droplet.id);
    
    this.logger.info(`✅ First node created: ${nodeId} (${activeDroplet.ip})`);
    return activeDroplet;
  }

  /**
   * Assign Reserved IP to droplet
   */
  private async assignReservedIp(reservedIpId: string, dropletId: string): Promise<void> {
    this.logger.info('Assigning Reserved IP to first node...');
    
    if (this.dryRun) {
      this.logDryRun(`assign Reserved IP ${reservedIpId} to droplet ${dropletId}`);
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    await doProvider.assignReservedIp(reservedIpId, dropletId);
    this.logger.info('✅ Reserved IP assigned to first node');
  }

  /**
   * Generate a unique hash for cluster VPC IP range (1-254)
   */
  private generateClusterHash(clusterName: string): number {
    // Simple hash function to generate a number between 1-254 for VPC IP range
    let hash = 0;
    for (let i = 0; i < clusterName.length; i++) {
      const char = clusterName.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Ensure range is between 1-254 (avoiding 0 and 255)
    return Math.abs(hash % 254) + 1;
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    // Validate required environment variables
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