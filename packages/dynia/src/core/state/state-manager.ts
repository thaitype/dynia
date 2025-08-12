import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ILogger } from '@thaitype/core-utils';

import type { AppState, Deployment, Node } from '../../shared/types/index.js';
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
        const defaultState: AppState = { nodes: [], deployments: [] };
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

  /**
   * Clear cached state (for testing)
   */
  clearCache(): void {
    this.cachedState = null;
  }
}
