# XLSX fixtures

The workbooks here are split by `lib/xlsx.ts` in `tests/xlsx.test.ts`, and the
files in `closedxml/` are what the importer's own conversion loop wrote for them
with ClosedXML 0.105.1 on .NET 8 (en-US, LF line endings). The tests compare the
two byte for byte.

| Workbook | Built by | What it covers |
| --- | --- | --- |
| `claims_export.xlsx` | `tools/make_claims.py` | 28 formatted columns, a used range starting at C3, a hidden sheet, an empty sheet, title rows to skip |
| `format_probe.xlsx` | `tools/make_probe.py` | 53 number formats over ten values, including the ones that throw |
| `edges.xlsx` | `tools/make_edges.py` | empty strings, a comment-only cell, styled-only rows, inline and rich text, `_xHHHH_` escapes, ISO date cells, unreadable values, a formula without a saved result |

To regenerate after a ClosedXML upgrade (Python with openpyxl, and the .NET 8 SDK):

```sh
python3 tools/make_claims.py claims_export.xlsx
python3 tools/make_probe.py format_probe.xlsx
python3 tools/make_edges.py edges.xlsx
cd tools
dotnet run -- ../claims_export.xlsx ../closedxml "|"
dotnet run -- ../claims_export.xlsx ../closedxml/comma ","
dotnet run -- ../claims_export.xlsx ../closedxml/skip "|" "REPORT=2"
dotnet run -- ../format_probe.xlsx ../closedxml "|" "" probe
dotnet run -- ../edges.xlsx ../closedxml "|" "" probe
```

`tools/Program.cs` is the body of `XlsxUtil.ConvertXlsToCsvAsync` with the
logger and configuration replaced by arguments. In `probe` mode a cell whose
formatting throws is written as `!` and the exception name instead of stopping
the sheet, which is also how the app shows such a cell. The empty sheet throws
`NullReferenceException` and gets no file.
