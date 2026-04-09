import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      auto: 'src/auto.ts',
      'cli/create': 'src/cli/create.ts',
      'cli/install-docs': 'src/cli/install-docs.ts',
      'cli/tutorial': 'src/cli/tutorial.ts',
      'cli/report-issue': 'src/cli/report-issue.ts',
      'inspect/cli': 'src/inspect/cli.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ['hono', 'express', 'fastify', 'next', 'pino', 'winston', 'winston-transport'],
  },
  {
    entry: { 'testing/index': 'src/testing/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    external: ['hono', 'express', 'fastify', 'next', 'pino', 'winston', 'winston-transport'],
  },
  {
    entry: {
      'bridges/pino': 'src/bridges/pino.ts',
      'bridges/winston': 'src/bridges/winston.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    external: ['hono', 'express', 'fastify', 'next', 'pino', 'winston', 'winston-transport'],
  },
])
