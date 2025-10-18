const express = require("express");
const { google } = require("googleapis");
const User = require("../models/user");
const UserSpreadsheet = require("../models/userSpreadsheet");
const UserSheet = require("../models/userSheet");
const router = express.Router();

// Helper function to ensure a valid access token
async function ensureValidAccessToken(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
  });

  try {
    // Test if the access token is valid
    await oauth2Client.getAccessToken();
    return oauth2Client;
  } catch (error) {
    console.log("Access token expired. Refreshing token...");

    // Refresh the access token
    const { credentials } = await oauth2Client.refreshAccessToken();
    user.accessToken = credentials.access_token;
    await user.save();

    oauth2Client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: user.refreshToken,
    });

    return oauth2Client;
  }
}

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

    // Create Categories sheet with default categories for new spreadsheets
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: data.id,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: "Categories",
              },
            },
          },
        ],
      },
    });

    // Add default categories
    const defaultCategories = ["Food", "Transport", "Shopping", "Bills", "Other"];
    await sheets.spreadsheets.values.update({
      spreadsheetId: data.id,
      range: "Categories!A1:A5",
      valueInputOption: "RAW",
      requestBody: {
        values: defaultCategories.map(cat => [cat]),
      },
    });
  }

  return spreadsheet;
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

    sheet = await UserSheet.create({
      spreadsheetId,
      month,
      sheetId,
    });
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

      res.json(data.values || []);
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

module.exports = router;