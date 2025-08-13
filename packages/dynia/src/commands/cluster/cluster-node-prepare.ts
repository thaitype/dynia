import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { NodePreparationService } from '../../shared/services/node-preparation-service.js';

export interface ClusterNodePrepareOptions {
  cluster: string;
  node: string;
  force?: boolean;
}

/**
 * Command to prepare a specific cluster node
 * Sets up complete HA infrastructure: Docker + Caddy + keepalived + security
 */
export class ClusterNodePrepareCommand extends BaseCommand<ClusterNodePrepareOptions> {
  protected async run(): Promise<void> {
    const { cluster: clusterName, node: nodeId, force = false } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['cluster', 'node']);

    this.logger.info(`Preparing node ${nodeId} in cluster ${clusterName}...`);

    // Get cluster information
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get target node
    const targetNode = await this.stateManager.getClusterNode(clusterName, nodeId);
    if (!targetNode) {
      throw new Error(`Node '${nodeId}' not found in cluster '${clusterName}'. Use 'dynia cluster node list ${clusterName}' to see available nodes.`);
    }

    // Check if node is already prepared (unless force flag is used)
    if (!force && await this.isNodeAlreadyPrepared(targetNode.publicIp, nodeId)) {
      this.logger.info(`⚠️  Node ${nodeId} appears to already be prepared. Use --force to re-prepare.`);
      this.logger.info('Next steps:');
      this.logger.info(`   1. Test node: dynia cluster repair-ha ${clusterName} --check-only`);
      this.logger.info(`   2. View status: dynia cluster node list ${clusterName}`);
      return;
    }

    // Get all cluster nodes for keepalived configuration
    const allNodes = await this.stateManager.getClusterNodes(clusterName);

    // Prepare keepalived configuration
    const keepalivedConfig = {
      priority: this.calculateNodePriority(targetNode, allNodes),
      role: targetNode.role || 'standby' as const,
      allNodes: allNodes,
    };

    // Set up node preparation service
    const preparationService = new NodePreparationService(this.logger);

    if (this.dryRun) {
      this.logDryRun(`prepare node ${nodeId} with Docker + Caddy + keepalived`);
      this.logDryRun(`keepalived role: ${keepalivedConfig.role}, priority: ${keepalivedConfig.priority}`);
      return;
    }

    // Execute node preparation
    try {
      await preparationService.prepareNode({
        nodeIp: targetNode.publicIp,
        nodeName: targetNode.twoWordId,
        baseDomain: cluster.baseDomain,
        cluster: {
          name: cluster.name,
          region: cluster.region,
          reservedIp: cluster.reservedIp,
          reservedIpId: cluster.reservedIpId,
        },
        keepalived: keepalivedConfig,
      });

      // Test node readiness after preparation
      const isReady = await preparationService.testNodeReadiness(
        targetNode.publicIp, 
        targetNode.twoWordId
      );

      if (!isReady) {
        throw new Error(`Node preparation completed but readiness tests failed`);
      }

      // Update node status to indicate it's prepared
      const updatedNode = {
        ...targetNode,
        // You could add a 'prepared' flag or timestamp to track preparation status
        updatedAt: new Date().toISOString(),
      };
      
      await this.stateManager.upsertClusterNode(updatedNode);

    } catch (error) {
      this.logger.error(`❌ Node preparation failed: ${error}`);
      throw new Error(`Failed to prepare node ${nodeId}. Check logs for details.`);
    }

    // Success summary
    this.logger.info(`\\n✅ Node ${nodeId} successfully prepared for HA cluster`);
    this.logger.info(`   IP: ${targetNode.publicIp}`);
    this.logger.info(`   Role: ${keepalivedConfig.role}`);
    this.logger.info(`   Priority: ${keepalivedConfig.priority}`);
    
    this.logger.info('\\nNext steps:');
    this.logger.info(`   1. Test cluster: dynia cluster repair-ha ${clusterName} --check-only`);
    this.logger.info(`   2. Deploy service: dynia cluster deployment create --name ${clusterName} --placeholder`);
    this.logger.info(`   3. Check status: dynia cluster node list ${clusterName}`);
  }

  /**
   * Check if node is already prepared by testing for basic infrastructure
   */
  private async isNodeAlreadyPrepared(nodeIp: string, nodeId: string): Promise<boolean> {
    try {
      const preparationService = new NodePreparationService(this.logger);
      return await preparationService.testNodeReadiness(nodeIp, nodeId);
    } catch {
      // If we can't test, assume not prepared
      return false;
    }
  }

  /**
   * Calculate keepalived priority based on node role and position
   */
  private calculateNodePriority(
    targetNode: { role?: string; twoWordId: string },
    allNodes: Array<{ role?: string; twoWordId: string }>
  ): number {
    // Priority calculation based on HA spec:
    // - Active node: highest priority (200)
    // - Standby nodes: decreasing priority (150, 100, 50...)
    
    if (targetNode.role === 'active') {
      return 200;
    }
    
    // For standby nodes, assign priority based on creation order
    // (nodes created first get higher priority for predictable failover)
    const standbyNodes = allNodes.filter(n => n.role !== 'active');
    const nodeIndex = standbyNodes.findIndex(n => n.twoWordId === targetNode.twoWordId);
    
    return 150 - (nodeIndex * 50); // 150, 100, 50, etc.
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    // No special prerequisites for node preparation
    // SSH access is tested during execution
  }
}