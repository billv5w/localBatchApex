"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchProcessor = void 0;
const child_process_1 = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class BatchProcessor {
    constructor(baseDir) {
        this.isPaused = false;
        this.baseDir = baseDir;
    }
    log(message, options) {
        options.onProgress?.(message);
        console.log(message);
    }
    async ensureDirectories(jobName) {
        // Normalize job name to be case-insensitive
        const normalizedJobName = jobName.toLowerCase();
        // Create all required directories
        this.apexDir = path.join(this.baseDir, "apex_files", normalizedJobName);
        this.resultsDir = path.join(this.baseDir, "execution_results", normalizedJobName);
        this.checkpointDir = path.join(this.baseDir, "checkpoints");
        this.checkpointFile = path.join(this.checkpointDir, `checkpoint_${normalizedJobName}.txt`);
        this.pauseFile = path.join(this.checkpointDir, `pause_${normalizedJobName}.txt`);
        // Ensure all directories exist
        await fs.mkdir(this.apexDir, { recursive: true });
        await fs.mkdir(this.resultsDir, { recursive: true });
        await fs.mkdir(this.checkpointDir, { recursive: true });
    }
    async generateApexFiles(options) {
        await this.ensureDirectories(options.jobName);
        for (const recordId of options.recordIds) {
            // Normalize record ID to be case-insensitive
            const normalizedRecordId = recordId.toLowerCase();
            const filePath = path.join(this.apexDir, `${normalizedRecordId}.apex`);
            const fileContent = `Id recordId = '${recordId}';\n${options.apexTemplate}`;
            await fs.writeFile(filePath, fileContent, "utf8");
            this.log(`Generated Apex file for ID: ${recordId}`, options);
        }
    }
    async runBatchProcess(options) {
        await this.ensureDirectories(options.jobName);
        let successful = 0;
        let failed = 0;
        let lastExecuted = "";
        try {
            // Remove pause file if exists
            await fs.rm(this.pauseFile).catch(() => { });
            // Read checkpoint if exists
            try {
                lastExecuted = await fs.readFile(this.checkpointFile, "utf8");
            }
            catch { }
            const files = await fs.readdir(this.apexDir);
            const apexFiles = files.filter((f) => f.toLowerCase().endsWith(".apex"));
            const total = apexFiles.length;
            this.log(`Total scripts to process: ${total}`, options);
            let resume = !lastExecuted;
            for (const file of apexFiles) {
                if (this.isPaused) {
                    await fs.writeFile(this.pauseFile, "");
                    break;
                }
                const fullPath = path.join(this.apexDir, file);
                // Handle resume logic with case-insensitive comparison
                if (!resume) {
                    if (fullPath.toLowerCase() === lastExecuted.toLowerCase()) {
                        resume = true;
                    }
                    continue;
                }
                this.log(`Processing script ${successful + failed + 1}/${total}: ${file}`, options);
                try {
                    const { stdout, stderr } = await execAsync(`sf apex run --file "${fullPath}" --target-org "${options.targetOrg}"`);
                    const timestamp = new Date()
                        .toISOString()
                        .replace(/[:.]/g, "-");
                    const recordId = path.basename(file, ".apex");
                    const resultPath = path.join(this.resultsDir, `success_${recordId}_${timestamp}.txt`);
                    await fs.writeFile(resultPath, `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`);
                    successful++;
                }
                catch (error) {
                    const timestamp = new Date()
                        .toISOString()
                        .replace(/[:.]/g, "-");
                    const recordId = path.basename(file, ".apex");
                    const resultPath = path.join(this.resultsDir, `failure_${recordId}_${timestamp}.txt`);
                    await fs.writeFile(resultPath, `ERROR:\n${error.message}\n\nSTDOUT:\n${error.stdout || ""}\n\nSTDERR:\n${error.stderr || ""}`);
                    failed++;
                }
                this.log(`Progress: ${successful} successful, ${failed} failed`, options);
            }
        }
        finally {
            // Cleanup
            if (!this.isPaused) {
                await fs.rm(this.checkpointFile).catch(() => { });
                await fs.rm(this.pauseFile).catch(() => { });
            }
        }
        return { successful, failed, total: successful + failed };
    }
    async pause() {
        this.isPaused = true;
    }
    async resume() {
        this.isPaused = false;
    }
    getDirectories(jobName) {
        // Normalize job name for consistency
        const normalizedJobName = jobName.toLowerCase();
        return {
            apexDir: path.join(this.baseDir, "apex_files", normalizedJobName),
            resultsDir: path.join(this.baseDir, "execution_results", normalizedJobName),
        };
    }
}
exports.BatchProcessor = BatchProcessor;
//# sourceMappingURL=batchProcessor.js.map