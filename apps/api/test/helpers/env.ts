// Point everything at the isolated test database before any module reads the env.
import 'reflect-metadata';

const required = ['TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL'] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} must be set (see .env.example).`);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.MIGRATION_DATABASE_URL = process.env.TEST_MIGRATION_DATABASE_URL;
process.env.NODE_ENV = 'test';
