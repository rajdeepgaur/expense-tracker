const express = require("express");
const session = require("express-session");
const path = require("path");
const sequelize = require("./config/database"); // Ensure DB is initialized
require("dotenv").config();

const app = express();
app.use(express.json());

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: false, // Set to true if using HTTPS
      httpOnly: true,
    },
  })
);

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/expenses", require("./routes/expenses"));
app.use("/dashboard", require("./routes/dashboard"));
app.use("/categories", require("./routes/categories"));

// Root route

app.get("/", (req, res) => {
  console.log("Session userId:", req.session.userId); // Debugging
  if (req.session.userId) {
    console.log("Redirecting to dashboard...");
    res.redirect("/dashboard");
  } else {
    console.log("Serving index.html...");
    res.sendFile(path.join(__dirname, "../client", "index.html"));
  }
});


// Serve static files from the "client" folder
app.use(express.static(path.join(__dirname, "../client")));


// Sync DB before starting server
sequelize.sync().then(() => {
  console.log("Database synced ✅");
  app.listen(3000, () => console.log("Server running on http://localhost:3000"));
});