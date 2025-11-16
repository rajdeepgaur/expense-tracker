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
  
  GOOGLE_SHEETS: {
    RANGES: {
      SUMMARY_FULL: "Summary!A1:B24",
      SUMMARY_FORMULAS: "Summary!B3:B24", 
      SUMMARY_STATS: "Summary!B3:B10",
      MONTHLY_DATA: "Summary!B13:B24",
      MONTHLY_HEADERS: "A1:C1"
    }
  }
};

module.exports = APP_CONFIG;