declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  argv: string[];
  exitCode?: number;
};
