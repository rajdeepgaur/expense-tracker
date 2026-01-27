// Load environment variables FIRST, before any other imports
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");
const pool = require("./config/pgPool");
const { errorHandler, requireAuth } = require("./middleware/errorHandler");
const APP_CONFIG = require("./utils/constants");

const app = express();

// Important: trust proxy so secure cookies work behind load balancers
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL session store for production
app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: "session",
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15, // Clean expired sessions every 15 minutes
    }),
    secret: APP_CONFIG.SESSION.SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: APP_CONFIG.SESSION.MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/expenses", requireAuth, require("./routes/expenses"));
app.use("/dashboard", require("./routes/dashboard"));
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

// Server start
const PORT = process.env.PORT || 3000;

console.log("Database synced ✅");
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  }
});