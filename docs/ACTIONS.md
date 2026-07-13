# Owner action register

This register contains work that repository automation cannot truthfully
complete. Order is dependency-driven.

| Order | Owner action | Blocks | Current fallback |
|---:|---|---|---|
| 1 | Provide an accountable research contact/deletion email and approve the consent notice. | Recruiting and storing session evidence. | Do not recruit or retain personal data. |
| 2 | Approve recruitment channels and incentive policy; recruit 4 beginners, 4 experts, and 4 API/tool developers. | All demand gates and comparative UX claims. | Desk evidence remains directional only. |
| 3 | Schedule/run 12 moderated sessions using one tagged prototype build and enter evidence in the score sheet. | `0/12` interviews and `0/5` material-loss gates. | No claim of validated demand. |
| 4 | Keep the prototype available for 14 days and have consenting participants use it on a second real task. | `0/3` repeat-use gate; elapsed real use cannot be simulated. | Stated intent is not counted. |
| 5 | Have at least 3 external tool developers exercise the synthetic API probe and provide code/test artifacts. | `0/3` real API-integration gate. | Contracts remain hypotheses. |
| 6 | Send first-wave vendor rights requests from an accountable owner identity: Cisco, Juniper, Arista, HPE Aruba, Fortinet, Palo Alto Networks, VMware/Broadcom, NetApp, Dell, Synology. | A vendor-relevant public Tier A/B path. | Public corpus remains the narrow approved standards seed; vendor data stays Q/P. |
| 7 | Supply or authorize a rights-approved 100-case parser corpus: 20 IETF/IANA, 20 valid vendor, 20 broken vendor, 20 revision-pair, and 20 collision/import cases. | Final canonical parser selection and real-vendor compatibility evidence. | Nine CC0 synthetic cases support only a provisional recommendation. |
| 8 | Provide a Docker-compatible runtime for Linux arm64/amd64 reproduction before Phase 1. | Container build, image size, Linux CPU/RSS, and malformed-input verification. | Pinned local venv/source builds remain explicitly non-container evidence. |
| 9 | Run `npx wrangler login`, explicitly approve authenticated Chrome fallback, or provide a least-privilege token for the `mibvendor.io` zone. | Mapping the research site to `mibvendor.io`. | Use [the public GitHub Pages build](https://ta2jam.github.io/mibvendor/); production remains untouched. |

## Dependency notes

- Actions 1–2 precede interviews. Action 4 starts only after first sessions and
  necessarily consumes real calendar time.
- Action 5 can run in parallel with interviews once the synthetic probe is
  reachable to integrators.
- Action 6 can start immediately but vendor response time is open-ended. Silence
  is not approval.
- Actions 7–8 close the parser decision gate; neither permits third-party MIB
  text to be committed or exposed in diagnostics.
- Action 9 does not block repository publication or interviews if the GitHub
  Pages URL is acceptable.
- A container runtime is a reproducibility dependency, not permission to install
  or run a production database/application stack.
