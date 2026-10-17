// CI: prints a fresh pairing link for a relay (what a Daylight's QR code holds), using the JavaScript reference.
//   node ci-pairing-link.mjs <relay URL> [name]
import { generateSecret, pairingLink } from '../../share/js/daylight-share.js';

const [relay, name = 'CI Daylight'] = process.argv.slice(2);
console.log(await pairingLink({ secret: generateSecret(), relay, name }));
