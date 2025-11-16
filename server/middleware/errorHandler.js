/**
 * Global error handling middleware
 * Provides consistent error responses and logging
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging
  console.error(`Error ${req.method} ${req.path}:`, err);

  // Handle specific error types
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.errors.map(e => e.message).join(', ')
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: 'Duplicate Entry',
      message: 'Resource already exists'
    });
  }

  // Google API errors
  if (err.code && err.code >= 400 && err.code < 500) {
    return res.status(err.code).json({
      error: 'Google API Error',
      message: err.message || 'External service error'
    });
  }

  // Default server error
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : err.message
  });
}

/**
 * Authentication middleware
 * Ensures user is logged in before accessing protected routes
 */
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      error: 'Authentication Required',
      message: 'Please log in to access this resource'
    });
  }
  next();
}

module.exports = {
  errorHandler,
  requireAuth
};