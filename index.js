import * as core from '@actions/core';
import * as github from '@actions/github';

/**
 * Checks the status of the latest successful workflow run in a given repository.
 * @param {object} octokit - GitHub API client.
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {string} workflow_id - Workflow file name or ID (e.g., 'ci-backend.yml').
 * @param {string} ref - The branch reference to check (e.g., 'main').
 */
async function checkWorkflowStatus(octokit, owner, repo, workflow_id, ref) {
    core.info(`Checking: ${owner}/${repo}, Workflow: ${workflow_id}, Branch: ${ref}`);

    const response = await octokit.rest.actions.listWorkflowRuns({
        owner: owner,
        repo: repo,
        workflow_id: workflow_id,
        branch: ref.replace('refs/heads/', ''),
        status: 'success',
        per_page: 1,
    });

    const runs = response.data.workflow_runs;

    if (runs.length === 0) {
        throw new Error(`❌ ERROR: No successful run found for workflow '${workflow_id}' on branch '${ref}' in repository '${owner}/${repo}'.`);
    } else {
        const latestRun = runs[0];
        const runCompletedTime = new Date(latestRun.updated_at);
        core.info(`✅ Success: Workflow '${workflow_id}' in ${owner}/${repo} (ID: ${latestRun.id}) completed: ${runCompletedTime.toISOString()}`);
        return true;
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
            checkWorkflowStatus(
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
            core.setFailed(`🛑 ONE OR MORE CI CHECKS FAILED:\n${failureMessages}`);
        } else {
            core.info(`🎉 SUCCESS! All ${repos.length} required CI pipelines completed successfully.`);
            core.setOutput('is-success', 'true');
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();