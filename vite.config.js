import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'SRB Grist PWA',
        short_name: 'SRB Grist PWA',
        description: 'SRB Grist PWA for team use',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        shortcuts: [
          {
            name: 'Factory View',
            short_name: 'Factory',
            description: 'View today\'s factory updates',
            url: '/factory',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'Telecaller View',
            short_name: 'Telecaller',
            description: 'Manage telecaller operations and calls',
            url: '/telecaller',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'Salesman View',
            short_name: 'Salesman',
            description: 'Manage salesman visits and conversations',
            url: '/salesman',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'Design Confirmation',
            short_name: 'Design',
            description: 'Review and confirm design submissions',
            url: '/design',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'Custom Table Viewer',
            short_name: 'Tables',
            description: 'View and explore Grist data tables',
            url: '/table',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'Analyse with SQL',
            short_name: 'SQL',
            description: 'Execute custom SQL queries on Grist data',
            url: '/sql',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'Data Dashboards',
            short_name: 'Dashboards',
            description: 'View and manage your data dashboards',
            url: '/dashboards',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          }
        ]
      }
    })
  ],
})
