import { BaseCommand } from '../../shared/base/base-command.js';

export interface ClusterNodeActivateOptions {
  'cluster-name': string;
  'node-id': string;
}

export class ClusterNodeActivateCommand extends BaseCommand<ClusterNodeActivateOptions> {
  protected async run(): Promise<void> {
    // TODO: Implement node activation (Reserved IP reassignment)
    this.logger.info('Cluster node activate command - Coming soon!');
    throw new Error('Cluster node activate command not yet implemented');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}