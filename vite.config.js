import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { defineProject } from 'vitest/config'
import { execSync } from 'node:child_process'
import path from 'path'

const coverageConfig = {
  provider: 'v8',
  include: [
    'src/utils/**',
    'src/components/AuthProvider.jsx',
    'src/components/schedule/costFunction.js',
    'src/components/schedule/staffingUtils.jsx',
    'src/components/staff/DoctorForm.jsx',
  ],
  exclude: ['src/**/__tests__/**', 'src/**/__component_tests__/**', '**/*.test.*'],
  reporter: ['text', 'lcov', 'json-summary', 'html'],
}

const unitProject = defineProject({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{js,jsx}', 'server/**/__tests__/**/*.test.js'],
    exclude: ['src/**/__component_tests__/**'],
  },
})

const componentProject = defineProject({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'component',
    environment: 'happy-dom',
    setupFiles: ['./src/test-utils/setup-tests.js'],
    include: ['src/**/__component_tests__/**/*.test.{js,jsx}'],
    css: true,
    clearMocks: true,
    restoreMocks: true,
  },
})

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function resolveCommitSha() {
  const explicitSha = firstNonEmptyString(
    process.env.VITE_APP_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.SOURCE_COMMIT,
  )
  if (explicitSha) {
    return explicitSha
  }
  try {
    return execSync('git rev-parse HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
  } catch {
    return ''
  }
}

const appCommitSha = resolveCommitSha()
const appCommitShortSha = appCommitSha ? appCommitSha.slice(0, 7) : ''

// https://vite.dev/config/
export default defineConfig({
  define: {
    'globalThis.__CURAFLOW_BUILD_INFO__': JSON.stringify({
      commitSha: appCommitSha,
      commitShortSha: appCommitShortSha,
    }),
  },
  test: {
    projects: [unitProject, componentProject],
    coverage: coverageConfig,
  },
  logLevel: 'error', // Suppress warnings, only show errors
  cacheDir: '.vite',
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Multi-page build: index.html (Mandanten-App) + master.html (Master-App)
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        master: path.resolve(__dirname, 'master.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
});
