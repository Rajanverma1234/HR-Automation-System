import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import CandidateApp from "./CandidateApp";
import ErrorBoundary from "./components/ErrorBoundary";

/** /apply is the page HR sends to candidates (upload + AI call only); everything else is the HR dashboard. */
const isCandidatePage = /^\/apply\/?$/.test(window.location.pathname);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      {isCandidatePage ? <CandidateApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
