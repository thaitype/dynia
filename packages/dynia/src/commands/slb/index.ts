import type { CommandModule } from 'yargs';

import type { GlobalConfigOptions } from '../../internal/types.js';
import { createCommandHandler } from '../../shared/base/base-command.js';
import { SlbSyncCommand } from './slb-sync.js';

/**
 * Load balancer synchronization command module
 */
export const slbCommand: CommandModule<GlobalConfigOptions> = {
  command: 'slb <action>',
  describe: 'Manage load balancer synchronization',
  builder: yargs =>
    yargs
      .command({
        command: 'sync',
        describe: 'Synchronize healthy nodes to load balancer',
        builder: yargs =>
          yargs
            .example('$0 slb sync', 'Sync all healthy nodes to Cloudflare Worker'),
        handler: createCommandHandler(SlbSyncCommand),
      })
      .demandCommand(1, 'Please specify an SLB action')
      .help(),
  handler: () => {
    // This will never be called due to demandCommand(1)
  },
};