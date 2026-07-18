import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { isStandaloneHubHost, StandaloneHubAuth } from './components/StandaloneHubAuth.tsx';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const app = isStandaloneHubHost()
  ? <StandaloneHubAuth><App /></StandaloneHubAuth>
  : <App />;

root.render(<React.StrictMode>{app}</React.StrictMode>);
