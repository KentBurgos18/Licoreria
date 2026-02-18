/**
 * Passport.js OAuth Configuration
 * Configures Google OAuth strategy
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('./database');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'licoreria-secret-key-2024';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Find or create a customer from OAuth profile
 */
async function findOrCreateOAuthCustomer(profile, provider) {
    const client = await pool.connect();
    try {
        // First, try to find by OAuth ID
        let result = await client.query(
            'SELECT * FROM customers WHERE oauth_provider = $1 AND oauth_id = $2',
            [provider, profile.id]
        );

        if (result.rows.length > 0) {
            return result.rows[0];
        }

        // Try to find by email (to link existing account)
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        if (email) {
            result = await client.query(
                'SELECT * FROM customers WHERE email = $1',
                [email]
            );

            if (result.rows.length > 0) {
                // Update existing customer with OAuth info
                const updated = await client.query(
                    `UPDATE customers 
                     SET oauth_provider = $1, oauth_id = $2, profile_picture = $3
                     WHERE id = $4
                     RETURNING *`,
                    [provider, profile.id, profile.photos?.[0]?.value || null, result.rows[0].id]
                );
                return updated.rows[0];
            }
        }

        // Create new customer
        const name = profile.displayName || 
                     (profile.name ? `${profile.name.givenName} ${profile.name.familyName}` : 'Usuario OAuth');
        const profilePicture = profile.photos?.[0]?.value || null;

        const newCustomer = await client.query(
            `INSERT INTO customers (name, email, oauth_provider, oauth_id, profile_picture, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             RETURNING *`,
            [name, email, provider, profile.id, profilePicture]
        );

        return newCustomer.rows[0];
    } finally {
        client.release();
    }
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
