const { google } = require("googleapis");
const { getUserById } = require("./userService");
const supabase = require("./supabase");

/**
 * Get a Google Sheets API client authenticated with the user's Google token
 * @param {number} userId - The user ID
 * @returns {object} Authenticated google.sheets instance
 */
async function getGoogleSheetsClient(userId) {
  const user = await getUserById(userId);
  
  if (!user) {
    throw new Error("User not found");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
  });

  return google.sheets({ version: "v4", auth: oauth2Client });
}

/**
 * Refresh access token if expired
 * @param {number} userId - The user ID
 */
async function ensureValidAccessToken(userId) {
  const user = await getUserById(userId);
  
  if (!user) {
    throw new Error("User not found");
  }

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
    const { credentials } = await oauth2Client.refreshAccessToken();
    // Update tokens in Supabase
    await supabase
      .from("users")
      .update({
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || user.refreshToken,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", userId);
    
    return oauth2Client;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    throw error;
  }
}

module.exports = {
  getGoogleSheetsClient,
  ensureValidAccessToken,
};
