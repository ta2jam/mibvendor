# Third-party data notices

## IANA Private Enterprise Numbers

The bundled snapshot retains only Private Enterprise Number and organization
fields from the [IANA PEN registry](https://www.iana.org/assignments/enterprise-numbers/).
IANA protocol registry data is provided under
[CC0 1.0](https://www.iana.org/help/licensing-terms). Contact names and email
addresses from the upstream registry are deliberately discarded.

## Net-SNMP agent platform identifiers

The initial exact `sysObjectID` mappings are normalized from the Net-SNMP
`NET-SNMP-TC` definitions pinned at commit
`ebe576ae028a25bd706c86125f7b737cf5173d69`. Net-SNMP publishes the applicable
package material under the BSD-family notices in its
[COPYING file](https://github.com/net-snmp/net-snmp/blob/master/COPYING).

These mappings identify an agent platform declared by an exact OID. They do not
identify a hardware model, prove device ownership, or authenticate the device.
