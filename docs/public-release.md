# Public-release hygiene / 公开版本净化说明

The public release is built from an explicit source allowlist in an isolated directory. Existing development outputs and local runtime state are not copied into it.

公开版本从明确列出的源代码文件建立独立快照，不复制开发环境已有的运行目录和历史产物。

Included: MOKI source, synthetic tests, reproducible build scripts, dependency lockfile, license notices, bilingual documentation and purpose-made demo media.

Excluded: personal libraries and databases, conversations, original user files, authentication state, environment files, local package-manager configuration, caches, debug ports/configuration, native test recordings, historical screenshots, private paths and earlier release archives.

The public contact entry uses GitHub Issues. Demonstration media contains only newly created sample files and data. Third-party license notices retain the attribution required by their authors; the presence of an upstream attribution email is not an application credential.

公开联系入口使用 GitHub Issues。演示素材只使用专门制作的示例文件。第三方许可证中的作者署名、版权邮箱按原文保留，不作为应用凭据。

Before publication, scan both the source snapshot and the built archive for credentials, machine-specific paths, runtime data and unintended files. Rebuild and run the regression suite from the isolated snapshot. Record the package SHA-256 in the release.

These are release preparation checks, not a claim that all vulnerabilities have been eliminated. Report reproducible bugs with sanitized examples through the repository.
