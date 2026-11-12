const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = -1;
let lastRandom = null;

function randomDigits() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes.slice(0, 16), byte => byte & 31).slice(0, 16);
}

function increment(digits) {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i] < 31) { next[i] += 1; return next; }
    next[i] = 0;
  }
  throw new Error('ULID random space exhausted');
}

function encodeTime(time) {
  let value = time;
  let result = '';
  for (let i = 0; i < 10; i += 1) {
    result = ENCODING[value % 32] + result;
    value = Math.floor(value / 32);
  }
  return result;
}

export function createUlid(now = Date.now()) {
  const time = Math.floor(Number(now));
  if (!Number.isSafeInteger(time) || time < 0 || time > 281474976710655) throw new Error('Invalid ULID timestamp');
  if (time === lastTime && lastRandom) lastRandom = increment(lastRandom);
  else { lastTime = time; lastRandom = randomDigits(); }
  return encodeTime(time) + lastRandom.map(value => ENCODING[value]).join('');
}


export async function createDeterministicUlid(timestamp, entropy) {
  const time = Math.floor(Number(timestamp));
  if (!Number.isSafeInteger(time) || time < 0 || time > 281474976710655) throw new Error('Invalid ULID timestamp');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(entropy))));
  let bits = 0;
  let bitCount = 0;
  let random = '';
  for (const byte of digest) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5 && random.length < 16) {
      bitCount -= 5;
      random += ENCODING[(bits >>> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
    if (random.length === 16) break;
  }
  return encodeTime(time) + random;
}
