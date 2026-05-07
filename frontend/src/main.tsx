import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// Get root element
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

// Create React root
const root = createRoot(rootElement);

// Render app
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
