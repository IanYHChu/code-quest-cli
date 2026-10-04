# Security policy

## Reporting a vulnerability

Please report privately through GitHub: open the **Security** tab of this repository and choose
**Report a vulnerability**. Don't open a public issue for a security problem.

Code Quest is maintained in spare time. Reports are acknowledged as soon as possible, and fixes
for confirmed problems take priority over everything else.

## What's in scope

- The mod doing anything beyond what the README's "What the mod can do" section lists
- `/cq-nudge` letting an argument reach `git` as an option, or running anything other than `git`
- The saved run, the scanner or the SARIF export leaking file contents or secrets
- A published npm release that doesn't match its provenance, or weaknesses in the workflows

## Supported versions

Only the latest release on npm is supported. Fixes ship as a new release.
