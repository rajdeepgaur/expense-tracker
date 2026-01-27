// Validate required environment variables in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable must be set in production');
  }
  if (process.env.SESSION_SECRET === 'default_secret_key') {
    throw new Error('SESSION_SECRET must be changed from default value in production');
  }
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters long for security');
  }
}

// Application Constants
const APP_CONFIG = {
  SESSION: {
    MAX_AGE: 30 * 24 * 60 * 60 * 1000, // 30 days
    SECRET: process.env.SESSION_SECRET || "default_secret_key"
  },
  
  YEAR_VALIDATION: {
    MIN: 1900,
    MAX: 2100
  },
  
  MONTHS: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ],
  
  DEFAULT_CATEGORIES: ["Food", "Transport", "Shopping", "Bills", "Other"],
  
  SHEETS: {
    CATEGORIES: "Categories",
    SUMMARY: "Summary"
  },

  GOOGLE_SHEETS: {
    RANGES: {
      SUMMARY_FULL: "Summary!A1:D19",
      MONTHLY_BREAKDOWN: "Summary!B8:D19",
      YEARLY_STATS: "Summary!B3:B4"
    },
    // Formulas for Summary sheet with 4 columns: Month, Total, Count, Daily Average
    YEARLY_TOTAL_FORMULA: `=IFERROR(SUM(B8:B19), 0)`,
    MONTH_SUM_FORMULA: (month) => `=IFERROR(SUM('${month}'!B2:B), 0)`,
    MONTH_COUNT_FORMULA: (month) => `=IFERROR(COUNT('${month}'!B2:B), 0)`,
    // Daily average: if current month/year, use current day; else use days in month
    MONTH_DAILY_AVG_FORMULA: (month, monthNum, year) => {
      // Check if this is current month and year
      const isCurrentMonth = `AND(MONTH(TODAY())=${monthNum}, YEAR(TODAY())=${year})`;
      // If current month, use DAY(TODAY()); else use days in month
      return `=IFERROR(IF(B${7+monthNum}=0, 0, B${7+monthNum}/IF(${isCurrentMonth}, DAY(TODAY()), DAY(DATE(${year}, ${monthNum+1}, 0)))), 0)`;
    }
  },
  
  GOOGLE_OAUTH: {
    SCOPES: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  }
};

module.exports = APP_CONFIG;