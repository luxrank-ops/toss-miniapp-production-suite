/**
 * ============================================================================
 * 파일명: backend/security/cryptoManager.js
 * 역할: 사용자의 민감한 개인정보(닉네임/생년월일/피부고민/생체주기 데이터 등)를
 *       데이터베이스에 저장하기 전에 AES-256-GCM 알고리즘으로 강력하게 암호화합니다.
 * 교육용 설명 (규칙 8 준수):
 *   - AES-256-GCM은 금융권과 군사 보안에서 사용하는 양방향 인증 암호화 표준입니다.
 *   - 매번 암호화할 때마다 12바이트 난수 초기화 벡터(IV)를 새로 생성하므로,
 *     똑같은 닉네임과 체질 정보를 입력해도 암호문은 매번 완전히 다르게 생성됩니다.
 *   - 또한 Auth Tag(무결성 인증 태그)를 함께 생성하여 데이터 위변조를 100% 탐지합니다.
 * ============================================================================
 */

const crypto = require('crypto');
const { getDynamicConfig } = require('../config/envLoader');

const ALGORITHM = 'aes-256-gcm';

/**
 * 환경변수의 마스터 키를 기반으로 정확히 32바이트(256비트) 암호화 키 버퍼를 생성합니다.
 * @returns {Buffer} 32바이트 암호화 키
 */
function resolveMasterKeyBuffer() {
    const { encryptionMasterKey } = getDynamicConfig();

    // 64자리 Hex 문자열인 경우 그대로 32바이트 버퍼로 변환합니다.
    if (encryptionMasterKey && /^[0-9a-fA-F]{64}$/.test(encryptionMasterKey)) {
        return Buffer.from(encryptionMasterKey, 'hex');
    }

    // 만약 사용자가 일반 문자열로 키를 입력했다면 SHA-256 해시를 통해 32바이트 키로 안전하게 파생합니다.
    const fallbackSeed = encryptionMasterKey || 'ANTIGRAVITY_GLOW_MUSE_DEFAULT_KEY_2026';
    return crypto.createHash('sha256').update(String(fallbackSeed)).digest();
}

/**
 * 민감한 객체 데이터를 AES-256-GCM으로 암호화합니다.
 * @param {Object} plainObject 암호화할 원본 객체 (예: { nickname, ageGroup, skinType, cyclePhase })
 * @returns {{ encryptedData: string, iv: string, authTag: string, algorithm: string }}
 */
function encryptSensitiveData(plainObject) {
    const key = resolveMasterKeyBuffer();
    // 12바이트(96비트) 난수 초기화 벡터(IV) 생성
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const serialized = JSON.stringify(plainObject);
    let encrypted = cipher.update(serialized, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // 데이터가 중간에 조작되지 않았음을 보증하는 16바이트 인증 태그 추출
    const authTag = cipher.getAuthTag().toString('hex');

    return {
        encryptedData: encrypted,
        iv: iv.toString('hex'),
        authTag,
        algorithm: 'AES-256-GCM'
    };
}

/**
 * AES-256-GCM으로 암호화된 패키지를 복호화하여 원본 객체로 복원합니다.
 * @param {{ encryptedData: string, iv: string, authTag: string }} encryptedBundle
 * @returns {Object} 복호화된 원본 데이터 객체
 */
function decryptSensitiveData(encryptedBundle) {
    const key = resolveMasterKeyBuffer();
    const ivBuffer = Buffer.from(encryptedBundle.iv, 'hex');
    const authTagBuffer = Buffer.from(encryptedBundle.authTag, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
    decipher.setAuthTag(authTagBuffer);

    let decrypted = decipher.update(encryptedBundle.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
}

module.exports = {
    encryptSensitiveData,
    decryptSensitiveData
};
