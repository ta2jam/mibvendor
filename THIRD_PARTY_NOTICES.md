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
