import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// Configure PDF.js worker before mounting
if (window.pdfjsLib && window.pdfjsLibUrl) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsLibUrl;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);