# Eval datasets

Labelled documents for measuring extraction accuracy and confidence calibration.
The scorer and loader are in `src/evals/`.

Each dataset is a directory containing the document files plus a `labels.json`:

```
evals/datasets/
  own/            # your own receipts and invoices (gitignored, personal data)
    labels.json
    careem-2026-08-14.jpg
    ...
  sroie/          # public labelled sets, added in Phase 6
  synthetic/      # generated edge cases: blurry, rotated, multi-currency...
```

## `labels.json`

An array of documents. Fields use the same flattened shape as `ExtractionField`,
so predictions and labels can be compared path by path:

```json
[
  {
    "file": "careem-2026-08-14.jpg",
    "fields": [
      { "path": "vendorName", "valueType": "TEXT", "value": "Careem" },
      { "path": "date", "valueType": "DATE", "value": "2026-08-14" },
      { "path": "currency", "valueType": "CURRENCY_CODE", "value": "AED" },
      { "path": "total", "valueType": "MONEY", "value": "42.50" },
      { "path": "tax", "valueType": "MONEY", "value": null },
      { "path": "lineItems.0.description", "valueType": "TEXT", "value": "Trip fare" },
      { "path": "lineItems.0.amount", "valueType": "MONEY", "value": "40.00" }
    ]
  }
]
```

Labelling rules:

- **Canonical values:** ISO dates (`2026-08-14`), plain decimals with no currency symbol or thousands separator (`1234.50`), and ISO 4217 codes (`AED`).
- **`null` means the document doesn't have the field** (e.g. no tax line). The model gets credit for returning nothing. If you leave a field out entirely, it isn't scored.
- **Label what the document says, not what it should say.** If the line items don't add up to the total, label both as printed; catching that is the validation agent's job.
- **Number line items top to bottom**, starting at 0.

The field list is provisional until the Phase 2 extraction schema is fixed. Relabelling a handful of receipts is cheap, so keep the first batch to around 15–20 documents.
