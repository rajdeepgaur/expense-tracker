const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const UserSpreadsheet = sequelize.define("UserSpreadsheet", {
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  spreadsheetId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
});

module.exports = UserSpreadsheet;