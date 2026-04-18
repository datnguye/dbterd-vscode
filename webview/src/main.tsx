import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@xyflow/react/dist/style.css";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("dbterd: #root element missing from webview HTML");
}
const serverUrl = rootEl.dataset.serverUrl ?? "http://localhost:8581";

createRoot(rootEl).render(
  <StrictMode>
    <App serverUrl={serverUrl} />
  </StrictMode>,
);
