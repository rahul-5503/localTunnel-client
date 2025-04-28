const Tunnel = require('./lib/Tunnel');

module.exports = function localtunnel(arg1, arg2, arg3) {
  //console.log("localtunnel start");
  const options = typeof arg1 === 'object' ? arg1 : { ...arg2, port: arg1 };
  const callback = typeof arg1 === 'object' ? arg2 : arg3;
  const client = new Tunnel(options);
  if (callback) {
    client.open(err => (err ? callback(err) : callback(null, client)));
   // console.log("localtunnel end");
    return client;
  }
  return new Promise((resolve, reject) =>
    client.open(err => (err ? reject(err) : resolve(client)))
  );
};
