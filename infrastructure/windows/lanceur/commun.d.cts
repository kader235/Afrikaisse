/** Types de commun.cjs (console Electron et tests). */
export interface PortInfo {
  port: number;
  nodeId: string;
}

export interface Health {
  status: string;
  profile: string;
  nodeId: string;
  database?: string;
  version: string;
  build?: string;
  time?: number;
  lanUrls?: string[];
  configured?: boolean;
}

export interface Paths {
  data: string;
  database: string;
  portFile: string;
  serverPid: string;
  supervisorPid: string;
  logs: string;
  backups: string;
}

export interface RunResult {
  code: number;
  output: string;
  timedOut: boolean;
}

export declare const TASK_NAME: string;
export declare const PREFERRED_PORT: number;
export declare const CANDIDATE_PORTS: number[];
export declare const RESTART_DELAYS_MS: number[];
export declare const STABLE_UPTIME_MS: number;

export declare function dataDir(env?: Record<string, string | undefined>): string;
export declare function paths(data: string): Paths;
export declare function parsePortFile(text: string): PortInfo | null;
export declare function readPortFile(file: string): PortInfo | null;
export declare function readPid(file: string): number | null;
export declare function isOwnHealth(health: unknown, nodeId: string | undefined): health is Health;
export declare function fetchHealth(port: number, timeoutMs?: number): Promise<Health | null>;
export declare function healthy(info: PortInfo | null, timeoutMs?: number): Promise<boolean>;
export declare function serverEnv(options: { app: string; data: string; env?: Record<string, string | undefined> }): Record<string, string | undefined>;
export declare function restartDelay(crashesInRow: number): number;
export declare function run(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string; env?: Record<string, string | undefined> }): Promise<RunResult>;
export declare function system32(name: string): string;
export declare function schtasks(args: string[], timeoutMs?: number): Promise<RunResult>;
export declare function taskInstalled(): Promise<boolean>;
export declare function runTask(): Promise<RunResult>;
export declare function isAlive(pid: number | null): boolean;
export declare function parseTasklistImage(output: string): string | null;
export declare function processImage(pid: number): Promise<{ ok: boolean; image: string | null }>;
export declare function isNodeProcess(pid: number, whenUnknown: boolean): Promise<boolean>;
export declare function stopProcesses(p: Paths): Promise<void>;
