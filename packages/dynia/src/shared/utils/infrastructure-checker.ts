import type { ILogger } from '@thaitype/core-utils';
import { SSHExecutor } from './ssh.js';

export interface InfrastructureState {
  sshConnectable: boolean;
  dockerInstalled: boolean;
  edgeNetworkExists: boolean;
  caddyRunning: boolean;
  placeholderRunning: boolean;
  httpsAccessible: boolean;
  errors: string[];
}

export interface InfrastructureCheckOptions {
  nodeName: string;
  nodeIp: string;
  domain: string;
  healthPath?: string;
}

/**
 * Stateless infrastructure checker that inspects remote server state
 */
export class InfrastructureChecker {
  private readonly ssh: SSHExecutor;

  constructor(
    private readonly options: InfrastructureCheckOptions,
    private readonly logger: ILogger
  ) {
    this.ssh = new SSHExecutor(options.nodeIp, logger);
  }

  /**
   * Check complete infrastructure state
   */
  async checkInfrastructure(): Promise<InfrastructureState> {
    const state: InfrastructureState = {
      sshConnectable: false,
      dockerInstalled: false,
      edgeNetworkExists: false,
      caddyRunning: false,
      placeholderRunning: false,
      httpsAccessible: false,
      errors: []
    };

    try {
      // Test SSH connectivity first
      state.sshConnectable = await this.checkSSHConnectivity();
      
      if (!state.sshConnectable) {
        state.errors.push('Cannot connect to VM via SSH');
        return state; // Can't check anything else without SSH
      }

      // Check Docker installation
      state.dockerInstalled = await this.checkDockerInstallation();
      if (!state.dockerInstalled) {
        state.errors.push('Docker is not installed');
      }

      // Check edge network
      if (state.dockerInstalled) {
        state.edgeNetworkExists = await this.checkEdgeNetwork();
        if (!state.edgeNetworkExists) {
          state.errors.push('Docker edge network does not exist');
        }
      }

      // Check Caddy service
      if (state.dockerInstalled) {
        state.caddyRunning = await this.checkCaddyService();
        if (!state.caddyRunning) {
          state.errors.push('Caddy service is not running');
        }
      }

      // Check placeholder service
      if (state.dockerInstalled) {
        state.placeholderRunning = await this.checkPlaceholderService();
        if (!state.placeholderRunning) {
          state.errors.push('Placeholder service is not running');
        }
      }

      // Check HTTPS accessibility
      state.httpsAccessible = await this.checkHTTPSAccessibility();
      if (!state.httpsAccessible) {
        state.errors.push('HTTPS endpoint is not accessible');
      }

    } catch (error) {
      state.errors.push(`Infrastructure check failed: ${error}`);
    }

    return state;
  }

  /**
   * Check if SSH connection is possible
   */
  async checkSSHConnectivity(): Promise<boolean> {
    try {
      await this.ssh.testConnection();
      return true;
    } catch (error) {
      this.logger.debug(`SSH connectivity check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if Docker is installed and running
   */
  async checkDockerInstallation(): Promise<boolean> {
    try {
      await this.ssh.executeCommand('docker --version');
      await this.ssh.executeCommand('docker compose version');
      
      // Check if Docker daemon is running
      await this.ssh.executeCommand('docker info');
      
      return true;
    } catch (error) {
      this.logger.debug(`Docker installation check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if edge network exists
   */
  async checkEdgeNetwork(): Promise<boolean> {
    try {
      const result = await this.ssh.executeCommand('docker network ls --format "{{.Name}}"');
      return result.split('\n').includes('edge');
    } catch (error) {
      this.logger.debug(`Edge network check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if Caddy service is running
   */
  async checkCaddyService(): Promise<boolean> {
    try {
      // Check if Caddy container exists and is running
      const result = await this.ssh.executeCommand(
        'cd /opt/dynia/caddy && docker compose ps --format json || echo "[]"'
      );
      
      const services = JSON.parse(result.trim() || '[]');
      const caddyService = Array.isArray(services) 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? services.find((service: any) => service.Service === 'caddy')
        : services.Service === 'caddy' ? services : null;
      
      return caddyService && caddyService.State === 'running';
    } catch (error) {
      this.logger.debug(`Caddy service check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if placeholder service is running
   */
  async checkPlaceholderService(): Promise<boolean> {
    try {
      // Check if placeholder container exists and is running
      const result = await this.ssh.executeCommand(
        'cd /opt/dynia/placeholder && docker compose ps --format json || echo "[]"'
      );
      
      const services = JSON.parse(result.trim() || '[]');
      const placeholderService = Array.isArray(services) 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? services.find((service: any) => service.Service === 'placeholder')
        : services.Service === 'placeholder' ? services : null;
      
      return placeholderService && placeholderService.State === 'running';
    } catch (error) {
      this.logger.debug(`Placeholder service check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if HTTPS endpoint is accessible from the internet
   */
  async checkHTTPSAccessibility(): Promise<boolean> {
    try {
      const fqdn = `${this.options.nodeName}.${this.options.domain}`;
      const healthPath = this.options.healthPath || '/';
      const url = `https://${fqdn}${healthPath}`;
      
      // Test from the server itself first (through Caddy)
      const result = await this.ssh.executeCommand(
        `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 30 "${url}" || echo "000"`
      );
      
      const statusCode = parseInt(result.trim());
      return statusCode >= 200 && statusCode < 400;
    } catch (error) {
      this.logger.debug(`HTTPS accessibility check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check specific service health with custom command
   */
  async checkServiceHealth(serviceName: string, healthCommand: string): Promise<boolean> {
    try {
      await this.ssh.executeCommand(healthCommand);
      return true;
    } catch (error) {
      this.logger.debug(`${serviceName} health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Get detailed service information
   */
  async getServiceDetails(): Promise<{
    docker: string;
    networks: string[];
    containers: Array<{ name: string; status: string; image: string }>;
  }> {
    const details = {
      docker: '',
      networks: [] as string[],
      containers: [] as Array<{ name: string; status: string; image: string }>
    };

    try {
      // Get Docker version
      details.docker = await this.ssh.executeCommand('docker --version');
      
      // Get networks
      const networksOutput = await this.ssh.executeCommand('docker network ls --format "{{.Name}}"');
      details.networks = networksOutput.split('\n').filter(name => name.trim());
      
      // Get running containers
      const containersOutput = await this.ssh.executeCommand(
        'docker ps --format "{{.Names}}|{{.Status}}|{{.Image}}"'
      );
      
      details.containers = containersOutput
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [name, status, image] = line.split('|');
          return { name, status, image };
        });
        
    } catch (error) {
      this.logger.debug(`Failed to get service details: ${error}`);
    }

    return details;
  }

  /**
   * Test internal network connectivity between services
   */
  async testInternalConnectivity(): Promise<boolean> {
    try {
      // Test if placeholder service is reachable from within the network
      const result = await this.ssh.executeCommand(
        'docker exec dynia-caddy wget --spider --timeout=10 http://placeholder:8080/ 2>&1 || echo "FAILED"'
      );
      
      return !result.includes('FAILED');
    } catch (error) {
      this.logger.debug(`Internal connectivity test failed: ${error}`);
      return false;
    }
  }
}