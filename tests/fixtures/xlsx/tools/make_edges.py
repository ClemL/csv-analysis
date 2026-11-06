import os, re, sys, zipfile
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import PatternFill
out = sys.argv[1]
tmp = out + '.tmp'
wb = Workbook()
ws = wb.active
ws.title = 'Edges'
ws['A1'] = 'PLACEHOLDER'
fill = PatternFill('solid', fgColor='FFFF00')
for c in 'ABCDEFGH':
    ws[f'{c}20'].fill = fill
ws['F6'].comment = Comment('a note', 'me')
ws2 = wb.create_sheet(' Spaced.Name ')
ws2['B2'] = 'x'
ws3 = wb.create_sheet('Formats')
ws3['A1'] = 1
ws3['A1'].number_format = '0.00'
wb.save(tmp)

# Hand-written rows for Edges. s="1" is the fill style openpyxl created (checked below).
rows = '''
<row r="1"><c r="A1" t="inlineStr"><is><t>h1</t></is></c><c r="B1" t="inlineStr"><is><t>h2</t></is></c><c r="C1" t="inlineStr"><is><t>h3</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>0</v></c></row>
<row r="3"><c r="A3" s="1"/><c r="B3" s="1"/><c r="D3" s="1"/></row>
<row r="4"><c r="A4" t="s"><v>1</v></c><c r="B4"><f>1+1</f><v>5</v></c><c r="C4" t="str"><f>A4&amp;"x"</f></c></row>
<row r="5"><c r="A5" t="inlineStr"><is><t xml:space="preserve">inline
two</t></is></c><c r="B5" t="s"><v>2</v></c><c r="C5" t="s"><v>3</v></c></row>
<row r="7"><c r="A7" t="d"><v>2026-09-01</v></c><c r="B7" t="d"><v>2026-09-01T14:05:00.000</v></c><c r="C7" t="b"><v>true</v></c></row>
<row r="8"><c r="A8" t="str"/><c r="B8" t="e"><v>#BOGUS</v></c><c r="C8"><v>abc</v></c></row>
<row r="9"><c r="A9" t="s"><v>4</v></c><c r="B9"><v> 12 </v></c><c r="C9"><v>1e3</v></c></row>
<row r="10"><c r="B10" t="inlineStr"><is><r><t>run</t></r><r><rPr><b/></rPr><t xml:space="preserve"> a
b</t></r></is></c></row>
'''
sst = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
<si><t></t></si>
<si><t>A4 text</t></si>
<si><t>esc_x000D__x000A_end _x005F_x0041_ _X0041_</t></si>
<si><r><t>rich</t></r><r><rPr><i/></rPr><t xml:space="preserve"> line
next</t></r><rPh sb="0" eb="1"><t>PH</t></rPh></si>
<si><t xml:space="preserve">  padded  </t></si>
</sst>'''
zin = zipfile.ZipFile(tmp)
zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
names = zin.namelist()
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == 'xl/worksheets/sheet1.xml':
        s = data.decode()
        # keep the openpyxl row 20 (styled), replace the rest
        row20 = re.search(r'<row r="20".*?</row>', s, re.S).group(0)
        s = re.sub(r'<sheetData>.*</sheetData>', '<sheetData>' + rows + row20 + '</sheetData>', s, flags=re.S)
        data = s.encode()
    if item.filename == '[Content_Types].xml' and 'sharedStrings' not in data.decode():
        data = data.decode().replace('</Types>', '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>').encode()
    if item.filename == 'xl/_rels/workbook.xml.rels' and 'sharedStrings' not in data.decode():
        data = data.decode().replace('</Relationships>', '<Relationship Id="rIdSST" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>').encode()
    if item.filename == 'xl/sharedStrings.xml':
        data = sst.encode()
    zout.writestr(item, data)
if 'xl/sharedStrings.xml' not in names:
    zout.writestr('xl/sharedStrings.xml', sst)
zout.close()
os.remove(tmp)
