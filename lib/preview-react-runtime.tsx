// Copyright © 2026 Alen Pepa
import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
class PreviewBoundary extends React.Component<{ children: React.ReactNode; onError: (message: string) => void }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error) { this.props.onError(error.message); }
  render() { return this.state.error ? React.createElement("pre", { style: { whiteSpace: "pre-wrap", padding: 20, color: "#c33" } }, this.state.error) : this.props.children; }
}
const packages: Record<string, unknown> = { react: React, "react-dom": ReactDOM, "react-dom/client": { createRoot }, "react/jsx-runtime": jsxRuntime, "lucide-react": icons };
export function requirePackage(name: string): unknown { if (!Object.hasOwn(packages, name)) throw Error("Unavailable package: " + name); return packages[name]; }
export { React, ReactDOM };
export function mount(component: React.ComponentType | React.ReactElement, host: HTMLElement, onError: (message: string) => void) {
  const element = React.isValidElement(component) ? component : React.createElement(component as React.ComponentType);
  createRoot(host).render(React.createElement(PreviewBoundary, { onError, children: element }));
}
