const { google } = require("googleapis");

/**
 * Ensures a valid OAuth2 access token for Google API calls
 * Automatically refreshes expired tokens and updates user record
 * @param {Object} user - User model instance with accessToken and refreshToken
 * @returns {Object} Configured oauth2Client ready for API calls
 */
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

module.exports = {
  ensureValidAccessToken
};