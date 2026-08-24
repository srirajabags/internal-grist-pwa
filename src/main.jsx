import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Auth0Provider } from '@auth0/auth0-react'
import './index.css'
import App from './App.jsx'
import UpdateGate from './components/UpdateGate.jsx'

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const gristServerUrl = import.meta.env.VITE_GRIST_SERVER_URL;

if (!domain || !clientId || !gristServerUrl) {
  console.error("Auth0 Domain, Client ID, and Grist Server URL are required in .env");
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      // Without these the SDK keeps tokens in memory only, so every page refresh
      // drops the session and falls back to a silent-auth iframe -- which modern
      // browsers block as a third-party cookie, hence the surprise logouts.
      // localStorage survives the reload; the refresh token renews it after that.
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback
      authorizationParams={{
        redirect_uri: window.location.origin,
        scope: 'openid profile email offline_access',
      }}
    >
      <BrowserRouter>
        {/* Wraps every route so a stale build is caught on the login screen too. */}
        <UpdateGate>
          <App />
        </UpdateGate>
      </BrowserRouter>
    </Auth0Provider>
  </StrictMode>,
)
