import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import { DockerInfrastructure } from '../../shared/utils/docker-infrastructure.js';
import type { ClusterNode } from '../../shared/types/index.js';

export interface ClusterNodeActivateOptions {
  'cluster-name': string;
  'node-id': string;
}

/**
 * Command to activate a cluster node (move Reserved IP)
 * Implements safe failover with health checks and state updates
 */
export class ClusterNodeActivateCommand extends BaseCommand<ClusterNodeActivateOptions> {
  protected async run(): Promise<void> {
    const { 'cluster-name': clusterName, 'node-id': nodeId } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['cluster-name', 'node-id']);

    this.logger.info(`Activating node ${nodeId} in cluster ${clusterName}...`);

    // Get cluster
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get target node
    const targetNode = await this.stateManager.getClusterNode(clusterName, nodeId);
    if (!targetNode) {
      throw new Error(`Node '${nodeId}' not found in cluster '${clusterName}'.`);
    }

    // Check if already active
    if (targetNode.role === 'active') {
      this.logger.info(`✅ Node ${nodeId} is already active in cluster ${clusterName}`);
      return;
    }

    // Get current active node
    const currentActiveNode = await this.stateManager.getActiveClusterNode(clusterName);
    
    // Step 1: Health check target node
    await this.performHealthCheck(targetNode);
    
    // Step 2: Reassign Reserved IP
    if (!cluster.reservedIpId) {
      throw new Error(`Cluster '${clusterName}' does not have a Reserved IP assigned. Use 'dynia cluster reserved-ip assign' to assign one.`);
    }
    await this.reassignReservedIp(cluster.reservedIpId, targetNode.dropletId, targetNode.twoWordId);
    
    // Step 3: Update node roles in state
    await this.updateNodeRoles(clusterName, currentActiveNode, targetNode);
    
    // Step 4: Update cluster active node
    await this.updateClusterActiveNode(clusterName, nodeId);

    // Success summary
    this.logger.info(`\n✅ Node ${nodeId} is now active in cluster ${clusterName}`);
    this.logger.info(`   Reserved IP: ${cluster.reservedIp} → ${targetNode.publicIp}`);
    
    if (currentActiveNode) {
      this.logger.info(`   Previous active: ${currentActiveNode.twoWordId} → standby`);
    }
    
    this.logger.info('\nNext steps:');
    this.logger.info(`   1. Verify accessibility: curl https://your-domain.com`);
    this.logger.info(`   2. Check cluster status: dynia cluster node list ${clusterName}`);
    this.logger.info(`   3. Monitor health: dynia cluster repair-ha ${clusterName} --check-only`);
  }

  /**
   * Perform health check on target node before activation
   */
  private async performHealthCheck(targetNode: ClusterNode): Promise<void> {
    this.logger.info(`Checking health of target node: ${targetNode.twoWordId}`);
    
    if (this.dryRun) {
      this.logDryRun(`health check node ${targetNode.twoWordId} at ${targetNode.publicIp}`);
      return;
    }

    // Check if node is reachable and has basic infrastructure
    const infrastructure = new DockerInfrastructure(
      targetNode.publicIp,
      targetNode.twoWordId,
      this.config.public.cloudflare.domain,
      this.logger
    );

    try {
      // Test basic infrastructure readiness
      const isHealthy = await infrastructure.testInfrastructure();
      
      if (!isHealthy) {
        throw new Error(`Node ${targetNode.twoWordId} failed health check. Run repair first: dynia cluster repair-ha ${targetNode.clusterId}`);
      }
      
      this.logger.info(`✅ Node ${targetNode.twoWordId} passed health check`);
      
    } catch (error) {
      this.logger.error(`❌ Health check failed for node ${targetNode.twoWordId}: ${error}`);
      throw new Error(`Cannot activate unhealthy node. Please repair the node first.`);
    }
  }

  /**
   * Reassign Reserved IP to target node
   */
  private async reassignReservedIp(reservedIpId: string, targetDropletId: string, nodeId: string): Promise<void> {
    this.logger.info(`Reassigning Reserved IP to node ${nodeId}...`);
    
    if (this.dryRun) {
      this.logDryRun(`assign Reserved IP ${reservedIpId} to droplet ${targetDropletId}`);
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    try {
      // DigitalOcean automatically unassigns from current droplet when assigning to new one
      await doProvider.assignReservedIp(reservedIpId, targetDropletId);
      
      this.logger.info(`✅ Reserved IP reassigned to node ${nodeId}`);
      
      // Wait a moment for the reassignment to take effect
      this.logger.info('Waiting for Reserved IP reassignment to propagate...');
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
      
    } catch (error) {
      this.logger.error(`❌ Failed to reassign Reserved IP: ${error}`);
      throw new Error(`Reserved IP reassignment failed. The cluster may be in an inconsistent state.`);
    }
  }

  /**
   * Update node roles in cluster state
   */
  private async updateNodeRoles(
    clusterName: string, 
    currentActiveNode: ClusterNode | null, 
    newActiveNode: ClusterNode
  ): Promise<void> {
    this.logger.info('Updating node roles in cluster state...');

    if (this.dryRun) {
      this.logDryRun(`update node roles: ${newActiveNode.twoWordId} → active`);
      if (currentActiveNode) {
        this.logDryRun(`update node roles: ${currentActiveNode.twoWordId} → standby`);
      }
      return;
    }

    // Update current active node to standby (if exists)
    if (currentActiveNode) {
      const updatedCurrentNode: ClusterNode = {
        ...currentActiveNode,
        role: 'standby',
      };
      
      await this.stateManager.upsertClusterNode(updatedCurrentNode);
      this.logger.info(`✅ Node ${currentActiveNode.twoWordId} role updated to standby`);
    }

    // Update target node to active
    const updatedTargetNode: ClusterNode = {
      ...newActiveNode,
      role: 'active',
    };
    
    await this.stateManager.upsertClusterNode(updatedTargetNode);
    this.logger.info(`✅ Node ${newActiveNode.twoWordId} role updated to active`);
  }

  /**
   * Update cluster's active node reference
   */
  private async updateClusterActiveNode(clusterName: string, newActiveNodeId: string): Promise<void> {
    this.logger.info('Updating cluster active node reference...');

    if (this.dryRun) {
      this.logDryRun(`update cluster ${clusterName} active node to ${newActiveNodeId}`);
      return;
    }

    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster ${clusterName} not found during state update`);
    }

    const updatedCluster = {
      ...cluster,
      activeNodeId: newActiveNodeId,
    };

    await this.stateManager.upsertCluster(updatedCluster);
    this.logger.info(`✅ Cluster active node updated to ${newActiveNodeId}`);
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required');
    }
  }
}