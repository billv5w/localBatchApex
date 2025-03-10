import { IpcRendererEvent } from "electron";

interface ProcessedOrg {
    alias: string;
    username: string;
    instanceUrl: string;
    isDevHub: boolean;
    isDefaultDevHub: boolean;
    isDefaultOrg: boolean;
    isScratch: boolean;
    expirationDate?: string;
}

interface ElectronAPI {
    getSfdxOrgs: () => Promise<ProcessedOrg[]>;
    openOrg: (targetOrg: string) => Promise<string>;
    runBatchProcess: (
        jobName: string,
        soqlQuery: string,
        apexTemplate: string,
        targetOrg: string
    ) => Promise<void>;
    pauseBatchProcess: (jobName: string) => Promise<void>;
    resumeBatchProcess: (jobName: string, targetOrg: string) => Promise<void>;
    onProcessUpdate: (
        callback: (event: IpcRendererEvent, message: string) => void
    ) => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
