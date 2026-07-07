/**
 * JWT Authentication
 * ==========================================================
 * - generateToken(userId) → general access JWT
 * - generateRoomToken(userId, docId) → scoped document token
 * - verifyToken(token) → decoded payload or throws
 * - verifyRoomToken(token, docId) → validates document access
 * ==========================================================
 */

'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const TOKEN_EXPIRY       = '24h';
const ROOM_TOKEN_EXPIRY  = '4h';

/**
 * Generate a general access token.
 * @param {string} userId
 * @returns {string} JWT
 */
function generateToken(userId) {
  return jwt.sign(
    { userId, type: 'access' },
    SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Generate a document-scoped room token.
 * @param {string} userId
 * @param {string} docId
 * @returns {string} JWT
 */
function generateRoomToken(userId, docId) {
  return jwt.sign(
    { userId, docId, type: 'room' },
    SECRET,
    { expiresIn: ROOM_TOKEN_EXPIRY }
  );
}

/**
 * Verify and decode a token.
 * @param {string} token
 * @returns {{ userId: string, type: string, [docId]: string }}
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

/**
 * Verify a room token and ensure it matches the requested document.
 * @param {string} token
 * @param {string} docId
 * @returns {{ userId: string, docId: string }}
 * @throws {Error} If invalid, expired, or wrong document
 */
function verifyRoomToken(token, docId) {
  const decoded = verifyToken(token);

  // Accept general access tokens (they can access any document)
  if (decoded.type === 'access') {
    return { userId: decoded.userId, docId };
  }

  // Room tokens must match the requested document
  if (decoded.type === 'room' && decoded.docId !== docId) {
    throw new Error(`Token not valid for document ${docId}`);
  }

  return { userId: decoded.userId, docId: decoded.docId };
}

module.exports = {
  generateToken,
  generateRoomToken,
  verifyToken,
  verifyRoomToken,
};
