import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import { ReservedIpService } from '../../shared/services/reserved-ip-service.js';
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

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );
    
    const reservedIpService = new ReservedIpService(doProvider, this.logger);

    // Check if cluster already has a Reserved IP
    if (cluster.reservedIp && cluster.reservedIpId) {
      this.logger.info(`⚠️  Cluster already has Reserved IP: ${cluster.reservedIp}`);
      this.logger.info(`This will reassign it from current node to ${nodeId}`);
      
      if (!this.dryRun) {
        // Reassign existing Reserved IP to target node
        await reservedIpService.reassignReservedIp(cluster.reservedIpId, targetNode.dropletId);
      }
    } else {
      // Use shared service to assign Reserved IP to target node
      if (this.dryRun) {
        this.logDryRun(`assign Reserved IP to droplet ${targetNode.dropletId} in region ${cluster.region}`);
      } else {
        const reservedIpInfo = await reservedIpService.assignReservedIpToDroplet(
          targetNode.dropletId, 
          cluster.region
        );
        
        // Update cluster state with new Reserved IP info
        await this.updateClusterReservedIp(clusterName, reservedIpInfo);
      }
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
    this.logger.info(`   3. Deploy services: dynia cluster deployment create --name ${clusterName} --placeholder`);
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