import type { ILogger } from '@thaitype/core-utils';
import { ConsoleLogger } from '@thaitype/core-utils';

export function handlerError(error: unknown, logger: ILogger | undefined, exitCode = 3): void {
  if (logger === undefined) {
    logger = new ConsoleLogger('error');
  }
  if (error instanceof Error) {
    logger.error(`Error: ${error.message}`);
    if (logger.level === 'debug') {
      logger.error('Error stack trace:');
      logger.error(error.stack ?? 'Unknown error stack');
    }
  } else {
    logger.error(`Error: ${error}`);
  }
  process.exit(exitCode);
}
