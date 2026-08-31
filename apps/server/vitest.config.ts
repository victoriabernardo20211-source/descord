import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Testes de integração só rodam quando há um Postgres de teste disponível.
    exclude: process.env.TEST_DATABASE_URL ? [] : ['test/integration/**'],
  },
});
