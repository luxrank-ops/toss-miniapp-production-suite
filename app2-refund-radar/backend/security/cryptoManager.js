/**
 * ============================================================================
 * 파일명: app2-refund-radar/backend/security/cryptoManager.js
 * 역할: [제2호 앱 보안 모듈] 개인정보 및 지출 프로필 AES-256-GCM 양방향 암호화 모듈
 * 설명: 사용자의 이름, 연령대, 의료·통신·카드 지출 데이터를 평문으로 저장하지 않고
 *       AES-256-GCM 알고리즘으로 암호화하여 보호합니다.
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
