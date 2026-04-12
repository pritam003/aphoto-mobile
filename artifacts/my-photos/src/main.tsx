import { createRoot } from "react-dom/client";
import App from "./App";
import { setBaseUrl } from "@workspace/api-client-react";
import "./index.css";

// Initialize API base URL - point to the Container App in production
const apiBase = import.meta.env.VITE_API_URL || "";
setBaseUrl(apiBase || null);

createRoot(document.getElementById("root")!).render(<App />);
