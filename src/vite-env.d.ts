/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "test" for the experiment build published under /test/ */
  readonly VITE_CHANNEL?: string;
}
