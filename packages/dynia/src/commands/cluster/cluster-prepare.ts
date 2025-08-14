import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { ClusterPreparationService } from '../../shared/services/cluster-preparation-service.js';
import type { ClusterNode } from '../../shared/types/index.js';

export interface ClusterPrepareOptions {
  name: string;
  'force'?: boolean;
  'parallel'?: boolean;
  'node'?: string;
}

/**
 * Command to prepare cluster infrastructure  
 * Ensures nodes are properly configured according to HA design spec
 * Can target specific nodes with --node parameter
 */
export class ClusterPrepareCommand extends BaseCommand<ClusterPrepareOptions> {
  protected async run(): Promise<void> {
    const { name: clusterName, force = false, parallel = false, node: targetNodeId } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name']);

    this.logger.info(`🔧 Checking and repairing cluster infrastructure: ${clusterName}...`);

    // Get cluster information
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get all cluster nodes
    const allNodes = await this.stateManager.getClusterNodes(clusterName);
    if (allNodes.length === 0) {
      throw new Error(`No nodes found in cluster '${clusterName}'. Add nodes first with 'dynia cluster node add'.`);
    }
    
    // DEBUG: Log how many total cluster nodes we found
    this.logger.info(`🔍 DEBUG: Found ${allNodes.length} total cluster nodes: ${allNodes.map(n => n.twoWordId).join(', ')}`);

    // Filter to specific node if --node parameter provided
    let nodesToPrepare = allNodes;
    if (targetNodeId) {
      const targetNode = allNodes.find(node => node.twoWordId === targetNodeId);
      if (!targetNode) {
        throw new Error(`Node '${targetNodeId}' not found in cluster '${clusterName}'. Available nodes: ${allNodes.map(n => n.twoWordId).join(', ')}`);
      }
      nodesToPrepare = [targetNode];
      this.logger.info(`🎯 Targeting specific node: ${targetNodeId}`);
    }

    this.logger.info(`Found ${nodesToPrepare.length} node${nodesToPrepare.length === 1 ? '' : 's'} to prepare:`);
    nodesToPrepare.forEach(node => {
      this.logger.info(`  - ${node.twoWordId} (${node.publicIp}) [${node.role || 'standby'}]`);
    });

    // Use the centralized preparation service
    const clusterPreparationService = new ClusterPreparationService(this.logger);

    if (!force) {
      // Check which nodes need repair (but pass all nodes for full cluster context)
      this.logger.info('🔍 Analyzing cluster health...');
      const clusterHealth = await clusterPreparationService.checkClusterHealth(cluster, nodesToPrepare);
      const unhealthyNodes = clusterHealth.nodeStatuses.filter(s => !s.prepared);
      
      if (unhealthyNodes.length === 0) {
        if (targetNodeId) {
          this.logger.info(`✅ Node ${targetNodeId} is healthy and properly configured.`);
          this.logger.info('   Use --force to re-prepare this node anyway.');
        } else {
          this.logger.info('✅ All nodes are healthy and properly configured.');
          this.logger.info('   Use --force to re-prepare all nodes anyway.');
        }
        this.showSummaryAndNextSteps(clusterName, nodesToPrepare);
        return;
      } else {
        this.logger.info(`🚨 Found ${unhealthyNodes.length} node${unhealthyNodes.length === 1 ? '' : 's'} that need repair:`);
        unhealthyNodes.forEach(status => {
          this.logger.info(`   ❌ ${status.nodeId}: ${status.reason}`);
        });
        this.logger.info('');
        this.logger.info('🔧 Proceeding with repair...');
      }
    } else {
      this.logger.info('🔧 Force mode: Re-preparing all nodes regardless of current status...');
    }

    // Execute preparation using the service
    // Pass ALL cluster nodes for HAProxy config, but only prepare filtered nodes
    try {
      await clusterPreparationService.prepareClusterNodes(cluster, allNodes, {
        parallel,
        force,
        dryRun: this.dryRun,
        targetNodes: targetNodeId ? [targetNodeId] : undefined
      });
      
    } catch (error) {
      this.logger.error(`❌ Cluster repair failed: ${error}`);
      throw new Error(`Failed to repair cluster ${clusterName}. Some nodes may be partially configured. Try running with --force to re-prepare all nodes.`);
    }

    // Success summary
    if (targetNodeId) {
      this.logger.info(`\\n✅ Node ${targetNodeId} preparation complete!`);
    } else {
      this.logger.info(`\\n✅ Cluster ${clusterName} repair and preparation complete!`);
    }
    this.showSummaryAndNextSteps(clusterName, nodesToPrepare);
  }




  /**
   * Show summary and next steps for repair tool
   */
  private showSummaryAndNextSteps(clusterName: string, allNodes: ClusterNode[]): void {
    this.logger.info(`\\n🔧 Cluster ${clusterName} repair summary:`);
    this.logger.info(`   ✅ ${allNodes.length} node${allNodes.length === 1 ? '' : 's'} verified and configured`);
    this.logger.info(`   ✅ HA infrastructure: Docker + HAProxy + Caddy + keepalived`);
    this.logger.info(`   ✅ Load balancing across all cluster nodes`);
    this.logger.info(`   ✅ Cluster is healthy and ready`);
    
    this.logger.info('\\n🚀 Recommended next steps:');
    this.logger.info(`   1. Verify services: dynia cluster config inspect --name ${clusterName} --routes`);
    this.logger.info(`   2. Check cluster health: dynia cluster repair-ha ${clusterName} --check-only`);
    this.logger.info(`   3. Test failover: dynia cluster node activate --name ${clusterName} --node <node-id>`);
    this.logger.info(`   4. Deploy new services: dynia cluster deployment create --name ${clusterName} <options>`);
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    // No special prerequisites for cluster preparation
    // Node access is tested during execution
  }
}