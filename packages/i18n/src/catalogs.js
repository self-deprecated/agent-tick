// React Native Metro resolves the workspace source export and does not remap
// TypeScript's NodeNext .js specifiers back to .ts files. Keep this tiny shim
// so source-mode imports from index.ts can resolve during mobile bundling.
export * from "./catalogs.ts";
