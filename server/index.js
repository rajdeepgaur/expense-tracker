const express = require("express");
const session = require("express-session");
const path = require("path");
const sequelize = require("./config/database");
const { errorHandler, requireAuth } = require("./middleware/errorHandler");
const APP_CONFIG = require("./utils/constants");
require("dotenv").config();

const requiredEnv = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'SESSION_SECRET'
];

const missing = requiredEnv.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required env vars:', missing.join(', '));
  // In production fail fast to surface the problem
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

const app = express();

// Important: trust proxy so secure cookies work behind Heroku's load balancer
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware with configuration from constants
app.use(
  session({
    secret: APP_CONFIG.SESSION.SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: APP_CONFIG.SESSION.MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    },
  })
);

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/expenses", requireAuth, require("./routes/expenses"));
app.use("/dashboard", requireAuth, require("./routes/dashboard"));
app.use("/categories", requireAuth, require("./routes/categories"));

// Root route
app.get("/", (req, res) => {
  if (req.session.userId) {
    res.redirect("/dashboard");
  } else {
    res.sendFile(path.join(__dirname, "../client", "index.html"));
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, "../client")));

// Error handling middleware (must be last)
app.use(errorHandler);

// Database sync and server start
const PORT = process.env.PORT || 3000;

sequelize.sync().then(() => {
  console.log("Database synced ✅");
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    }
  });
}).catch(err => {
  console.error("Failed to sync database:", err);
  process.exit(1);
});