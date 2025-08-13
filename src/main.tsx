import React from "react";
import { createRoot } from "react-dom/client";
import PosterizerPro from "../PosterizerPro";

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <PosterizerPro />
  </React.StrictMode>
);


