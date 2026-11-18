import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 750,
    // Lazy tabs (AI, enrichment/IaC) split into their own async chunks via
    // React.lazy; everything else stays in the entry + vendor chunk.
  },
});
