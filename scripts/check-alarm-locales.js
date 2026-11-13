const fs = require('fs');
const path = require('path');

const localeDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const files = fs.readdirSync(localeDir)
  .filter((file) => file.endsWith('.json') && !file.includes('.tmp'));

const flatten = (value, prefix = '', result = {}) => {
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, next, result);
    } else {
      result[next] = Array.isArray(child) ? 'array' : typeof child;
    }
  }
  return result;
};

const flattenStrings = (value, prefix = '', result = {}) => {
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenStrings(child, next, result);
    } else if (typeof child === 'string') {
      result[next] = child;
    }
  }
  return result;
};

const interpolationTokens = (value) => Array.from(
  value.matchAll(/{{\s*([^{}]+?)\s*}}/g),
  (match) => `{{${match[1].trim()}}}`,
);

const multisetDifference = (left, right) => {
  const remaining = new Map();
  for (const token of right) remaining.set(token, (remaining.get(token) || 0) + 1);
  return left.filter((token) => {
    const count = remaining.get(token) || 0;
    if (!count) return true;
    remaining.set(token, count - 1);
    return false;
  });
};

const alarmOnly = (locale) => Object.fromEntries(
  Object.entries(locale).filter(([key]) => key.startsWith('alarm')),
);
const readLocale = (file) => JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
const reference = alarmOnly(readLocale('en.json'));
const expected = flatten(reference);
const expectedStrings = flattenStrings(reference);
let mismatchCount = 0;

for (const file of files) {
  const locale = alarmOnly(readLocale(file));
  const actual = flatten(locale);
  const actualStrings = flattenStrings(locale);
  const missing = Object.keys(expected).filter((key) => !(key in actual));
  const extra = Object.keys(actual).filter((key) => !(key in expected));
  const shape = Object.keys(expected).filter((key) => key in actual && expected[key] !== actual[key]);
  const tokens = Object.keys(expectedStrings).flatMap((key) => {
    if (typeof actualStrings[key] !== 'string') return [];
    const expectedTokens = interpolationTokens(expectedStrings[key]);
    const actualTokens = interpolationTokens(actualStrings[key]);
    const missingTokens = multisetDifference(expectedTokens, actualTokens);
    const extraTokens = multisetDifference(actualTokens, expectedTokens);
    return missingTokens.length || extraTokens.length
      ? [{ key, missing: missingTokens, extra: extraTokens }]
      : [];
  });

  if (missing.length || extra.length || shape.length || tokens.length) {
    mismatchCount += 1;
    console.error(`${file}: ${JSON.stringify({ missing, extra, shape, tokens })}`);
  }
}

console.log(`locales=${files.length} alarmLeaves=${Object.keys(expected).length} mismatches=${mismatchCount}`);
process.exitCode = mismatchCount ? 1 : 0;
