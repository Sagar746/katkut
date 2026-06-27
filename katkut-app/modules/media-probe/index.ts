// Re-export the native module. On web, it will be resolved to MediaProbeModule.web.ts
// and on native platforms to MediaProbeModule.ts
export { default } from './src/MediaProbeModule';
export * from './src/MediaProbe.types';
