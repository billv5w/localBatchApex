import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { BatchProcessor } from "./batchProcessor";

const execAsync = promisify(exec);

// Initialize batch processor with app's user data directory
const batchProcessor = new BatchProcessor(app.getPath("userData"));

let mainWindow: BrowserWindow | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
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

app.whenReady().then(() => {
    createWindow();

    app.on("activate", function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", function () {
    if (process.platform !== "darwin") app.quit();
});

// SF CLI org response type
interface SfOrg {
    alias?: string;
    username: string;
    instanceUrl?: string;
    isDevHub?: boolean;
    isDefaultDevHubUsername?: boolean;
    isDefaultUsername?: boolean;
    isScratch?: boolean;
    expirationDate?: string;
    trailExpirationDate?: string;
    instanceName?: string;
    instanceApiVersion?: string;
    connectedStatus?: string;
    isDefaultDevHub?: boolean;
    isDefault?: boolean;
    isSandbox?: boolean;
}

// Processed org type
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

// Storage directory for persisting data
const storageDir = path.join(app.getPath("userData"), "storage");
const orgsFile = path.join(storageDir, "orgs.json");

// Save orgs to storage
const saveOrgsToStorage = (orgs: ProcessedOrg[]) => {
    try {
        if (!existsSync(storageDir)) {
            mkdirSync(storageDir, { recursive: true });
        }
        writeFileSync(orgsFile, JSON.stringify(orgs, null, 2));
        console.log("Saved orgs to storage");
    } catch (error) {
        console.error("Error saving orgs to storage:", error);
    }
};

// Load orgs from storage
const loadOrgsFromStorage = (): ProcessedOrg[] | null => {
    try {
        if (existsSync(orgsFile)) {
            const data = readFileSync(orgsFile, "utf8");
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Error loading orgs from storage:", error);
    }
    return null;
};

// Get list of SFDX orgs
const getSfdxOrgs = async (
    useStorage: boolean = true
): Promise<ProcessedOrg[]> => {
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
        } catch (error) {
            console.error("SF CLI not found:", error);
            throw new Error(
                "Salesforce CLI (sf) is not installed or not in PATH"
            );
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
        } catch (error) {
            console.error("Failed to parse JSON output:", error);
            throw new Error("Failed to parse org list output");
        }

        if (!result?.result || typeof result.result !== "object") {
            console.error("Unexpected result format:", result);
            throw new Error("Unexpected org list format");
        }

        // Combine all org categories and remove duplicates based on username
        const orgMap = new Map<string, SfOrg>();

        // Helper function to add orgs to map, preferring devHubs and active orgs
        const addOrgsToMap = (orgs: SfOrg[]) => {
            orgs.forEach((org) => {
                const existing = orgMap.get(org.username);
                if (
                    !existing ||
                    (org.isDevHub && !existing.isDevHub) ||
                    (org.connectedStatus === "Connected" &&
                        existing.connectedStatus !== "Connected")
                ) {
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
        const filteredOrgs = allOrgs.filter((org: SfOrg) => {
            if (org.isScratch && org.expirationDate) {
                const expDate = new Date(org.expirationDate);
                const isExpired = expDate < new Date();
                if (isExpired) {
                    console.log(
                        `Filtering out expired scratch org ${org.username}`
                    );
                    return false;
                }
            }
            return true;
        });
        console.log("Filtered orgs:", filteredOrgs);

        const processedOrgs = filteredOrgs.map((org: SfOrg): ProcessedOrg => {
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

        const sortedOrgs = processedOrgs.sort(
            (a: ProcessedOrg, b: ProcessedOrg) => {
                // Sort by:
                // 1. Default org first
                // 2. Default DevHub second
                // 3. DevHubs third
                // 4. Then alphabetically by alias
                if (a.isDefaultOrg) return -1;
                if (b.isDefaultOrg) return 1;
                if (a.isDefaultDevHub) return -1;
                if (b.isDefaultDevHub) return 1;
                if (a.isDevHub && !b.isDevHub) return -1;
                if (!a.isDevHub && b.isDevHub) return 1;
                return a.alias.localeCompare(b.alias);
            }
        );
        console.log("Final sorted orgs:", sortedOrgs);

        // Save to storage before returning
        saveOrgsToStorage(sortedOrgs);
        return sortedOrgs;
    } catch (error) {
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
async function ensureDirectories(jobName: string): Promise<void> {
    const dirs = [
        path.join("apex_files", jobName),
        path.join("execution_results", jobName),
    ];

    for (const dir of dirs) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }
}

// Sanitize text for command line
const sanitizeForCmd = (text: string): string => {
    // Replace newlines with spaces and escape quotes
    return text
        .replace(/[\r\n]+/g, " ") // Replace newlines with spaces
        .replace(/"/g, '\\"') // Escape double quotes
        .trim(); // Remove leading/trailing whitespace
};

// Execute SOQL query and get record IDs
const executeSOQL = async (
    soql: string,
    targetOrg: string
): Promise<string[]> => {
    const sanitizedSoql = sanitizeForCmd(soql);
    const { stdout } = await execAsync(
        `sf data query --query "${sanitizedSoql}" --target-org "${targetOrg}" --result-format csv | tail -n +2`
    );
    return stdout
        .trim()
        .split("\n")
        .filter((id) => id.length > 0); // Filter out empty lines
};

// Generate Apex files for each record ID
const generateApexFiles = (
    jobName: string,
    recordIds: string[],
    apexTemplate: string
) => {
    const jobDir = path.join("apex_files", jobName);
    const sanitizedTemplate = apexTemplate.trim(); // Preserve newlines but trim edges

    recordIds.forEach(async (recordId) => {
        const filePath = path.join(jobDir, `${recordId}.apex`);
        const fileContent = `Id recordId = '${recordId}';\n${sanitizedTemplate}`;
        await fs.writeFile(filePath, fileContent, "utf8");
    });
};

// Run the batch process
const runBatch = async (
    jobName: string,
    targetOrg: string,
    onProgress: (message: string) => void
) => {
    const scriptPath = path.join(__dirname, "..", "bash", "run-folder.sh");
    const child = exec(`bash "${scriptPath}" "${targetOrg}" "${jobName}"`);

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
    return new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
            child.on("close", (code) => {
                if (code === 0 || code === null) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Process exited with code ${code}`));
                }
            });

            child.on("error", (error) => {
                reject(error);
            });
        }
    );
};

// Track running processes
const runningProcesses = new Map<string, { process: any; paused: boolean }>();

// IPC Handlers
ipcMain.handle("getSfdxOrgs", async (event, useStorage: boolean = true) => {
    return await getSfdxOrgs(useStorage);
});

ipcMain.handle("openOrg", async (event, targetOrg) => {
    try {
        // Send status update to renderer
        event.sender.send("processUpdate", `Opening org ${targetOrg}...`);

        // Execute the command in the background
        const command = `sf org open --target-org ${targetOrg}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                event.sender.send(
                    "processUpdate",
                    `Error opening org: ${error.message}`
                );
                return;
            }
            if (stderr) {
                event.sender.send("processUpdate", `Warning: ${stderr}`);
            }
            event.sender.send("processUpdate", "Org opened in browser");
        });

        return "Opening org in browser...";
    } catch (error) {
        console.error("Error opening org:", error);
        throw error;
    }
});

// Job storage
interface JobData {
    jobName?: string;
    targetOrg: string;
    soqlQuery: string;
    apexTemplate: string;
    status: "prepared" | "running" | "paused" | "completed";
    timestamp: string;
    result?: {
        successful: number;
        failed: number;
        total: number;
    };
}

async function saveJobToStorage(
    jobName: string,
    data: Partial<JobData>
): Promise<void> {
    const jobsPath = path.join(app.getPath("userData"), "jobs.json");
    let jobs: Record<string, JobData> = {};

    try {
        const content = await fs.readFile(jobsPath, "utf8");
        jobs = JSON.parse(content);
    } catch (error) {
        // File doesn't exist or is invalid, start with empty object
    }

    jobs[jobName] = {
        ...jobs[jobName],
        ...data,
        jobName,
    } as JobData;

    await fs.writeFile(jobsPath, JSON.stringify(jobs, null, 2), "utf8");
}

// Load jobs from storage
async function loadJobsFromStorage(): Promise<Record<string, JobData>> {
    const jobsPath = path.join(app.getPath("userData"), "jobs.json");
    try {
        const content = await fs.readFile(jobsPath, "utf8");
        return JSON.parse(content);
    } catch (error) {
        return {};
    }
}

// Load specific job from storage
async function loadJobFromStorage(jobName: string): Promise<JobData | null> {
    const jobs = await loadJobsFromStorage();
    const normalizedJobName = jobName.toLowerCase();

    // Find the job with case-insensitive matching
    const matchingJob = Object.entries(jobs).find(
        ([key]) => key.toLowerCase() === normalizedJobName
    );

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
async function openFolder(folderPath: string): Promise<boolean> {
    try {
        // Convert to absolute path using the user data directory
        const absolutePath = path.isAbsolute(folderPath)
            ? folderPath
            : path.join(app.getPath("userData"), folderPath);

        await fs.access(absolutePath);
        const { shell } = require("electron");
        await shell.openPath(absolutePath);
        return true;
    } catch (error) {
        console.error("Error opening folder:", error);
        return false;
    }
}

// Update IPC Handlers
ipcMain.handle("getJobs", async () => {
    return loadJobsFromStorage();
});

ipcMain.handle("getJob", async (event, jobName: string) => {
    return loadJobFromStorage(jobName);
});

ipcMain.handle("openScriptsFolder", async (event, jobName: string) => {
    const normalizedJobName = jobName.toLowerCase();
    const folderPath = path.join("apex_files", normalizedJobName);
    return openFolder(folderPath);
});

ipcMain.handle("openResultsFolder", async (event, jobName: string) => {
    const normalizedJobName = jobName.toLowerCase();
    const folderPath = path.join("execution_results", normalizedJobName);
    return openFolder(folderPath);
});

// Prepare batch files without executing
const prepareBatchFiles = async (
    event: Electron.IpcMainInvokeEvent,
    jobName: string,
    soqlQuery: string,
    apexTemplate: string,
    targetOrg: string
): Promise<{ recordCount: number; jobDir: string }> => {
    try {
        // Execute SOQL query
        const sanitizedSoql = sanitizeForCmd(soqlQuery);
        const { stdout } = await execAsync(
            `sf data query --query "${sanitizedSoql}" --target-org "${targetOrg}" --json`
        );

        const queryResult = JSON.parse(stdout);
        const records = queryResult.result.records;
        const recordIds = records.map((record: any) => record.Id);

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
    } catch (error) {
        console.error("Error preparing batch files:", error);
        throw error;
    }
};

ipcMain.handle(
    "prepareBatchFiles",
    async (
        event,
        jobName: string,
        soqlQuery: string,
        apexTemplate: string,
        targetOrg: string
    ) => {
        return await prepareBatchFiles(
            event,
            jobName,
            soqlQuery,
            apexTemplate,
            targetOrg
        );
    }
);

// Pause batch process
ipcMain.handle("pauseBatchProcess", async (event, jobName: string) => {
    try {
        await batchProcessor.pause();
        await saveJobToStorage(jobName, {
            status: "paused",
            timestamp: new Date().toISOString(),
        });
        return true;
    } catch (error) {
        console.error("Error pausing batch process:", error);
        throw error;
    }
});

// Resume batch process
ipcMain.handle("resumeBatchProcess", async (event, jobName: string) => {
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
    } catch (error) {
        console.error("Error resuming batch process:", error);
        throw error;
    }
});

// Open org using sf CLI
const openOrg = async (targetOrg: string) => {
    try {
        console.log(`Opening org: ${targetOrg}`);
        const { stdout, stderr } = await execAsync(
            `sf org open --target-org ${targetOrg}`
        );
        if (stderr) {
            console.error("Error opening org:", stderr);
            throw new Error(stderr);
        }
        return stdout;
    } catch (error) {
        console.error("Failed to open org:", error);
        throw error;
    }
};

// Run batch process handler
ipcMain.handle(
    "runBatchProcess",
    async (
        event,
        jobName: string,
        soqlQuery: string,
        apexTemplate: string,
        targetOrg: string
    ) => {
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
        } catch (error) {
            console.error("Error running batch process:", error);
            throw error;
        }
    }
);
