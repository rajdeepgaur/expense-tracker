const express = require("express");
const { google } = require("googleapis");
const User = require("../models/user");
const UserSpreadsheet = require("../models/userSpreadsheet");
const router = express.Router();

// Helper function to ensure a valid access token (same as in expenses.js)
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
    await oauth2Client.getAccessToken();
    return oauth2Client;
  } catch (error) {
    console.log("Access token expired. Refreshing token...");
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

// Ensure the Categories sheet exists in the current year's spreadsheet
async function ensureCategoriesSheetExists(user, oauth2Client) {
  const currentYear = new Date().getFullYear();
  
  // Find or create the current year's spreadsheet
  let spreadsheet = await UserSpreadsheet.findOne({ 
    where: { userId: user.id, year: currentYear } 
  });

  if (!spreadsheet) {
    // Create spreadsheet if it doesn't exist
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const { data } = await drive.files.create({
      resource: {
        name: `Expenses-${currentYear}`,
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
      fields: "id",
    });

    spreadsheet = await UserSpreadsheet.create({
      userId: user.id,
      year: currentYear,
      spreadsheetId: data.id,
    });
  }

  // Check if Categories sheet exists
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
  
  try {
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheet.spreadsheetId,
    });

    const categoriesSheet = data.sheets.find(sheet => 
      sheet.properties.title === "Categories"
    );

    if (!categoriesSheet) {
      // Create Categories sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheet.spreadsheetId,
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

      // Add default categories to the new sheet
      const defaultCategories = ["Food", "Transport", "Shopping", "Bills", "Other"];
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: "Categories!A1:A5",
        valueInputOption: "RAW",
        requestBody: {
          values: defaultCategories.map(cat => [cat]),
        },
      });
    }
  } catch (error) {
    console.error("Error ensuring Categories sheet exists:", error);
    throw error;
  }

  return spreadsheet.spreadsheetId;
}

// Get all categories for a user from Google Sheets
router.get("/", async (req, res) => {
  try {
    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user);
    const spreadsheetId = await ensureCategoriesSheetExists(user, oauth2Client);

    // Read categories from the Categories sheet
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: "Categories!A:A",
    });

    const categories = [];

    if (data.values) {
      data.values.forEach((row, index) => {
        if (row[0] && row[0].trim()) {
          categories.push({
            id: index,
            categoryName: row[0].trim(),
            isDefault: false  // All categories are now editable/deletable
          });
        }
      });
    }

    // If no categories found, return defaults
    if (categories.length === 0) {
      const defaultCategories = ["Food", "Transport", "Shopping", "Bills", "Other"];
      defaultCategories.forEach((cat, index) => {
        categories.push({
          id: index,
          categoryName: cat,
          isDefault: false
        });
      });
    }

    res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).send("Failed to fetch categories");
  }
});

// Add a new custom category to Google Sheets
router.post("/", async (req, res) => {
  try {
    const { categoryName } = req.body;

    if (!categoryName || categoryName.trim() === "") {
      return res.status(400).send("Category name is required");
    }

    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user);
    const spreadsheetId = await ensureCategoriesSheetExists(user, oauth2Client);

    // Read existing categories to check for duplicates
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: "Categories!A:A",
    });

    const existingCategories = [];
    if (data.values) {
      data.values.forEach(row => {
        if (row[0] && row[0].trim()) {
          existingCategories.push(row[0].trim().toLowerCase());
        }
      });
    }

    // Check for duplicates
    if (existingCategories.includes(categoryName.trim().toLowerCase())) {
      return res.status(400).send("Category already exists");
    }

    // Add the new category to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: "Categories!A:A",
      valueInputOption: "RAW",
      requestBody: {
        values: [[categoryName.trim()]],
      },
    });

    res.status(201).json({
      id: existingCategories.length,
      categoryName: categoryName.trim(),
      isDefault: false
    });
  } catch (error) {
    console.error("Error adding category:", error);
    res.status(500).send("Failed to add category");
  }
});

// Delete a category from Google Sheets (including default categories)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rowIndex = parseInt(id);

    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user);
    const spreadsheetId = await ensureCategoriesSheetExists(user, oauth2Client);

    // Read existing categories
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: "Categories!A:A",
    });

    if (!data.values || !data.values[rowIndex] || !data.values[rowIndex][0]) {
      return res.status(404).send("Category not found");
    }

    // Get sheet properties to perform row deletion
    const spreadsheetData = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });

    const categoriesSheet = spreadsheetData.data.sheets.find(sheet => 
      sheet.properties.title === "Categories"
    );

    if (!categoriesSheet) {
      return res.status(404).send("Categories sheet not found");
    }

    // Delete the row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: categoriesSheet.properties.sheetId,
                dimension: "ROWS",
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    });

    res.status(200).send("Category deleted successfully");
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).send("Failed to delete category");
  }
});

// Edit/Update a category in Google Sheets
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryName } = req.body;
    const rowIndex = parseInt(id);

    if (!categoryName || categoryName.trim() === "") {
      return res.status(400).send("Category name is required");
    }

    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.status(401).send("User not authenticated");
    }

    const oauth2Client = await ensureValidAccessToken(user);
    const spreadsheetId = await ensureCategoriesSheetExists(user, oauth2Client);

    // Read existing categories to check for duplicates and validate row exists
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: "Categories!A:A",
    });

    if (!data.values || !data.values[rowIndex] || !data.values[rowIndex][0]) {
      return res.status(404).send("Category not found");
    }

    // Check for duplicates (excluding the current category)
    const existingCategories = [];
    if (data.values) {
      data.values.forEach((row, index) => {
        if (row[0] && row[0].trim() && index !== rowIndex) {
          existingCategories.push(row[0].trim().toLowerCase());
        }
      });
    }

    if (existingCategories.includes(categoryName.trim().toLowerCase())) {
      return res.status(400).send("Category already exists");
    }

    // Update the category
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: `Categories!A${rowIndex + 1}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[categoryName.trim()]],
      },
    });

    res.status(200).json({
      id: rowIndex,
      categoryName: categoryName.trim(),
      isDefault: false
    });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).send("Failed to update category");
  }
});

module.exports = router;