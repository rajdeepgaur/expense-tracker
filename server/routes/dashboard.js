const express = require("express");
const path = require("path");
const router = express.Router();

// Dashboard route (authentication already enforced by requireAuth middleware in index.js)
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../client", "dashboard.html"));
});

module.exports = router;