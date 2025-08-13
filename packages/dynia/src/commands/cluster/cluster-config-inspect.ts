import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { SSHExecutor } from '../../shared/utils/ssh.js';
import type { ClusterNode } from '../../shared/types/index.js';
import { Table } from 'console-table-printer';

export interface ClusterConfigInspectOptions {
  name: string;
  component?: string;
  node?: string;
  full?: boolean;
}

interface ComponentConfig {
  component: string;
  node: string;
  status: string;
  key_config: Record<string, string>;
  full_config?: string;
}

/**
 * Command to inspect live configuration of cluster nodes across all components
 * Shows configuration for Caddy, Docker, keepalived, and system info
 */
export class ClusterConfigInspectCommand extends BaseCommand<ClusterConfigInspectOptions> {
  private readonly supportedComponents = ['caddy', 'docker', 'keepalived', 'system'];

  protected async run(): Promise<void> {
    const { name: clusterName, component, node, full } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name']);

    if (component && !this.supportedComponents.includes(component)) {
      throw new Error(`Unsupported component '${component}'. Supported components: ${this.supportedComponents.join(', ')}`);
    }

    this.logger.info(`Inspecting configuration for cluster: ${clusterName}`);

    // Get cluster
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get cluster nodes
    const allNodes = await this.stateManager.getClusterNodes(clusterName);
    
    if (allNodes.length === 0) {
      this.logger.info(`No nodes found in cluster '${clusterName}'.`);
      this.logger.info(`Add nodes with: dynia cluster node add --name ${clusterName}`);
      return;
    }

    // Filter nodes if specified
    let targetNodes = allNodes;
    if (node) {
      targetNodes = allNodes.filter(n => n.twoWordId === node);
      if (targetNodes.length === 0) {
        throw new Error(`Node '${node}' not found in cluster '${clusterName}'.`);
      }
    }

    // Determine components to inspect
    const componentsToInspect = component ? [component] : this.supportedComponents;

    this.logger.info(`\nCluster: ${clusterName}`);
    this.logger.info(`Nodes: ${targetNodes.length} of ${allNodes.length}`);
    this.logger.info(`Components: ${componentsToInspect.join(', ')}`);
    this.logger.info(`Mode: ${full ? 'Full Configuration' : 'Summary'}\n`);

    // Collect configurations from all nodes and components
    const configurations: ComponentConfig[] = [];

    for (const targetNode of targetNodes) {
      this.logger.info(`Inspecting node: ${targetNode.twoWordId} (${targetNode.publicIp})`);
      
      for (const comp of componentsToInspect) {
        try {
          const config = await this.inspectComponent(targetNode, comp, full || false);
          configurations.push(config);
        } catch (error) {
          this.logger.warn(`Failed to inspect ${comp} on ${targetNode.twoWordId}: ${error}`);
          configurations.push({
            component: comp,
            node: targetNode.twoWordId,
            status: 'Error',
            key_config: { error: error instanceof Error ? error.message : String(error) }
          });
        }
      }
    }

    // Display results
    if (full) {
      this.displayFullConfiguration(configurations);
    } else {
      this.displaySummaryConfiguration(configurations);
    }

    // Show helpful commands
    console.log('\nUseful commands:');
    console.log(`  dynia cluster config inspect --name ${clusterName} --full # Show full configurations`);
    if (!component) {
      console.log(`  dynia cluster config inspect --name ${clusterName} --component caddy # Filter by component`);
    }
    if (!node && targetNodes.length > 1) {
      console.log(`  dynia cluster config inspect --name ${clusterName} --node ${targetNodes[0].twoWordId} # Filter by node`);
    }
    console.log(`  dynia cluster node list --name ${clusterName} # Show node status`);
  }

  /**
   * Inspect a specific component on a node
   */
  private async inspectComponent(node: ClusterNode, component: string, full: boolean): Promise<ComponentConfig> {
    const ssh = new SSHExecutor(node.publicIp, this.logger);

    switch (component) {
      case 'caddy':
        return await this.inspectCaddy(ssh, node, full);
      case 'docker':
        return await this.inspectDocker(ssh, node, full);
      case 'keepalived':
        return await this.inspectKeepalived(ssh, node, full);
      case 'system':
        return await this.inspectSystem(ssh, node, full);
      default:
        throw new Error(`Unknown component: ${component}`);
    }
  }

  /**
   * Inspect Caddy configuration and status
   */
  private async inspectCaddy(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'caddy',
      node: node.twoWordId,
      status: 'Unknown',
      key_config: {}
    };

    try {
      // Check container status
      const containerStatus = await ssh.executeCommand('docker ps --filter "name=dynia-caddy" --format "{{.Status}}"');
      config.status = containerStatus.trim() ? 'Running' : 'Stopped';

      // Get Caddyfile path and basic info
      const caddyfileExists = await ssh.executeCommand('test -f /opt/dynia/caddy/Caddyfile && echo "exists" || echo "missing"');
      config.key_config.caddyfile = caddyfileExists.trim();

      if (caddyfileExists.trim() === 'exists') {
        // Count domains in Caddyfile
        const domainCount = await ssh.executeCommand('grep -c "^[a-zA-Z0-9.-]\\+\\.[a-zA-Z]\\+.*{" /opt/dynia/caddy/Caddyfile || echo "0"');
        config.key_config.domains = domainCount.trim();

        // Check admin API
        try {
          await ssh.executeCommand('curl -f --connect-timeout 2 --max-time 5 http://localhost:2019/config/ >/dev/null 2>&1');
          config.key_config.admin_api = 'Accessible';
        } catch {
          config.key_config.admin_api = 'Not accessible';
        }

        if (full) {
          // Get full Caddyfile content
          config.full_config = await ssh.executeCommand('cat /opt/dynia/caddy/Caddyfile');
        }
      }

      // Check container health
      if (config.status === 'Running') {
        const healthStatus = await ssh.executeCommand('docker inspect dynia-caddy --format "{{.State.Health.Status}}" 2>/dev/null || echo "no-healthcheck"');
        config.key_config.health = healthStatus.trim();
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Inspect Docker configuration and status
   */
  private async inspectDocker(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'docker',
      node: node.twoWordId,
      status: 'Unknown',
      key_config: {}
    };

    try {
      // Check Docker daemon status
      const dockerStatus = await ssh.executeCommand('systemctl is-active docker || echo "inactive"');
      config.status = dockerStatus.trim() === 'active' ? 'Running' : 'Stopped';

      // Get container count
      const containerCount = await ssh.executeCommand('docker ps -q | wc -l');
      config.key_config.running_containers = containerCount.trim();

      // Get network count
      const networkCount = await ssh.executeCommand('docker network ls -q | wc -l');
      config.key_config.networks = networkCount.trim();

      // Check edge network
      const edgeNetwork = await ssh.executeCommand('docker network ls --filter "name=edge" --format "{{.Name}}" | head -1 || echo "missing"');
      config.key_config.edge_network = edgeNetwork.trim();

      // Get Docker version
      const dockerVersion = await ssh.executeCommand('docker --version | cut -d" " -f3 | cut -d"," -f1');
      config.key_config.version = dockerVersion.trim();

      if (full) {
        // Get detailed container information
        const containerDetails = await ssh.executeCommand('docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"');
        config.full_config = containerDetails;
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Inspect keepalived configuration and status
   */
  private async inspectKeepalived(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'keepalived',
      node: node.twoWordId,
      status: 'Unknown',
      key_config: {}
    };

    try {
      // Check if keepalived is installed/configured
      const keepalivedExists = await ssh.executeCommand('which keepalived >/dev/null 2>&1 && echo "installed" || echo "not-installed"');
      
      if (keepalivedExists.trim() === 'not-installed') {
        config.status = 'Not Configured';
        config.key_config.installation = 'Not installed';
        return config;
      }

      // Check service status
      const serviceStatus = await ssh.executeCommand('systemctl is-active keepalived 2>/dev/null || echo "inactive"');
      config.status = serviceStatus.trim() === 'active' ? 'Running' : 'Stopped';

      // Get configuration file info
      const configExists = await ssh.executeCommand('test -f /etc/keepalived/keepalived.conf && echo "exists" || echo "missing"');
      config.key_config.config_file = configExists.trim();

      if (configExists.trim() === 'exists') {
        // Get VRRP instance info
        const vrrpInstance = await ssh.executeCommand('grep -E "^\\s*state|^\\s*priority" /etc/keepalived/keepalived.conf | head -2 | tr "\\n" " " || echo "unknown"');
        config.key_config.vrrp_config = vrrpInstance.trim();

        if (full) {
          // Get full keepalived configuration
          config.full_config = await ssh.executeCommand('cat /etc/keepalived/keepalived.conf');
        }
      }

      // Check for VRRP traffic (indicates keepalived is working)
      if (config.status === 'Running') {
        const vrrpTraffic = await ssh.executeCommand('ip -br addr show | grep -q "scope global secondary" && echo "has-vip" || echo "no-vip"');
        config.key_config.virtual_ip = vrrpTraffic.trim();
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Inspect system configuration and status
   */
  private async inspectSystem(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'system',
      node: node.twoWordId,
      status: 'Running',
      key_config: {}
    };

    try {
      // Get system uptime
      const uptime = await ssh.executeCommand('uptime -p');
      config.key_config.uptime = uptime.trim();

      // Get memory usage
      const memUsage = await ssh.executeCommand('free -h | grep Mem | awk \'{print $3 "/" $2}\'');
      config.key_config.memory = memUsage.trim();

      // Get disk usage for /opt/dynia
      const diskUsage = await ssh.executeCommand('df -h /opt/dynia | tail -1 | awk \'{print $3 "/" $2 " (" $5 ")"}\'');
      config.key_config.disk_usage = diskUsage.trim();

      // Get load average
      const loadAvg = await ssh.executeCommand('cat /proc/loadavg | cut -d" " -f1-3');
      config.key_config.load_average = loadAvg.trim();

      // Check dynia directory structure
      const dyniaStructure = await ssh.executeCommand('find /opt/dynia -maxdepth 2 -type d | wc -l');
      config.key_config.dynia_dirs = dyniaStructure.trim();

      if (full) {
        // Get detailed system information
        const systemInfo = await ssh.executeCommand('uname -a; echo "---"; df -h; echo "---"; free -h; echo "---"; ps aux --sort=-%mem | head -10');
        config.full_config = systemInfo;
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Display summary configuration in table format
   */
  private displaySummaryConfiguration(configurations: ComponentConfig[]): void {
    const table = new Table({
      columns: [
        { name: 'node', title: 'Node', alignment: 'left' },
        { name: 'component', title: 'Component', alignment: 'left' },
        { name: 'status', title: 'Status', alignment: 'center' },
        { name: 'key_info', title: 'Key Configuration', alignment: 'left' }
      ]
    });

    configurations.forEach(config => {
      const statusIcon = this.getStatusIcon(config.status);
      const keyInfo = this.formatKeyInfo(config.key_config);

      table.addRow({
        node: config.node,
        component: config.component,
        status: `${statusIcon} ${config.status}`,
        key_info: keyInfo
      });
    });

    table.printTable();
  }

  /**
   * Display full configuration with detailed output
   */
  private displayFullConfiguration(configurations: ComponentConfig[]): void {
    configurations.forEach((config, index) => {
      if (index > 0) console.log('\n' + '='.repeat(80) + '\n');
      
      console.log(`Node: ${config.node} | Component: ${config.component}`);
      console.log(`Status: ${this.getStatusIcon(config.status)} ${config.status}`);
      
      if (Object.keys(config.key_config).length > 0) {
        console.log('\nKey Configuration:');
        Object.entries(config.key_config).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
      }

      if (config.full_config) {
        console.log('\nFull Configuration:');
        console.log('-'.repeat(40));
        console.log(config.full_config);
        console.log('-'.repeat(40));
      }
    });
  }

  /**
   * Get status icon for display
   */
  private getStatusIcon(status: string): string {
    switch (status.toLowerCase()) {
      case 'running':
        return '🟢';
      case 'stopped':
        return '🔴';
      case 'error':
        return '❌';
      case 'not configured':
        return '⚪';
      default:
        return '🟡';
    }
  }

  /**
   * Format key configuration info for table display
   */
  private formatKeyInfo(keyConfig: Record<string, string>): string {
    const items: string[] = [];
    
    Object.entries(keyConfig).forEach(([key, value]) => {
      if (key === 'error') {
        items.push(`❌ ${value}`);
      } else {
        items.push(`${key}: ${value}`);
      }
    });

    return items.slice(0, 3).join(', ') + (items.length > 3 ? '...' : '');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}