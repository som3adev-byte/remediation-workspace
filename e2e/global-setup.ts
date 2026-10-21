import { execSync } from 'node:child_process';

export default function globalSetup() {
  execSync('pnpm db:setup', { stdio: 'inherit' });
}
