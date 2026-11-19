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
        // Split heavyweight office dependencies (docx/pptxgenjs are several
        // MBs and only used by manual exports) plus any other unused-on-load
        // library out of the initial vendor chunk; UI tabs stay in vendor.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('docx') || id.includes('pptxgenjs') || id.includes('jszip')) {
            return 'office';
          }
          if (id.includes('@xyflow') || id.includes('zustand')) return 'flow';
          return 'vendor';
        },
      },
    },
  },
});
