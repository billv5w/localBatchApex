"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = require("path");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = require("fs/promises");
const fs_1 = require("fs");
const batchProcessor_1 = require("./batchProcessor");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Initialize batch processor with app's user data directory
const batchProcessor = new batchProcessor_1.BatchProcessor(electron_1.app.getPath("userData"));
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js"),
        },
    });
    const indexPath = path.join(__dirname, "index.html");
    mainWindow.loadFile(indexPath).catch((e) => {
        console.error("Failed to load index.html:", e);
        console.log("Looking for file at:", indexPath);
    });
    if (process.env.NODE_ENV === "development") {
        mainWindow.webContents.openDevTools();
    }
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on("activate", function () {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("window-all-closed", function () {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
// Storage directory for persisting data
const storageDir = path.join(electron_1.app.getPath("userData"), "storage");
const orgsFile = path.join(storageDir, "orgs.json");
// Save orgs to storage
const saveOrgsToStorage = (orgs) => {
    try {
        if (!(0, fs_1.existsSync)(storageDir)) {
            (0, fs_1.mkdirSync)(storageDir, { recursive: true });
        }
        (0, fs_1.writeFileSync)(orgsFile, JSON.stringify(orgs, null, 2));
        console.log("Saved orgs to storage");
    }
    catch (error) {
        console.error("Error saving orgs to storage:", error);
    }
};
// Load orgs from storage
const loadOrgsFromStorage = () => {
    try {
        if ((0, fs_1.existsSync)(orgsFile)) {
            const data = (0, fs_1.readFileSync)(orgsFile, "utf8");
            return JSON.parse(data);
        }
    }
    catch (error) {
        console.error("Error loading orgs from storage:", error);
    }
    return null;
};
// Get list of SFDX orgs
const getSfdxOrgs = async (useStorage = true) => {
    try {
        // Try to load from storage first if useStorage is true
        if (useStorage) {
            const storedOrgs = loadOrgsFromStorage();
            if (storedOrgs) {
                console.log("Loaded orgs from storage");
                return storedOrgs;
            }
        }
        console.log("Fetching SFDX orgs...");
        // First check if sf CLI is installed
        try {
            const { stdout: versionOutput } = await execAsync("sf --version");
            console.log("SF CLI version:", versionOutput);
        }
        catch (error) {
            console.error("SF CLI not found:", error);
            throw new Error("Salesforce CLI (sf) is not installed or not in PATH");
        }
        // Use sf org list command with JSON output
        console.log("Executing: sf org list --json");
        const { stdout, stderr } = await execAsync("sf org list --json");
        if (stderr) {
            console.error("Command stderr:", stderr);
        }
        console.log("Raw sf org list output:", stdout);
        if (!stdout.trim()) {
            console.log("No output from sf org list command");
            return [];
        }
        let result;
        try {
            result = JSON.parse(stdout);
            console.log("Parsed result:", result);
        }
        catch (error) {
            console.error("Failed to parse JSON output:", error);
            throw new Error("Failed to parse org list output");
        }
        if (!result?.result || typeof result.result !== "object") {
            console.error("Unexpected result format:", result);
            throw new Error("Unexpected org list format");
        }
        // Combine all org categories and remove duplicates based on username
        const orgMap = new Map();
        // Helper function to add orgs to map, preferring devHubs and active orgs
        const addOrgsToMap = (orgs) => {
            orgs.forEach((org) => {
                const existing = orgMap.get(org.username);
                if (!existing ||
                    (org.isDevHub && !existing.isDevHub) ||
                    (org.connectedStatus === "Connected" &&
                        existing.connectedStatus !== "Connected")) {
                    orgMap.set(org.username, org);
                }
            });
        };
        // Add orgs in priority order
        addOrgsToMap(result.result.devHubs || []);
        addOrgsToMap(result.result.nonScratchOrgs || []);
        addOrgsToMap(result.result.sandboxes || []);
        addOrgsToMap(result.result.scratchOrgs || []);
        addOrgsToMap(result.result.other || []);
        const allOrgs = Array.from(orgMap.values());
        console.log("All orgs before filtering:", allOrgs);
        // Filter out expired scratch orgs
        const filteredOrgs = allOrgs.filter((org) => {
            if (org.isScratch && org.expirationDate) {
                const expDate = new Date(org.expirationDate);
                const isExpired = expDate < new Date();
                if (isExpired) {
                    console.log(`Filtering out expired scratch org ${org.username}`);
                    return false;
                }
            }
            return true;
        });
        console.log("Filtered orgs:", filteredOrgs);
        const processedOrgs = filteredOrgs.map((org) => {
            const processed = {
                alias: org.alias || org.username,
                username: org.username,
                instanceUrl: org.instanceUrl || "",
                isDevHub: org.isDevHub || false,
                isDefaultDevHub: org.isDefaultDevHubUsername || false,
                isDefaultOrg: org.isDefaultUsername || false,
                isScratch: org.isScratch || false,
                expirationDate: org.expirationDate || org.trailExpirationDate,
            };
            console.log(`Processed org ${org.username}:`, processed);
            return processed;
        });
        console.log("Processed orgs:", processedOrgs);
        const sortedOrgs = processedOrgs.sort((a, b) => {
            // Sort by:
            // 1. Default org first
            // 2. Default DevHub second
            // 3. DevHubs third
            // 4. Then alphabetically by alias
            if (a.isDefaultOrg)
                return -1;
            if (b.isDefaultOrg)
                return 1;
            if (a.isDefaultDevHub)
                return -1;
            if (b.isDefaultDevHub)
                return 1;
            if (a.isDevHub && !b.isDevHub)
                return -1;
            if (!a.isDevHub && b.isDevHub)
                return 1;
            return a.alias.localeCompare(b.alias);
        });
        console.log("Final sorted orgs:", sortedOrgs);
        // Save to storage before returning
        saveOrgsToStorage(sortedOrgs);
        return sortedOrgs;
    }
    catch (error) {
        // If fetching fails and we haven't tried storage yet, try storage as fallback
        if (!useStorage) {
            const storedOrgs = loadOrgsFromStorage();
            if (storedOrgs) {
                console.log("Falling back to stored orgs");
                return storedOrgs;
            }
        }
        throw error;
    }
};
// Ensure required directories exist
async function ensureDirectories(jobName) {
    const dirs = [
        path.join("apex_files", jobName),
        path.join("execution_results", jobName),
    ];
    for (const dir of dirs) {
        try {
            await fs.access(dir);
        }
        catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }
}
// Sanitize text for command line
const sanitizeForCmd = (text) => {
    // Replace newlines with spaces and escape quotes
    return text
        .replace(/[\r\n]+/g, " ") // Replace newlines with spaces
        .replace(/"/g, '\\"') // Escape double quotes
        .trim(); // Remove leading/trailing whitespace
};
// Execute SOQL query and get record IDs
const executeSOQL = async (soql, targetOrg) => {
    const sanitizedSoql = sanitizeForCmd(soql);
    const { stdout } = await execAsync(`sf data query --query "${sanitizedSoql}" --target-org "${targetOrg}" --result-format csv | tail -n +2`);
    return stdout
        .trim()
        .split("\n")
        .filter((id) => id.length > 0); // Filter out empty lines
};
// Generate Apex files for each record ID
const generateApexFiles = (jobName, recordIds, apexTemplate) => {
    const jobDir = path.join("apex_files", jobName);
    const sanitizedTemplate = apexTemplate.trim(); // Preserve newlines but trim edges
    recordIds.forEach(async (recordId) => {
        const filePath = path.join(jobDir, `${recordId}.apex`);
        const fileContent = `Id recordId = '${recordId}';\n${sanitizedTemplate}`;
        await fs.writeFile(filePath, fileContent, "utf8");
    });
};
// Run the batch process
const runBatch = async (jobName, targetOrg, onProgress) => {
    const scriptPath = path.join(__dirname, "..", "bash", "run-folder.sh");
    const child = (0, child_process_1.exec)(`bash "${scriptPath}" "${targetOrg}" "${jobName}"`);
    let stdout = "";
    let stderr = "";
    // Stream stdout in real-time
    child.stdout?.on("data", (data) => {
        stdout += data;
        onProgress(data.toString());
    });
    // Stream stderr in real-time
    child.stderr?.on("data", (data) => {
        stderr += data;
        onProgress(`Error: ${data.toString()}`);
    });
    // Return a promise that resolves when the process completes
    return new Promise((resolve, reject) => {
        child.on("close", (code) => {
            if (code === 0 || code === null) {
                resolve({ stdout, stderr });
            }
            else {
                reject(new Error(`Process exited with code ${code}`));
            }
        });
        child.on("error", (error) => {
            reject(error);
        });
    });
};
// Track running processes
const runningProcesses = new Map();
// IPC Handlers
electron_1.ipcMain.handle("getSfdxOrgs", async (event, useStorage = true) => {
    return await getSfdxOrgs(useStorage);
});
electron_1.ipcMain.handle("openOrg", async (event, targetOrg) => {
    try {
        // Send status update to renderer
        event.sender.send("processUpdate", `Opening org ${targetOrg}...`);
        // Execute the command in the background
        const command = `sf org open --target-org ${targetOrg}`;
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
            if (error) {
                event.sender.send("processUpdate", `Error opening org: ${error.message}`);
                return;
            }
            if (stderr) {
                event.sender.send("processUpdate", `Warning: ${stderr}`);
            }
            event.sender.send("processUpdate", "Org opened in browser");
        });
        return "Opening org in browser...";
    }
    catch (error) {
        console.error("Error opening org:", error);
        throw error;
    }
});
async function saveJobToStorage(jobName, data) {
    const jobsPath = path.join(electron_1.app.getPath("userData"), "jobs.json");
    let jobs = {};
    try {
        const content = await fs.readFile(jobsPath, "utf8");
        jobs = JSON.parse(content);
    }
    catch (error) {
        // File doesn't exist or is invalid, start with empty object
    }
    jobs[jobName] = {
        ...jobs[jobName],
        ...data,
        jobName,
    };
    await fs.writeFile(jobsPath, JSON.stringify(jobs, null, 2), "utf8");
}
// Load jobs from storage
async function loadJobsFromStorage() {
    const jobsPath = path.join(electron_1.app.getPath("userData"), "jobs.json");
    try {
        const content = await fs.readFile(jobsPath, "utf8");
        return JSON.parse(content);
    }
    catch (error) {
        return {};
    }
}
// Load specific job from storage
async function loadJobFromStorage(jobName) {
    const jobs = await loadJobsFromStorage();
    const normalizedJobName = jobName.toLowerCase();
    // Find the job with case-insensitive matching
    const matchingJob = Object.entries(jobs).find(([key]) => key.toLowerCase() === normalizedJobName);
    if (matchingJob) {
        // Include the job name in the returned data
        return {
            ...matchingJob[1],
            jobName: matchingJob[0], // Add the original job name
        };
    }
    return null;
}
// Open folder in system file explorer
async function openFolder(folderPath) {
    try {
        // Convert to absolute path using the user data directory
        const absolutePath = path.isAbsolute(folderPath)
            ? folderPath
            : path.join(electron_1.app.getPath("userData"), folderPath);
        await fs.access(absolutePath);
        const { shell } = require("electron");
        await shell.openPath(absolutePath);
        return true;
    }
    catch (error) {
        console.error("Error opening folder:", error);
        return false;
    }
}
// Update IPC Handlers
electron_1.ipcMain.handle("getJobs", async () => {
    return loadJobsFromStorage();
});
electron_1.ipcMain.handle("getJob", async (event, jobName) => {
    return loadJobFromStorage(jobName);
});
electron_1.ipcMain.handle("openScriptsFolder", async (event, jobName) => {
    const normalizedJobName = jobName.toLowerCase();
    const folderPath = path.join("apex_files", normalizedJobName);
    return openFolder(folderPath);
});
electron_1.ipcMain.handle("openResultsFolder", async (event, jobName) => {
    const normalizedJobName = jobName.toLowerCase();
    const folderPath = path.join("execution_results", normalizedJobName);
    return openFolder(folderPath);
});
// Prepare batch files without executing
const prepareBatchFiles = async (event, jobName, soqlQuery, apexTemplate, targetOrg) => {
    try {
        // Execute SOQL query
        const sanitizedSoql = sanitizeForCmd(soqlQuery);
        const { stdout } = await execAsync(`sf data query --query "${sanitizedSoql}" --target-org "${targetOrg}" --json`);
        const queryResult = JSON.parse(stdout);
        const records = queryResult.result.records;
        const recordIds = records.map((record) => record.Id);
        // Generate Apex files
        await batchProcessor.generateApexFiles({
            jobName,
            targetOrg,
            recordIds,
            apexTemplate,
            onProgress: (message) => {
                event.sender.send("processUpdate", message);
            },
        });
        // Save job data
        await saveJobToStorage(jobName, {
            targetOrg,
            soqlQuery,
            apexTemplate,
            status: "prepared",
            timestamp: new Date().toISOString(),
        });
        const dirs = batchProcessor.getDirectories(jobName);
        return {
            recordCount: recordIds.length,
            jobDir: dirs.apexDir,
        };
    }
    catch (error) {
        console.error("Error preparing batch files:", error);
        throw error;
    }
};
electron_1.ipcMain.handle("prepareBatchFiles", async (event, jobName, soqlQuery, apexTemplate, targetOrg) => {
    return await prepareBatchFiles(event, jobName, soqlQuery, apexTemplate, targetOrg);
});
// Pause batch process
electron_1.ipcMain.handle("pauseBatchProcess", async (event, jobName) => {
    try {
        await batchProcessor.pause();
        await saveJobToStorage(jobName, {
            status: "paused",
            timestamp: new Date().toISOString(),
        });
        return true;
    }
    catch (error) {
        console.error("Error pausing batch process:", error);
        throw error;
    }
});
// Resume batch process
electron_1.ipcMain.handle("resumeBatchProcess", async (event, jobName) => {
    try {
        const jobData = await loadJobFromStorage(jobName);
        if (!jobData) {
            throw new Error(`No data found for job: ${jobName}`);
        }
        await batchProcessor.resume();
        const result = await batchProcessor.runBatchProcess({
            jobName,
            targetOrg: jobData.targetOrg,
            recordIds: [], // Not needed for resuming
            apexTemplate: jobData.apexTemplate,
            onProgress: (message) => {
                event.sender.send("processUpdate", message);
            },
        });
        // Update job status
        await saveJobToStorage(jobName, {
            ...jobData,
            status: "completed",
            result,
            timestamp: new Date().toISOString(),
        });
        return result;
    }
    catch (error) {
        console.error("Error resuming batch process:", error);
        throw error;
    }
});
// Open org using sf CLI
const openOrg = async (targetOrg) => {
    try {
        console.log(`Opening org: ${targetOrg}`);
        const { stdout, stderr } = await execAsync(`sf org open --target-org ${targetOrg}`);
        if (stderr) {
            console.error("Error opening org:", stderr);
            throw new Error(stderr);
        }
        return stdout;
    }
    catch (error) {
        console.error("Failed to open org:", error);
        throw error;
    }
};
// Run batch process handler
electron_1.ipcMain.handle("runBatchProcess", async (event, jobName, soqlQuery, apexTemplate, targetOrg) => {
    try {
        const result = await batchProcessor.runBatchProcess({
            jobName,
            targetOrg,
            recordIds: [], // Not needed for running, only for preparation
            apexTemplate,
            onProgress: (message) => {
                event.sender.send("processUpdate", message);
            },
        });
        // Update job status
        await saveJobToStorage(jobName, {
            targetOrg,
            soqlQuery,
            apexTemplate,
            status: "completed",
            result,
            timestamp: new Date().toISOString(),
        });
        return result;
    }
    catch (error) {
        console.error("Error running batch process:", error);
        throw error;
    }
});
//# sourceMappingURL=main.js.map