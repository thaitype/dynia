import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { NodePreparationService } from '../../shared/services/node-preparation-service.js';

export interface ClusterPrepareOptions {
  name: string;
  'force'?: boolean;
  'parallel'?: boolean;
}

/**
 * Command to prepare entire cluster infrastructure  
 * Ensures all nodes are properly configured according to HA design spec
 */
export class ClusterPrepareCommand extends BaseCommand<ClusterPrepareOptions> {
  protected async run(): Promise<void> {
    const { name: clusterName, force = false, parallel = false } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name']);

    this.logger.info(`Preparing cluster infrastructure: ${clusterName}...`);

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

    this.logger.info(`Found ${allNodes.length} node${allNodes.length === 1 ? '' : 's'} to prepare:`);
    allNodes.forEach(node => {
      this.logger.info(`  - ${node.twoWordId} (${node.publicIp}) [${node.role || 'standby'}]`);
    });

    if (!force) {
      // Check which nodes are already prepared
      const preparationStatus = await this.checkNodePreparationStatus(allNodes);
      const unpreparedNodes = preparationStatus.filter(s => !s.prepared);
      
      if (unpreparedNodes.length === 0) {
        this.logger.info('✅ All nodes appear to already be prepared. Use --force to re-prepare.');
        this.showSummaryAndNextSteps(clusterName, allNodes);
        return;
      } else {
        this.logger.info(`${unpreparedNodes.length} node${unpreparedNodes.length === 1 ? '' : 's'} need preparation:`);
        unpreparedNodes.forEach(status => {
          this.logger.info(`  - ${status.nodeId} (${status.reason})`);
        });
      }
    }

    if (this.dryRun) {
      this.logDryRun(`prepare ${allNodes.length} nodes with Docker + Caddy + keepalived`);
      allNodes.forEach(node => {
        const priority = this.calculateNodePriority(node, allNodes);
        this.logDryRun(`  ${node.twoWordId}: role=${node.role || 'standby'}, priority=${priority}`);
      });
      return;
    }

    // Execute preparation
    const preparationService = new NodePreparationService(this.logger);
    
    try {
      if (parallel) {
        await this.prepareNodesInParallel(preparationService, cluster, allNodes);
      } else {
        await this.prepareNodesSequentially(preparationService, cluster, allNodes);
      }
      
      // Verify all nodes are ready
      await this.verifyClusterReadiness(preparationService, allNodes);
      
    } catch (error) {
      this.logger.error(`❌ Cluster preparation failed: ${error}`);
      throw new Error(`Failed to prepare cluster ${clusterName}. Some nodes may be partially configured.`);
    }

    // Success summary
    this.logger.info(`\\n✅ Cluster ${clusterName} infrastructure preparation complete`);
    this.showSummaryAndNextSteps(clusterName, allNodes);
  }

  /**
   * Check preparation status of all nodes
   */
  private async checkNodePreparationStatus(
    allNodes: Array<{ twoWordId: string; publicIp: string }>
  ): Promise<Array<{ nodeId: string; prepared: boolean; reason?: string }>> {
    this.logger.info('Checking current node preparation status...');
    
    const preparationService = new NodePreparationService(this.logger);
    const results: Array<{ nodeId: string; prepared: boolean; reason?: string }> = [];
    
    for (const node of allNodes) {
      try {
        const isReady = await preparationService.testNodeReadiness(node.publicIp, node.twoWordId);
        results.push({
          nodeId: node.twoWordId,
          prepared: isReady,
          reason: isReady ? undefined : 'Failed readiness tests'
        });
      } catch (error) {
        results.push({
          nodeId: node.twoWordId,
          prepared: false,
          reason: `Cannot connect: ${error}`
        });
      }
    }
    
    return results;
  }

  /**
   * Prepare nodes one by one (safer, easier to debug)
   */
  private async prepareNodesSequentially(
    preparationService: NodePreparationService,
    cluster: any,
    allNodes: any[]
  ): Promise<void> {
    this.logger.info('Preparing nodes sequentially...');
    
    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i];
      this.logger.info(`\\n[${i + 1}/${allNodes.length}] Preparing node ${node.twoWordId}...`);
      
      await this.prepareNode(preparationService, cluster, node, allNodes);
    }
  }

  /**
   * Prepare nodes in parallel (faster but harder to debug)
   */
  private async prepareNodesInParallel(
    preparationService: NodePreparationService,
    cluster: any,
    allNodes: any[]
  ): Promise<void> {
    this.logger.info('Preparing nodes in parallel...');
    
    const preparationPromises = allNodes.map(node => 
      this.prepareNode(preparationService, cluster, node, allNodes)
    );
    
    await Promise.all(preparationPromises);
  }

  /**
   * Prepare a single node
   */
  private async prepareNode(
    preparationService: NodePreparationService,
    cluster: any,
    node: any,
    allNodes: any[]
  ): Promise<void> {
    const keepalivedConfig = {
      priority: this.calculateNodePriority(node, allNodes),
      role: (node.role || 'standby') as 'active' | 'standby',
      allNodes: allNodes,
    };

    await preparationService.prepareNode({
      nodeIp: node.publicIp,
      nodeName: node.twoWordId,
      baseDomain: cluster.baseDomain,
      cluster: {
        name: cluster.name,
        region: cluster.region,
        reservedIp: cluster.reservedIp,
        reservedIpId: cluster.reservedIpId,
      },
      keepalived: keepalivedConfig,
    });
    
    this.logger.info(`✅ Node ${node.twoWordId} prepared successfully`);
  }

  /**
   * Verify entire cluster is ready after preparation
   */
  private async verifyClusterReadiness(
    preparationService: NodePreparationService,
    allNodes: any[]
  ): Promise<void> {
    this.logger.info('\\nVerifying cluster readiness...');
    
    let allReady = true;
    
    for (const node of allNodes) {
      try {
        const isReady = await preparationService.testNodeReadiness(node.publicIp, node.twoWordId);
        if (isReady) {
          this.logger.info(`✅ ${node.twoWordId}: Ready`);
        } else {
          this.logger.error(`❌ ${node.twoWordId}: Not ready`);
          allReady = false;
        }
      } catch (error) {
        this.logger.error(`❌ ${node.twoWordId}: Test failed - ${error}`);
        allReady = false;
      }
    }
    
    if (!allReady) {
      throw new Error('Some nodes failed readiness verification');
    }
    
    this.logger.info('✅ All nodes are ready');
  }

  /**
   * Calculate keepalived priority based on node role and position
   */
  private calculateNodePriority(
    node: { role?: string; twoWordId: string },
    allNodes: Array<{ role?: string; twoWordId: string }>
  ): number {
    if (node.role === 'active') {
      return 200;
    }
    
    const standbyNodes = allNodes.filter(n => n.role !== 'active');
    const nodeIndex = standbyNodes.findIndex(n => n.twoWordId === node.twoWordId);
    
    return 150 - (nodeIndex * 50); // 150, 100, 50, etc.
  }

  /**
   * Show summary and next steps
   */
  private showSummaryAndNextSteps(clusterName: string, allNodes: any[]): void {
    this.logger.info(`\\nCluster ${clusterName} summary:`);
    this.logger.info(`  - ${allNodes.length} node${allNodes.length === 1 ? '' : 's'} configured`);
    this.logger.info(`  - HA infrastructure: Docker + Caddy + keepalived`);
    this.logger.info(`  - Ready for service deployment`);
    
    this.logger.info('\\nNext steps:');
    this.logger.info(`   1. Deploy test service: dynia cluster deploy --name ${clusterName} --placeholder`);
    this.logger.info(`   2. Check cluster health: dynia cluster repair-ha ${clusterName} --check-only`);
    this.logger.info(`   3. View node status: dynia cluster node list ${clusterName}`);
    this.logger.info(`   4. Test failover: dynia cluster node activate ${clusterName} <node-id>`);
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    // No special prerequisites for cluster preparation
    // Node access is tested during execution
  }
}