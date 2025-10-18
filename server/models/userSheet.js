const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const UserSheet = sequelize.define("UserSheet", {
  spreadsheetId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  month: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  sheetId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
});

module.exports = UserSheet;