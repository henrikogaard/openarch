import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        // One vendor chunk (splitting further creates circular-chunk warnings
        // via zustand/react-is); lazy tabs (AI, enrichment/IaC) still split
        // into their own async chunks via React.lazy.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
