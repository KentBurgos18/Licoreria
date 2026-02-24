/**
 * Passport.js OAuth Configuration
 * Configures Google OAuth strategy
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const sequelize = require('./database');
const { QueryTypes } = require('sequelize');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'licoreria-secret-key-2024';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Find or create a customer from OAuth profile
 */
async function findOrCreateOAuthCustomer(profile, provider) {
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

    // Try to find by OAuth ID
    let [rows] = await sequelize.query(
        'SELECT * FROM customers WHERE oauth_provider = $1 AND oauth_id = $2',
        { bind: [provider, profile.id], type: QueryTypes.SELECT, plain: false, raw: true }
    );
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];
    if (rows.length > 0) return rows[0];

    // Try to find by email (to link existing account)
    if (email) {
        let [emailRows] = await sequelize.query(
            'SELECT * FROM customers WHERE email = $1',
            { bind: [email], type: QueryTypes.SELECT, plain: false, raw: true }
        );
        if (!Array.isArray(emailRows)) emailRows = emailRows ? [emailRows] : [];

        if (emailRows.length > 0) {
            const [updated] = await sequelize.query(
                `UPDATE customers 
                 SET oauth_provider = $1, oauth_id = $2, profile_picture = $3
                 WHERE id = $4
                 RETURNING *`,
                { bind: [provider, profile.id, profile.photos?.[0]?.value || null, emailRows[0].id] }
            );
            return Array.isArray(updated) ? updated[0] : updated;
        }
    }

    // Create new customer
    const name = profile.displayName || 
                 (profile.name ? `${profile.name.givenName} ${profile.name.familyName}` : 'Usuario OAuth');
    const profilePicture = profile.photos?.[0]?.value || null;

    const [newRows] = await sequelize.query(
        `INSERT INTO customers (name, email, oauth_provider, oauth_id, profile_picture, is_active, tenant_id)
         VALUES ($1, $2, $3, $4, $5, true, 1)
         RETURNING *`,
        { bind: [name, email, provider, profile.id, profilePicture] }
    );
    return Array.isArray(newRows) ? newRows[0] : newRows;
}

/**
 * Generate JWT token for customer
 */
function generateCustomerToken(customer) {
    return jwt.sign(
        { 
            id: customer.id, 
            email: customer.email,
            type: 'customer'
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

/**
 * Configure Passport strategies
 */
function configurePassport() {
    // Serialize user
    passport.serializeUser((user, done) => {
        done(null, user);
    });

    passport.deserializeUser((user, done) => {
        done(null, user);
    });

    // Google Strategy
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        passport.use(new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: `${BASE_URL}/api/auth/google/callback`,
            scope: ['profile', 'email']
        }, async (accessToken, refreshToken, profile, done) => {
            try {
                const customer = await findOrCreateOAuthCustomer(profile, 'google');
                const token = generateCustomerToken(customer);
                done(null, { customer, token });
            } catch (error) {
                console.error('Error in Google OAuth:', error);
                done(error, null);
            }
        }));
        console.log('✓ Google OAuth strategy configured');
    } else {
        console.warn('⚠ Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
    }
}

module.exports = {
    configurePassport,
    findOrCreateOAuthCustomer,
    generateCustomerToken,
    passport
};
