const localtunnel = require('localtunnel');
(async () => {
  try {
    console.log('Connecting to localtunnel...');
    const tunnel = await localtunnel({ port: 3000, subdomain: 'runwars-arena-yash-beta' });
    console.log('Tunnel URL:', tunnel.url);
    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });
  } catch (err) {
    console.error('Error establishing tunnel:', err);
  }
})();
