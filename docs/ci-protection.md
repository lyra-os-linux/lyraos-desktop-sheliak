# Required check for main

The `main` branch requires the GitHub Actions check `contracts` (app ID
`15368`) and an up-to-date PR branch. Protection applies to repository
administrators. Additional review count remains zero; force pushes and branch
deletion remain disabled.

The check validates TypeScript, the extension bundle, translations, tests,
RPM packaging contracts and build reproducibility. It runs on every PR and
on pushes to main. It is independent of the OBS publication workflow;
passing CI does not prove package publication or qualify a GNOME session/ISO.

Issue #16 is qualified with a temporary failure step restricted to the test
PR branch. The step must be removed before the final CI run and documentation
merge. No extension code is changed by the test.

The effective protection lives in GitHub settings. Inspect the branch
protection endpoint and applicable rules after policy or workflow changes.
Preserve the check name and GitHub Actions app binding. Administrators can
still deliberately edit protection settings; routine merges must satisfy
the required check.

References:

- https://github.com/lyra-os-linux/lyraos-desktop-sheliak/issues/16
- https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection
