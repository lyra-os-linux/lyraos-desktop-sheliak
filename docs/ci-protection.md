# Required check for main

The `main` branch requires the GitHub Actions check `contracts` (app ID
`15368`) and an up-to-date PR branch. Protection applies to repository
administrators. Additional review count remains zero; force pushes and branch
deletion remain disabled.

The check validates TypeScript, the extension bundle, translations, tests,
RPM packaging contracts and build reproducibility. It runs on every PR and
on pushes to main. It is independent of the OBS publication workflow;
passing CI does not prove package publication or qualify a GNOME session/ISO.

## Qualification on 2026-09-15

[PR #33](https://github.com/lyra-os-linux/lyraos-desktop-sheliak/pull/33)
exercised the policy using the maintainer's administrator account. A temporary
step, restricted to that PR branch, delayed and deliberately failed the
`contracts` job. No extension code was changed. The step was removed before
the final CI run; the resulting workflow matches the previously qualified
production workflow.

| State on the controlled PR | Merge API result |
| --- | --- |
| `contracts` in progress | HTTP 405: `Required status check "contracts" is in progress.` |
| `contracts` failed | HTTP 405: `Required status check "contracts" is failing.` |

Both merge requests included the exact PR head SHA. The refused attempts
left `main` at `f8d713bad0f0fdd6db372eb9635066ccbde7c1d0`. The
[controlled CI run](https://github.com/lyra-os-linux/lyraos-desktop-sheliak/actions/runs/34986285239)
records the intentional failure; it is not an extension regression. A
successful complete `contracts` run on the final PR head remains required
for the documentation merge. Issue #16 records the final CI and merge receipt.

## Administration and recovery

The effective protection lives in GitHub settings. Inspect the branch
protection endpoint and applicable rules after policy or workflow changes.
Preserve the check name and GitHub Actions app binding. Administrators can
still deliberately edit protection settings; routine merges must satisfy
the required check. No user/team/app bypass is configured in the inspected
policy, and the API returned no additional rules applicable to main.

GitHub accepts successful, neutral or skipped conclusions for required
checks. The current job has no job-level skip condition and the workflow has
no PR path or branch filter. Preserve that coverage when changing CI.

The configuration changed only required status checks and administrator
enforcement. An explicitly approved rollback would restore no required checks
and disabled administrator enforcement, leaving other policy fields intact.
That removes this CI gate and must be recorded as a policy change; normal
workflow or infrastructure failures should instead be corrected and rerun.

References:

- https://github.com/lyra-os-linux/lyraos-desktop-sheliak/issues/16
- https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection
