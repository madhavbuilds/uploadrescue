# Security policy

## Supported versions

| Version            | Supported |
| ------------------ | --------- |
| 0.x (latest minor) | ✓         |

## Reporting a vulnerability

**Please do not open public issues for security problems.**

Report privately through GitHub's **[Report a vulnerability](../../security/advisories/new)** button (Security → Advisories) on this repository. Include:

- affected package(s) and version(s);
- a description of the issue and its impact;
- a minimal reproduction (a file or code sample), if possible.

We aim to acknowledge reports within 3 business days and to provide a fix or mitigation plan within 30 days for confirmed issues. We will credit reporters in the advisory unless you prefer otherwise.

## Scope

In scope: anything in this repository's published packages — for example SVG sanitization bypasses, ZIP limit bypasses (bombs, traversal, overlapping entries), unexpected network requests, code execution, or resource exhaustion that the documented limits should prevent.

Out of scope: the security of files _after_ your server receives them. UploadRescue is not a malware scanner; compressing a file does not make it safe. See [docs/security.md](docs/security.md) for the full security model.
