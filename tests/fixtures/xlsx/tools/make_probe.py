import sys
from openpyxl import Workbook
out = sys.argv[1]
FORMATS = ['General', '0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '0.00E+00', '# ?/?', '# ??/??',
    'm/d/yyyy', 'd-mmm-yy', 'd-mmm', 'mmm-yy', 'h:mm AM/PM', 'h:mm:ss AM/PM', 'h:mm', 'h:mm:ss',
    'm/d/yyyy h:mm', 'mm:ss', '[h]:mm:ss', 'mmss.0', '##0.0E+0', '@', '#,##0 ;(#,##0)',
    '#,##0.00;[Red](#,##0.00)', '"$"#,##0', '[$€-407]#,##0.00', '0.000', '#,##0,"K"', '#,##0.0,,"M"',
    'dddd, mmmm d, yyyy', 'yyyy-mm-dd hh:mm:ss', 'hh:mm:ss.000', '[mm]:ss', '0;-0;"zero";"text: "@',
    '?/8', '# ?/4', 'm/d/yyyy h:mm AM/PM', 'mm/dd/yyyy', 'yyyymmdd', '000-00-0000', '00000', '0.0#',
    '#.##', '#,##0.00_);[Red](#,##0.00)', 'dd/mm/yy', 'mmmmm', 'ddd', 'hh "hrs"', '0.00 "units"', '\\$0.00']
VALUES = [0.6045138889, 46266.6045138889, 46266, 1234.5678, -1234.5678, 0, 'abc', 0.5, 1e-10, 98765432.1]
wb = Workbook()
ws = wb.active
ws.title = 'Probe'
ws.append(['format'] + [f'v{i}' for i in range(len(VALUES))])
for f in FORMATS:
    ws.append([f] + VALUES)
    r = ws.max_row
    for c in range(2, len(VALUES) + 2):
        ws.cell(r, c).number_format = f
wb.save(out)
