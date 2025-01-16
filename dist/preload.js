"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    getSfdxOrgs: (useStorage = true) => electron_1.ipcRenderer.invoke("getSfdxOrgs", useStorage),
    openOrg: (targetOrg) => electron_1.ipcRenderer.invoke("openOrg", targetOrg),
    prepareBatchFiles: (jobName, soqlQuery, apexTemplate, targetOrg) => electron_1.ipcRenderer.invoke("prepareBatchFiles", jobName, soqlQuery, apexTemplate, targetOrg),
    runBatchProcess: (jobName, soqlQuery, apexTemplate, targetOrg) => electron_1.ipcRenderer.invoke("runBatchProcess", jobName, soqlQuery, apexTemplate, targetOrg),
    pauseBatchProcess: (jobName) => electron_1.ipcRenderer.invoke("pauseBatchProcess", jobName),
    resumeBatchProcess: (jobName, targetOrg) => electron_1.ipcRenderer.invoke("resumeBatchProcess", jobName, targetOrg),
    onProcessUpdate: (callback) => electron_1.ipcRenderer.on("processUpdate", callback),
    getJobs: () => electron_1.ipcRenderer.invoke("getJobs"),
    getJob: (jobName) => electron_1.ipcRenderer.invoke("getJob", jobName),
    openScriptsFolder: (jobName) => electron_1.ipcRenderer.invoke("openScriptsFolder", jobName),
    openResultsFolder: (jobName) => electron_1.ipcRenderer.invoke("openResultsFolder", jobName),
});
//# sourceMappingURL=preload.js.map