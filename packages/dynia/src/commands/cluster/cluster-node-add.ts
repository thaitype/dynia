import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { Helpers } from '../../shared/utils/helpers.js';
import { TwoWordNameGenerator } from '../../shared/utils/two-word-generator.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import { DockerInfrastructure } from '../../shared/utils/docker-infrastructure.js';
import type { ClusterNode } from '../../shared/types/index.js';

export interface ClusterNodeAddOptions {
  name: string;
  count?: number;
}

/**
 * Command to add nodes to an existing cluster
 * Implements node creation with proper cluster integration
 */
export class ClusterNodeAddCommand extends BaseCommand<ClusterNodeAddOptions> {
  protected async run(): Promise<void> {
    const { name, count = 1 } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name']);
    
    if (count < 1 || count > 10) {
      throw new Error('Count must be between 1 and 10 nodes');
    }

    this.logger.info(`Adding ${count} node${count === 1 ? '' : 's'} to cluster: ${name}`);

    // Get existing cluster
    const cluster = await this.stateManager.getCluster(name);
    if (!cluster) {
      throw new Error(`Cluster '${name}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get existing cluster nodes to avoid name collisions
    const existingClusterNodes = await this.stateManager.getClusterNodes(name);
    const allClusterNodes = await this.stateManager.getAllClusterNodes();
    const existingNames = allClusterNodes.map(n => n.twoWordId);

    // Generate new node IDs
    const newNodeIds = TwoWordNameGenerator.generateMultiple(count, existingNames);
    this.logger.info(`Generated node IDs: ${newNodeIds.join(', ')}`);

    // Calculate priorities for new nodes (lower than existing ones)
    const existingPriorities = existingClusterNodes.map(n => n.priority);
    const lowestPriority = existingPriorities.length > 0 ? Math.min(...existingPriorities) : 150;
    
    // Create nodes sequentially to avoid conflicts
    const createdNodes: ClusterNode[] = [];
    
    for (let i = 0; i < newNodeIds.length; i++) {
      const nodeId = newNodeIds[i];
      const priority = lowestPriority - (i + 1) * 10; // Ensure new nodes have lower priority
      
      try {
        const newNode = await this.createClusterNode(cluster.name, nodeId, cluster.region, cluster.size, cluster.vpcId, priority);
        createdNodes.push(newNode);
        
        // Save node state immediately
        await this.conditionalExecute(
          () => this.stateManager.upsertClusterNode(newNode),
          `save cluster node ${nodeId} to state`
        );
        
        this.logger.info(`✅ Node ${nodeId} created successfully`);
        
      } catch (error) {
        this.logger.error(`❌ Failed to create node ${nodeId}: ${error}`);
        
        // If we've created some nodes successfully, still report partial success
        if (createdNodes.length > 0) {
          this.logger.info(`Partially successful: ${createdNodes.length} of ${count} nodes created`);
          break;
        } else {
          throw error; // Re-throw if first node fails
        }
      }
    }

    // Summary
    if (createdNodes.length > 0) {
      this.logger.info(`\n✅ Successfully added ${createdNodes.length} node${createdNodes.length === 1 ? '' : 's'} to cluster ${name}:`);
      
      for (const node of createdNodes) {
        this.logger.info(`   ${node.twoWordId}: ${node.publicIp} (${node.role}, priority ${node.priority})`);
      }
      
      this.logger.info('\nNext steps:');
      this.logger.info(`   1. Check cluster status: dynia cluster node list ${name}`);
      this.logger.info(`   2. Deploy services: dynia cluster deploy --name ${name} --placeholder`);
      this.logger.info(`   3. Test failover: dynia cluster node activate ${name} <node-id>`);
    }
  }

  /**
   * Create a new cluster node
   */
  private async createClusterNode(
    clusterName: string,
    nodeId: string,
    region: string,
    size: string,
    vpcId: string | undefined,
    priority: number
  ): Promise<ClusterNode> {
    this.logger.info(`Creating cluster node: ${nodeId}`);
    
    if (this.dryRun) {
      this.logDryRun(`create droplet ${clusterName}-${nodeId} in region ${region}`);
      return {
        twoWordId: nodeId,
        clusterId: clusterName,
        dropletId: 'mock-droplet-id',
        hostname: `${clusterName}-${nodeId}`,
        publicIp: '203.0.113.20',
        privateIp: '10.10.0.20',
        role: 'standby',
        priority,
        status: 'provisioning',
        createdAt: Helpers.generateTimestamp(),
      };
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    // Create droplet
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

    // Set up Docker infrastructure on new node
    await this.setupNodeInfrastructure(activeDroplet.ip, nodeId, clusterName);

    // Create cluster node object
    const clusterNode: ClusterNode = {
      twoWordId: nodeId,
      clusterId: clusterName,
      dropletId: activeDroplet.id,
      hostname: `${clusterName}-${nodeId}`,
      publicIp: activeDroplet.ip,
      privateIp: undefined, // Will be populated when VPC is fully integrated
      role: 'standby', // New nodes start as standby
      priority,
      status: 'active', // Active means the droplet is running and configured
      createdAt: Helpers.generateTimestamp(),
    };

    return clusterNode;
  }

  /**
   * Set up Docker infrastructure on new node
   */
  private async setupNodeInfrastructure(nodeIp: string, nodeId: string, clusterName: string): Promise<void> {
    this.logger.info(`Setting up infrastructure on node ${nodeId}...`);
    
    if (this.dryRun) {
      this.logDryRun(`setup Docker infrastructure on node ${nodeId}`);
      return;
    }

    const infrastructure = new DockerInfrastructure(
      nodeIp,
      nodeId,
      this.config.public.cloudflare.domain,
      this.logger
    );

    // Install basic Docker infrastructure
    // Note: This sets up the basic containers, but keepalived configuration
    // will be handled in a separate step when we implement the KeepaliveManager
    await infrastructure.setupInfrastructure();

    this.logger.info(`✅ Infrastructure setup completed on node ${nodeId}`);
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required');
    }
    
    if (!this.config.secrets.sshKeyId) {
      throw new Error('DYNIA_SSH_KEY_ID environment variable is required');
    }
  }
}