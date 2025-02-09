// Get UI elements
const jobNameInput = document.getElementById("jobName") as HTMLInputElement;
const soqlInput = document.getElementById("soqlQuery") as HTMLTextAreaElement;
const apexTemplateInput = document.getElementById(
    "apexTemplate"
) as HTMLTextAreaElement;
const targetOrgSelect = document.getElementById(
    "targetOrg"
) as HTMLSelectElement;
const openOrgBtn = document.getElementById("openOrg") as HTMLButtonElement;
const runBatchBtn = document.getElementById("runBatch") as HTMLButtonElement;
const pauseBatchBtn = document.getElementById(
    "pauseBatch"
) as HTMLButtonElement;
const resumeBatchBtn = document.getElementById(
    "resumeBatch"
) as HTMLButtonElement;
const resultsDiv = document.getElementById("results") as HTMLDivElement;
const orgLoadingStatus = document.getElementById(
    "orgLoadingStatus"
) as HTMLDivElement;
const refreshOrgsBtn = document.getElementById(
    "refreshOrgs"
) as HTMLButtonElement;
const prepareBatchBtn = document.getElementById(
    "prepareBatch"
) as HTMLButtonElement;
const openScriptsBtn = document.getElementById(
    "openScripts"
) as HTMLButtonElement;
const openResultsBtn = document.getElementById(
    "openResults"
) as HTMLButtonElement;

let currentJobName = "";
let isProcessing = false;
let preparedJobName = "";

// Load SFDX orgs on startup
async function loadSfdxOrgs(useStorage: boolean = true) {
    console.log("Starting to load SFDX orgs...");
    orgLoadingStatus.textContent =
        "Loading organizations (this may take a few seconds)...";
    try {
        console.log("Calling window.electronAPI.getSfdxOrgs()...");
        const orgs = await (window.electronAPI as any).getSfdxOrgs(useStorage);
        console.log("Received orgs:", orgs);

        // Clear any existing options
        console.log("Clearing existing options...");
        while (targetOrgSelect.firstChild) {
            targetOrgSelect.removeChild(targetOrgSelect.firstChild);
        }

        if (!orgs || orgs.length === 0) {
            console.log("No orgs found, adding empty state option");
            const option = document.createElement("option");
            option.value = "";
            option.text =
                "No authenticated orgs found - Run 'sf login web' to authenticate";
            option.disabled = true;
            option.selected = true;
            targetOrgSelect.appendChild(option);
            openOrgBtn.disabled = true;

            // Show error in results
            resultsDiv.innerHTML = `
                <div class="error">No authenticated Salesforce orgs found.</div>
                <div>Please authenticate using one of these commands:</div>
                <pre>sf login web</pre>
                <div>or</div>
                <pre>sf login device</pre>
            `;
            orgLoadingStatus.textContent = "No organizations found";
            return;
        }

        // Add default empty option
        console.log("Adding default empty option");
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.text = "Select an organization";
        defaultOption.disabled = true;
        targetOrgSelect.appendChild(defaultOption);

        console.log("Adding org options...");
        orgs.forEach((org) => {
            console.log("Processing org:", org);
            const option = document.createElement("option");
            option.value = org.username;
            option.dataset.instanceUrl = org.instanceUrl;

            // Create descriptive label
            let label = org.alias;
            if (org.isDefaultOrg) label += " (Default)";
            if (org.isDefaultDevHub) label += " (Default DevHub)";
            else if (org.isDevHub) label += " (DevHub)";
            if (org.isScratch) {
                label += " (Scratch)";
                if (org.expirationDate) {
                    const expDate = new Date(org.expirationDate);
                    label += ` - Expires ${expDate.toLocaleDateString()}`;
                }
            }

            option.text = label;
            console.log("Adding option:", {
                value: option.value,
                text: option.text,
            });
            targetOrgSelect.appendChild(option);
        });

        // Select default org if available
        console.log("Looking for default org...");
        const defaultOrg = orgs.find((org) => org.isDefaultOrg);
        if (defaultOrg) {
            console.log("Found default org:", defaultOrg);
            targetOrgSelect.value = defaultOrg.username;
        } else {
            console.log("No default org found, selecting placeholder");
            defaultOption.selected = true;
        }

        // Enable/disable open org button based on selection
        openOrgBtn.disabled = !targetOrgSelect.value;
        console.log("Final org selector state:", {
            value: targetOrgSelect.value,
            options: Array.from(targetOrgSelect.options).map((o) => ({
                value: o.value,
                text: o.text,
            })),
            openOrgBtnDisabled: openOrgBtn.disabled,
        });

        // Clear any previous error messages
        resultsDiv.innerHTML = "";
        orgLoadingStatus.textContent = `Found ${orgs.length} organization${
            orgs.length === 1 ? "" : "s"
        }`;
    } catch (error) {
        console.error("Error in loadSfdxOrgs:", error);
        if (error instanceof Error) {
            console.error("Error details:", error.message);
            console.error("Error stack:", error.stack);
        }
        const option = document.createElement("option");
        option.value = "";
        option.text = "Error loading orgs";
        option.disabled = true;
        option.selected = true;
        targetOrgSelect.innerHTML = "";
        targetOrgSelect.appendChild(option);
        openOrgBtn.disabled = true;

        // Show error in results
        resultsDiv.innerHTML = `
            <div class="error">Failed to load Salesforce orgs.</div>
            <div>Please ensure:</div>
            <ol>
                <li>Salesforce CLI (sf) is installed</li>
                <li>You are logged in to at least one org</li>
                <li>Your CLI installation is working correctly</li>
            </ol>
            <div>Try running these commands in your terminal:</div>
            <pre>sf --version</pre>
            <pre>sf org list</pre>
        `;
        orgLoadingStatus.textContent = "Error loading organizations";
    }
}

// Handle org selection change
targetOrgSelect.addEventListener("change", () => {
    openOrgBtn.disabled = !targetOrgSelect.value;
});

// Handle open org button click
openOrgBtn.addEventListener("click", async () => {
    try {
        const selectedOption =
            targetOrgSelect.options[targetOrgSelect.selectedIndex];
        const targetOrg = selectedOption.value;
        if (targetOrg) {
            openOrgBtn.disabled = true;
            resultsDiv.innerHTML = `<div>Opening org ${targetOrg}...</div>`;
            const result = await (window.electronAPI as any).openOrg(targetOrg);
            resultsDiv.innerHTML += `<div>${result}</div>`;
            openOrgBtn.disabled = false;
        }
    } catch (error) {
        console.error("Error opening org:", error);
        const errorMessage =
            error instanceof Error
                ? error.message
                : "An unknown error occurred";
        resultsDiv.innerHTML = `<div class="error">Error opening org: ${errorMessage}</div>`;
        openOrgBtn.disabled = false;
    }
});

// Handle refresh orgs button click
refreshOrgsBtn.addEventListener("click", async () => {
    refreshOrgsBtn.disabled = true;
    try {
        await loadSfdxOrgs(false); // Force refresh from SF CLI
    } finally {
        refreshOrgsBtn.disabled = false;
    }
});

// Load job data if available
async function loadJobData(jobName: string) {
    try {
        const job = await (window.electronAPI as any).getJob(jobName);
        if (job) {
            // Populate form with job data
            jobNameInput.value = job.jobName;
            soqlInput.value = job.soqlQuery;
            apexTemplateInput.value = job.apexTemplate;

            // Wait for orgs to load before setting target org
            const orgsLoaded = new Promise<void>((resolve) => {
                const checkOrgs = setInterval(() => {
                    if (targetOrgSelect.options.length > 1) {
                        clearInterval(checkOrgs);
                        targetOrgSelect.value = job.targetOrg;
                        resolve();
                    }
                }, 100);
            });

            await orgsLoaded;

            // Enable folder buttons if job was prepared or completed
            if (job.status === "prepared" || job.status === "completed") {
                openScriptsBtn.disabled = false;
                openResultsBtn.disabled = false;
                if (job.status === "prepared") {
                    runBatchBtn.disabled = false;
                    preparedJobName = job.jobName;
                }
            }

            resultsDiv.innerHTML = `<div>Loaded job "${job.jobName}" (${job.status})</div>`;
            if (job.lastExecuted) {
                resultsDiv.innerHTML += `<div>Last executed: ${new Date(
                    job.lastExecuted
                ).toLocaleString()}</div>`;
            }
        }
    } catch (error) {
        console.error("Error loading job:", error);
    }
}

// Handle folder button clicks
openScriptsBtn.addEventListener("click", async () => {
    if (jobNameInput.value) {
        const opened = await (window.electronAPI as any).openScriptsFolder(
            jobNameInput.value
        );
        if (!opened) {
            resultsDiv.innerHTML += `<div class="error">Scripts folder not found for job "${jobNameInput.value}"</div>`;
        }
    }
});

openResultsBtn.addEventListener("click", async () => {
    if (jobNameInput.value) {
        const opened = await (window.electronAPI as any).openResultsFolder(
            jobNameInput.value
        );
        if (!opened) {
            resultsDiv.innerHTML += `<div class="error">Results folder not found for job "${jobNameInput.value}"</div>`;
        }
    }
});

// Update job name input handler
jobNameInput.addEventListener("change", async () => {
    if (jobNameInput.value) {
        await loadJobData(jobNameInput.value);
    }
});

// Validate form and show feedback
function validateForm(): boolean {
    let isValid = true;
    const formGroups = document.querySelectorAll(".form-group");

    // Clear previous validation state
    formGroups.forEach((group) => {
        group.classList.remove("error");
    });

    // Check job name
    if (!jobNameInput.value.trim()) {
        jobNameInput.parentElement?.classList.add("error");
        isValid = false;
    }

    // Check target org
    if (!targetOrgSelect.value) {
        targetOrgSelect.closest(".form-group")?.classList.add("error");
        isValid = false;
    }

    // Check SOQL query
    if (!soqlInput.value.trim()) {
        soqlInput.parentElement?.classList.add("error");
        isValid = false;
    }

    // Check Apex template
    if (!apexTemplateInput.value.trim()) {
        apexTemplateInput.parentElement?.classList.add("error");
        isValid = false;
    }

    return isValid;
}

// Clear validation errors when user starts typing
const inputs = [jobNameInput, soqlInput, apexTemplateInput];
inputs.forEach((input) => {
    input.addEventListener("input", () => {
        input.parentElement?.classList.remove("error");
    });
});

targetOrgSelect.addEventListener("change", () => {
    targetOrgSelect.closest(".form-group")?.classList.remove("error");
});

// Update prepare batch files handler
prepareBatchBtn.addEventListener("click", async () => {
    try {
        if (!validateForm()) {
            return;
        }

        // Clear previous results
        resultsDiv.innerHTML = "";
        preparedJobName = jobNameInput.value;

        // Update button states
        prepareBatchBtn.disabled = true;
        runBatchBtn.disabled = true;
        openScriptsBtn.disabled = true;
        openResultsBtn.disabled = true;

        const result = await (window.electronAPI as any).prepareBatchFiles(
            jobNameInput.value,
            soqlInput.value,
            apexTemplateInput.value,
            targetOrgSelect.value
        );

        // Enable buttons
        runBatchBtn.disabled = false;
        openScriptsBtn.disabled = false;
        openResultsBtn.disabled = false;

        resultsDiv.innerHTML += `<div>Files prepared successfully. Found ${result.recordCount} records.</div>`;
        resultsDiv.innerHTML += `<div>Review the generated files in: ${result.jobDir}</div>`;
        resultsDiv.innerHTML += `<div>Click 'Execute Batch' when ready to process the files.</div>`;
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "An unknown error occurred";
        resultsDiv.innerHTML += `<div class="error">Error: ${errorMessage}</div>`;
    } finally {
        prepareBatchBtn.disabled = false;
    }
});

// Update run batch process handler
runBatchBtn.addEventListener("click", async () => {
    try {
        if (!validateForm()) {
            return;
        }

        if (!preparedJobName) {
            resultsDiv.innerHTML = `<div class="error">Please prepare the batch files first</div>`;
            return;
        }

        // Update button states
        runBatchBtn.disabled = true;
        prepareBatchBtn.disabled = true;
        resumeBatchBtn.disabled = true;
        pauseBatchBtn.disabled = false;

        isProcessing = true;
        currentJobName = preparedJobName;

        // Get the concurrency limit value from the input.
        const concurrencyLimitInput = document.getElementById(
            "concurrencyLimit"
        ) as HTMLInputElement;
        const concurrencyLimit = parseInt(concurrencyLimitInput.value, 10) || 5;

        await (window.electronAPI as any).runBatchProcess(
            preparedJobName,
            soqlInput.value,
            apexTemplateInput.value,
            targetOrgSelect.value,
            concurrencyLimit
        );

        isProcessing = false;
        pauseBatchBtn.disabled = true;
        preparedJobName = ""; // Clear the prepared job name
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "An unknown error occurred";
        resultsDiv.innerHTML += `<div class="error">Error: ${errorMessage}</div>`;
    } finally {
        runBatchBtn.disabled = false;
        prepareBatchBtn.disabled = false;
        resumeBatchBtn.disabled = false;
        pauseBatchBtn.disabled = true;
        isProcessing = false;
    }
});

// Pause batch process
pauseBatchBtn.addEventListener("click", async () => {
    if (currentJobName && isProcessing) {
        try {
            await (window.electronAPI as any).pauseBatchProcess(currentJobName);
            pauseBatchBtn.disabled = true;
            resumeBatchBtn.disabled = false;
            isProcessing = false;
        } catch (error) {
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : "An unknown error occurred";
            resultsDiv.innerHTML += `<div class="error">Error pausing process: ${errorMessage}</div>`;
        }
    }
});

// Resume batch process
resumeBatchBtn.addEventListener("click", async () => {
    try {
        if (!targetOrgSelect.value) {
            alert("Please select a target org");
            return;
        }

        if (!currentJobName) {
            alert("No previous job found to resume");
            return;
        }

        // Clear previous results
        resultsDiv.innerHTML = "";
        isProcessing = true;

        // Update button states
        runBatchBtn.disabled = true;
        resumeBatchBtn.disabled = true;
        pauseBatchBtn.disabled = false;

        await (window.electronAPI as any).resumeBatchProcess(
            currentJobName,
            targetOrgSelect.value
        );

        isProcessing = false;
        pauseBatchBtn.disabled = true;
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "An unknown error occurred";
        resultsDiv.innerHTML += `<div class="error">Error: ${errorMessage}</div>`;
    } finally {
        // Re-enable buttons
        runBatchBtn.disabled = false;
        resumeBatchBtn.disabled = false;
        pauseBatchBtn.disabled = true;
        isProcessing = false;
    }
});

// Load orgs on startup (using storage)
loadSfdxOrgs(true);

// Handle process updates
(window.electronAPI as any).onProcessUpdate((event: any, message: string) => {
    const messageDiv = document.createElement("div");
    messageDiv.textContent = message;
    resultsDiv.appendChild(messageDiv);
    resultsDiv.scrollTop = resultsDiv.scrollHeight;
});
