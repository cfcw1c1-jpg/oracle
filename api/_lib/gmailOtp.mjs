import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AutomationFailure } from './ogdLogin.mjs';

// Reads the OGD OTP email over IMAP, signing in with a Gmail App Password.
const OTP_WAIT_MS = 90000;
const OTP_POLL_MS = 5000;
const MAX_MESSAGES_PER_POLL = 5;

// OGD sends its OTP emails from this address. Only its messages are opened,
// so unrelated mail in the account is never read.
const OTP_SENDER = 'postmaster@cfcglobaldata.com';
const DIGIT_CODE = String.raw`(?<![\d-])(?!(?:19|20)\d{2}(?!\d))(\d{4,8})(?![\d-])`;
const LABELLED_CODE_PATTERNS = [
  new RegExp(String.raw`(?:\bOTP\b|one[\s-]?time\s+(?:pass\s?code|password|pin|code))[\s\S]{0,80}?${DIGIT_CODE}`, 'i'),
  new RegExp(String.raw`(?:verification|security|authentication|login|access)\s+code[\s\S]{0,80}?${DIGIT_CODE}`, 'i'),
  new RegExp(String.raw`(?:\bcode\b|passcode|\bpin\b)[\s\S]{0,80}?${DIGIT_CODE}`, 'i'),
];

export function extractOtp(text) {
  const body = String(text || '');
  for (const pattern of LABELLED_CODE_PATTERNS) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  const standalone = new Set(Array.from(body.matchAll(new RegExp(DIGIT_CODE, 'g')), (match) => match[1]));
  return standalone.size === 1 ? [...standalone][0] : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createGmailClient({ address, password }) {
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: address, pass: password }, logger: false });
}

function isFromOtpSender({ envelope }) {
  return (envelope?.from ?? []).some((party) => party.address?.toLowerCase() === OTP_SENDER);
}

// All Mail covers the inbox and any label; Spam is separate in Gmail and is
// where a new sender's OTP email is likely to land.
async function listOtpMailboxes(client) {
  const mailboxes = await client.list();
  const paths = mailboxes.filter((box) => box.specialUse === '\\All' || box.specialUse === '\\Junk').map((box) => box.path);
  return paths.length > 0 ? paths : ['INBOX'];
}

async function readOtpFromMailbox(client, path, sinceEpochSeconds) {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    // Gmail's after: operator takes epoch seconds, so an older OTP still in
    // the mailbox is ignored regardless of the account's timezone.
    const uids = await client.search({ gmraw: `from:${OTP_SENDER} after:${sinceEpochSeconds}` }, { uid: true });
    if (!uids || uids.length === 0) return null;

    const headers = await client.fetchAll(uids.slice(-MAX_MESSAGES_PER_POLL).join(','), { uid: true, envelope: true, internalDate: true }, { uid: true });
    const candidates = headers
      .filter((message) => new Date(message.internalDate).getTime() / 1000 >= sinceEpochSeconds)
      .filter(isFromOtpSender)
      .sort((a, b) => new Date(b.internalDate) - new Date(a.internalDate));

    for (const candidate of candidates) {
      const message = await client.fetchOne(String(candidate.uid), { source: true }, { uid: true });
      if (!message) continue;
      const parsed = await simpleParser(message.source);
      const otp = extractOtp(`${parsed.subject ?? ''}\n${parsed.text ?? ''}`);
      if (otp) return otp;
    }
    return null;
  } finally {
    lock.release();
  }
}

// Returns a readOtp function for loginToOgd. Gmail is only contacted when OGD
// actually asks for an OTP.
export function createGmailOtpReader({ address, password, createClient = createGmailClient, otpWaitMs = OTP_WAIT_MS, pollMs = OTP_POLL_MS }) {
  return async function readOtp({ sinceEpochSeconds }) {
    const client = createClient({ address, password });
    // An unhandled 'error' event from a dropped socket would crash the function.
    client.on('error', (error) => console.error('[ogd] imap error:', error?.code ?? 'unknown'));

    try {
      await client.connect();
    } catch (error) {
      if (error?.authenticationFailed) {
        throw new AutomationFailure('gmail_bad_password', 'Google did not accept this Gmail address and App Password.');
      }
      throw new AutomationFailure('gmail_connection_error', 'Could not connect to Gmail.');
    }

    try {
      const mailboxes = await listOtpMailboxes(client);
      const deadline = Date.now() + otpWaitMs;
      while (Date.now() < deadline) {
        for (const path of mailboxes) {
          const otp = await readOtpFromMailbox(client, path, sinceEpochSeconds);
          if (otp) return otp;
        }
        await sleep(pollMs);
      }
      throw new AutomationFailure('otp_not_found', `OGD asked for an OTP, but no email containing one reached this Gmail within ${Math.round(otpWaitMs / 1000)} seconds.`);
    } catch (error) {
      if (error instanceof AutomationFailure) throw error;
      throw new AutomationFailure('gmail_connection_error', 'The connection to Gmail dropped while waiting for the OTP.');
    } finally {
      await client.logout().catch(() => client.close());
    }
  };
}
