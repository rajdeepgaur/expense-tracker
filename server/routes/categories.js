const express = require("express");
const { google } = require("googleapis");
const User = require("../models/user");
const UserSpreadsheet = require("../models/userSpreadsheet");
const { ensureValidAccessToken } = require("../utils/oauth");
const APP_CONFIG = require("../utils/constants");
const router = express.Router();

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

  // Ensure Categories sheet exists (for both new and existing spreadsheets)
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });
  
  try {
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheet.spreadsheetId,
    });

    const categoriesSheet = data.sheets.find(sheet => 
      sheet.properties.title === APP_CONFIG.SHEETS.CATEGORIES
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
                  title: APP_CONFIG.SHEETS.CATEGORIES,
                },
              },
            },
          ],
        },
      });

      // Add header row to Categories sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: "Categories!A1:A1",
        valueInputOption: "RAW",
        requestBody: {
          values: [["Category Name"]],
        },
      });

      // Add default categories to the new sheet (starting from row 2)
      const defaultCategories = APP_CONFIG.DEFAULT_CATEGORIES;
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: "Categories!A2:A6",
        valueInputOption: "RAW",
        requestBody: {
          values: defaultCategories.map(cat => [cat]),
        },
      });
    }

    // Delete default Sheet1 if it exists (after ensuring Categories sheet exists)
    const sheet1 = data.sheets.find(sheet => 
      sheet.properties.title === "Sheet1"
    );

    if (sheet1) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheet.spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteSheet: {
                  sheetId: sheet1.properties.sheetId,
                },
              },
            ],
          },
        });
      } catch (deleteError) {
        console.log("Note: Could not delete default Sheet1:", deleteError.message);
      }
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
      // Skip the first row (header) and process categories starting from index 1
      data.values.slice(1).forEach((row, index) => {
        if (row[0] && row[0].trim()) {
          categories.push({
            id: index + 1, // Adjust ID to account for skipped header
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
      // Skip header row when checking for duplicates
      data.values.slice(1).forEach(row => {
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

    // Prevent deletion of header row
    if (rowIndex === 0) {
      return res.status(400).send("Cannot delete header row");
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

    // Prevent editing of header row
    if (rowIndex === 0) {
      return res.status(400).send("Cannot edit header row");
    }

    // Check for duplicates (excluding the current category and header row)
    const existingCategories = [];
    if (data.values) {
      data.values.forEach((row, index) => {
        if (row[0] && row[0].trim() && index !== rowIndex && index !== 0) {
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