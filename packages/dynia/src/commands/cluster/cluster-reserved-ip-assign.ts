import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import type { ClusterNode } from '../../shared/types/index.js';

export interface ClusterReservedIpAssignOptions {
  cluster: string;
  node: string;
}

/**
 * Command to assign Reserved IP to a specific cluster node
 * Can use existing unassigned Reserved IP or create new one
 */
export class ClusterReservedIpAssignCommand extends BaseCommand<ClusterReservedIpAssignOptions> {
  protected async run(): Promise<void> {
    const { cluster: clusterName, node: nodeId } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['cluster', 'node']);

    this.logger.info(`Assigning Reserved IP to node ${nodeId} in cluster ${clusterName}...`);

    // Get cluster
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get target node
    const targetNode = await this.stateManager.getClusterNode(clusterName, nodeId);
    if (!targetNode) {
      throw new Error(`Node '${nodeId}' not found in cluster '${clusterName}'. Use 'dynia cluster node list ${clusterName}' to see available nodes.`);
    }

    // Check if cluster already has a Reserved IP
    if (cluster.reservedIp && cluster.reservedIpId) {
      this.logger.info(`⚠️  Cluster already has Reserved IP: ${cluster.reservedIp}`);
      this.logger.info(`This will reassign it from current node to ${nodeId}`);
      
      // Reassign existing Reserved IP to target node
      await this.reassignExistingReservedIp(cluster.reservedIpId, targetNode, clusterName);
    } else {
      // Try to find existing unassigned Reserved IP in region, or create new one
      const reservedIpInfo = await this.findOrCreateReservedIp(cluster.region, targetNode.dropletId);
      
      // Update cluster state with new Reserved IP info
      await this.updateClusterReservedIp(clusterName, reservedIpInfo);
    }

    // Update target node to active and other nodes to standby
    await this.updateNodeRoles(clusterName, nodeId);

    // Success summary
    this.logger.info(`\\n✅ Reserved IP successfully assigned to node ${nodeId} in cluster ${clusterName}`);
    
    const updatedCluster = await this.stateManager.getCluster(clusterName);
    if (updatedCluster?.reservedIp) {
      this.logger.info(`   Reserved IP: ${updatedCluster.reservedIp}`);
      this.logger.info(`   Target node: ${targetNode.twoWordId} (${targetNode.publicIp})`);
    }
    
    this.logger.info('\\nNext steps:');
    this.logger.info(`   1. Check cluster status: dynia cluster node list ${clusterName}`);
    this.logger.info(`   2. Test connectivity: curl https://your-domain-pointing-to-reserved-ip.com`);
    this.logger.info(`   3. Deploy services: dynia cluster deploy --name ${clusterName} --placeholder`);
  }

  /**
   * Find existing unassigned Reserved IP or create new one with droplet assignment
   */
  private async findOrCreateReservedIp(region: string, dropletId: string): Promise<{ id: string; ip: string }> {
    this.logger.info(`Finding or creating Reserved IP in region ${region}...`);
    
    if (this.dryRun) {
      this.logDryRun(`find available Reserved IP in ${region} or create new with droplet ${dropletId}`);
      return { id: 'mock-reserved-ip', ip: '203.0.113.100' };
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    // First, try to find existing unassigned Reserved IP in the region
    try {
      const availableReservedIps = await this.findAvailableReservedIps(region);
      
      if (availableReservedIps.length > 0) {
        const existingIp = availableReservedIps[0];
        this.logger.info(`Found existing unassigned Reserved IP: ${existingIp.ip}`);
        
        // Assign it to the droplet
        await doProvider.assignReservedIp(existingIp.id, dropletId);
        this.logger.info(`✅ Assigned existing Reserved IP ${existingIp.ip} to droplet ${dropletId}`);
        
        return existingIp;
      }
    } catch (error) {
      this.logger.warn(`Could not find available Reserved IPs: ${error}`);
      this.logger.info('Will create new Reserved IP instead...');
    }

    // No available Reserved IP found, create new one with immediate assignment
    this.logger.info('Creating new Reserved IP with immediate droplet assignment...');
    const reservedIp = await doProvider.createReservedIpWithDroplet(dropletId, region);
    this.logger.info(`✅ Created new Reserved IP: ${reservedIp.ip} (${reservedIp.id})`);
    
    return reservedIp;
  }

  /**
   * Find available (unassigned) Reserved IPs in a region
   */
  private async findAvailableReservedIps(region: string): Promise<{ id: string; ip: string }[]> {
    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    const allReservedIps = await doProvider.listReservedIps();
    
    // Filter for IPs in the correct region that are not assigned to any droplet
    const availableIps = allReservedIps.filter(ip => 
      ip.region === region && !ip.dropletId
    );

    return availableIps;
  }

  /**
   * Reassign existing Reserved IP to target node
   */
  private async reassignExistingReservedIp(
    reservedIpId: string, 
    targetNode: ClusterNode, 
    clusterName: string
  ): Promise<void> {
    this.logger.info(`Reassigning Reserved IP ${reservedIpId} to node ${targetNode.twoWordId}...`);
    
    if (this.dryRun) {
      this.logDryRun(`reassign Reserved IP ${reservedIpId} to droplet ${targetNode.dropletId}`);
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    // Reassign Reserved IP to target node
    await doProvider.assignReservedIp(reservedIpId, targetNode.dropletId);
    
    // Wait a moment for the reassignment to take effect
    this.logger.info('Waiting for Reserved IP reassignment to propagate...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    this.logger.info(`✅ Reserved IP ${reservedIpId} reassigned to node ${targetNode.twoWordId}`);
  }

  /**
   * Update cluster state with Reserved IP information
   */
  private async updateClusterReservedIp(
    clusterName: string, 
    reservedIpInfo: { id: string; ip: string }
  ): Promise<void> {
    this.logger.info('Updating cluster state with Reserved IP info...');
    
    if (this.dryRun) {
      this.logDryRun(`update cluster ${clusterName} with Reserved IP ${reservedIpInfo.ip}`);
      return;
    }

    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster ${clusterName} not found during state update`);
    }

    const updatedCluster = {
      ...cluster,
      reservedIp: reservedIpInfo.ip,
      reservedIpId: reservedIpInfo.id,
    };

    await this.stateManager.upsertCluster(updatedCluster);
    this.logger.info(`✅ Cluster state updated with Reserved IP: ${reservedIpInfo.ip}`);
  }

  /**
   * Update node roles - make target node active, others standby
   */
  private async updateNodeRoles(clusterName: string, targetNodeId: string): Promise<void> {
    this.logger.info('Updating node roles...');
    
    if (this.dryRun) {
      this.logDryRun(`update node ${targetNodeId} to active, others to standby`);
      return;
    }

    // Get all cluster nodes
    const allNodes = await this.stateManager.getClusterNodes(clusterName);
    
    for (const node of allNodes) {
      const newRole = node.twoWordId === targetNodeId ? 'active' : 'standby';
      
      if (node.role !== newRole) {
        const updatedNode = {
          ...node,
          role: newRole as 'active' | 'standby',
        };
        
        await this.stateManager.upsertClusterNode(updatedNode);
        this.logger.info(`✅ Node ${node.twoWordId} role updated to ${newRole}`);
      }
    }

    // Update cluster's active node reference
    const cluster = await this.stateManager.getCluster(clusterName);
    if (cluster && cluster.activeNodeId !== targetNodeId) {
      const updatedCluster = {
        ...cluster,
        activeNodeId: targetNodeId,
      };
      
      await this.stateManager.upsertCluster(updatedCluster);
      this.logger.info(`✅ Cluster active node updated to ${targetNodeId}`);
    }
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required');
    }
  }
}