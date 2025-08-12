import { BaseCommand } from '../../shared/base/base-command.js';

export interface ClusterNodeRemoveOptions {
  'cluster-name': string;
  'node-id': string;
  confirm?: boolean;
}

export class ClusterNodeRemoveCommand extends BaseCommand<ClusterNodeRemoveOptions> {
  protected async run(): Promise<void> {
    // TODO: Implement node removal
    this.logger.info('Cluster node remove command - Coming soon!');
    throw new Error('Cluster node remove command not yet implemented');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}