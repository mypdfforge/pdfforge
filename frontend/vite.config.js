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
  server: { proxy: { '/api': 'http://localhost:8000' } }
})
