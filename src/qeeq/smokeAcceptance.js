const fs = require('node:fs');
const path = require('node:path');

function assertSmokeAcceptance(payload) {
  const scenarios = Array.isArray(payload?.scenarios) ? payload.scenarios : [];
  const verifiedPublicPlnOffers = scenarios.flatMap(scenario => Array.isArray(scenario?.offers) ? scenario.offers : [])
    .filter(offer => offer && typeof offer === 'object'
      && typeof offer.provider_name === 'string' && offer.provider_name.trim()
      && offer.price_tier === 'public'
      && offer.price_verified === true
      && Number.isFinite(offer.total_price) && offer.total_price > 0
      && offer.currency === 'PLN');

  if (payload?.run_status !== 'success'
    || payload?.quality_status !== 'pass'
    || verifiedPublicPlnOffers.length === 0) {
    throw new Error('Smoke acceptance failed');
  }
  return { verified_public_pln_offer_count: verifiedPublicPlnOffers.length };
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (argv.length !== 1) throw new Error('Exactly one --input option is required');
  const match = /^--input=(.+)$/.exec(argv[0]);
  if (!match) throw new Error('Exactly one --input option is required');
  return { input: match[1] };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node src/qeeq/smokeAcceptance.js --input=<canonical-smoke.json>');
    return 0;
  }
  const result = assertSmokeAcceptance(JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8')));
  console.log(JSON.stringify(result));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    console.error('QEEQ smoke acceptance failed.');
    process.exitCode = 1;
  }
}

module.exports = { assertSmokeAcceptance };
