const db = require('../config/db');

const PROVIDER   = (process.env.SMS_PROVIDER || '').trim().toLowerCase();
const API_KEY    = process.env.SMS_API_KEY || '';
const API_USER   = process.env.SMS_API_USER || '';
const FROM       = process.env.SMS_FROM || '';
const ENABLED    = (process.env.SMS_ENABLED || 'true') === 'true';

function normalizeMalawiPhone(raw) {
    let digits = (raw || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '265' + digits.slice(1);
    if (!digits.startsWith('265') && digits.length === 9) digits = '265' + digits;
    return '+' + digits;
}


async function logSms(phone, message, status, provider, responseBody) {
    await db.execute(
        `INSERT INTO sms_messages (recipient_phone, message, status, provider, message_length, response_body)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            phone,
            message,
            status,
            provider || PROVIDER || 'none',
            message.length,
            responseBody ? JSON.stringify(responseBody).slice(0, 2000) : null
        ]
    );
}


async function sendWithAfricaTalking(phone, message) {
    const smsUrl = 'https://api.africastalking.com/version1/messaging';
    const body = new URLSearchParams({
        username:  API_USER,
        to:        phone,
        message,
        ...(FROM ? { from: FROM } : {})
    });

    const res = await fetch(smsUrl, {
        method: 'POST',
        headers: { 'apiKey': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok && json.SMSMessageData?.Recipients?.length > 0) {
        const recipient = json.SMSMessageData.Recipients[0];
        if (recipient.status === 'Success') return { ok: true, providerResponse: json };
    }

    const errMsg = json.SMSMessageData?.Message || json.Message || 'Unknown error';
    return { ok: false, error: errMsg, providerResponse: json };
}


exports.sendInvitationSms = async function sendInvitationSms(phone, {
    obNumber, suspectName, crimeCategory, incidentLocation,
    incidentDate, incidentDetails, appearanceDate, appearanceTime, officerNotes
}) {
    if (!ENABLED || !phone) {
        await logSms(phone || 'UNKNOWN', 'SMS disabled or no phone', 'QUEUED', PROVIDER, null);
        return { ok: false, queued: true, error: 'SMS provider not configured or phone missing' };
    }

    const normalized = normalizeMalawiPhone(phone);

    const narrativeShort = (incidentDetails || '').slice(0, 80);
    const message = [
        `Malawi Police Service — Limbe Station`,
        ``,
        `To: ${suspectName}`,
        `You are hereby invited to appear at Limbe Police Station`,
        `on ${appearanceDate} at ${appearanceTime},`,
        `in connection with ${crimeCategory || 'a reported offence'} (OB ${obNumber}).`,
        ``,
        `Place of incident: ${incidentLocation}`,
        `${narrativeShort}${incidentDetails && incidentDetails.length > 80 ? '…' : ''}`,
        ``,
        `Bring your National ID. Refusal to appear may lead to`,
        `a warrant of arrest being issued against you.`,
        ``,
        `${officerNotes ? 'Note: ' + officerNotes + '. ' : ''}`,
        `Contact: Desk Officer, Limbe Police Station`
    ].join('\n');

    const credsConfigured = API_KEY && API_USER
        && !API_KEY.startsWith('your_')
        && !API_USER.startsWith('your_');

    if (!credsConfigured) {
        await logSms(normalized, message, 'QUEUED', PROVIDER || 'console', null);
        console.log(`[SMS QUEUED — no provider configured]\n  To: ${normalized}\n  ${message.replace(/\n/g, '\n  ')}\n`);
        return { ok: true, queued: true, phone: normalized, message };
    }

    try {
        const result = await sendWithAfricaTalking(normalized, message);
        const status = result.ok ? 'SENT' : 'FAILED';
        await logSms(normalized, message, status, 'africastalking', result.providerResponse || result.error);
        return { ok: result.ok, phone: normalized, message, error: result.error };
    } catch (err) {
        await logSms(normalized, message, 'FAILED', PROVIDER || 'africastalking', { error: err.message });
        return { ok: false, phone: normalized, message, error: err.message };
    }
};


exports.getSmsStatus = async function getSmsStatus() {
    const [[row]] = await db.execute(
        `SELECT COUNT(*) AS total, SUM(status='SENT') AS sent, SUM(status='QUEUED') AS queued, SUM(status='FAILED') AS failed FROM sms_messages`
    );
    return row;
};
