import type { ILogger } from '@thaitype/core-utils';
import { NodePreparationService } from './node-preparation-service.js';
import type { Cluster, ClusterNode } from '../types/index.js';

export interface ClusterPreparationOptions {
  parallel?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export interface NodePreparationStatus {
  nodeId: string;
  prepared: boolean;
  reason?: string;
}

/**
 * Service for managing cluster-wide preparation and repair operations
 * Centralizes shared logic between cluster-create-ha and cluster-prepare commands
 */
export class ClusterPreparationService {
  private readonly nodePreparationService: NodePreparationService;

  constructor(private readonly logger: ILogger) {
    this.nodePreparationService = new NodePreparationService(logger);
  }

  /**
   * Prepare all nodes in a cluster
   * Used by both cluster-create-ha and cluster-prepare commands
   */
  async prepareClusterNodes(
    cluster: Cluster,
    allNodes: ClusterNode[],
    options: ClusterPreparationOptions = {}
  ): Promise<void> {
    const { parallel = false, dryRun = false } = options;

    if (dryRun) {
      this.logger.info(`[DRY RUN] Would prepare ${allNodes.length} node(s) with Docker + HAProxy + Caddy + keepalived`);
      allNodes.forEach(node => {
        const priority = this.calculateNodePriority(node, allNodes);
        this.logger.info(`[DRY RUN]   ${node.twoWordId}: role=${node.role || 'active'}, priority=${priority}`);
      });
      return;
    }

    try {
      if (parallel) {
        await this.prepareNodesInParallel(cluster, allNodes);
      } else {
        await this.prepareNodesSequentially(cluster, allNodes);
      }
      
      // Verify all nodes are ready
      await this.verifyClusterReadiness(allNodes);
      
    } catch (error) {
      this.logger.error(`❌ Cluster preparation failed: ${error}`);
      throw new Error(`Failed to prepare cluster ${cluster.name}. Some nodes may be partially configured.`);
    }

    this.logger.info(`✅ Cluster ${cluster.name} preparation complete`);
  }

  /**
   * Check preparation status of all nodes
   * Used by cluster-prepare to determine what needs repair
   */
  async checkNodePreparationStatus(allNodes: ClusterNode[]): Promise<NodePreparationStatus[]> {
    const results: NodePreparationStatus[] = [];
    
    for (const node of allNodes) {
      try {
        const isReady = await this.nodePreparationService.testNodeReadiness(node.publicIp, node.twoWordId);
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
   * Calculate keepalived priority based on node role and position
   * Shared logic for consistent priority assignment
   */
  calculateNodePriority(
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
   * Verify entire cluster is ready after preparation
   */
  async verifyClusterReadiness(allNodes: ClusterNode[]): Promise<void> {
    this.logger.info('Verifying cluster readiness...');
    
    let allReady = true;
    
    for (const node of allNodes) {
      try {
        const isReady = await this.nodePreparationService.testNodeReadiness(node.publicIp, node.twoWordId);
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
   * Prepare nodes sequentially (safer, easier to debug)
   */
  private async prepareNodesSequentially(cluster: Cluster, allNodes: ClusterNode[]): Promise<void> {
    this.logger.info(`Preparing ${allNodes.length} node(s) sequentially...`);
    
    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i];
      this.logger.info(`[${i + 1}/${allNodes.length}] Preparing node ${node.twoWordId}...`);
      
      await this.prepareNode(cluster, node, allNodes);
    }
  }

  /**
   * Prepare nodes in parallel (faster but harder to debug)
   */
  private async prepareNodesInParallel(cluster: Cluster, allNodes: ClusterNode[]): Promise<void> {
    this.logger.info(`Preparing ${allNodes.length} node(s) in parallel...`);
    
    const preparationPromises = allNodes.map(node => 
      this.prepareNode(cluster, node, allNodes)
    );
    
    await Promise.all(preparationPromises);
  }

  /**
   * Prepare a single node with proper cluster configuration
   */
  private async prepareNode(cluster: Cluster, node: ClusterNode, allNodes: ClusterNode[]): Promise<void> {
    const keepalivedConfig = {
      priority: this.calculateNodePriority(node, allNodes),
      role: (node.role || 'active') as 'active' | 'standby',
      allNodes: allNodes,
    };

    await this.nodePreparationService.prepareNode({
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
}