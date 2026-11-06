import datetime as dt, sys
from openpyxl import Workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont

out = sys.argv[1]
wb = Workbook()
ws = wb.active
ws.title = 'Claims'
head = ['claim_id', 'member', 'fill_date', 'fill_builtin', 'iso_date', 'filled_at', 'pickup', 'duration',
        'ndc_text', 'ndc_padded', 'qty', 'unit_cost', 'price', 'accounting', 'total', 'pct', 'paid',
        'note', 'sci', 'big', 'small', 'drift', 'whole', 'neg_paren', 'neg_red', 'fraction', 'status', 'month']
ws.append(head)
formats = {
    'fill_date': 'm/d/yyyy', 'fill_builtin': 'mm-dd-yy', 'iso_date': 'yyyy-mm-dd', 'filled_at': 'm/d/yyyy h:mm',
    'pickup': 'h:mm AM/PM', 'duration': '[h]:mm:ss', 'ndc_padded': '00000000000', 'unit_cost': '#,##0.00',
    'price': '"$"#,##0.00', 'accounting': '$#,##0.00_);($#,##0.00)', 'total': '#,##0', 'pct': '0.0%',
    'sci': '0.00E+00', 'neg_paren': '#,##0.00;(#,##0.00)', 'neg_red': '0.00;[Red]-0.00', 'fraction': '# ?/?',
    'month': 'mmm yyyy',
}
rows = [
    [1000001, 'Rivera, Ana', dt.date(2026, 9, 1), dt.date(2026, 9, 1), dt.date(2026, 9, 1),
     dt.datetime(2026, 9, 1, 14, 5), dt.time(9, 30), dt.timedelta(hours=27, minutes=3, seconds=4),
     '00093714656', 93714656, 30, 1204.1, 12.5, -1234.567, 98765, 0.125, True,
     'Refill, early | see note\nsecond line', 123456.789, 123456789012345678, 0.000012, 0.1 + 0.2, 30.0,
     -42.5, -3.14159, 1.5, '#N/A', dt.date(2026, 9, 1)],
    [1000002, 'Chen, Wei', dt.date(2026, 12, 31), dt.date(2026, 12, 31), dt.date(2026, 12, 31),
     dt.datetime(2026, 12, 31, 0, 0), dt.time(23, 59, 59), dt.timedelta(minutes=5),
     '0093-7146-56', 378385593, 0, 0.005, 0, 0, 0, 1, False,
     None, 0.00042, 1e15, 1e-7, 2.675, 7, 42.5, 0, 0.333333, '#DIV/0!', dt.date(2027, 1, 15)],
    [1000003, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None,
     'last row', None, None, None, None, None, None, None, None, None, None],
]
for row in rows:
    ws.append(row)
for col, name in enumerate(head, start=1):
    if name in formats:
        for r in range(2, ws.max_row + 1):
            ws.cell(r, col).number_format = formats[name]
# Rich text in one cell: runs with different fonts, one string.
ws.cell(4, 2).value = CellRichText([TextBlock(InlineFont(b=True), 'Okafor'), ', ', TextBlock(InlineFont(i=True), 'Grace')])

summary = wb.create_sheet('Summary')
summary['C3'] = 'covered_entity'; summary['D3'] = 'claims'; summary['E3'] = 'paid'
summary['C4'] = 'CE-014'; summary['D4'] = 61204; summary['E4'] = 1234567.891
summary['E4'].number_format = '#,##0.00'
# Row 5 left blank on purpose: RowsUsed skips it.
summary['C6'] = 'CE-003'; summary['D6'] = 48330; summary['E6'] = 99.5
summary['C7'] = 'merged across'; summary.merge_cells('C7:E7')

hidden = wb.create_sheet('Hidden lookup')
hidden.sheet_state = 'hidden'
hidden.append(['code', 'label'])
hidden.append(['A', 'Active'])

wb.create_sheet('Empty')

report = wb.create_sheet('Report')
report['A1'] = 'Monthly utilization report'
report['A2'] = 'Generated 2026-10-01'
report.append(['ndc', 'fills'])
report.append(['00093714656', 12])
report.append(['00378385593', 7])

wb.save(out)
