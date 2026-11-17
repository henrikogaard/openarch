# @openarch/archi

Import and export [Archi](https://www.archimatetool.com/)'s native `.archimate`
format. This lets models move between OpenArch and the Archi desktop tool
without converting through AOEF first.

## Format

A `.archimate` file is a ZIP archive. The model itself lives in `model.xml`
(some archives place it at `model/model.xml`); Archi may also add an `images/`
directory for custom icons and images. The XML uses Archi's own namespace:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<archimate:model
  xmlns:archimate="http://www.archimatetool.com/archimate"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  name="My model"
  id="id-model">
  <folder name="Business" id="id-business" type="business">
    <element id="id-actor" name="Customer" type="BusinessActor">
      <documentation>External customer</documentation>
      <properties>
        <property key="owner" value="Sales"/>
      </properties>
    </element>
  </folder>
  <folder name="Relations" id="id-relations" type="relations">
    <element id="id-serving" name="Serves" type="ServingRelationship"
             source="id-process" target="id-actor"/>
  </folder>
  <folder name="Views" id="id-views" type="diagrams">
    <view id="id-view" name="Main">
      <child xsi:type="archimate:DiagramModelArchimateObject" id="id-node">
        <bounds x="10" y="20" width="120" height="60"/>
        <archimateElement xsi:type="archimate:BusinessActor" href="id-actor"/>
      </child>
      <connection xsi:type="archimate:DiagramModelArchimateConnection"
                  id="id-connection" source="id-node" target="id-other">
        <archimateRelationship href="id-serving"/>
      </connection>
    </view>
  </folder>
</archimate:model>
```

## Usage

```ts
import { exportArchi, importArchi } from '@openarch/archi';

const bytes = exportArchi(model); // Uint8Array containing a .archimate ZIP
const { model: imported, warnings } = importArchi(bytes);
```

`importArchi` returns the model plus any non-fatal warnings (for example,
unknown concept types or diagram connections with missing endpoints). Invalid
archives, a missing `model.xml`, and malformed XML throw an `Error` with a
descriptive message.

## Mapping

| Archi native | OpenArch core |
| --- | --- |
| `<archimate:model name id>` | `Model.name`, `Model.id` |
| `<documentation>` on the model | `Model.documentation` |
| Top-level layer `<folder>` | `Domain` (`domain-<slug>`, fixed palette color) |
| Nested `<folder>` | Inherits the nearest top-level domain |
| `<element type="BusinessActor">` | `ArchiElement.type` (validated with `getElementType`) |
| `<element type="ServingRelationship">` | `Relationship.type = "Serving"` (suffix stripped) |
| `<property key value>` | `Property { key, value }` |
| `<view>` | `View` |
| `<child>` with `<archimateElement href>` | `ViewNode` with `elementRef` and `bounds` |
| `<child>` without an element | `ViewNode` with `type: "Label"` and the `name` as label |
| `<connection source target>` | `ViewEdge` with `source`, `target`, `relationshipRef` |
| `<bounds x y width height>` | `Bounds { x, y, w, h }` |

On export, elements are grouped into folders by ArchiMate layer (`business`,
`application`, `technology`, `physical`, `motivation`, `strategy`,
`implementation`, `other`). Relationships go into a `relations` folder and
views into a `diagrams` folder. Relationship types gain the native
`Relationship` suffix (`Serving` → `ServingRelationship`).

## Limitations

- **Images and custom icons are not preserved.** The `images/` directory of an
  imported archive is ignored, and no images are written on export.
- **Visual styling is not preserved.** Fonts, colors, line styles, icon
  settings, and other Archi diagram styling are not part of the core model and
  are dropped.
- **Nested diagram children are flattened.** Groups and other container
  children become label nodes, and their descendants are collected as ordinary
  view nodes. Bounds are kept as stored in the file.
- **One name and one documentation string per concept.** Archi stores a single
  name/documentation value; multiple localized values collapse to a single
  string on export.
- **Domains are layer-derived.** Archi top-level layer folders become domains;
  container folders such as `relations`, `diagrams`, and `derived` do not.
  Custom OpenArch domains are not written separately and therefore do not
  survive a round trip.
- **Unknown element types are kept, not rejected.** They are imported as-is and
  reported in `warnings`. Unknown relationship types are handled the same way.
