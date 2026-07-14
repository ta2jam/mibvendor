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
