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
    runBatchProcess: (
        jobName: string,
        soqlQuery: string,
        apexTemplate: string,
        targetOrg: string
    ) => Promise<void>;
    resumeBatchProcess: (targetOrg: string) => Promise<void>;
    onProcessUpdate: (
        callback: (event: IpcRendererEvent, message: string) => void
    ) => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
