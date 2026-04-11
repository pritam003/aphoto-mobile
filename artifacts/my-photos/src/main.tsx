import { createRoot } from "react-dom/client";
import App from "./App";
import { setBaseUrl } from "@workspace/api-client-react";
import "./index.css";

// Initialize API base URL
const apiBase = import.meta.env.VITE_API_BASE_URL || "/";
setBaseUrl(apiBase);

createRoot(document.getElementById("root")!).render(<App />);
