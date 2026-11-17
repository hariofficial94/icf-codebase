# Go-live: factory specification + Flipkart only for Bio Bacteria (17 Nov 2026)

## 1. Flipkart orders are only for Bio Bacteria
- On the New PO form (CRE beta), **"Flipkart order" appears only when every product on the order is Bio Bacteria** (any pack size: the product name starts with "Bio Bacteria").
- If a CRE picks Flipkart and then adds another product, the order switches back to **Standard** and the hint explains why.
- The server refuses a Flipkart order with any other product on it.

## 2. Specification for the factory
**Which products:** the **Product Catalog** tab gets a new column **D, "Needs Specification"**, added automatically the first time the catalog is read. **ReLeaf Office Container Z 2010 Model** starts as **Y**. Type **Y** against any other made-to-order product to give it the same section. No code change is needed.

**New PO form:** when such a product is on the order, a **"Specification for the factory"** section opens under Products:
- **Description and special instructions:** required, up to 1,500 characters, with a live counter.
- **Design files:** up to 10, PDF or photo, 8 MB each. They upload one at a time when the order is sent. If the order fails (for example a duplicate quotation number) and is sent again, files already uploaded aren't sent twice.

One specification per order. For several units, the text can say "Unit 1 …, Unit 2 …".

**Internal PO:** a full-width **MANUFACTURING INSTRUCTIONS** box after Items, with the description in full and the design files listed by name. The files themselves open and print from the order.

**On the order (everyone can see it):** CRE beta drawer, Ops beta order screen and Accounts beta drawer show the description and the files, each with **Open / Print**.

**Changing it:** the CRE on the order (or the Admin / a Director) can edit the description and add or remove files **at any time**. Nothing is locked after pickup.
- If Ops has already picked the order up, the order is marked **"Specification changed"**. Ops gets **one email**, and the Ops screen shows the warning at the top.
- The flag clears when Ops prints the Internal PO again ("Make a fresh copy"), because the new PO carries the latest version.
- A removed file is renamed "(removed …)" in Drive and kept, never deleted.

## Data
- Tracker columns, added automatically at the end: *Spec Description, Spec Updated At, Spec Updated By, Spec Changed After Pickup*.
- New tab **Order Design Files**, created on first use: one row per file. The admin **Delete a record** clean-up removes these rows and trashes the files with the order.
- Files live in the **ICF Order POs** Drive folder as `<Tracker ID> - Design 01 - <original name>`, shared by link like the POs.

## Note
The **classic** CRE page has no specification box, so a container order logged there will be refused and asked for the specification. All CREs use the beta page, so this shouldn't come up.

## Setup
None. Pull, `clasp push`, then log a **Test Customer …** order with the office container and a couple of files, and print its Internal PO.
