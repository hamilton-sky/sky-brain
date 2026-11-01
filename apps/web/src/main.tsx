import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) {
  throw new Error("The page has no #root element.");
}

createRoot(root).render(
  <StrictMode>
    <h1>sky-brain</h1>
  </StrictMode>,
);
