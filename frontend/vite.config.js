import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL || 'https://mypdfforge.onrender.com/api'
    ),
    'import.meta.env.VITE_BRAIN_URL': JSON.stringify(
      process.env.VITE_BRAIN_URL || ''
    ),
    'import.meta.env.VITE_OCR_SPACE_API_KEY': JSON.stringify(
      process.env.VITE_OCR_SPACE_API_KEY || ''
    )
  },
  server: { proxy: { '/api': 'http://localhost:8000' } },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split heavy conversion libs into separate lazy chunks
          if (id.includes('jspdf-autotable')) return 'jspdf-autotable'
          if (id.includes('jspdf'))           return 'jspdf'
          if (id.includes('html2canvas'))     return 'html2canvas'
          if (id.includes('mammoth'))         return 'mammoth'
          if (id.includes('node_modules/react')) return 'react-vendor'
          if (id.includes('@cantoo/pdf-lib')) return 'pdf-lib'
        }
      }
    }
  }
})
