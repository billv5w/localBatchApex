import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface BatchProcessOptions {
    jobName: string;
    targetOrg: string;
    recordIds: string[];
    apexTemplate: string;
    onProgress?: (message: string) => void;
    concurrencyLimit?: number;
}

export interface BatchProcessResult {
    successful: number;
    failed: number;
    total: number;
}

export class BatchProcessor {
    private baseDir: string;
    private apexDir: string;
    private resultsDir: string;
    private checkpointDir: string;
    private checkpointFile: string;
    private pauseFile: string;
    private isPaused: boolean = false;

    constructor(baseDir: string) {
        this.baseDir = baseDir;
    }

    private log(message: string, options: BatchProcessOptions) {
        options.onProgress?.(message);
        console.log(message);
    }

    private async ensureDirectories(jobName: string): Promise<void> {
        // Normalize job name to be case-insensitive
        const normalizedJobName = jobName.toLowerCase();

        // Create all required directories
        this.apexDir = path.join(this.baseDir, "apex_files", normalizedJobName);
        this.resultsDir = path.join(
            this.baseDir,
            "execution_results",
            normalizedJobName
        );
        this.checkpointDir = path.join(this.baseDir, "checkpoints");
        this.checkpointFile = path.join(
            this.checkpointDir,
            `checkpoint_${normalizedJobName}.txt`
        );
        this.pauseFile = path.join(
            this.checkpointDir,
            `pause_${normalizedJobName}.txt`
        );

        // Ensure all directories exist
        await fs.mkdir(this.apexDir, { recursive: true });
        await fs.mkdir(this.resultsDir, { recursive: true });
        await fs.mkdir(this.checkpointDir, { recursive: true });
    }

    async generateApexFiles(options: BatchProcessOptions): Promise<void> {
        await this.ensureDirectories(options.jobName);

        for (const recordId of options.recordIds) {
            // Normalize record ID to be case-insensitive
            const normalizedRecordId = recordId.toLowerCase();
            const filePath = path.join(
                this.apexDir,
                `${normalizedRecordId}.apex`
            );
            const fileContent = `Id recordId = '${recordId}';\n${options.apexTemplate}`;
            await fs.writeFile(filePath, fileContent, "utf8");
            this.log(`Generated Apex file for ID: ${recordId}`, options);
        }
    }

    async runBatchProcess(
        options: BatchProcessOptions
    ): Promise<BatchProcessResult> {
        await this.ensureDirectories(options.jobName);

        let successful = 0;
        let failed = 0;
        let lastExecuted = "";

        try {
            // Remove pause file if exists
            await fs.rm(this.pauseFile).catch(() => {});

            // Read checkpoint if exists
            try {
                lastExecuted = await fs.readFile(this.checkpointFile, "utf8");
            } catch {}

            const files = await fs.readdir(this.apexDir);
            const apexFiles = files.filter((f) =>
                f.toLowerCase().endsWith(".apex")
            );
            const total = apexFiles.length;

            this.log(`Total scripts to process: ${total}`, options);
            // resume flag is false initially if a checkpoint exists
            let resume = !lastExecuted;

            // Concurrency pool implementation:
            let index = 0;
            const concurrencyLimit =
                options.concurrencyLimit && options.concurrencyLimit > 0
                    ? options.concurrencyLimit
                    : 5;

            const processNext = async () => {
                while (true) {
                    if (this.isPaused) {
                        // If paused, write the pause file and stop processing
                        await fs.writeFile(this.pauseFile, "");
                        return;
                    }
                    // Atomically grab the next file index
                    const currentIndex = index;
                    index++;
                    if (currentIndex >= apexFiles.length) break;

                    const file = apexFiles[currentIndex];
                    const fullPath = path.join(this.apexDir, file);

                    // Handle resume logic: skip files until the checkpoint is reached.
                    if (!resume) {
                        if (
                            fullPath.toLowerCase() ===
                            lastExecuted.toLowerCase()
                        ) {
                            resume = true;
                        }
                        if (!resume) continue; // Skip until resume is set
                    }

                    const currentCount = successful + failed + 1;
                    this.log(
                        `Processing script ${currentCount}/${total}: ${file}`,
                        options
                    );

                    try {
                        const { stdout, stderr } = await execAsync(
                            `sf apex run --file "${fullPath}" --target-org "${options.targetOrg}"`
                        );

                        const timestamp = new Date()
                            .toISOString()
                            .replace(/[:.]/g, "-");
                        const recordId = path.basename(file, ".apex");
                        const resultPath = path.join(
                            this.resultsDir,
                            `success_${recordId}_${timestamp}.txt`
                        );

                        await fs.writeFile(
                            resultPath,
                            `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`
                        );
                        successful++;
                    } catch (error: any) {
                        const timestamp = new Date()
                            .toISOString()
                            .replace(/[:.]/g, "-");
                        const recordId = path.basename(file, ".apex");
                        const resultPath = path.join(
                            this.resultsDir,
                            `failure_${recordId}_${timestamp}.txt`
                        );

                        await fs.writeFile(
                            resultPath,
                            `ERROR:\n${error.message}\n\nSTDOUT:\n${
                                error.stdout || ""
                            }\n\nSTDERR:\n${error.stderr || ""}`
                        );
                        failed++;
                    }

                    this.log(
                        `Progress: ${successful} successful, ${failed} failed`,
                        options
                    );
                }
            };

            const workers = [];
            for (let i = 0; i < concurrencyLimit; i++) {
                workers.push(processNext());
            }
            await Promise.all(workers);
        } finally {
            // Cleanup: remove checkpoint and pause file if not paused
            if (!this.isPaused) {
                await fs.rm(this.checkpointFile).catch(() => {});
                await fs.rm(this.pauseFile).catch(() => {});
            }
        }

        return { successful, failed, total: successful + failed };
    }

    async pause(): Promise<void> {
        this.isPaused = true;
    }

    async resume(): Promise<void> {
        this.isPaused = false;
    }

    getDirectories(jobName: string) {
        // Normalize job name for consistency
        const normalizedJobName = jobName.toLowerCase();
        return {
            apexDir: path.join(this.baseDir, "apex_files", normalizedJobName),
            resultsDir: path.join(
                this.baseDir,
                "execution_results",
                normalizedJobName
            ),
        };
    }
}
