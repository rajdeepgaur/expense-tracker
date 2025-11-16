const express = require("express");
const { google } = require("googleapis");
const User = require("../models/user");
const UserSpreadsheet = require("../models/userSpreadsheet");
const UserSheet = require("../models/userSheet");
const { ensureValidAccessToken } = require("../utils/oauth");
const APP_CONFIG = require("../utils/constants");
const router = express.Router();

// Ensure the yearly spreadsheet exists
async function ensureSpreadsheetExists(userId, year, oauth2Client) {
  let spreadsheet = await UserSpreadsheet.findOne({ where: { userId, year } });

  if (!spreadsheet) {
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const { data } = await drive.files.create({
      resource: {
        name: `Expenses-${year}`,
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
      fields: "id",
    });

    spreadsheet = await UserSpreadsheet.create({
      userId,
      year,
      spreadsheetId: data.id,
    });
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
      const response = await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
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

      // Add summary headers and formulas to the Summary sheet
      await sheetsApi.spreadsheets.values.update({
        spreadsheetId,
        range: "Summary!A1:B24",
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [
            ["Expense Summary", ""],
            ["", ""],
            ["Total Expenses (Year)", `=IFERROR(SUMPRODUCT(SUMIF(INDIRECT("'"&{"January","February","March","April","May","June","July","August","September","October","November","December"}&"'!B:B"),">0",INDIRECT("'"&{"January","February","March","April","May","June","July","August","September","October","November","December"}&"'!B:B"))), 0)`],
            ["Average per Month", `=IFERROR(B3/12, 0)`],
            ["", ""],
            ["Monthly Breakdown:", ""],
            ["", ""],
            ["January", `=IFERROR(SUM(January!B:B), 0)`],
            ["February", `=IFERROR(SUM(February!B:B), 0)`],
            ["March", `=IFERROR(SUM(March!B:B), 0)`],
            ["April", `=IFERROR(SUM(April!B:B), 0)`],
            ["May", `=IFERROR(SUM(May!B:B), 0)`],
            ["June", `=IFERROR(SUM(June!B:B), 0)`],
            ["July", `=IFERROR(SUM(July!B:B), 0)`],
            ["August", `=IFERROR(SUM(August!B:B), 0)`],
            ["September", `=IFERROR(SUM(September!B:B), 0)`],
            ["October", `=IFERROR(SUM(October!B:B), 0)`],
            ["November", `=IFERROR(SUM(November!B:B), 0)`],
            ["December", `=IFERROR(SUM(December!B:B), 0)`],
            ["", ""],
            ["", ""],
            ["", ""],
            ["", ""],
          ]
        }
      });

      console.log("Summary sheet created and initialized with formulas");
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
    
    // Re-write the formulas to force recalculation
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: "Summary!B3:B24",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          ["=IFERROR(SUM(January!B:B),0)+IFERROR(SUM(February!B:B),0)+IFERROR(SUM(March!B:B),0)+IFERROR(SUM(April!B:B),0)+IFERROR(SUM(May!B:B),0)+IFERROR(SUM(June!B:B),0)+IFERROR(SUM(July!B:B),0)+IFERROR(SUM(August!B:B),0)+IFERROR(SUM(September!B:B),0)+IFERROR(SUM(October!B:B),0)+IFERROR(SUM(November!B:B),0)+IFERROR(SUM(December!B:B),0)"],
          ["=IFERROR(MAX(0,COUNTA(January!A:A)-1),0)+IFERROR(MAX(0,COUNTA(February!A:A)-1),0)+IFERROR(MAX(0,COUNTA(March!A:A)-1),0)+IFERROR(MAX(0,COUNTA(April!A:A)-1),0)+IFERROR(MAX(0,COUNTA(May!A:A)-1),0)+IFERROR(MAX(0,COUNTA(June!A:A)-1),0)+IFERROR(MAX(0,COUNTA(July!A:A)-1),0)+IFERROR(MAX(0,COUNTA(August!A:A)-1),0)+IFERROR(MAX(0,COUNTA(September!A:A)-1),0)+IFERROR(MAX(0,COUNTA(October!A:A)-1),0)+IFERROR(MAX(0,COUNTA(November!A:A)-1),0)+IFERROR(MAX(0,COUNTA(December!A:A)-1),0)"],
          ["=IF(B3=0,0,B3/12)"],
          [""],
          [""],
          [`=IFERROR(SUM(${new Date().toLocaleString('default', { month: 'long' })}!B:B),0)`],
          [`=IFERROR(MAX(0,COUNTA(${new Date().toLocaleString('default', { month: 'long' })}!A:A)-1),0)`],
          [`=IF(B8=0,0,B8/DAY(TODAY()))`],
          [""],
          [""],
          ["=IFERROR(SUM(January!B:B),0)"],
          ["=IFERROR(SUM(February!B:B),0)"],
          ["=IFERROR(SUM(March!B:B),0)"],
          ["=IFERROR(SUM(April!B:B),0)"],
          ["=IFERROR(SUM(May!B:B),0)"],
          ["=IFERROR(SUM(June!B:B),0)"],
          ["=IFERROR(SUM(July!B:B),0)"],
          ["=IFERROR(SUM(August!B:B),0)"],
          ["=IFERROR(SUM(September!B:B),0)"],
          ["=IFERROR(SUM(October!B:B),0)"],
          ["=IFERROR(SUM(November!B:B),0)"],
          ["=IFERROR(SUM(December!B:B),0)"]
        ]
      }
    });
  } catch (error) {
    console.log("Note: Could not force Summary sheet recalculation:", error.message);
  }
}

// Ensure the monthly sheet exists
async function ensureSheetExists(spreadsheetId, month, oauth2Client) {
  let sheet = await UserSheet.findOne({ where: { spreadsheetId, month } });

  if (!sheet) {
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const { data } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
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
      spreadsheetId: spreadsheetId,
      range: `${month}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Date", "Amount", "Category"]],
      },
    });

    sheet = await UserSheet.create({
      spreadsheetId,
      month,
      sheetId,
    });

    // Force recalculation of Summary sheet since a new monthly sheet was created
    await forceRecalculateSummary(spreadsheetId, oauth2Client);
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

    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user);

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
    await ensureSheetExists(spreadsheet.spreadsheetId, month, oauth2Client);

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

    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.status(400).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user);

    // Find the spreadsheet for the specified year
    const spreadsheet = await UserSpreadsheet.findOne({
      where: { userId: user.id, year: parseInt(year) }
    });

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

    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user);

    // Find the spreadsheet for the specified year
    const spreadsheet = await UserSpreadsheet.findOne({
      where: { userId: user.id, year: parseInt(currentYear) }
    });

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
      // Get summary statistics
      const { data: summaryData } = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: "Summary!B3:B10",
      });

      // Get monthly breakdown
      const { data: monthlyData } = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: "Summary!B13:B24",
      });

      if (!summaryData.values) {
        return res.json({
          totalExpenses: 0,
          totalTransactions: 0,
          averagePerMonth: 0,
          thisMonthTotal: 0,
          thisMonthTransactions: 0,
          dailyAverage: 0,
          monthlyBreakdown: [] // Empty array when no summary data
        });
      }

      // Parse the calculated values from the Summary sheet
      // Skip empty rows in the range B3:B10
      const values = summaryData.values.flat().filter(val => val !== "");
      const [
        totalExpenses, 
        totalTransactions, 
        averagePerMonth, 
        thisMonthTotal, 
        thisMonthTransactions, 
        dailyAverage
      ] = values;

      // Parse monthly breakdown (B13:B22)
      // Parse monthly breakdown (B13:B24) - only include months with expenses
      const monthNames = ["January", "February", "March", "April", "May", "June", 
                         "July", "August", "September", "October", "November", "December"];
      
      const monthlyBreakdown = [];
      if (monthlyData.values) {
        monthlyData.values.forEach((row, index) => {
          if (index < monthNames.length) {
            const total = parseFloat(row[0]) || 0;
            if (total > 0) {  // Only include months with expenses
              monthlyBreakdown.push({
                month: monthNames[index],
                monthNumber: index + 1, // For chronological sorting
                total: total
              });
            }
          }
        });
      }

      // Sort chronologically (January = 1, February = 2, etc.)
      monthlyBreakdown.sort((a, b) => a.monthNumber - b.monthNumber);      console.log(thisMonthTotal);

      res.json({
        totalExpenses: parseFloat(totalExpenses) || 0,
        totalTransactions: parseInt(totalTransactions) || 0,
        averagePerMonth: parseFloat(averagePerMonth) || 0,
        thisMonthTotal: parseFloat(thisMonthTotal) || 0,
        thisMonthTransactions: parseInt(thisMonthTransactions) || 0,
        dailyAverage: parseFloat(dailyAverage) || 0,
        monthlyBreakdown: monthlyBreakdown
      });

    } catch (sheetError) {
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