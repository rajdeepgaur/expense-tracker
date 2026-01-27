const supabase = require("./supabase");

/**
 * Find user by Google ID
 */
async function findUserByGoogleId(googleId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("googleId", googleId)
    .single();

  if (error && error.code !== "PGRST116") { // PGRST116 = no rows
    console.error("Error finding user:", error);
    throw error;
  }

  return data;
}

/**
 * Create a new user
 */
async function createUser(googleId, email, accessToken, refreshToken) {
  const { data, error } = await supabase
    .from("users")
    .insert({
      googleId: googleId,
      email: email,
      accessToken: accessToken,
      refreshToken: refreshToken,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating user:", error);
    throw error;
  }

  return data;
}

/**
 * Update user tokens
 */
async function updateUserTokens(userId, accessToken, refreshToken) {
  const { data, error } = await supabase
    .from("users")
    .update({
      accessToken: accessToken,
      refreshToken: refreshToken,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    console.error("Error updating user tokens:", error);
    throw error;
  }

  return data;
}

/**
 * Get user by ID
 */
async function getUserById(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error getting user:", error);
    throw error;
  }

  return data;
}

module.exports = {
  findUserByGoogleId,
  createUser,
  updateUserTokens,
  getUserById,
};
