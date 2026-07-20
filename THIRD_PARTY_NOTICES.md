# Third-party data notices

## IETF MIB code components

The active catalog includes 72 modules extracted from IETF-stream RFCs whose
publication date, stream, code-component notice, and absence of a restrictive
pre-5378 legend passed the automated fail-closed gate. IANA-maintained files
supersede same-name RFC extracts. Each served IETF file begins with a retained
Revised BSD redistribution notice and links to its source RFC.

IETF code components are licensed under the Revised BSD License described in
section 4 of the [IETF Trust Legal Provisions](https://trustee.ietf.org/documents/trust-legal-provisions/tlp-5/).
The IETF and contributor names may not be used to endorse mibvendor.

Fourteen candidate RFCs are explicitly listed as quarantined in
[`data/mib-catalog.json`](data/mib-catalog.json); their MIB text is not bundled
or served.

## IANA-maintained MIB files

The 20 raw files directly linked by the IANA protocol index's maintained-MIB
group are retained byte-for-byte. IANA protocol registry data is made available
under [CC0 1.0](https://www.iana.org/help/licensing-terms). The source checksum
and served checksum must therefore remain identical.

## IANA Private Enterprise Numbers

The bundled snapshot retains only Private Enterprise Number and organization
fields from the [IANA PEN registry](https://www.iana.org/assignments/enterprise-numbers/).
IANA protocol registry data is provided under
[CC0 1.0](https://www.iana.org/help/licensing-terms). Contact names and email
addresses from the upstream registry are deliberately discarded.

## Net-SNMP project MIBs and agent platform identifiers

The 18 Net-SNMP/UCD/LM-Sensors project MIBs and exact `sysObjectID` mappings are
pinned to Net-SNMP tag `v5.9.5.2`, commit
`319bbd0bb36547992c0e1302fef278c6f49d0c80`. Net-SNMP publishes the applicable
package material under multiple BSD-family notices. The complete pinned
[`COPYING`](data/mibs/redistributable/net-snmp/COPYING) file is distributed
with the modules and must be retained. Net-SNMP's copied RFC MIB files are not
treated as Net-SNMP-authored modules and are excluded from this source class.

These mappings identify an agent platform declared by an exact OID. They do not
identify a hardware model, prove device ownership, or authenticate the device.

## Device-identity metadata and project observations

The production `device-identity-2026-07-20.3` release contains normalized
factual OID assignments from the LibreNMS repository at commit
`dfba713a2ffd39c2b6619cccdec016e04a06a027`. LibreNMS identifies the repository
as GPL-3.0-or-later; the pinned `LICENSE.txt` and `README.md` checksums are
recorded in `data/device-identities/vendor-mib-sources.json`. The complete GPL
version 3 text and the accompanying upstream repository notice are retained at
[`data/device-identities/licenses/librenms/LICENSE.txt`](data/device-identities/licenses/librenms/LICENSE.txt)
and
[`data/device-identities/licenses/librenms/README.md`](data/device-identities/licenses/librenms/README.md).

Vendor-artifact restrictions take precedence over that repository signal. This
identity layer therefore publishes only numeric assignments, source symbols,
36 reviewed device-model normalizations, conservative family/category
classification, generic vendor identifiers, source URLs, revisions, and
checksums. A generic identifier may refer to a chassis, module, line card, or
component; it is not a model claim. This layer contains no raw vendor MIB bytes
or descriptions and grants no right to obtain or redistribute those source
artifacts.

Sanitized project-observation metadata also derives from LibreNMS test fixtures
at the same pinned commit and SNMP::Info test fixtures at commit
`613d360b629d58d1a7de90e07c14b62e3a40748f`. The exact SNMP::Info BSD-3-Clause
license and disclaimer are retained in
[`data/device-identities/licenses/SNMP-INFO-LICENSE`](data/device-identities/licenses/SNMP-INFO-LICENSE).

The normalized project layer excludes raw fixtures, walks, serial numbers,
hostnames, contact/location fields, addresses, credentials, and raw
`sysDescr`. Its model values are observations usable only for corroboration,
not universal product claims. Exact pinned license evidence and input checksums
are recorded in
`data/device-identities/project-fixtures-manifest.json`.

## LibreNMS-derived platform-prefix definitions

The definition-only dataset
[`data/device-identities/project-prefixes.json`](data/device-identities/project-prefixes.json)
is derived from the `resources/definitions/os_detection` tree in the same
pinned LibreNMS commit
[`dfba713a2ffd39c2b6619cccdec016e04a06a027`](https://github.com/librenms/librenms/tree/dfba713a2ffd39c2b6619cccdec016e04a06a027/resources/definitions/os_detection),
dated 2026-07-18. LibreNMS identifies the repository as GPL-3.0-or-later. The
LibreNMS-derived prefix records in `project-prefixes.json`, the corresponding
rows embedded in `runtime-index.json`, and those records returned by the API
are therefore distributed under GPL-3.0-or-later. This does not classify
unrelated runtime-index content or the rest of mibvendor as GPL.

The adapter publishes 655 unconditional, arc-bound `sysObjectID` prefixes for
406 platform keys across 266 PENs. It publishes a platform claim only. It does
not publish a model, product family, vendor MIB content, raw YAML, source
descriptions, or firmware claims. The 358 rejected literals remain quarantined
because they are conditional, are PEN roots, fall outside the enterprise tree,
are shared Net-SNMP agent identifiers, or conflict across platform definitions.

The manifest
[`data/device-identities/project-prefixes-manifest.json`](data/device-identities/project-prefixes-manifest.json)
binds the exact repository and commit, input tree, all 806 tracked input paths,
Git modes and blob identifiers, SHA-256 values, total bytes, license/README
blob and SHA-256 values, required license markers, parser policy, and resource
limits. A mismatch fails closed to `NOASSERTION` and quarantine. The retained
GPL text and upstream notice are the same LibreNMS files linked above. The
pinned upstream tree is the source for the derived records; mibvendor does not
provide a raw-YAML endpoint.

## RackTables-derived exact device definitions

The definition-only dataset
[`data/device-identities/project-definitions.json`](data/device-identities/project-definitions.json)
is derived from the static `known_switches` table in RackTables commit
[`e5fff9f8aab339798ed47e8c6d7d977ed97a82bd`](https://github.com/RackTables/racktables/tree/e5fff9f8aab339798ed47e8c6d7d977ed97a82bd),
source path `wwwroot/inc/snmp.php`. RackTables identifies this material as
GPL-2.0-only. The RackTables-derived definition content in
`project-definitions.json`, the definition rows embedded in the mixed
`runtime-index.json`, and individual definition content returned by the API are
therefore distributed under GPL-2.0-only. This does not classify unrelated
runtime-index content or the rest of mibvendor as GPL; those remain under their
own licenses except where another third-party notice says otherwise.

The pinned upstream notice and full license text are retained as
[`COPYING`](data/device-identities/licenses/racktables/COPYING) and
[`LICENSE`](data/device-identities/licenses/racktables/LICENSE). The source
artifact is bound by Git blob
`36af514aae26ed22750d06fb18c8b80a41bfccdb` and SHA-256
`9d54ec87a9678fccc9fc1c49e36888362bc2bdeb8130f2b8498cba694f5ae8fa`.
The exact source revision, review artifact, retained-license checksums, field
normalization contract, quarantine reasons, and overlap dispositions are
recorded in
[`data/device-identities/project-definitions-manifest.json`](data/device-identities/project-definitions-manifest.json).

Only normalized numeric OIDs, bounded model labels, and provenance are
published. RackTables PHP/source code, source descriptions, port summaries,
raw device data, and firmware claims are not included or exposed by the API.

## Repository-license-derived MIB collections

The following collections are published under mibvendor's repository-license
signal policy. A recognized license at the exact pinned repository revision is
treated as publication permission for that snapshot only when the artifact does
not carry a more specific conflicting restriction, confidential-material claim,
or no-license notice. Conflicting artifacts are quarantined and their raw bytes
are neither retained in public staging nor published. This is a release policy,
not a claim that the repository owner authored or owns every embedded MIB. Each
published artifact remains traceable by source URL and checksum and may be
removed through the documented takedown process.

| Source | License signal | Pinned revision | Retained notice |
| --- | --- | --- | --- |
| dynatrace-extensions/snmp-mib-files | Apache-2.0 | `5050aeed71a88f2994e7dc2a8ba1ca5b377abb3c` | [`LICENSE`](data/mibs/redistributable/license-derived/dynatrace-snmp-mib-files/licenses/LICENSE) |
| erlang/otp SNMP | Apache-2.0 | `34baca942c370d385ed03daa1fcd8c0f7c3bb88b` | [`LICENSE.txt`](data/mibs/redistributable/license-derived/erlang-otp-snmp/licenses/LICENSE.txt) |
| kmalinich/snmp-mibs | MIT | `4ad06ab6c6d205b2844495dae032ae23f1970c95` | [`LICENSE`](data/mibs/redistributable/license-derived/kmalinich-snmp-mibs/licenses/LICENSE) |
| ntop/ntopng MIBs | GPL-3.0 | `b225f45d319cbc7ed45e4044ab5c3f3abd08c747` | [`LICENSE`](data/mibs/redistributable/license-derived/ntopng-mibs/licenses/LICENSE) |
| openss7/mibs | AGPL-3.0 | `7c7fc62a98b820d5d13946717661d2f32b898c03` | [`COPYING`](data/mibs/redistributable/license-derived/openss7-mibs/licenses/COPYING) |
| osnmpd/mibs | MIT | `a7c7830cfbbb77fc20d18021531e250267da67e3` | [`LICENSE`](data/mibs/redistributable/license-derived/osnmpd-mibs/licenses/LICENSE) |
| pandorafms/open-mibs | GPL-2.0 | `ab7e2a4c20707834cd1ed28fefc06631cbfa8f15` | [`LICENSE`](data/mibs/redistributable/license-derived/pandora-open-mibs/licenses/LICENSE) |
| sigscale/mibs | Apache-2.0 | `14259b9e52a5cd7ff0fd60b33728da616792887d` | [`COPYING`](data/mibs/redistributable/license-derived/sigscale-mibs/licenses/COPYING) |
| ska-telescope/ska-low-sre-vendor-mibs | BSD-3-Clause | `47e13d3d6aa8413f9d44779a3180e407d536d847` | [`LICENSE`](data/mibs/redistributable/license-derived/ska-low-sre-vendor-mibs/licenses/LICENSE) |

The retained license files and the source-specific notices in each raw MIB must
remain with redistributed raw files. The API exposes source provenance and
checksums so consumers can audit the exact material used by a data release.
