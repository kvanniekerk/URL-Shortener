const { randomInt } = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 7;
const CODE_PATTERN = new RegExp(`^[A-Za-z0-9]{${CODE_LENGTH}}$`);

/**
 * Generate a random short code using a cryptographically secure RNG.
 * 62^7 ≈ 3.5 trillion possible codes.
 */
function generateCode(length = CODE_LENGTH) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += ALPHABET[randomInt(ALPHABET.length)];
    }
    return code;
}

function isValidCode(value) {
    return typeof value === 'string' && CODE_PATTERN.test(value);
}

module.exports = { generateCode, isValidCode, CODE_LENGTH };
