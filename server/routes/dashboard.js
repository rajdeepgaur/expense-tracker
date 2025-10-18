const express = require("express");
const path = require("path");
const User = require("../models/user");
const router = express.Router();

// Middleware to validate user session
const validateUserSession = async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.redirect("/?message=session_expired");
    }

    const user = await User.findByPk(req.session.userId);
    if (!user) {
      req.session = null;
      return res.redirect("/?message=invalid_session");
    }

    next();
  } catch (error) {
    console.error("Error validating user session:", error);
    res.redirect("/?message=server_error");
  }
};

// Dashboard route
router.get("/", validateUserSession, (req, res) => {
  res.sendFile(path.join(__dirname, "../../client", "dashboard.html"));
});

module.exports = router;