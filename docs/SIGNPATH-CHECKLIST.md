# SignPath Foundation readiness checklist

This checklist separates repository work from account and release work. A checked item is prepared in the repository; an unchecked item requires a public GitHub/SignPath action or an external review.

## Repository-controlled

- [x] Apache License 2.0 in `LICENSE`.
- [x] README explains the product, installation, features, and downloads/builds.
- [x] `CODE-SIGNING-POLICY.md` uses the required “Code signing policy” wording and documents ownership, roles, provenance, privacy, releases, and manual approval.
- [x] `CODE_OF_CONDUCT.md` is published.
- [x] `SECURITY.md` explains private vulnerability reporting.
- [x] `.github/workflows/build.yml` builds the Windows installer from source, runs tests, uploads the unsigned artifact, and provides an opt-in SignPath submission job.
- [x] Root and desktop package metadata identify Apache-2.0 licensing and the intended GitHub repository.
- [x] Generated dependencies and build outputs are excluded from Git by `.gitignore`.

## Maintainer/release actions still required

- [ ] Create or confirm the public repository at `https://github.com/f4did/F4-Studio`.
- [ ] Push the committed source and enable GitHub Actions.
- [ ] Enable MFA/2FA on every GitHub account with repository access.
- [ ] Apply to SignPath Foundation and enable MFA on the SignPath account.
- [ ] Configure the SignPath GitHub connector, project slug, signing policy slug, and artifact configuration.
- [ ] Add `SIGNPATH_API_TOKEN` as a GitHub Actions secret and the SignPath IDs as repository variables.
- [ ] Create at least one GitHub release containing the built Windows executable.
- [ ] Publish a free download/release page and link the Code Signing Policy from it.
- [ ] Review bundled media, fonts, dependencies, and generated/runtime components for compatible open-source or redistributable licenses; document third-party notices where required.
- [ ] Complete SignPath’s malware/PUA, project ownership, active-maintenance, and source-to-binary eligibility review.

Do not mark the external items complete until they are verified in GitHub, SignPath, and the public release page.
