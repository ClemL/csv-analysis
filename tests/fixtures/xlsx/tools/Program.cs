// Golden-output harness: the body of XlsxUtil.ConvertXlsToCsvAsync / CreateCsvFromSheetAsync,
// with the logger and config replaced by arguments. Writes each sheet's CSV into outDir.
using ClosedXML.Excel;
using System.Globalization;

var inputFilePath = args[0];
var outDir = args[1];
var separator = args.Length > 2 ? args[2] : "|";
var skipArg = args.Length > 3 ? args[3] : "";
var extension = "csv";
CultureInfo.CurrentCulture = new CultureInfo("en-US");
CultureInfo.CurrentUICulture = new CultureInfo("en-US");

Dictionary<string, int> SkipRowDict = new();
foreach (var pair in skipArg.Split(',', StringSplitOptions.RemoveEmptyEntries))
{
    var kv = pair.Split('=');
    SkipRowDict[kv[0].Trim().ToUpper()] = int.Parse(kv[1]);
}

Directory.CreateDirectory(outDir);
using var stream = File.OpenRead(inputFilePath);
XLWorkbook wb = new XLWorkbook(stream);
foreach (IXLWorksheet sheet in wb.Worksheets)
{
    var skipRows = 0;
    if (SkipRowDict.ContainsKey(sheet.Name.Trim().ToUpper()))
        skipRows = SkipRowDict[sheet.Name.Trim().ToUpper()];

    string inputFileName = Path.GetFileNameWithoutExtension(inputFilePath);
    int result;
    int dotIndex = inputFileName.IndexOf('.');
    if (dotIndex == -1 || dotIndex == inputFileName.Length - 1) { }
    else if (int.TryParse(inputFileName.Substring(0, dotIndex), out result)) { }
    else inputFileName = inputFileName.Substring(dotIndex + 1).TrimStart();

    var newOutputFilename = $"{inputFileName}.{sheet.Name}.{extension}";
    newOutputFilename = newOutputFilename.Length <= 80 ? newOutputFilename : newOutputFilename.Substring(0, 80);

    try
    {
        var rows = sheet.RangeUsed().RowsUsed().Skip(skipRows);
        var outputCsvContent = new List<List<string>>();
        foreach (IXLRangeRow row in rows)
            outputCsvContent.Add(row.Cells().Select(c => {
                if (args.Length > 4 && args[4] == "probe")
                {
                    try { return c.GetFormattedString(); } catch (Exception ex) { return "!" + ex.GetType().Name; }
                }
                return c.GetFormattedString();
            }).ToList());
        List<string> lines = outputCsvContent.Select(r => string.Join(separator, r)).ToList();
        File.WriteAllLines(Path.Join(outDir, newOutputFilename), lines);
        Console.WriteLine($"OK\t{sheet.Name}\t{newOutputFilename}\t{lines.Count}");
    }
    catch (Exception e)
    {
        Console.WriteLine($"FAIL\t{sheet.Name}\t{newOutputFilename}\t{e.GetType().Name}: {e.Message}");
    }
}
