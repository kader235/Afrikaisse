/** Types de tache.cjs (tests). */
export declare const LOCAL_SERVICE_SID: string;
export declare const TASK_SDDL: string;
export declare function escapeXml(value: string): string;
export declare function buildTaskXml(options: { nodeExe: string; script: string; workingDir: string; securityDescriptor?: string | null }): string;
export declare function encodeTaskXml(xml: string): Buffer;
