import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { Helpers } from '../../shared/utils/helpers.js';
import { TwoWordNameGenerator } from '../../shared/utils/two-word-generator.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import { createCloudflareProvider } from '../../core/providers/cloudflare-provider.js';
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

    // Step 1: Create Reserved IP
    const reservedIpInfo = await this.createReservedIp(region);
    
    // Step 2: Create VPC (optional, for future multi-node support)
    const vpcInfo = await this.createVpc(name, region);
    
    // Step 3: Generate first node ID
    const existingNodes = await this.stateManager.getAllClusterNodes();
    const existingNames = existingNodes.map(n => n.twoWordId);
    const firstNodeId = TwoWordNameGenerator.generate(existingNames);
    
    // Step 4: Create first droplet
    const dropletInfo = await this.createFirstNode(name, firstNodeId, region, size, vpcInfo.id);
    
    // Step 5: Assign Reserved IP to first node
    await this.assignReservedIp(reservedIpInfo.id, dropletInfo.id);
    
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
    
    // Step 7: Save first cluster node state
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
    this.logger.info(`   2. Deploy services: dynia cluster deploy --name ${name} --placeholder`);
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
    const vpc = await doProvider.createVpc({
      name: vpcName,
      region,
      ipRange: '10.10.0.0/16', // Standard private range
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
  ): Promise<{ id: string; ip: string }> {
    this.logger.info(`Creating first node: ${nodeId}`);
    
    if (this.dryRun) {
      this.logDryRun(`create droplet ${clusterName}-${nodeId} in region ${region}`);
      return { id: 'mock-droplet-id', ip: '203.0.113.10' };
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