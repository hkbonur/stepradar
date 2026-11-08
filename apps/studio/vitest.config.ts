import { defineConfig } from 'vitest/config'
import { reactCompiler } from '../../vitest.react-compiler.mts'

export default defineConfig({
  plugins: [reactCompiler()],
  resolve: { tsconfigPaths: true },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'worker/**/*.test.ts'], environment: 'node' },
})
