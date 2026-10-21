import { createApp } from './app';
import { env } from './config/env';
import { logger } from './common/logger';

async function main() {
  const app = await createApp();
  // Loopback only: the browser never talks to the API directly, only the web proxy does.
  await app.listen(env().API_PORT, '127.0.0.1');
  logger.info({ port: env().API_PORT }, 'api listening on 127.0.0.1');
}

main().catch((err) => {
  logger.fatal({ err: { message: err instanceof Error ? err.message : String(err) } }, 'api failed to start');
  process.exit(1);
});
