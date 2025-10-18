const express = require("express");
const router = express.Router();
const { oauth2Client, SCOPES } = require("../config/oauth");
const User = require("../models/user.js");
const { google } = require("googleapis");

// Step 1: Login
router.get("/login", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
  res.redirect(url);
});

// Step 2: Google OAuth2 callback route
router.get("/google/callback", async (req, res) => {
  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: googleUser } = await oauth2.userinfo.get();

    // Find or create user in the database
    let user = await User.findOne({ where: { googleId: googleUser.id } });
    if (!user) {
      user = await User.create({
        googleId: googleUser.id,
        email: googleUser.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });
    } else {
      // Update tokens if the user already exists
      user.accessToken = tokens.access_token;
      user.refreshToken = tokens.refresh_token;
      await user.save();
    }

    // Regenerate session and set userId
    req.session.regenerate((err) => {
      if (err) {
        console.error("Failed to regenerate session:", err);
        return res.status(500).send("Failed to create session");
      }
      req.session.userId = user.id;
      console.log("User ID set in session:", req.session.userId);
      res.redirect("/dashboard");
    });
  } catch (error) {
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).send("Something went wrong during authentication. Please try again.");
  }
});

// Logout
router.get("/logout", (req, res) => {
  req.session = null;
  res.redirect("/?message=logout_success");
});


module.exports = router;
