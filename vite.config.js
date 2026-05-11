import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { defineProject } from 'vitest/config'
import path from 'path'

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
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    exclude: ['src/**/__component_tests__/**'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/components/schedule/costFunction.js', 'src/components/schedule/staffingUtils.jsx'],
      exclude: ['src/**/__tests__/**', 'src/**/__component_tests__/**', '**/*.test.*'],
      reporter: ['text', 'lcov'],
    },
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

// https://vite.dev/config/
export default defineConfig({
  test: {
    projects: [unitProject, componentProject],
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
