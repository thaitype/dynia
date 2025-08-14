import type { ILogger } from '@thaitype/core-utils';
import { NodePreparationService } from './node-preparation-service.js';
import type { Cluster, ClusterNode } from '../types/index.js';

export interface ClusterPreparationOptions {
  parallel?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

/**
 * ClusterPreparationService for higher-level cluster coordination
 * Handles state management, node coordination, and cluster-wide logic
 * This service orchestrates cluster-level operations while delegating
 * node preparation to NodePreparationService
 */
export class ClusterPreparationService {
  private readonly nodePreparationService: NodePreparationService;

  constructor(private readonly logger: ILogger) {
    this.nodePreparationService = new NodePreparationService(logger);
  }

  /**
   * Prepare all nodes in a cluster (cluster-wide coordination)
   * Delegates actual node preparation to NodePreparationService
   */
  async prepareClusterNodes(
    cluster: Cluster,
    allNodes: ClusterNode[],
    options: ClusterPreparationOptions = {}
  ): Promise<void> {
    this.logger.info(`🔧 Orchestrating cluster-wide preparation for ${cluster.name}...`);
    
    // Delegate to NodePreparationService for the actual node work
    await this.nodePreparationService.prepareClusterNodes(cluster, allNodes, options);
    
    this.logger.info(`✅ Cluster ${cluster.name} coordination complete`);
  }

  /**
   * Check cluster health and preparation status
   * Provides cluster-level health assessment
   */
  async checkClusterHealth(cluster: Cluster, allNodes: ClusterNode[]) {
    this.logger.info(`🔍 Assessing cluster health for ${cluster.name}...`);
    
    // Delegate node status checking to NodePreparationService
    const nodeStatuses = await this.nodePreparationService.checkNodePreparationStatus(allNodes);
    
    const healthyNodes = nodeStatuses.filter(s => s.prepared);
    const unhealthyNodes = nodeStatuses.filter(s => !s.prepared);
    
    return {
      cluster,
      totalNodes: allNodes.length,
      healthyNodes: healthyNodes.length,
      unhealthyNodes: unhealthyNodes.length,
      nodeStatuses,
      isHealthy: unhealthyNodes.length === 0
    };
  }

  /**
   * Calculate and assign priorities for cluster nodes
   * Ensures consistent priority assignment across the cluster
   */
  assignNodePriorities(allNodes: ClusterNode[]): ClusterNode[] {
    return allNodes.map(node => ({
      ...node,
      priority: this.nodePreparationService.calculateNodePriority(node, allNodes)
    }));
  }

  /**
   * Orchestrate adding a new node to an existing cluster
   * Handles cluster-level coordination for node addition
   */
  async addNodeToCluster(
    cluster: Cluster,
    newNode: ClusterNode,
    existingNodes: ClusterNode[]
  ): Promise<void> {
    this.logger.info(`🔧 Adding node ${newNode.twoWordId} to cluster ${cluster.name}...`);
    
    // Calculate priority for the new node
    const allNodes = [...existingNodes, newNode];
    const priority = this.nodePreparationService.calculateNodePriority(newNode, allNodes);
    
    // Update node with calculated priority
    const nodeWithPriority = { ...newNode, priority };
    
    // Prepare the new node with cluster context
    await this.nodePreparationService.prepareClusterNodes(
      cluster, 
      [nodeWithPriority], 
      { dryRun: false }
    );
    
    this.logger.info(`✅ Node ${newNode.twoWordId} successfully added to cluster`);
  }

  /**
   * Future: Handle cluster scaling decisions
   * Placeholder for future cluster-level logic
   */
  async assessScalingNeeds(cluster: Cluster, allNodes: ClusterNode[]) {
    // Future implementation for cluster scaling logic
    this.logger.info(`📊 Assessing scaling needs for cluster ${cluster.name}...`);
    
    return {
      recommendedAction: 'maintain',
      reason: 'Cluster appears healthy',
      suggestions: []
    };
  }

  /**
   * Future: Cluster-wide health monitoring coordination
   * Placeholder for future monitoring integration
   */
  async monitorClusterHealth(cluster: Cluster, allNodes: ClusterNode[]) {
    // Future implementation for continuous health monitoring
    this.logger.info(`📈 Starting health monitoring for cluster ${cluster.name}...`);
    
    // This could integrate with external monitoring systems
    return {
      monitoringEnabled: false,
      reason: 'Not yet implemented'
    };
  }
}