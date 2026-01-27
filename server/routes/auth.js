const express = require("express");
const router = express.Router();
const { google } = require("googleapis");
const { findUserByGoogleId, createUser, updateUserTokens } = require("../utils/userService");
const APP_CONFIG = require("../utils/constants");

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Step 1: Login - redirect to Google OAuth
router.get("/login", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: APP_CONFIG.GOOGLE_OAUTH.SCOPES,
    prompt: "consent",
  });
  console.log("[Login] Redirecting to Google OAuth");
  res.redirect(url);
});

// Step 2: Google OAuth2 callback route
router.get("/google/callback", async (req, res) => {
  try {
    console.log("[Callback] Received query params:", Object.keys(req.query));
    const { code, error } = req.query;

    if (error) {
      console.error("[Callback] OAuth error:", error);
      return res.status(400).send("OAuth error: " + error);
    }

    if (!code) {
      console.error("[Callback] No authorization code received");
      return res.status(400).send("Missing authorization code");
    }

    console.log("[Callback] Exchanging code for tokens...");
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log("[Callback] Getting user info from Google...");
    // Get user info from Google
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: googleUser } = await oauth2.userinfo.get();

    console.log("[Callback] User email:", googleUser.email);

    // Find or create user in Supabase
    let user = await findUserByGoogleId(googleUser.id);
    
    if (!user) {
      console.log("[Callback] Creating new user in Supabase");
      user = await createUser(
        googleUser.id,
        googleUser.email,
        tokens.access_token,
        tokens.refresh_token
      );
    } else {
      console.log("[Callback] Updating existing user tokens");
      // Only update refresh_token if we got a new one from Google
      // Otherwise keep the existing one
      const refreshToken = tokens.refresh_token || user.refreshToken;
      user = await updateUserTokens(
        user.id,
        tokens.access_token,
        refreshToken
      );
    }

    console.log("[Callback] Regenerating session...");
    // Regenerate session and set userId
    req.session.regenerate((err) => {
      if (err) {
        console.error("[Callback] Session error:", err);
        return res.status(500).send("Failed to create session");
      }
      req.session.userId = user.id;
      console.log("[Callback] User ID set in session:", req.session.userId);
      res.redirect("/dashboard");
    });
  } catch (error) {
    console.error("[Callback] Error:", error.message);
    res.status(500).send("Something went wrong during authentication. Please try again.");
  }
});

// Logout: destroy server-side session and clear cookie
router.get("/logout", (req, res) => {
  if (!req.session) {
    return res.redirect("/?message=logout_success");
  }

  req.session.destroy((err) => {
    if (err) {
      console.error("[Logout] Error destroying session:", err);
      return res.status(500).send("Failed to logout");
    }
    res.clearCookie("connect.sid");
    res.redirect("/?message=logout_success");
  });
});


module.exports = router;
