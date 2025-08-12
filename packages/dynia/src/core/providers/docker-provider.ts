import { readFile } from 'node:fs/promises';

import type { ILogger } from '@thaitype/core-utils';
import { parse as parseYaml } from 'yaml';

import { ExecaExecutor } from '../../executor/execa-executor.js';
import type { ComposeServiceInfo, ContainerInfo, IDockerProvider } from './interfaces.js';

/**
 * Docker provider implementation using docker and docker-compose CLI
 */
export class DockerProvider implements IDockerProvider {
  private readonly executor: ExecaExecutor;

  constructor(private readonly logger: ILogger) {
    this.executor = new ExecaExecutor();
  }

  /**
   * Execute docker-compose up
   */
  async composeUp(
    composeFile: string,
    options: {
      detach?: boolean;
      pull?: boolean;
    } = {}
  ): Promise<void> {
    const { detach = true, pull = true } = options;

    const args = ['compose', '-f', composeFile, 'up'];
    if (detach) args.push('-d');
    if (pull) args.push('--pull', 'always');

    this.logger.debug(`Running: docker ${args.join(' ')}`);
    await this.executor.run('docker', args);
  }

  /**
   * Execute docker-compose down
   */
  async composeDown(composeFile: string): Promise<void> {
    const args = ['compose', '-f', composeFile, 'down', '--remove-orphans'];

    this.logger.debug(`Running: docker ${args.join(' ')}`);
    await this.executor.run('docker', args);
  }

  /**
   * Parse compose file and extract service information
   */
  async getComposeServices(composeFile: string): Promise<ComposeServiceInfo[]> {
    try {
      const content = await readFile(composeFile, 'utf-8');
      const compose = parseYaml(content);

      if (!compose.services || typeof compose.services !== 'object') {
        throw new Error('Invalid compose file: no services found');
      }

      const services: ComposeServiceInfo[] = [];

      for (const [serviceName, serviceConfig] of Object.entries(compose.services)) {
        if (typeof serviceConfig !== 'object' || !serviceConfig) continue;

        const config = serviceConfig as Record<string, unknown>;
        const ports: number[] = [];
        const labels: Record<string, string> = {};

        // Extract ports
        if (config.ports && Array.isArray(config.ports)) {
          for (const port of config.ports) {
            if (typeof port === 'string') {
              const match = port.match(/:(\d+)$/);
              if (match) {
                ports.push(parseInt(match[1], 10));
              }
            } else if (typeof port === 'object' && port.target) {
              ports.push(port.target);
            }
          }
        }

        // Extract labels
        if (config.labels) {
          if (Array.isArray(config.labels)) {
            for (const label of config.labels) {
              if (typeof label === 'string') {
                const [key, ...valueParts] = label.split('=');
                if (key && valueParts.length > 0) {
                  labels[key] = valueParts.join('=');
                }
              }
            }
          } else if (typeof config.labels === 'object') {
            Object.assign(labels, config.labels);
          }
        }

        services.push({
          name: serviceName,
          ports,
          labels,
        });
      }

      return services;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse compose file: ${message}`);
    }
  }

  /**
   * Create Docker network
   */
  async createNetwork(name: string): Promise<void> {
    try {
      const args = ['network', 'create', name];
      this.logger.debug(`Running: docker ${args.join(' ')}`);
      await this.executor.run('docker', args);
    } catch (error) {
      // Ignore if network already exists
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already exists')) {
        throw error;
      }
      this.logger.debug(`Network ${name} already exists`);
    }
  }

  /**
   * Check if network exists
   */
  async networkExists(name: string): Promise<boolean> {
    try {
      const args = ['network', 'inspect', name];
      await this.executor.run('docker', args);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get container information
   */
  async getContainer(name: string): Promise<ContainerInfo | null> {
    try {
      const args = ['container', 'inspect', '--format', '{{.Id}},{{.Name}},{{.State.Status}}', name];

      const output = await this.execAndCapture('docker', args);
      const [id, containerName, status] = output.trim().split(',');

      // Get port information
      const portArgs = [
        'container',
        'inspect',
        '--format',
        '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} {{end}}',
        name,
      ];

      const portOutput = await this.execAndCapture('docker', portArgs);
      const ports = portOutput
        .trim()
        .split(' ')
        .filter(p => p)
        .map(portSpec => {
          const match = portSpec.match(/(\d+)\/(tcp|udp)/);
          return match ? { internal: parseInt(match[1], 10) } : null;
        })
        .filter((p): p is { internal: number } => p !== null);

      return {
        id,
        name: containerName.startsWith('/') ? containerName.slice(1) : containerName,
        status,
        ports,
      };
    } catch {
      return null;
    }
  }

  /**
   * Execute command in container
   */
  async exec(containerName: string, command: string[]): Promise<string> {
    const args = ['exec', containerName, ...command];
    return await this.execAndCapture('docker', args);
  }

  /**
   * Execute command and capture output (helper method)
   */
  private async execAndCapture(command: string, args: string[]): Promise<string> {
    // This is a simplified version - in a real implementation, you'd want to capture stdout
    // For now, we'll use a basic approach
    const { execa } = await import('execa');
    const result = await execa(command, args);
    return result.stdout;
  }
}
