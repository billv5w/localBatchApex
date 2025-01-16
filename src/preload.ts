import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
    getSfdxOrgs: (useStorage: boolean = true) =>
        ipcRenderer.invoke("getSfdxOrgs", useStorage),
    openOrg: (targetOrg: string) => ipcRenderer.invoke("openOrg", targetOrg),
    prepareBatchFiles: (
        jobName: string,
        soqlQuery: string,
        apexTemplate: string,
        targetOrg: string
    ) =>
        ipcRenderer.invoke(
            "prepareBatchFiles",
            jobName,
            soqlQuery,
            apexTemplate,
            targetOrg
        ),
    runBatchProcess: (
        jobName: string,
        soqlQuery: string,
        apexTemplate: string,
        targetOrg: string
    ) =>
        ipcRenderer.invoke(
            "runBatchProcess",
            jobName,
            soqlQuery,
            apexTemplate,
            targetOrg
        ),
    pauseBatchProcess: (jobName: string) =>
        ipcRenderer.invoke("pauseBatchProcess", jobName),
    resumeBatchProcess: (jobName: string, targetOrg: string) =>
        ipcRenderer.invoke("resumeBatchProcess", jobName, targetOrg),
    onProcessUpdate: (
        callback: (event: Electron.IpcRendererEvent, message: string) => void
    ) => ipcRenderer.on("processUpdate", callback),
    getJobs: () => ipcRenderer.invoke("getJobs"),
    getJob: (jobName: string) => ipcRenderer.invoke("getJob", jobName),
    openScriptsFolder: (jobName: string) =>
        ipcRenderer.invoke("openScriptsFolder", jobName),
    openResultsFolder: (jobName: string) =>
        ipcRenderer.invoke("openResultsFolder", jobName),
});
