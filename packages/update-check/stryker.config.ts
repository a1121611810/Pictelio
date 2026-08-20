// Stryker mutation testing 配置（ADR-0101：本地灵敏度门禁，不进 CI）
const config = {
  $schema: 'https://json.schemastore.org/stryker-mutator-report-schema.json',
  testRunner: 'vitest',
  mutate: ['src/index.ts'],
  coverageAnalysis: 'off',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { baseDir: 'dist/mutation-report' },
  thresholds: { high: 80, low: 60, break: 50 },
  concurrency: 4,
};

export default config;