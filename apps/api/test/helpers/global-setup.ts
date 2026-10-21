import { execSync } from 'node:child_process';

/** Applies every migration (schema + RLS + grants) to the test database once per run. */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
  });
}
