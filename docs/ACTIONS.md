# Owner action register

This register contains work that repository automation cannot truthfully
complete. Order is dependency-driven.

| Order | Owner action | Blocks | Current fallback |
|---:|---|---|---|
| 1 | Provide an accountable research contact/deletion email and approve the consent notice. | Recruiting and storing session evidence. | Do not recruit or retain personal data. |
| 2 | Approve recruitment channels and incentive policy; recruit 4 beginners, 4 experts, and 4 API/tool developers. | All demand gates and comparative UX claims. | Desk evidence remains directional only. |
| 3 | Schedule/run 12 moderated sessions using one tagged prototype build and enter evidence in the score sheet. | `0/12` interviews and `0/5` material-loss gates. | No claim of validated demand. |
| 4 | Keep the prototype available for 14 days and have consenting participants use it on a second real task. | `0/3` repeat-use gate; elapsed real use cannot be simulated. | Stated intent is not counted. |
| 5 | Have at least 3 external tool developers exercise the public-alpha API and provide code/test artifacts. | `0/3` real API-integration gate. | The live endpoint has a machine-checked OpenAPI 3.1 contract; external use remains `0/3`, so the contracts are still hypotheses. |
| 6 | Send first-wave vendor rights and source-verification requests from an accountable owner identity: Cisco, Juniper, Arista, HPE Aruba, Fortinet, Palo Alto Networks, VMware/Broadcom, NetApp, Dell, Synology. | Official-source corroboration and any vendor-authorized raw/rendered scope. | License-signaled project sources may publish governed metadata, but artifact restrictions still block vendor raw text/descriptions and unverified official references remain labelled as such. |

## Dependency notes

- Actions 1–2 precede interviews. Action 4 starts only after first sessions and
  necessarily consumes real calendar time.
- Action 5 can run in parallel with interviews once the synthetic probe is
  reachable to integrators.
- Action 6 can start immediately but vendor response time is open-ended. Silence
  is not approval.
- The Linux amd64 container run is complete: all three candidates met all nine
  synthetic expectations with no timeout and deterministic normalized output.
  The native Linux arm64 run reproduced the same normalized evidence. This is
  multi-architecture reproducibility evidence, not vendor-compatibility evidence.
- The parser work no longer needs owner action: 100 unique tracked
  redistributable files and the separate CC0 edge suite produced identical
  native amd64/arm64 evidence. PySMI 2.0.0 passed the fail-closed selection;
  public files remain positive breadth rather than proprietary malformed-input
  evidence.
