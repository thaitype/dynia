import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ILogger } from '@thaitype/core-utils';

import type { AppState, Cluster, ClusterNode, Deployment, Node, Route } from '../../shared/types/index.js';
import { AppStateSchema } from '../../shared/types/index.js';

/**
 * Security check to prevent secrets from being stored in state
 */
const FORBIDDEN_KEYS = ['token', 'key', 'secret', 'password', 'auth', 'credential'];

function validateNoSecrets(obj: unknown, path = ''): void {
  if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      // Check if key name suggests it might be a secret
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_KEYS.some(forbiddenKey => lowerKey.includes(forbiddenKey))) {
        throw new Error(`Security violation: Attempted to store sensitive data in state at ${currentPath}`);
      }

      // Recursively check nested objects
      if (typeof value === 'object' && value !== null) {
        validateNoSecrets(value, currentPath);
      }
    }
  }
}

/**
 * Manages application state persistence in .dynia/state.json
 * Implements CRUD operations with validation and atomic writes
 */
export class StateManager {
  private readonly statePath: string;
  private cachedState: AppState | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly logger: ILogger,
    stateDir = '.dynia'
  ) {
    this.statePath = join(rootDir, stateDir, 'state.json');
  }

  /**
   * Load state from disk with validation
   */
  async loadState(): Promise<AppState> {
    if (this.cachedState) {
      return this.cachedState;
    }

    try {
      if (!existsSync(this.statePath)) {
        this.logger.info('State file does not exist, creating default state');
        const defaultState: AppState = { 
          nodes: [], 
          deployments: [], 
          clusters: [], 
          clusterNodes: [], 
          routes: [] 
        };
        await this.saveState(defaultState);
        return defaultState;
      }

      const content = await readFile(this.statePath, 'utf-8');
      const rawState = JSON.parse(content);
      const validatedState = AppStateSchema.parse(rawState);

      this.cachedState = validatedState;
      this.logger.debug(
        `Loaded state with ${validatedState.nodes.length} nodes and ${validatedState.deployments.length} deployments`
      );

      return validatedState;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load state: ${message}`);
    }
  }

  /**
   * Save state to disk with atomic write
   */
  async saveState(state: AppState): Promise<void> {
    try {
      // Security check - ensure no secrets in state
      validateNoSecrets(state);

      // Validate state schema
      const validatedState = AppStateSchema.parse(state);

      // Ensure directory exists
      await mkdir(dirname(this.statePath), { recursive: true });

      // Atomic write via temp file
      const tempPath = `${this.statePath}.tmp`;
      await writeFile(tempPath, JSON.stringify(validatedState, null, 2), 'utf-8');

      // Move temp file to final location (atomic on most filesystems)
      await writeFile(this.statePath, JSON.stringify(validatedState, null, 2), 'utf-8');

      this.cachedState = validatedState;
      this.logger.debug('State saved successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to save state: ${message}`);
    }
  }

  /**
   * Add or update a node in state
   */
  async upsertNode(node: Node): Promise<void> {
    const state = await this.loadState();
    const existingIndex = state.nodes.findIndex(n => n.name === node.name);

    if (existingIndex >= 0) {
      state.nodes[existingIndex] = node;
      this.logger.debug(`Updated node ${node.name}`);
    } else {
      state.nodes.push(node);
      this.logger.debug(`Added new node ${node.name}`);
    }

    await this.saveState(state);
  }

  /**
   * Remove a node from state
   */
  async removeNode(nodeName: string): Promise<boolean> {
    const state = await this.loadState();
    const initialLength = state.nodes.length;
    state.nodes = state.nodes.filter(n => n.name !== nodeName);

    if (state.nodes.length < initialLength) {
      // Also remove related deployments
      state.deployments = state.deployments.filter(d => d.node !== nodeName);
      await this.saveState(state);
      this.logger.debug(`Removed node ${nodeName} and its deployments`);
      return true;
    }

    return false;
  }

  /**
   * Get a node by name
   */
  async getNode(nodeName: string): Promise<Node | null> {
    const state = await this.loadState();
    return state.nodes.find(n => n.name === nodeName) || null;
  }

  /**
   * Get all nodes
   */
  async getNodes(): Promise<Node[]> {
    const state = await this.loadState();
    return state.nodes;
  }

  /**
   * Add or update a deployment in state
   */
  async upsertDeployment(deployment: Deployment): Promise<void> {
    const state = await this.loadState();
    const existingIndex = state.deployments.findIndex(d => d.node === deployment.node);

    if (existingIndex >= 0) {
      state.deployments[existingIndex] = deployment;
      this.logger.debug(`Updated deployment on node ${deployment.node}`);
    } else {
      state.deployments.push(deployment);
      this.logger.debug(`Added new deployment on node ${deployment.node}`);
    }

    await this.saveState(state);
  }

  /**
   * Remove a deployment from state
   */
  async removeDeployment(nodeName: string): Promise<boolean> {
    const state = await this.loadState();
    const initialLength = state.deployments.length;
    state.deployments = state.deployments.filter(d => d.node !== nodeName);

    if (state.deployments.length < initialLength) {
      await this.saveState(state);
      this.logger.debug(`Removed deployment from node ${nodeName}`);
      return true;
    }

    return false;
  }

  /**
   * Get deployment for a node
   */
  async getDeployment(nodeName: string): Promise<Deployment | null> {
    const state = await this.loadState();
    return state.deployments.find(d => d.node === nodeName) || null;
  }

  /**
   * Get all deployments
   */
  async getDeployments(): Promise<Deployment[]> {
    const state = await this.loadState();
    return state.deployments;
  }

  /**
   * Get healthy nodes (active status)
   */
  async getHealthyNodes(): Promise<Node[]> {
    const nodes = await this.getNodes();
    return nodes.filter(node => node.status === 'active');
  }

  // Cluster management methods

  /**
   * Add or update a cluster in state
   */
  async upsertCluster(cluster: Cluster): Promise<void> {
    const state = await this.loadState();
    const existingIndex = state.clusters.findIndex(c => c.name === cluster.name);

    if (existingIndex >= 0) {
      state.clusters[existingIndex] = cluster;
      this.logger.debug(`Updated cluster ${cluster.name}`);
    } else {
      state.clusters.push(cluster);
      this.logger.debug(`Added new cluster ${cluster.name}`);
    }

    await this.saveState(state);
  }

  /**
   * Remove a cluster from state
   */
  async removeCluster(clusterName: string): Promise<boolean> {
    const state = await this.loadState();
    const initialLength = state.clusters.length;
    state.clusters = state.clusters.filter(c => c.name !== clusterName);

    if (state.clusters.length < initialLength) {
      // Remove related cluster nodes and routes
      state.clusterNodes = state.clusterNodes.filter(n => n.clusterId !== clusterName);
      state.routes = state.routes.filter(r => r.clusterId !== clusterName);
      await this.saveState(state);
      this.logger.debug(`Removed cluster ${clusterName} and its related resources`);
      return true;
    }

    return false;
  }

  /**
   * Get a cluster by name
   */
  async getCluster(clusterName: string): Promise<Cluster | null> {
    const state = await this.loadState();
    return state.clusters.find(c => c.name === clusterName) || null;
  }

  /**
   * Get all clusters
   */
  async getClusters(): Promise<Cluster[]> {
    const state = await this.loadState();
    return state.clusters;
  }

  // Cluster node management methods

  /**
   * Add or update a cluster node in state
   */
  async upsertClusterNode(node: ClusterNode): Promise<void> {
    const state = await this.loadState();
    const existingIndex = state.clusterNodes.findIndex(n => 
      n.clusterId === node.clusterId && n.twoWordId === node.twoWordId
    );

    if (existingIndex >= 0) {
      state.clusterNodes[existingIndex] = node;
      this.logger.debug(`Updated cluster node ${node.twoWordId} in cluster ${node.clusterId}`);
    } else {
      state.clusterNodes.push(node);
      this.logger.debug(`Added new cluster node ${node.twoWordId} to cluster ${node.clusterId}`);
    }

    await this.saveState(state);
  }

  /**
   * Remove a cluster node from state
   */
  async removeClusterNode(clusterId: string, twoWordId: string): Promise<boolean> {
    const state = await this.loadState();
    const initialLength = state.clusterNodes.length;
    state.clusterNodes = state.clusterNodes.filter(n => 
      !(n.clusterId === clusterId && n.twoWordId === twoWordId)
    );

    if (state.clusterNodes.length < initialLength) {
      await this.saveState(state);
      this.logger.debug(`Removed cluster node ${twoWordId} from cluster ${clusterId}`);
      return true;
    }

    return false;
  }

  /**
   * Get cluster nodes for a specific cluster
   */
  async getClusterNodes(clusterId: string): Promise<ClusterNode[]> {
    const state = await this.loadState();
    return state.clusterNodes.filter(n => n.clusterId === clusterId);
  }

  /**
   * Get a specific cluster node
   */
  async getClusterNode(clusterId: string, twoWordId: string): Promise<ClusterNode | null> {
    const state = await this.loadState();
    return state.clusterNodes.find(n => 
      n.clusterId === clusterId && n.twoWordId === twoWordId
    ) || null;
  }

  /**
   * Get all cluster nodes
   */
  async getAllClusterNodes(): Promise<ClusterNode[]> {
    const state = await this.loadState();
    return state.clusterNodes;
  }

  /**
   * Get active node for a cluster
   */
  async getActiveClusterNode(clusterId: string): Promise<ClusterNode | null> {
    const nodes = await this.getClusterNodes(clusterId);
    return nodes.find(n => n.role === 'active') || null;
  }

  // Route management methods

  /**
   * Add or update a route in state
   */
  async upsertRoute(route: Route): Promise<void> {
    const state = await this.loadState();
    const existingIndex = state.routes.findIndex(r => 
      r.clusterId === route.clusterId && r.host === route.host
    );

    if (existingIndex >= 0) {
      state.routes[existingIndex] = route;
      this.logger.debug(`Updated route ${route.host} in cluster ${route.clusterId}`);
    } else {
      state.routes.push(route);
      this.logger.debug(`Added new route ${route.host} to cluster ${route.clusterId}`);
    }

    await this.saveState(state);
  }

  /**
   * Remove a route from state
   */
  async removeRoute(clusterId: string, host: string): Promise<boolean> {
    const state = await this.loadState();
    const initialLength = state.routes.length;
    state.routes = state.routes.filter(r => 
      !(r.clusterId === clusterId && r.host === host)
    );

    if (state.routes.length < initialLength) {
      await this.saveState(state);
      this.logger.debug(`Removed route ${host} from cluster ${clusterId}`);
      return true;
    }

    return false;
  }

  /**
   * Get routes for a specific cluster
   */
  async getClusterRoutes(clusterId: string): Promise<Route[]> {
    const state = await this.loadState();
    return state.routes.filter(r => r.clusterId === clusterId);
  }

  /**
   * Get a specific route
   */
  async getRoute(clusterId: string, host: string): Promise<Route | null> {
    const state = await this.loadState();
    return state.routes.find(r => 
      r.clusterId === clusterId && r.host === host
    ) || null;
  }

  /**
   * Get all routes
   */
  async getAllRoutes(): Promise<Route[]> {
    const state = await this.loadState();
    return state.routes;
  }

  /**
   * Clear cached state (for testing)
   */
  clearCache(): void {
    this.cachedState = null;
  }
}
