import { BaseCommand } from '../../shared/base/base-command.js';

export interface ClusterNodeListOptions {
  'cluster-name': string;
}

export class ClusterNodeListCommand extends BaseCommand<ClusterNodeListOptions> {
  protected async run(): Promise<void> {
    // TODO: Implement node listing for cluster
    this.logger.info('Cluster node list command - Coming soon!');
    throw new Error('Cluster node list command not yet implemented');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}