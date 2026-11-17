# Security Policy

## Supported versions

Security fixes are applied to the latest `master` branch and the latest published release. Older releases may not receive fixes.

## Reporting a vulnerability

Please do not publish an exploitable vulnerability in a public issue. Report it privately through GitHub’s security advisory/reporting flow for [F4 Studio](https://github.com/f4did/F4-Studio/security), or contact the maintainer through the project’s verified GitHub profile [@f4did](https://github.com/f4did).

Include:

- affected version or commit;
- operating system and runtime;
- clear reproduction steps;
- impact assessment;
- a minimal proof of concept, if safe to share.

The maintainer will acknowledge a report when practical, investigate it, coordinate a fix, and credit the reporter if they want attribution. Do not include passwords, API tokens, private media, or personal data in reports.

## Supply-chain and release integrity

- Dependencies are pinned by `package-lock.json` and `desktop/package-lock.json`.
- Release builds run from the public GitHub repository using GitHub-hosted runners.
- SignPath signing credentials are stored as GitHub Actions secrets and never committed.
- Users should download Windows executables only from the official GitHub Releases page and verify the digital signature when one is published.
