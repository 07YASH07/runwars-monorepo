const localtunnel = require('localtunnel');
(async () => {
  try {
    const randomSub = 'runwars-yash-' + Math.floor(Math.random() * 1000000);
    console.log('Connecting to localtunnel with subdomain:', randomSub);
    const tunnel = await localtunnel({ port: 3000, subdomain: randomSub });
    console.log('Tunnel URL successfully established:', tunnel.url);
    tunnel.close();
  } catch (err) {
    console.error('Error establishing tunnel:', err.message || err);
  }
})();
