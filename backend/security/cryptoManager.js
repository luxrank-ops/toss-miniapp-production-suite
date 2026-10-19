/**
 * ============================================================================
 * 파일명: backend/security/cryptoManager.js
 * 역할: [보안 최우선 규칙 준수] 개인정보 AES-256-GCM 양방향 암호화 및 무결성 검증 모듈
 * 설명: 사용자의 생년월일시, 이름, 정산 계좌 등 모든 개인정보를 데이터베이스나
 *       메모리 원장에 저장하기 전에 군사 등급 표준인 AES-256-GCM 알고리즘으로
 *       강력하게 암호화합니다.
 * ============================================================================
 */

const crypto = require('crypto');
const { getDynamicConfig } = require('../config/envLoader');

/**
 * 환경변수에 설정된 비밀키(ENCRYPTION_SECRET_KEY)를 바탕으로
 * 정확히 32바이트(256비트) 길이의 암호화 키 버퍼를 생성하는 내부 함수입니다.
 */
function deriveAes256Key() {
    const { encryptionKey } = getDynamicConfig();
    // SHA-256 해시를 통과시키면 어떤 길이의 비밀번호든 항상 32바이트(256비트) 키가 만들어집니다.
    return crypto.createHash('sha256').update(String(encryptionKey)).digest();
}

/**
 * 평문 데이터(문자열 또는 객체)를 AES-256-GCM 알고리즘으로 암호화하는 함수입니다.
 * @param {string|object} plainData 암호화할 원본 개인정보
 * @returns {{ encryptedText: string, iv: string, authTag: string, algorithm: string }}
 */
function encryptPersonalData(plainData) {
    const key = deriveAes256Key();
    // 매 암호화마다 완전히 새로운 12바이트 난수 초기화 벡터(IV)를 생성하여 동일 평문도 매번 다른 암호문이 되게 합니다.
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const stringified = typeof plainData === 'string' ? plainData : JSON.stringify(plainData);

    let encrypted = cipher.update(stringified, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // 데이터 위변조 여부를 검증할 수 있는 16바이트 인증 태그(Auth Tag)를 추출합니다.
    const authTag = cipher.getAuthTag().toString('hex');

    return {
        encryptedText: encrypted,
        iv: iv.toString('hex'),
        authTag,
        algorithm: 'AES-256-GCM'
    };
}

/**
 * AES-256-GCM으로 암호화된 데이터를 원래의 평문으로 복호화하는 함수입니다.
 * 결제 검증이 완료되었거나 권한이 확인된 경우에만 호출됩니다.
 * @param {{ encryptedText: string, iv: string, authTag: string }} payload 암호화 패키지
 * @returns {any} 복호화된 원본 데이터
 */
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

/**
 * 개인정보 평문을 노출하지 않고도 동일 요청자인지 비교할 수 있도록
 * SHA-256 단방향 해시값을 생성하는 함수입니다.
 * @param {string} input 문자열
 * @returns {string} 64자리 16진수 해시 문자열
 */
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
