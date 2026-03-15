import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CLAUDE_THEME, applyTheme } from "./lib/theme";

// Apply theme CSS variables before first render
applyTheme(CLAUDE_THEME);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
