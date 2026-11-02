import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/inter/index.css";
import "@fontsource/m-plus-rounded-1c/800.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
