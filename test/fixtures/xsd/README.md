# ArchiMate 3.0 Open Exchange Format schemas

These files are the official Open Group schemas used **only** by the schema-conformance
tests in `packages/core/src/aoef.conformance.test.ts`.

| File | Source |
|---|---|
| `archimate3_Model.xsd` | https://www.opengroup.org/xsd/archimate/3.0/archimate3_Model.xsd |
| `archimate3_View.xsd` | https://www.opengroup.org/xsd/archimate/3.0/archimate3_View.xsd |
| `archimate3_Diagram.xsd` | https://www.opengroup.org/xsd/archimate/3.0/archimate3_Diagram.xsd |
| `xml.xsd` | https://www.w3.org/2001/xml.xsd |

`archimate3_Diagram.xsd` includes `archimate3_View.xsd`, which includes
`archimate3_Model.xsd`. The Model schema imports `xml.xsd`; the vendored copy's
`schemaLocation` was changed from the w3.org URL to the local `xml.xsd` so validation
works offline. That one-line change is the only modification to the official files.

The tests validate models **without** Dublin Core metadata. The Open Group's ArchiSurance
example carries `dc:*` elements that require the Dublin Core schema, which is not vendored
here; the conformance test asserts that every *other* error is absent.

ArchiMate® is a registered trademark of The Open Group. These schema files are the
property of The Open Group and are included unmodified for interoperability testing.
