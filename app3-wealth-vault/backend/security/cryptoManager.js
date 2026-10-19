/**
 * ============================================================================
 * 파일명: app3-wealth-vault/backend/security/cryptoManager.js
 * 역할: [제3호 앱 보안 최우선 모듈] 개인 재산(은행·증권·부동산·동산·보험) 및
 *       소득(임대소득·금융소득) 데이터 AES-256-GCM 양방향 암호화 모듈
 * ============================================================================
 */

const crypto = require('crypto');
const { getDynamicConfig } = require('../config/envLoader');

function deriveAes256Key() {
    const { encryptionKey } = getDynamicConfig();
    return crypto.createHash('sha256').update(String(encryptionKey)).digest();
}

function encryptPersonalData(plainData) {
    const key = deriveAes256Key();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const stringified = typeof plainData === 'string' ? plainData : JSON.stringify(plainData);
    let encrypted = cipher.update(stringified, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
        encryptedText: encrypted,
        iv: iv.toString('hex'),
        authTag,
        algorithm: 'AES-256-GCM'
    };
}

function decryptPersonalData(payload) {
    const key = deriveAes256Key();
    const ivBuffer = Buffer.from(payload.iv, 'hex');
    const authTagBuffer = Buffer.from(payload.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
    decipher.setAuthTag(authTagBuffer);

    let decrypted = decipher.update(payload.encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    try {
        return JSON.parse(decrypted);
    } catch {
        return decrypted;
    }
}

function createLookupHash(input) {
    const { encryptionKey } = getDynamicConfig();
    return crypto
        .createHmac('sha256', String(encryptionKey))
        .update(String(input))
        .digest('hex');
}

module.exports = {
    encryptPersonalData,
    decryptPersonalData,
    createLookupHash
};
