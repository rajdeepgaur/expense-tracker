const supabase = require("./supabase");

/**
 * Find spreadsheet by userId and year
 */
async function findSpreadsheetByUserAndYear(userId, year) {
  const { data, error } = await supabase
    .from("user_spreadsheets")
    .select("*")
    .eq("userId", userId)
    .eq("year", year)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error finding spreadsheet:", error);
    throw error;
  }

  return data;
}

/**
 * Create a new spreadsheet
 */
async function createSpreadsheet(userId, year, spreadsheetId) {
  const { data, error } = await supabase
    .from("user_spreadsheets")
    .insert({
      userId: userId,
      year: year,
      spreadsheetId: spreadsheetId,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating spreadsheet:", error);
    throw error;
  }

  return data;
}

/**
 * Find sheet by spreadsheetId and month
 * @param {number} spreadsheetId - The user_spreadsheets table ID (not Google Sheets ID)
 * @param {string} month - The month name (e.g., "January")
 */
async function findSheetBySpreadsheetAndMonth(spreadsheetId, month) {
  const { data, error } = await supabase
    .from("user_sheets")
    .select("*")
    .eq("spreadsheetId", spreadsheetId)
    .eq("month", month)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error finding sheet:", error);
    throw error;
  }

  return data;
}

/**
 * Create a new sheet
 * @param {number} spreadsheetId - The user_spreadsheets table ID
 * @param {string} month - The month name
 * @param {string} sheetId - The Google Sheets sheet ID
 */
async function createSheet(spreadsheetId, month, sheetId) {
  const { data, error } = await supabase
    .from("user_sheets")
    .insert({
      spreadsheetId: spreadsheetId,
      month: month,
      sheetId: sheetId,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating sheet:", error);
    throw error;
  }

  return data;
}

module.exports = {
  findSpreadsheetByUserAndYear,
  createSpreadsheet,
  findSheetBySpreadsheetAndMonth,
  createSheet,
};
