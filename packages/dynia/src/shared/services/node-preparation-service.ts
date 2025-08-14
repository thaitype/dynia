import type { ILogger } from '@thaitype/core-utils';
import { DockerInfrastructure } from '../utils/docker-infrastructure.js';
import type { Cluster, ClusterNode } from '../types/index.js';

export interface NodePreparationOptions {
  nodeIp: string;
  nodeName: string;
  baseDomain: string;
  cluster?: {
    name: string;
    region: string;
    reservedIp?: string;
    reservedIpId?: string;
  };
  keepalived?: {
    priority: number;
    role: 'active' | 'standby';
    allNodes: ClusterNode[];
  };
}

export interface ClusterNodePreparationOptions {
  parallel?: boolean;
  force?: boolean;
  dryRun?: boolean;
  targetNodes?: string[]; // Filter to only prepare these node IDs
}

export interface NodePreparationStatus {
  nodeId: string;
  prepared: boolean;
  reason?: string;
}

/**
 * Enhanced NodePreparationService for preparing individual nodes with cluster context
 * Handles uniform node setup: Docker, HAProxy/Caddy, keepalived
 * Used by all commands that need to prepare nodes (create-ha, prepare, node add)
 */
export class NodePreparationService {
  constructor(private readonly logger: ILogger) {}

  /**
   * Complete node preparation according to HA spec
   * - Docker infrastructure (Docker + Caddy + networking)
   * - HAProxy for L7 load balancing
   * - keepalived for HA failover
   */
  async prepareNode(options: NodePreparationOptions): Promise<void> {
    const { nodeIp, nodeName, baseDomain, cluster, keepalived } = options;
    
    this.logger.info(`Preparing node ${nodeName} (${nodeIp}) for HA cluster...`);
    
    // Step 1: Set up basic Docker infrastructure (Docker + Caddy + networking)
    await this.setupDockerInfrastructure(nodeIp, nodeName, baseDomain);
    
    // Step 2: Install HAProxy for cluster load balancing
    if (cluster && keepalived?.allNodes) {
      await this.setupHAProxy(nodeIp, keepalived.allNodes, cluster.name, cluster.reservedIp);
    }
    
    // Step 3: Configure keepalived for HA failover
    if (keepalived) {
      await this.setupKeepalived(nodeIp, keepalived);
    }
    
    this.logger.info(`✅ Node ${nodeName} preparation complete`);
  }

  /**
   * Prepare multiple nodes in a cluster
   * Used by cluster-wide preparation commands
   */
  async prepareClusterNodes(
    cluster: Cluster,
    allNodes: ClusterNode[],
    options: ClusterNodePreparationOptions = {}
  ): Promise<void> {
    const { parallel = false, dryRun = false, targetNodes } = options;
    
    // Filter to target nodes if specified, but keep allNodes for HAProxy configuration
    const nodesToPrepare = targetNodes 
      ? allNodes.filter(node => targetNodes.includes(node.twoWordId))
      : allNodes;

    if (dryRun) {
      this.logger.info(`[DRY RUN] Would prepare ${nodesToPrepare.length} node(s) with Docker + HAProxy + Caddy + keepalived`);
      nodesToPrepare.forEach(node => {
        const priority = this.calculateNodePriority(node, allNodes);
        this.logger.info(`[DRY RUN]   ${node.twoWordId}: role=${node.role || 'active'}, priority=${priority}`);
      });
      return;
    }

    try {
      if (parallel) {
        await this.prepareNodesInParallel(cluster, nodesToPrepare, allNodes);
      } else {
        await this.prepareNodesSequentially(cluster, nodesToPrepare, allNodes);
      }
      
      // Verify prepared nodes are ready
      await this.verifyClusterReadiness(nodesToPrepare);
      
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
        const isReady = await this.testNodeReadiness(node.publicIp, node.twoWordId);
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
   * Test node readiness
   */
  async testNodeReadiness(nodeIp: string, nodeName: string): Promise<boolean> {
    this.logger.info(`Testing readiness of prepared node ${nodeName}...`);
    
    const infrastructure = new DockerInfrastructure(
      nodeIp,
      nodeName,
      '', // baseDomain not needed for readiness test
      this.logger
    );
    
    try {
      const isReady = await infrastructure.testInfrastructure();
      return isReady;
    } catch (error) {
      this.logger.error(`❌ Node ${nodeName} failed readiness test: ${error}`);
      return false;
    }
  }

  /**
   * Verify entire cluster is ready after preparation
   */
  async verifyClusterReadiness(allNodes: ClusterNode[]): Promise<void> {
    this.logger.info('Verifying cluster readiness...');
    
    let allReady = true;
    
    for (const node of allNodes) {
      try {
        const isReady = await this.testNodeReadiness(node.publicIp, node.twoWordId);
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
  private async prepareNodesSequentially(cluster: Cluster, nodesToPrepare: ClusterNode[], allNodes: ClusterNode[]): Promise<void> {
    this.logger.info(`Preparing ${nodesToPrepare.length} node(s) sequentially...`);
    
    for (let i = 0; i < nodesToPrepare.length; i++) {
      const node = nodesToPrepare[i];
      this.logger.info(`[${i + 1}/${nodesToPrepare.length}] Preparing node ${node.twoWordId}...`);
      
      await this.prepareSingleNode(cluster, node, allNodes);
    }
  }

  /**
   * Prepare nodes in parallel (faster but harder to debug)
   */
  private async prepareNodesInParallel(cluster: Cluster, nodesToPrepare: ClusterNode[], allNodes: ClusterNode[]): Promise<void> {
    this.logger.info(`Preparing ${nodesToPrepare.length} node(s) in parallel...`);
    
    const preparationPromises = nodesToPrepare.map(node => 
      this.prepareSingleNode(cluster, node, allNodes)
    );
    
    await Promise.all(preparationPromises);
  }

  /**
   * Prepare a single node with proper cluster configuration
   */
  private async prepareSingleNode(cluster: Cluster, node: ClusterNode, allNodes: ClusterNode[]): Promise<void> {
    const keepalivedConfig = {
      priority: this.calculateNodePriority(node, allNodes),
      role: (node.role || 'active') as 'active' | 'standby',
      allNodes: allNodes,
    };

    await this.prepareNode({
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
   * Set up Docker infrastructure (existing DockerInfrastructure logic)
   */
  private async setupDockerInfrastructure(
    nodeIp: string, 
    nodeName: string, 
    baseDomain: string
  ): Promise<void> {
    this.logger.info(`Setting up Docker infrastructure on ${nodeName}...`);
    
    const infrastructure = new DockerInfrastructure(
      nodeIp,
      nodeName,
      baseDomain,
      this.logger
    );
    
    await infrastructure.setupInfrastructure();
    
    this.logger.info(`✅ Docker infrastructure ready on ${nodeName}`);
  }

  /**
   * Set up HAProxy for cluster load balancing
   * Note: allNodes should contain ALL cluster nodes, not just the node being prepared
   */
  private async setupHAProxy(
    nodeIp: string,
    allNodes: ClusterNode[],
    clusterName: string,
    reservedIp?: string
  ): Promise<void> {
    this.logger.info(`Setting up HAProxy on ${nodeIp}...`);
    
    const infrastructure = new DockerInfrastructure(
      nodeIp,
      '', // nodeName not needed for HAProxy
      '', // baseDomain not needed for HAProxy
      this.logger
    );
    
    // Prepare cluster nodes for HAProxy config
    const haproxyNodes = allNodes.map(node => ({
      twoWordId: node.twoWordId,
      privateIp: node.privateIp || node.publicIp,
      publicIp: node.publicIp,
      role: node.role
    }));
    
    try {
      await infrastructure.installSystemHAProxy(haproxyNodes, clusterName, reservedIp);
      
      // Verify HAProxy installation
      await this.verifyHAProxyInstallation(infrastructure, nodeIp);
      
      this.logger.info(`✅ HAProxy configured and verified on ${nodeIp}`);
      
    } catch (error) {
      this.logger.error(`❌ HAProxy setup failed on ${nodeIp}: ${error}`);
      throw new Error(`Failed to setup HAProxy on ${nodeIp}: ${error}`);
    }
  }

  /**
   * Verify HAProxy installation and configuration
   */
  private async verifyHAProxyInstallation(infrastructure: DockerInfrastructure, nodeIp: string): Promise<void> {
    this.logger.info(`🔍 Verifying HAProxy installation on ${nodeIp}...`);
    
    try {
      // Check if HAProxy service is running
      const serviceStatus = await infrastructure.executeCommand('sudo systemctl is-active haproxy');
      if (serviceStatus.trim() !== 'active') {
        throw new Error(`HAProxy service is not active: ${serviceStatus}`);
      }
      this.logger.info(`✅ HAProxy service is active`);
      
      // Check if HAProxy is listening on port 80
      const portCheck = await infrastructure.executeCommand('sudo ss -tlnp | grep :80 | grep haproxy');
      if (!portCheck.includes('haproxy')) {
        throw new Error(`HAProxy is not listening on port 80`);
      }
      this.logger.info(`✅ HAProxy is listening on port 80`);
      
      // Verify HAProxy config syntax
      const configTest = await infrastructure.executeCommand('sudo haproxy -c -f /etc/haproxy/haproxy.cfg');
      if (!configTest.includes('Configuration file is valid')) {
        throw new Error(`HAProxy config validation failed: ${configTest}`);
      }
      this.logger.info(`✅ HAProxy configuration is valid`);
      
      // Display current config for debugging
      const currentConfig = await infrastructure.executeCommand('sudo cat /etc/haproxy/haproxy.cfg | grep -A5 -B5 "default_backend\\|backend cluster_backends"');
      this.logger.info(`🔍 HAProxy config excerpt:\n${currentConfig}`);
      
    } catch (error) {
      this.logger.error(`❌ HAProxy verification failed: ${error}`);
      throw error;
    }
  }

  /**
   * Set up keepalived for HA failover
   */
  private async setupKeepalived(
    nodeIp: string,
    keepalivedConfig: {
      priority: number;
      role: 'active' | 'standby';
      allNodes: ClusterNode[];
    }
  ): Promise<void> {
    this.logger.info(`Setting up keepalived on ${nodeIp}...`);
    
    const infrastructure = new DockerInfrastructure(
      nodeIp,
      '', // nodeName not needed for keepalived
      '', // baseDomain not needed for keepalived  
      this.logger
    );
    
    // TODO: Add keepalived installation when available in DockerInfrastructure
    this.logger.info(`⚠️  keepalived installation not yet implemented`);
    
    this.logger.info(`✅ keepalived setup complete on ${nodeIp}`);
  }
}