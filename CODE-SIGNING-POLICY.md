# Code Signing Policy

## Windows code signing

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

F4 Studio intends to use SignPath Foundation for signing Windows executable releases. Until SignPath approval is granted and a signed release is published, any local or CI executable must be treated as unsigned.

## Project ownership

The source code, build scripts, packaging configuration, and release process are maintained by the F4 Studio project maintainer.

Project repository: [github.com/f4did/F4-Studio](https://github.com/f4did/F4-Studio)

## Team roles

- Authors/committers: [@f4did](https://github.com/f4did)
- Reviewers: [@f4did](https://github.com/f4did)
- Approvers: [@f4did](https://github.com/f4did)

External contributions must be reviewed before merging. Every release signing request requires manual approval by the designated approver in SignPath.

## Build and provenance

Windows release executables are built by GitHub Actions from this public repository. The workflow installs dependencies from the committed lockfiles, runs the test suite, builds the Vite application, and packages the Electron Windows artifact.

Only binaries built from this project’s source code and build scripts are submitted for signing. The signing workflow uploads the unsigned artifact to GitHub Actions before submitting it to SignPath, allowing the trusted build system to verify repository origin.

The SignPath project, signing policy, and artifact configuration slugs are kept in the SignPath project configuration and GitHub Actions variables. The API token is stored only as the `SIGNPATH_API_TOKEN` GitHub Actions secret.

## Release process

1. Merge the reviewed source and workflow changes to the release branch.
2. Create a version tag/release in GitHub.
3. Run the Windows build workflow from the public repository.
4. Inspect the test results and unsigned artifact.
5. Submit the artifact to SignPath using the manual signing approval path.
6. Verify the signed executable’s publisher and signature.
7. Publish the signed executable on the [GitHub Releases page](https://github.com/f4did/F4-Studio/releases).

## Privacy policy

F4 Studio is local-first. The program will not transfer information to other networked systems unless specifically requested by the user or the person installing or operating it. GitHub, SignPath, package registries, and any hosting provider have their own privacy policies and are used only for development, build, signing, or distribution services.

## Distribution

Official signed Windows releases will be distributed through the project’s GitHub Releases page. The README must link to the latest release/download page and this policy before applying for signing.

## Security and integrity

No signing key or SignPath API token belongs in this repository. Pull requests must not modify signing workflow permissions, artifact paths, or provenance fields without review. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
