const { google } = require("googleapis");
const { getUserById, updateUserTokens } = require("./userService");

/**
 * Ensures a valid OAuth2 access token for Google API calls
 * Automatically refreshes expired tokens and updates user record
 * @param {number} userId - User ID
 * @returns {Object} Configured oauth2Client ready for API calls
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
    // Test if the access token is valid
    await oauth2Client.getAccessToken();
    return oauth2Client;
  } catch (error) {
    console.log("Access token expired. Refreshing token...");

    if (!user.refreshToken) {
      throw new Error("No refresh token available. User needs to re-authenticate.");
    }

    // Refresh the access token
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    // Update tokens in Supabase
    await updateUserTokens(userId, credentials.access_token, credentials.refresh_token || user.refreshToken);

    oauth2Client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token || user.refreshToken,
    });

    return oauth2Client;
  }
}

module.exports = {
  ensureValidAccessToken
};