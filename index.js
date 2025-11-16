import * as core from '@actions/core';
import * as github from '@actions/github';

/**
 * Checks the conclusion of the very latest workflow run on the specified branch.
 */
async function checkWorkflowConclusion(octokit, owner, repo, workflow_id, ref) {
    core.info(`Checking LATEST run for: ${owner}/${repo}, Workflow: ${workflow_id}, Branch: ${ref}`);

    const response = await octokit.rest.actions.listWorkflowRuns({
        owner: owner,
        repo: repo,
        workflow_id: workflow_id,
        branch: ref.replace('refs/heads/', ''),
        per_page: 1,
    });

    const runs = response.data.workflow_runs;

    if (runs.length === 0) {
        throw new Error(`❌ ERROR: No run found for workflow '${workflow_id}' on branch '${ref}' in repository '${owner}/${repo}'.`);
    } else {
        const latestRun = runs[0];
        const runConclusion = latestRun.conclusion;
        const runStatus = latestRun.status;

        if (runStatus !== 'completed') {
            throw new Error(`🛑 ERROR: Latest CI run (ID: ${latestRun.id}) in ${owner}/${repo} is still in progress (Status: ${runStatus}). Deployment cannot proceed.`);
        }

        if (runConclusion === 'success') {
            core.info(`✅ SUCCESS: Latest CI run (ID: ${latestRun.id}) in ${owner}/${repo} concluded successfully.`);
            return true;
        } else {
            throw new Error(`🛑 ERROR: Latest CI run (ID: ${latestRun.id}) in ${owner}/${repo} FAILED with conclusion: ${runConclusion}. Deployment aborted.`);
        }
    }
}

async function run() {
    try {
        const repositoriesJson = core.getInput('repositories-to-check', { required: true });
        const ref = core.getInput('ref', { required: true });
        const token = core.getInput('token', { required: true });

        let repos;
        try {
            repos = JSON.parse(repositoriesJson);
            if (!Array.isArray(repos) || repos.length === 0) {
                throw new Error("Input 'repositories-to-check' must be a non-empty JSON array.");
            }
        } catch (e) {
            core.setFailed(`Invalid JSON format for 'repositories-to-check': ${e.message}`);
            return;
        }

        const octokit = github.getOctokit(token);

        const checks = repos.map(repoInfo =>
            checkWorkflowConclusion(
                octokit,
                repoInfo.owner,
                repoInfo.repo,
                repoInfo.workflow,
                ref
            )
                .then(result => ({ status: 'fulfilled', value: result }))
                .catch(error => ({ status: 'rejected', reason: error }))
        );

        const results = await Promise.all(checks);

        const failures = results.filter(result => result.status === 'rejected');

        if (failures.length > 0) {
            const failureMessages = failures.map(f => f.reason.message).join('\n---\n');
            core.setFailed(`🛑 ONE OR MORE REQUIRED CI PIPELINES FAILED:\n${failureMessages}`);
        } else {
            core.info(`🎉 SUCCESS! All ${repos.length} required CI pipelines concluded successfully.`);
            core.setOutput('is-success', 'true');
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();