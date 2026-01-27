const express = require("express");
const { google } = require("googleapis");
const { getUserById } = require("../utils/userService");
const { 
  findSpreadsheetByUserAndYear, 
  createSpreadsheet,
  findSheetBySpreadsheetAndMonth,
  createSheet
} = require("../utils/spreadsheetService");
const { ensureValidAccessToken } = require("../utils/oauth");
const APP_CONFIG = require("../utils/constants");
const router = express.Router();

// Ensure the yearly spreadsheet exists
async function ensureSpreadsheetExists(userId, year, oauth2Client) {
  let spreadsheet = await findSpreadsheetByUserAndYear(userId, year);

  if (!spreadsheet) {
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const { data } = await drive.files.create({
      resource: {
        name: `Expenses-${year}`,
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
      fields: "id",
    });

    spreadsheet = await createSpreadsheet(userId, year, data.id);
  }

  // Always ensure Summary sheet exists (even for existing spreadsheets)
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
  
  try {
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheet.spreadsheetId,
    });

    const summarySheet = data.sheets.find(sheet => 
      sheet.properties.title === APP_CONFIG.SHEETS.SUMMARY
    );

    if (!summarySheet) {
      // Create Summary sheet
      try {
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheet.spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: APP_CONFIG.SHEETS.SUMMARY,
                  sheetType: "GRID",
                  gridProperties: {
                    rowCount: 1000,
                    columnCount: 26
                  }
                }
              }
            }]
          }
        });

        // Build monthly breakdown rows with Total, Count, and Daily Average columns
        const monthlyRows = APP_CONFIG.MONTHS.map((month, index) => [
          month,
          APP_CONFIG.GOOGLE_SHEETS.MONTH_SUM_FORMULA(month),
          APP_CONFIG.GOOGLE_SHEETS.MONTH_COUNT_FORMULA(month),
          APP_CONFIG.GOOGLE_SHEETS.MONTH_DAILY_AVG_FORMULA(month, index + 1, year)
        ]);
        
        // Add summary headers and formulas to the Summary sheet
        await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheet.spreadsheetId,
          range: "Summary!A1:D19",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              ["Expense Summary", "", "", ""],
              ["", "", "", ""],
              ["Total Expenses (Year)", APP_CONFIG.GOOGLE_SHEETS.YEARLY_TOTAL_FORMULA, "", ""],
              ["Average per Month", `=IFERROR(B3/12, 0)`, "", ""],
              ["", "", "", ""],
              ["Monthly Breakdown:", "", "", ""],
              ["Month", "Total", "Count", "Daily Average"],
              ...monthlyRows
            ]
          }
        });

        console.log("Summary sheet created and initialized with formulas");
      } catch (createError) {
        // If sheet already exists (race condition or manual creation), just log a warning
        if (createError.message && createError.message.includes('already exists')) {
          console.log("Summary sheet already exists (detected during creation attempt)");
        } else {
          // Re-throw other errors
          throw createError;
        }
      }
    }
  } catch (error) {
    console.error("Error ensuring Summary sheet exists:", error);
  }

  return spreadsheet;
}

// Force recalculation of Summary sheet formulas by re-writing them
async function forceRecalculateSummary(spreadsheetId, oauth2Client) {
  try {
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    
    // Re-write the total formula to force recalculation
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: "Summary!B3",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[APP_CONFIG.GOOGLE_SHEETS.YEARLY_TOTAL_FORMULA]]
      }
    });
  } catch (error) {
    console.log("Note: Could not force Summary sheet recalculation:", error.message);
  }
}

// Ensure the monthly sheet exists
async function ensureSheetExists(spreadsheet, month, oauth2Client) {
  let sheet = await findSheetBySpreadsheetAndMonth(spreadsheet.id, month);

  if (!sheet) {
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const { data } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheet.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: month,
              },
            },
          },
        ],
      },
    });

    const sheetId = data.replies[0].addSheet.properties.sheetId;

    // Add column headers to the monthly sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: `${month}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Date", "Amount", "Category"]],
      },
    });

    sheet = await createSheet(spreadsheet.id, month, sheetId);

    // Force recalculation of Summary sheet since a new monthly sheet was created
    await forceRecalculateSummary(spreadsheet.spreadsheetId, oauth2Client);
  }

  return sheet;
}

// Add an expense
router.post("/", async (req, res) => {
  try {
    const { date, amount, category } = req.body;

    // Validate the date
    if (!date || isNaN(new Date(date).getTime())) {
      return res.status(400).send("Invalid or missing date");
    }

    const user = await getUserById(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user.id);

    // Parse the date and calculate the year
    const expenseDate = new Date(date);
    const year = expenseDate.getFullYear();
    const month = expenseDate.toLocaleString("default", { month: "long" });

    // Validate the year
    if (isNaN(year) || year < 1900 || year > 2100) {
      return res.status(400).send("Invalid year derived from date");
    }

    // Ensure the spreadsheet and sheet exist
    const spreadsheet = await ensureSpreadsheetExists(user.id, year, oauth2Client);
    await ensureSheetExists(spreadsheet, month, oauth2Client);

    // Append the expense to the sheet
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: `${month}!A:C`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[date, amount, category]],
      },
    });

    // Force recalculation of Summary sheet formulas for this month
    // Find the row number for this month (8=January, 9=February, etc.)
    const monthIndex = APP_CONFIG.MONTHS.indexOf(month);
    if (monthIndex !== -1) {
      const summaryRow = 8 + monthIndex; // Row 8 is January, row 9 is February, etc.
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheet.spreadsheetId,
          range: `Summary!B${summaryRow}:D${summaryRow}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[
              APP_CONFIG.GOOGLE_SHEETS.MONTH_SUM_FORMULA(month),
              APP_CONFIG.GOOGLE_SHEETS.MONTH_COUNT_FORMULA(month),
              APP_CONFIG.GOOGLE_SHEETS.MONTH_DAILY_AVG_FORMULA(month, monthIndex + 1, year)
            ]]
          }
        });
      } catch (recalcError) {
        console.log(`Note: Could not force recalculation for ${month}:`, recalcError.message);
      }
    }

    res.status(201).send("Expense added");
  } catch (error) {
    console.error("Error adding expense:", error);
    res.status(500).send("Failed to add expense");
  }
});

// Fetch expenses
router.get("/", async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).send("Year and month parameters are required");
    }

    const user = await getUserById(req.session.userId);

    if (!user) {
      return res.status(400).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user.id);

    // Find the spreadsheet for the specified year
    const spreadsheet = await findSpreadsheetByUserAndYear(user.id, parseInt(year));

    if (!spreadsheet) {
      return res.status(404).json({ 
        error: "no_spreadsheet", 
        message: `No expense data found for ${year}. Start by adding your first expense for this year.` 
      });
    }

    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    
    try {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: `${month}!A:C`,
      });

      // Filter out the header row (first row) and any empty rows
      const expenses = (data.values || []).slice(1).filter(row => row && row[0] && row[1]);
      
      res.json(expenses);
    } catch (sheetError) {
      // Check if the error is due to sheet not existing
      if (sheetError.code === 400 && sheetError.message && sheetError.message.includes('Unable to parse range')) {
        return res.status(404).json({ 
          error: "no_sheet", 
          message: `No expenses found for ${month} ${year}. Add your first expense for this month to get started.` 
        });
      }
      // Re-throw other errors to be caught by the outer catch block
      throw sheetError;
    }
  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).send("Failed to fetch expenses");
  }
});

// Get summary statistics from the Summary sheet
router.get("/summary", async (req, res) => {
  try {
    const { year } = req.query;
    const currentYear = year || new Date().getFullYear();

    const user = await getUserById(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user.id);

    // Find the spreadsheet for the specified year
    const spreadsheet = await findSpreadsheetByUserAndYear(user.id, parseInt(currentYear));

    if (!spreadsheet) {
      return res.json({
        totalExpenses: 0,
        totalTransactions: 0,
        averagePerMonth: 0,
        thisMonthTotal: 0,
        thisMonthTransactions: 0,
        dailyAverage: 0,
        monthlyBreakdown: [] // Empty array when no spreadsheet exists
      });
    }

    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    
    try {
      // First, check if Summary sheet exists
      const { data: spreadsheetData } = await sheets.spreadsheets.get({
        spreadsheetId: spreadsheet.spreadsheetId,
      });

      const summarySheet = spreadsheetData.sheets.find(sheet => 
        sheet.properties.title === "Summary"
      );

      if (!summarySheet) {
        // Summary sheet hasn't been created yet
        return res.json({
          totalExpenses: 0,
          totalTransactions: 0,
          averagePerMonth: 0,
          thisMonthTotal: 0,
          thisMonthTransactions: 0,
          dailyAverage: 0,
          monthlyBreakdown: []
        });
      }

      // Get summary statistics (B3:B4 for yearly totals)
      const { data: summaryData } = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: "Summary!B3:B4",
      });

      // Get monthly breakdown (B8:D19) - Total, Count, Daily Average for each month
      const { data: monthlyData } = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: "Summary!B8:D19",
      });

      // Initialize default values
      let totalExpenses = 0;
      let averagePerMonth = 0;
      let thisMonthTotal = 0;
      let thisMonthTransactions = 0;
      let dailyAverage = 0;

      // Parse summary values
      // B3: Total Expenses (Year)
      // B4: Average per Month
      if (summaryData.values && summaryData.values.length > 0) {
        totalExpenses = parseFloat(summaryData.values[0][0]) || 0;        // B3
        averagePerMonth = parseFloat(summaryData.values[1][0]) || 0;      // B4
      }

      // Parse monthly breakdown with Total, Count, and Daily Average columns
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                         "July", "August", "September", "October", "November", "December"];
      
      const monthlyBreakdown = [];
      if (monthlyData.values) {
        monthlyData.values.forEach((row, index) => {
          if (index < monthNames.length && row.length > 0) {
            const total = parseFloat(row[0]) || 0;
            const count = parseInt(row[1]) || 0;
            const dailyAvg = parseFloat(row[2]) || 0;
            
            if (total > 0) {  // Only include months with expenses
              monthlyBreakdown.push({
                month: monthNames[index],
                monthNumber: index + 1,
                total: total,
                count: count,
                dailyAverage: dailyAvg
              });
            }
          }
        });
      }

      // Sort chronologically
      monthlyBreakdown.sort((a, b) => a.monthNumber - b.monthNumber);
      
      // Get current month stats from monthly breakdown
      const currentMonthName = new Date().toLocaleString('default', { month: 'long' });
      const currentMonthData_breakdown = monthlyBreakdown.find(m => m.month === currentMonthName);
      
      if (currentMonthData_breakdown) {
        thisMonthTotal = currentMonthData_breakdown.total;
        thisMonthTransactions = currentMonthData_breakdown.count;
        dailyAverage = currentMonthData_breakdown.dailyAverage;
      }

      res.json({
        totalExpenses: totalExpenses,
        totalTransactions: thisMonthTransactions,
        averagePerMonth: averagePerMonth,
        thisMonthTotal: thisMonthTotal,
        thisMonthTransactions: thisMonthTransactions,
        dailyAverage: dailyAverage,
        monthlyBreakdown: monthlyBreakdown
      });

    } catch (sheetError) {
      console.error("Error reading Summary sheet:", sheetError);
      // If Summary sheet doesn't exist or has issues, return zeros
      return res.json({
        totalExpenses: 0,
        totalTransactions: 0,
        averagePerMonth: 0,
        thisMonthTotal: 0,
        thisMonthTransactions: 0,
        dailyAverage: 0,
        monthlyBreakdown: [] // Empty array on error
      });
    }
  } catch (error) {
    console.error("Error fetching summary statistics:", error);
    res.status(500).send("Failed to fetch summary statistics");
  }
});

module.exports = router;